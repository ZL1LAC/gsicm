import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { Source, Candidate, AcquiredImage } from "../shared/types.js";
import type { Store } from "./store.js";
import { discover, download, inspectImage, retry } from "./acquisition.js";
import { runProcess } from "./engine.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const decoderPython =
  process.env.GSICM_PYTHON ||
  path.join(
    root,
    ".venv-gk2a",
    process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
  );
export function decoderStatus() {
  return {
    ready: existsSync(decoderPython),
    message: existsSync(decoderPython)
      ? "Satellite decoder installed"
      : "Run Setup-Decoders.ps1 on Windows or install .venv-gk2a on Linux before testing raw sources.",
  };
}
export function completeScans(items: Candidate[], product: Source["product"]) {
  if (product !== "himawari-ahi") return items.map((item) => [item]);
  const groups = new Map<string, Candidate[]>();
  for (const item of items) {
    const match =
      /^HS_H09_(\d{8}_\d{4})_B13_FLDK_R20_S(\d{2})10\.DAT\.bz2$/.exec(
        path.posix.basename(item.key),
      );
    if (!match) continue;
    groups.set(match[1], [...(groups.get(match[1]) ?? []), item]);
  }
  return [...groups.values()].filter(
    (group) =>
      group.length === 10 &&
      new Set(group.map((item) => /_S(\d{2})10/.exec(item.key)![1])).size ===
        10 &&
      group.every((item) => {
        const n = Number(/_S(\d{2})10/.exec(item.key)![1]);
        return n >= 1 && n <= 10;
      }),
  );
}
export function decodedTime(value: string, target: Date, tolerance: number) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value))
    throw new Error("Decoder returned a non-UTC observation time");
  const time = new Date(value);
  if (
    !Number.isFinite(+time) ||
    Math.abs(+time - +target) > tolerance * 60000 ||
    +time > Date.now() + 60000
  )
    throw new Error("Decoded observation is outside the required time window");
  return time.toISOString();
}
export async function acquireRaw(
  store: Store,
  source: Source,
  target: Date,
  tolerance: number,
  signal: AbortSignal,
  log: (text: string) => void,
): Promise<AcquiredImage> {
  if (!decoderStatus().ready) throw new Error(decoderStatus().message);
  const cache = store
    .images()
    .filter(
      (i) =>
        i.sourceId === source.id &&
        i.geometry &&
        Math.abs(+new Date(i.observationTime) - +target) <= tolerance * 60000,
    );
  let scans: Candidate[][] = [];
  try {
    scans = completeScans(
      await retry(
        () => discover(source, target, tolerance + 1, store.settings(), signal),
        signal,
      ),
      source.product,
    );
  } catch (error) {
    signal.throwIfAborted();
    if (!cache.length) throw error;
  }
  const options = [
    ...scans.map((scan) => ({
      scan,
      cached: cache.find((i) => i.remoteKey === scan[0].key),
      time: scan[0].observationTime,
    })),
    ...cache
      .filter((i) => !scans.some((scan) => scan[0].key === i.remoteKey))
      .map((cached) => ({
        scan: [] as Candidate[],
        cached,
        time: cached.observationTime,
      })),
  ].sort(
    (a, b) =>
      Math.abs(+new Date(a.time) - +target) -
      Math.abs(+new Date(b.time) - +target),
  );
  let last = "No complete scans in the observation window";
  for (const option of options) {
    signal.throwIfAborted();
    if (option.cached) {
      try {
        await inspectImage(option.cached.path, source);
        log(`Using decoded observation ${option.cached.observationTime}\n`);
        return option.cached;
      } catch {
        store.delete("images", option.cached.id);
      }
    }
    if (!option.scan.length) continue;
    const id = randomUUID(),
      work = path.join(store.root, "work", `decode-${id}`),
      input = path.join(work, "raw"),
      output = path.join(work, "decoded");
    await mkdir(input, { recursive: true });
    try {
      for (const candidate of option.scan) {
        log(`Downloading ${path.posix.basename(candidate.key)}\n`);
        await download(
          source,
          candidate,
          path.join(input, path.posix.basename(candidate.key)),
          store.settings(),
          signal,
        );
      }
      const scripts = {
        "goes-abi": "test-goes.py",
        "gk2a-ami": "test-gk2a.py",
        "himawari-ahi": "test-himawari.py",
      };
      const script = scripts[source.product as keyof typeof scripts];
      if (!script) throw new Error("Unsupported decoder");
      const raw =
        source.product === "himawari-ahi"
          ? input
          : path.join(input, path.posix.basename(option.scan[0].key));
      log(`Decoding ${source.product} and validating Sanchez geometry\n`);
      await runProcess(
        decoderPython,
        [path.join(root, "scripts", script), raw, "--output", output],
        root,
        signal,
        store.settings().processTimeoutMinutes * 60000,
        log,
      );
      const metadata = JSON.parse(
        await readFile(path.join(output, "decoded-metadata.json"), "utf8"),
      );
      const observationTime = decodedTime(
        metadata.observation_start_utc,
        target,
        tolerance,
      );
      const grid = metadata.sanchez_grid ?? metadata.grid;
      if (
        grid?.sweep !== "x" ||
        !Number.isFinite(grid.longitude) ||
        Math.abs(grid.longitude - source.longitude) > 1 ||
        Math.abs(grid.height_m - 35786023) > 1
      )
        throw new Error(
          "Decoded geometry does not match the configured satellite",
        );
      const decoded = path.resolve(metadata.sanchez_input),
        relative = path.relative(output, decoded);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw new Error("Decoder output is outside its workspace");
      const dimensions = await inspectImage(decoded, source);
      const hash = createHash("sha256")
        .update(await readFile(decoded))
        .digest("hex");
      await mkdir(path.join(store.root, "cache"), { recursive: true });
      const final = path.join(store.root, "cache", `${id}.png`);
      signal.throwIfAborted();
      await rename(decoded, final);
      const image: AcquiredImage = {
        id,
        sourceId: source.id,
        observationTime,
        nominalTime: option.time,
        acquiredAt: new Date().toISOString(),
        path: final,
        ...dimensions,
        hash,
        remoteKey: option.scan[0].key,
        geometry: { longitude: grid.longitude, height: grid.height_m },
      };
      store.put("images", id, image);
      return image;
    } catch (error) {
      signal.throwIfAborted();
      last = String(error);
      log(`${last}\n`);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  throw new Error(`${source.name}: ${last}`);
}
