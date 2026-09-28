import { spawn } from "node:child_process";
import {
  mkdir,
  writeFile,
  copyFile,
  rename,
  rm,
  readdir,
  stat,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { addAttributionOverlay } from "./overlay.js";
import type { Store } from "./store.js";
import type {
  Profile,
  SourceRecord,
  Job,
  PublishedOutput,
  AcquiredImage,
} from "../shared/types.js";
import { acquire, inspectImage } from "./acquisition.js";
export function targetTime(now = new Date(), minutes = 10) {
  const step = minutes * 60000;
  return new Date(Math.floor(+now / step) * step - step);
}
export function blockers(profile: Profile, sources: SourceRecord[]) {
  return profile.sourceIds.length
    ? profile.sourceIds.flatMap((id) => {
        const s = sources.find((x) => x.id === id);
        return !s
          ? [`Missing source ${id}`]
          : !s.enabled
            ? [`${s.name} is disabled`]
            : !s.validation?.compatible
              ? [`${s.name}: test and confirm clean geometry first`]
              : [];
      })
    : ["Select at least one required source."];
}
export function sanchezArgs(
  profile: Profile,
  stage: string,
  output: string,
  resources: string,
  target: string,
) {
  const args = [
    profile.projection === "map" ? "reproject" : "geostationary",
    "-s",
    path.join(stage, "inputs"),
    "-o",
    output,
    "-D",
    path.join(stage, "satellites.json"),
    "-p",
    path.join(stage, "paths.json"),
    "-u",
    path.join(resources, profile.underlay),
    "-T",
    target.replace(/\.\d{3}Z$/, ""),
    "-d",
    String(profile.toleranceMinutes),
    "-m",
    String(profile.sourceIds.length),
    "-r",
    String(profile.resolution),
    "-F",
    profile.format,
    "-b",
    String(profile.brightness),
    "-S",
    String(profile.saturation),
    "-t",
    profile.tint,
    "-n",
    "-f",
  ];
  if (profile.projection === "map") args.push("--nocrop");
  else args.push("-l", String(profile.longitude), "-h", String(profile.haze));
  return args;
}

export async function runProcess(
  executable: string,
  args: string[],
  cwd: string,
  signal: AbortSignal,
  timeoutMs: number,
  log: (message: string) => void,
) {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd,
      windowsHide: true,
      shell: false,
    });
    let timedOut = false;
    const abort = () => child.kill();
    signal.addEventListener("abort", abort, { once: true });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => log(String(chunk)));
    child.stderr?.on("data", (chunk) => log(String(chunk)));
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      if (signal.aborted) reject(new Error("Cancelled"));
      else if (timedOut)
        reject(new Error("Process exceeded the processing timeout."));
      else if (code !== 0)
        reject(new Error(`Process exited with code ${code}.`));
      else resolve();
    });
  });
}
export class Engine {
  maintaining = false;
  active?: { id: string; controller: AbortController };
  private ticking = false;
  private lastSlot = "";
  private stopping = false;
  constructor(
    public store: Store,
    public projectRoot: string,
  ) {}
  enqueue(
    profileId: string,
    target = targetTime(new Date(), this.store.settings().pollMinutes),
  ) {
    if (this.stopping) throw new Error("Manager is shutting down.");
    if (this.maintaining)
      throw new Error("Cache cleanup is finishing; retry shortly.");
    const profile = this.store.get<Profile>("profiles", profileId);
    if (!profile) throw new Error("Profile not found.");
    const existing = this.store
      .list<Job>("jobs")
      .find(
        (j) =>
          j.profileId === profileId && ["queued", "running"].includes(j.status),
      );
    if (existing) return existing;
    const reasons = blockers(profile, this.store.sources());
    if (reasons.length) throw new Error(reasons.join("; "));
    const job: Job = {
      id: randomUUID(),
      profileId,
      profileName: profile.name,
      targetTime: target.toISOString(),
      startedAt: new Date().toISOString(),
      status: "queued",
      message: "Waiting for compositor",
      logs: "",
    };
    this.store.put("jobs", job.id, job);
    void this.drain();
    return job;
  }
  cancel(id: string) {
    const job = this.store.get<Job>("jobs", id);
    if (!job) return;
    if (this.active?.id === id) this.active.controller.abort();
    else if (job.status === "queued")
      this.store.put("jobs", id, {
        ...job,
        status: "cancelled",
        finishedAt: new Date().toISOString(),
        message: "Cancelled before starting",
      });
  }
  shutdown() {
    this.stopping = true;
    this.active?.controller.abort();
    for (const job of this.store.list<Job>("jobs"))
      if (job.status === "queued")
        this.finish(
          job.id,
          "interrupted",
          "Manager shut down before starting.",
        );
  }
  log(id: string, text: string) {
    const job = this.store.get<Job>("jobs", id);
    if (job)
      this.store.put("jobs", id, {
        ...job,
        logs: (job.logs + text).slice(-200000),
      });
  }
  async drain() {
    if (this.active || this.stopping) return;
    const job = this.store.list<Job>("jobs").find((j) => j.status === "queued");
    if (!job) return;
    const controller = new AbortController();
    this.active = { id: job.id, controller };
    this.store.put("jobs", job.id, {
      ...job,
      status: "running",
      message: "Acquiring required observations",
    });
    const stage = path.join(this.store.root, "work", job.id);
    try {
      const profile = this.store.get<Profile>("profiles", job.profileId)!;
      const sources = this.store.sources();
      const reasons = blockers(profile, sources);
      if (reasons.length) throw new Error(reasons.join("; "));
      const chosen = profile.sourceIds.map((id) =>
        sources.find((s) => s.id === id)!,
      );
      const images: AcquiredImage[] = [];
      for (const source of chosen) {
        this.log(job.id, `Fetching ${source.name}\n`);
        images.push(
          await acquire(
            this.store,
            source,
            new Date(job.targetTime),
            profile.toleranceMinutes,
            controller.signal,
            (text) => this.log(job.id, text),
          ),
        );
      }
      await mkdir(path.join(stage, "inputs"), { recursive: true });
      const definitions = [];
      const mappings = [];
      for (let i = 0; i < chosen.length; i++) {
        const s = chosen[i],
          img = images[i],
          prefix = `SAT${i}_FD_IR_`,
          stamp = img.observationTime
            .replace(/[-:]/g, "")
            .replace(/\.\d+Z$/, "Z");
        const directory = path.join(stage, "inputs", s.id);
        await mkdir(directory, { recursive: true });
        if (s.product === "elektro-l") {
          const filename = path.posix
            .basename(img.remoteKey)
            .replace(/\.zip$/i, "_9.jpg");
          await copyFile(img.path, path.join(directory, filename));
          definitions.push({
            DisplayName: s.satellite,
            FilenameSuffix: "9",
            FilenameParser: "Electro",
            Longitude: s.longitude,
            Brightness: s.brightness,
            Invert: true,
            Crop: s.crop,
          });
        } else {
          await copyFile(
            img.path,
            path.join(directory, `${prefix}${stamp}.png`),
          );
          definitions.push({
            DisplayName: s.satellite,
            FilenamePrefix: `^${prefix}`,
            FilenameParser: "Goesproc",
            Longitude: img.geometry?.longitude ?? s.longitude,
            Height: img.geometry?.height ?? 35786023,
            LongitudeAdjustment: img.geometry ? 0 : s.longitudeAdjustment,
            Crop: img.geometry ? [0, 0, 0, 0] : s.crop,
            Invert: img.geometry ? false : s.invert,
            Brightness: s.brightness,
          });
        }
        mappings.push({ Satellite: s.satellite, Directory: directory });
      }
      await writeFile(
        path.join(stage, "satellites.json"),
        JSON.stringify(definitions),
      );
      await writeFile(path.join(stage, "paths.json"), JSON.stringify(mappings));
      const output = path.join(stage, `result.${profile.format}`);
      const args = sanchezArgs(
        profile,
        stage,
        output,
        path.join(this.projectRoot, "bin", "Resources"),
        job.targetTime,
      );
      this.log(job.id, `Sanchez ${args.join(" ")}\n`);
      await runProcess(
        path.join(this.projectRoot, "bin", "Sanchez.exe"),
        args,
        stage,
        controller.signal,
        this.store.settings().processTimeoutMinutes * 60000,
        (text) => this.log(job.id, text),
      );
      const annotated = path.join(stage, `annotated.${profile.format}`);
      await addAttributionOverlay(
        output,
        annotated,
        profile,
        job.targetTime,
        chosen,
        images,
        sources,
      );
      await rename(annotated, output);
      const dimensions = await inspectImage(output);
      controller.signal.throwIfAborted();
      const directory = path.join(this.store.root, "outputs");
      await mkdir(directory, { recursive: true });
      const published = path.join(directory, `${job.id}.${profile.format}`);
      await rename(output, published);
      const previous = this.store.get<PublishedOutput>("outputs", profile.id);
      const record: PublishedOutput = {
        profileId: profile.id,
        jobId: job.id,
        path: published,
        publishedAt: new Date().toISOString(),
        targetTime: job.targetTime,
        observations: chosen.map((s, i) => ({
          sourceId: s.id,
          satellite: s.satellite,
          time: images[i].observationTime,
          attribution: s.attribution,
        })),
        ...dimensions,
      };
      this.store.put("outputs", profile.id, record);
      if (previous) await rm(previous.path, { force: true }).catch(() => {});
      this.finish(job.id, "succeeded", "Published complete composite");
    } catch (error) {
      this.finish(
        job.id,
        controller.signal.aborted ? "cancelled" : "failed",
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      await rm(stage, { recursive: true, force: true }).catch(() => {});
      this.active = undefined;
      void this.drain();
    }
  }
  finish(id: string, status: Job["status"], message: string) {
    const job = this.store.get<Job>("jobs", id)!;
    this.store.put("jobs", id, {
      ...job,
      status,
      message,
      finishedAt: new Date().toISOString(),
    });
  }
  async tick(now = new Date()) {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const settings = this.store.settings();
      const slot = targetTime(now, settings.pollMinutes).toISOString();
      if (slot !== this.lastSlot) {
        this.lastSlot = slot;
        for (const p of this.store.profiles())
          if (p.enabled && !blockers(p, this.store.sources()).length)
            this.enqueue(p.id, new Date(slot));
      }
      if (!this.active) {
        this.maintaining = true;
        try {
          await cleanup(this.store, now);
        } finally {
          this.maintaining = false;
        }
      }
    } finally {
      this.ticking = false;
    }
  }
}
export async function cleanup(store: Store, now = new Date()) {
  const cutoff = +now - store.settings().cacheHours * 3600000;
  for (const image of store.images())
    if (+new Date(image.acquiredAt) < cutoff) {
      await safeRemove(store.root, image.path);
      store.delete("images", image.id);
    }
  for (const job of store.list<Job>("jobs"))
    if (
      !["queued", "running"].includes(job.status) &&
      +new Date(job.finishedAt ?? job.startedAt) <
        +now - store.settings().logDays * 86400000
    )
      store.delete("jobs", job.id);
  const keep = new Set([
    ...store.images().map((i) => i.path),
    ...store.outputs().map((o) => o.path),
  ]);
  for (const folder of ["cache", "outputs", "work"]) {
    const dir = path.join(store.root, folder);
    for (const entry of await readdir(dir, { withFileTypes: true }).catch(
      () => [],
    )) {
      const file = path.join(dir, entry.name);
      if (!keep.has(file) && (await stat(file)).mtimeMs < cutoff)
        await safeRemove(store.root, file);
    }
  }
}
async function safeRemove(root: string, file: string) {
  const absolute = path.resolve(file),
    relative = path.relative(path.resolve(root), absolute);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    !["cache", "outputs", "work"].includes(relative.split(path.sep)[0])
  )
    throw new Error("Cleanup path is outside manager storage.");
  await rm(absolute, { recursive: true, force: true });
}
