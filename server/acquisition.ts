import { Client } from "basic-ftp";
import {
  S3Client,
  ListObjectsV2Command,
  type S3ClientConfig,
} from "@aws-sdk/client-s3";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, rename, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import type {
  Source,
  Candidate,
  AcquiredImage,
  Settings,
} from "../shared/types.js";
import type { Store } from "./store.js";

export function elektroDirectories(
  base: string,
  target: Date,
  tolerance: number,
) {
  const step = 30 * 60000;
  const directories: string[] = [];
  for (
    let t = Math.ceil((+target - tolerance * 60000) / step) * step;
    t <= +target + tolerance * 60000;
    t += step
  ) {
    const local = new Date(t + 3 * 3600000);
    const month = local.toLocaleString("en-US", {
      month: "long",
      timeZone: "UTC",
    });
    directories.push(
      `${base}/${local.getUTCFullYear()}/${month}/${String(local.getUTCDate()).padStart(2, "0")}/${String(local.getUTCHours()).padStart(2, "0")}${String(local.getUTCMinutes()).padStart(2, "0")}`,
    );
  }
  return directories;
}

export function template(value: string, date: Date) {
  const iso = date.toISOString();
  const day =
    Math.floor(
      (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) -
        Date.UTC(date.getUTCFullYear(), 0, 1)) /
        86400000,
    ) + 1;
  const tokens: Record<string, string> = {
    YYYY: iso.slice(0, 4),
    MM: iso.slice(5, 7),
    DD: iso.slice(8, 10),
    HH: iso.slice(11, 13),
    mm: iso.slice(14, 16),
    ss: iso.slice(17, 19),
    DDD: String(day).padStart(3, "0"),
  };
  return value.replace(/\{(YYYY|MM|DD|HH|mm|ss|DDD)\}/g, (_, k) => tokens[k]);
}
export function observationTime(key: string, source: Source): string {
  const raw = new RegExp(source.timestampRegex).exec(key)?.[1];
  if (!raw)
    throw new Error(
      "Filename must contain an observation timestamp matching capture group 1.",
    );
  let value = raw;
  if (source.timestampFormat === "minute") {
    const digits = raw.replace("_", "");
    if (!/^\d{12}$/.test(digits)) throw new Error("Expected YYYYMMDDHHmm.");
    value = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}T${digits.slice(8, 10)}:${digits.slice(10, 12)}:00Z`;
  }
  if (source.timestampFormat === "elektro") {
    if (!/^\d{6}_\d{4}$/.test(raw)) throw new Error("Expected YYMMDD_HHmm.");
    value = `20${raw.slice(0, 2)}-${raw.slice(2, 4)}-${raw.slice(4, 6)}T${raw.slice(7, 9)}:${raw.slice(9, 11)}:00Z`;
  }
  if (source.timestampFormat === "compact") {
    if (!/^\d{8}T\d{6}Z$/.test(raw))
      throw new Error("Expected YYYYMMDDTHHmmssZ.");
    value = `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}T${raw.slice(9, 11)}:${raw.slice(11, 13)}:${raw.slice(13, 15)}Z`;
  }
  if (source.timestampFormat === "julian") {
    if (!/^\d{13}$/.test(raw)) throw new Error("Expected YYYYDDDHHmmss.");
    const year = +raw.slice(0, 4),
      day = +raw.slice(4, 7),
      hour = +raw.slice(7, 9),
      minute = +raw.slice(9, 11),
      second = +raw.slice(11, 13);
    const d = new Date(Date.UTC(year, 0, day, hour, minute, second));
    if (
      day < 1 ||
      day > 366 ||
      d.getUTCFullYear() !== year ||
      hour > 23 ||
      minute > 59 ||
      second > 59
    )
      throw new Error("Invalid Julian timestamp.");
    return d.toISOString();
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value))
    throw new Error("Observation timestamps must use UTC.");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 19) !== value.slice(0, 19)
  )
    throw new Error("Invalid observation timestamp.");
  return new Date(
    +date - (source.timestampFormat === "elektro" ? 3 * 3600000 : 0),
  ).toISOString();
}
export function candidates(
  keys: { key: string; url: string }[],
  source: Source,
  target: Date,
  tolerance: number,
) {
  const pattern = new RegExp(source.pattern);
  return keys
    .flatMap((k) => {
      try {
        if (!pattern.test(k.key)) return [];
        const t = observationTime(k.key, source);
        return Math.abs(+new Date(t) - +target) <= tolerance * 60000 &&
          +new Date(t) <= Date.now() + 60000
          ? [{ ...k, observationTime: t }]
          : [];
      } catch {
        return [];
      }
    })
    .sort(
      (a, b) =>
        Math.abs(+new Date(a.observationTime) - +target) -
          Math.abs(+new Date(b.observationTime) - +target) ||
        b.observationTime.localeCompare(a.observationTime),
    );
}
function remoteUrl(value: string, protocols: string[]) {
  const u = new URL(value);
  if (!protocols.includes(u.protocol))
    throw new Error(
      "Source URL protocol does not match the selected transport.",
    );
  return u;
}
async function ftp<T>(
  source: Source,
  settings: Settings,
  signal: AbortSignal,
  fn: (client: Client, url: URL) => Promise<T>,
) {
  const url = remoteUrl(source.location, ["ftp:", "ftps:"]);
  const client = new Client(settings.downloadTimeoutSeconds * 1000);
  const abort = () => client.close();
  signal.throwIfAborted();
  signal.addEventListener("abort", abort, { once: true });
  try {
    await client.access({
      host: url.hostname,
      port: Number(url.port) || 21,
      user: source.username || "anonymous",
      password: source.password || "anonymous@example.com",
      secure: source.transport === "ftps",
    });
    return await fn(client, url);
  } finally {
    client.close();
    signal.removeEventListener("abort", abort);
  }
}
export function anonymousS3(config: S3ClientConfig = {}) {
  return new S3Client({
    region: "us-east-1",
    ...config,
    credentials: { accessKeyId: "anonymous", secretAccessKey: "anonymous" },
    signer: { sign: async (request) => request },
  });
}
export async function discover(
  source: Source,
  target: Date,
  tolerance: number,
  settings: Settings,
  signal: AbortSignal,
  s3Factory: (region: string) => S3Client = (region) => anonymousS3({ region }),
): Promise<Candidate[]> {
  signal = AbortSignal.any([
    signal,
    AbortSignal.timeout(settings.downloadTimeoutSeconds * 1000),
  ]);
  signal.throwIfAborted();
  const keys: { key: string; url: string }[] = [];
  if (source.transport === "http") {
    remoteUrl(source.location, ["http:", "https:"]);
    const step = source.cadenceMinutes * 60000;
    for (
      let time = Math.floor((+target - tolerance * 60000) / step) * step;
      time <= +target + tolerance * 60000;
      time += step
    ) {
      const url = template(source.location, new Date(time));
      if (!keys.some((k) => k.url === url))
        keys.push({ key: decodeURIComponent(new URL(url).pathname), url });
    }
  } else if (source.transport === "ftp" || source.transport === "ftps") {
    await ftp(source, settings, signal, async (client, url) => {
      if (source.product === "elektro-l" || source.product === "elektro-rgb") {
        const base = decodeURIComponent(url.pathname).replace(/\/$/, "");
        for (const directory of elektroDirectories(base, target, tolerance)) {
          signal.throwIfAborted();
          try {
            for (const f of await client.list(directory))
              if (f.isFile)
                keys.push({
                  key: path.posix.join(directory, f.name),
                  url: path.posix.join(directory, f.name),
                });
          } catch (error) {
            if ((error as { code?: number }).code !== 550) throw error;
          }
        }
        return;
      }
      const directories = new Set<string>();
      for (
        let t = +target - tolerance * 60000;
        t <= +target + tolerance * 60000;
        t += 60000
      )
        directories.add(
          template(decodeURIComponent(url.pathname), new Date(t)),
        );
      for (const directory of directories) {
        signal.throwIfAborted();
        const entries = await client.list(directory);
        for (const f of entries)
          if (f.isFile ?? f.type === 1)
            keys.push({
              key: path.posix.join(directory, f.name),
              url: path.posix.join(directory, f.name),
            });
      }
    });
  } else {
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(source.bucket))
      throw new Error("Enter a valid public S3 bucket.");
    const client = s3Factory(source.awsRegion);
    const prefixes = new Set<string>();
    const step =
      source.product === "himawari-ahi" ? source.cadenceMinutes * 60000 : 60000;
    for (
      let t = Math.floor((+target - tolerance * 60000) / step) * step;
      t <= +target + tolerance * 60000;
      t += step
    )
      prefixes.add(template(source.prefix, new Date(t)));
    try {
      for (const prefix of prefixes) {
        let token: string | undefined;
        let pages = 0;
        do {
          const page = await client.send(
            new ListObjectsV2Command({
              Bucket: source.bucket,
              Prefix: prefix,
              ContinuationToken: token,
            }),
            { abortSignal: signal },
          );
          for (const o of page.Contents ?? [])
            if (o.Key)
              keys.push({
                key: o.Key,
                url: `https://${source.bucket.includes(".") ? `s3.${source.awsRegion}.amazonaws.com/${source.bucket}` : `${source.bucket}.s3.${source.awsRegion}.amazonaws.com`}/${o.Key.split("/").map(encodeURIComponent).join("/")}`,
              });
          token = page.NextContinuationToken;
          if (++pages >= 20 && token)
            throw new Error("S3 listing too broad; narrow the prefix.");
        } while (token);
      }
    } finally {
      client.destroy();
    }
  }
  return candidates(keys, source, target, tolerance);
}
export async function retry<T>(
  action: () => Promise<T>,
  signal: AbortSignal,
  attempts = 3,
): Promise<T> {
  for (let n = 0; ; n++) {
    signal.throwIfAborted();
    try {
      return await action();
    } catch (error) {
      signal.throwIfAborted();
      if (n >= attempts - 1 || (error as { permanent?: boolean }).permanent)
        throw error;
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          clearTimeout(timer);
          reject(signal.reason);
        };
        const timer = setTimeout(
          () => {
            signal.removeEventListener("abort", abort);
            resolve();
          },
          300 * 2 ** n,
        );
        signal.addEventListener("abort", abort, { once: true });
      });
    }
  }
}
export async function download(
  source: Source,
  candidate: Candidate,
  destination: string,
  settings: Settings,
  signal: AbortSignal,
) {
  await retry(async () => {
    const timeout = AbortSignal.timeout(settings.downloadTimeoutSeconds * 1000);
    const combined = AbortSignal.any([signal, timeout]);
    let bytes = 0;
    const limiter = new Transform({
      transform(chunk, _encoding, cb) {
        bytes += chunk.length;
        cb(
          bytes > settings.maxDownloadMb * 1024 * 1024
            ? Object.assign(new Error("Download exceeds size limit."), {
                permanent: true,
              })
            : null,
          chunk,
        );
      },
    });
    try {
      if (source.transport === "ftp" || source.transport === "ftps")
        await ftp(source, settings, combined, async (client) => {
          const writing = pipeline(limiter, createWriteStream(destination), {
            signal: combined,
          });
          const reading = client
            .downloadTo(limiter, candidate.url)
            .catch((error) => {
              limiter.destroy(error);
              throw error;
            });
          const results = await Promise.allSettled([reading, writing]);
          for (const r of results) if (r.status === "rejected") throw r.reason;
        });
      else {
        const response = await fetch(candidate.url, { signal: combined });
        if (!response.ok) {
          await response.body?.cancel();
          throw Object.assign(new Error(`HTTP ${response.status}`), {
            permanent: response.status < 500 && response.status !== 429,
          });
        }
        if (!response.body) throw new Error("Empty response.");
        await pipeline(
          Readable.fromWeb(response.body as never),
          limiter,
          createWriteStream(destination),
          { signal: combined },
        );
      }
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
  }, signal);
}
export async function inspectImage(file: string, source?: Source) {
  const image = sharp(file, {
    failOn: "warning",
    limitInputPixels: source ? 400_000_000 : 1_000_000_000,
  });
  const meta = await image.metadata();
  if (
    !["png", "jpeg", "gif", "tiff", "webp"].includes(meta.format ?? "") ||
    !meta.width ||
    !meta.height ||
    (meta.pages ?? 1) > 1
  )
    throw new Error("Expected a single rendered raster image.");
  await image.stats();
  if (
    source &&
    (meta.width !== source.expectedWidth ||
      meta.height !== source.expectedHeight)
  )
    throw new Error(
      `Geometry mismatch: received ${meta.width} × ${meta.height}; expected ${source.expectedWidth} × ${source.expectedHeight}.`,
    );
  return { width: meta.width, height: meta.height };
}
export async function acquire(
  store: Store,
  source: Source,
  target: Date,
  tolerance: number,
  signal: AbortSignal,
  log: (message: string) => void = () => {},
): Promise<AcquiredImage> {
  if (source.product === "elektro-l" || source.product === "elektro-rgb") {
    const { acquireElektro, acquireElektroRgb } = await import("./elektro.js");
    return source.product === "elektro-rgb"
      ? acquireElektroRgb(store, source, target, tolerance, signal, log)
      : acquireElektro(store, source, target, tolerance, signal, log);
  }
  if (source.product && source.product !== "raster") {
    const { acquireRaw } = await import("./raw.js");
    return acquireRaw(store, source, target, tolerance, signal, log);
  }
  const cache = store
    .images()
    .filter(
      (i) =>
        i.sourceId === source.id &&
        Math.abs(+new Date(i.observationTime) - +target) <= tolerance * 60000,
    );
  let available: Candidate[];
  try {
    available = await retry(
      () => discover(source, target, tolerance, store.settings(), signal),
      signal,
    );
  } catch (error) {
    signal.throwIfAborted();
    if (!cache.length) throw error;
    available = [];
  }
  const options = [
    ...available.map((c) => ({
      time: c.observationTime,
      candidate: c,
      cached: cache.find((i) => i.observationTime === c.observationTime),
    })),
    ...cache
      .filter(
        (i) => !available.some((c) => c.observationTime === i.observationTime),
      )
      .map((i) => ({
        time: i.observationTime,
        candidate: undefined,
        cached: i,
      })),
  ].sort(
    (a, b) =>
      Math.abs(+new Date(a.time) - +target) -
      Math.abs(+new Date(b.time) - +target),
  );
  const dir = path.join(store.root, "cache");
  await mkdir(dir, { recursive: true });
  let last = "No timestamped images fall within the tolerance.";
  for (const option of options) {
    signal.throwIfAborted();
    if (option.cached) {
      try {
        await inspectImage(option.cached.path, source);
        return option.cached;
      } catch {
        store.delete("images", option.cached.id);
      }
    }
    if (!option.candidate) continue;
    const id = randomUUID(),
      temp = path.join(dir, `${id}.part`),
      normalized = path.join(dir, `${id}.png.part`),
      final = path.join(dir, `${id}.png`);
    try {
      await download(source, option.candidate, temp, store.settings(), signal);
      const dimensions = await inspectImage(temp, source);
      await sharp(temp).png().toFile(normalized);
      signal.throwIfAborted();
      const hash = createHash("sha256")
        .update(await readFile(normalized))
        .digest("hex");
      await rename(normalized, final);
      const image: AcquiredImage = {
        id,
        sourceId: source.id,
        observationTime: option.time,
        acquiredAt: new Date().toISOString(),
        path: final,
        ...dimensions,
        hash,
        remoteKey: option.candidate.key,
      };
      store.put("images", id, image);
      return image;
    } catch (error) {
      signal.throwIfAborted();
      last = String(error);
    } finally {
      await rm(temp, { force: true });
      await rm(normalized, { force: true });
    }
  }
  throw new Error(`${source.name}: ${last}`);
}
