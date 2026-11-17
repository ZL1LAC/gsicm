import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { sourceSchema } from "../shared/types.js";
import type { Source, Candidate, AcquiredImage } from "../shared/types.js";
import type { Store } from "./store.js";
import { download, inspectImage } from "./acquisition.js";
import { decoderPython, decoderStatus, decodedTime } from "./raw.js";
import { runProcess } from "./engine.js";

export const eumetviewPreset = sourceSchema.parse({
  id: "eumetview-iodc",
  name: "Meteosat-9 IODC IR10.8",
  satellite: "Meteosat-9-IODC",
  region: "Indian Ocean",
  enabled: true,
  product: "eumetview-iodc",
  transport: "http",
  location: "https://view.eumetsat.int/geoserver/wms",
  longitude: 45.5,
  expectedWidth: 5424,
  expectedHeight: 5424,
  cadenceMinutes: 15,
  attribution: "EUMETSAT EUMETView Meteosat-9 SEVIRI IR10.8",
  cleanConfirmed: true,
});

export async function acquireEumetview(
  store: Store,
  source: Source,
  target: Date,
  tolerance: number,
  signal: AbortSignal,
  log: (message: string) => void,
): Promise<AcquiredImage> {
  if (!decoderStatus().ready) throw new Error(decoderStatus().message);
  if (source.transport !== "http" || source.longitude !== 45.5)
    throw new Error("EUMETView IODC requires HTTP and longitude 45.5°E.");
  const id = randomUUID();
  const work = path.join(store.root, "work", `iodc-${id}`);
  const script = fileURLToPath(
    new URL("../scripts/reproject-eumetview.py", import.meta.url),
  );
  const capabilities = path.join(work, "capabilities.xml");
  const manifest = path.join(work, "observation.json");
  const input = path.join(work, "geographic.png");
  const output = path.join(work, "satellite.png");
  await mkdir(work, { recursive: true });
  try {
    const url = new URL(source.location);
    const parameters = {
      service: "WMS",
      request: "GetCapabilities",
      version: "1.3.0",
    };
    // WMS parameter names are case-insensitive; replace stale WMS values
    // while retaining endpoint-specific selectors and credentials.
    for (const key of [...url.searchParams.keys()])
      if (Object.hasOwn(parameters, key.toLowerCase()))
        url.searchParams.delete(key);
    for (const [key, value] of Object.entries(parameters))
      url.searchParams.set(key, value);
    await download(
      source,
      { key: "capabilities", url: url.href, observationTime: "" },
      capabilities,
      {
        ...store.settings(),
        maxDownloadMb: Math.min(10, store.settings().maxDownloadMb),
      },
      signal,
    );
    await runProcess(
      decoderPython,
      [
        script,
        "--capabilities",
        capabilities,
        "--target",
        target.toISOString(),
        "--tolerance",
        String(tolerance),
        "--endpoint",
        source.location,
        "--output",
        manifest,
      ],
      work,
      signal,
      30000,
      log,
    );
    const candidate: Candidate = JSON.parse(await readFile(manifest, "utf8"));
    const observationTime = decodedTime(
      candidate.observationTime,
      target,
      tolerance,
    );
    const cached = store
      .images()
      .find(
        (i) =>
          i.sourceId === source.id &&
          i.remoteKey === candidate.key &&
          i.geometry?.longitude === 45.5,
      );
    if (cached) {
      try {
        await inspectImage(cached.path, source);
        return cached;
      } catch {
        store.delete("images", cached.id);
      }
    }
    log(`Downloading Meteosat-9 IODC IR10.8 at ${observationTime}\n`);
    await download(source, candidate, input, store.settings(), signal);
    log(
      "Reprojecting EUMETView geographic imagery to the Sanchez sweep-X grid\n",
    );
    await runProcess(
      decoderPython,
      [script, "--source", input, "--output", output],
      work,
      signal,
      store.settings().processTimeoutMinutes * 60000,
      log,
    );
    const dimensions = await inspectImage(output, source);
    const hash = createHash("sha256")
      .update(await readFile(output))
      .digest("hex");
    const final = path.join(store.root, "cache", `${id}.png`);
    await mkdir(path.dirname(final), { recursive: true });
    signal.throwIfAborted();
    await rename(output, final);
    const image: AcquiredImage = {
      id,
      sourceId: source.id,
      observationTime,
      acquiredAt: new Date().toISOString(),
      path: final,
      ...dimensions,
      hash,
      remoteKey: candidate.key,
      geometry: { longitude: 45.5, height: 35786023 },
    };
    store.put("images", id, image);
    return image;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
