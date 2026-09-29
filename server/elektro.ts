import path from "node:path";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { discover, download, inspectImage, retry } from "./acquisition.js";
import { runProcess } from "./engine.js";
import { decoderPython } from "./raw.js";
import type { Store } from "./store.js";
import type { Source, AcquiredImage } from "../shared/types.js";

export async function acquireElektro(
  store: Store,
  source: Source,
  target: Date,
  tolerance: number,
  signal: AbortSignal,
  log: (s: string) => void,
): Promise<AcquiredImage> {
  const cached = store
    .images()
    .filter(
      (i) =>
        i.sourceId === source.id &&
        i.remoteKey.endsWith(".zip") &&
        Math.abs(+new Date(i.observationTime) - +target) <= tolerance * 60000,
    );
  const available = await retry(
    () => discover(source, target, tolerance, store.settings(), signal),
    signal,
  );
  if (!available.length)
    throw new Error(
      `${source.name}: no archived ZIP within ±${tolerance} minutes of ${target.toISOString()} (FTP folders use Moscow UTC+3).`,
    );
  let last = "No usable channel 9";
  for (const candidate of available) {
    const hit = cached.find((i) => i.remoteKey === candidate.key);
    if (hit) {
      try {
        await inspectImage(hit.path, source);
        return hit;
      } catch {
        store.delete("images", hit.id);
      }
    }
    const id = randomUUID(),
      dir = path.join(store.root, "work", `electro-${id}`);
    await mkdir(dir, { recursive: true });
    try {
      const archive = path.join(dir, "observation.zip"),
        channel = path.join(dir, "channel.jpg");
      log(
        `Downloading Elektro full-resolution archive ${candidate.key}; observation ${candidate.observationTime}\n`,
      );
      await download(source, candidate, archive, store.settings(), signal);
      const name = path.posix
        .basename(candidate.key)
        .replace(/\.zip$/i, "_9.jpg");
      await runProcess(
        decoderPython,
        [
          fileURLToPath(
            new URL("../scripts/extract-elektro.py", import.meta.url),
          ),
          archive,
          channel,
          name,
        ],
        dir,
        signal,
        60000,
        log,
      );
      const dimensions = await inspectImage(channel, source);
      const hash = createHash("sha256")
        .update(await readFile(channel))
        .digest("hex");
      await mkdir(path.join(store.root, "cache"), { recursive: true });
      const final = path.join(store.root, "cache", `${id}.jpg`);
      signal.throwIfAborted();
      await rename(channel, final);
      const image: AcquiredImage = {
        id,
        sourceId: source.id,
        observationTime: candidate.observationTime,
        acquiredAt: new Date().toISOString(),
        path: final,
        ...dimensions,
        hash,
        remoteKey: candidate.key,
      };
      store.put("images", id, image);
      return image;
    } catch (error) {
      signal.throwIfAborted();
      last = String(error);
      log(`${last}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  throw new Error(`${source.name}: ${last}`);
}

export async function acquireElektroRgb(
  store: Store,
  source: Source,
  target: Date,
  tolerance: number,
  signal: AbortSignal,
  log: (s: string) => void,
): Promise<AcquiredImage> {
  const cached = store
    .images()
    .filter(
      (i) =>
        i.sourceId === source.id &&
        i.remoteKey.endsWith(".jpg") &&
        Math.abs(+new Date(i.observationTime) - +target) <= tolerance * 60000,
    );
  const available = await retry(
    () => discover(source, target, tolerance, store.settings(), signal),
    signal,
  );
  if (!available.length)
    throw new Error(
      `${source.name}: no RGB JPEG within ±${tolerance} minutes of ${target.toISOString()} (FTP folders use Moscow UTC+3).`,
    );
  let last = "No usable RGB JPEG";
  for (const candidate of available) {
    const hit = cached.find((i) => i.remoteKey === candidate.key);
    if (hit) {
      try {
        await inspectImage(hit.path, source);
        return hit;
      } catch {
        store.delete("images", hit.id);
      }
    }
    const id = randomUUID(),
      dir = path.join(store.root, "work", `electro-rgb-${id}`);
    await mkdir(dir, { recursive: true });
    try {
      const downloaded = path.join(dir, "observation.jpg");
      log(
        `Downloading Elektro RGB full-disc ${candidate.key}; observation ${candidate.observationTime}\n`,
      );
      await download(source, candidate, downloaded, store.settings(), signal);
      const dimensions = await inspectImage(downloaded, source);
      const hash = createHash("sha256")
        .update(await readFile(downloaded))
        .digest("hex");
      await mkdir(path.join(store.root, "cache"), { recursive: true });
      const final = path.join(store.root, "cache", `${id}.jpg`);
      signal.throwIfAborted();
      await rename(downloaded, final);
      const image: AcquiredImage = {
        id,
        sourceId: source.id,
        observationTime: candidate.observationTime,
        acquiredAt: new Date().toISOString(),
        path: final,
        ...dimensions,
        hash,
        remoteKey: candidate.key,
      };
      store.put("images", id, image);
      return image;
    } catch (error) {
      signal.throwIfAborted();
      last = String(error);
      log(`${last}\n`);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
  throw new Error(`${source.name}: ${last}`);
}
