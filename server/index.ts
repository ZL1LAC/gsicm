import express from "express";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdir, mkdir, unlink, open } from "node:fs/promises";
import {
  sourceSchema,
  profileSchema,
  settingsSchema,
  type SourceRecord,
  type Profile,
  type Job,
  type AcquiredImage,
  type PublishedOutput,
} from "../shared/types.js";
import { Store } from "./store.js";
import { Engine, blockers, targetTime } from "./engine.js";
import { acquire } from "./acquisition.js";

export async function createApp(
  root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  data = path.join(root, "data"),
  shutdown?: () => void,
) {
  const store = new Store(data),
    engine = new Engine(store, root),
    app = express(),
    password = process.env.GSICM_PASSWORD?.trim(),
    sessionToken = password ? crypto.randomBytes(32).toString("base64url") : "";
  app.use((req, res, next) => {
    const host = req.hostname;
    if (!["127.0.0.1", "localhost", "::1"].includes(host))
      return res.status(403).json({ error: "Local connections only." });
    const origin = req.headers.origin;
    if (origin && origin !== `http://${req.headers.host}`)
      return res.status(403).json({ error: "Untrusted origin." });
    if (!["GET", "HEAD"].includes(req.method) && !req.is("application/json"))
      return res.status(415).json({ error: "JSON requests required." });
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });
  app.use(express.json({ limit: "128kb" }));
  const cookie = (req: express.Request, name: string) =>
    req.headers.cookie
      ?.split(";")
      .map((part) => part.trim().split("="))
      .find(([key]) => key === name)?.[1];
  const authorized = (req: express.Request) =>
    !password || cookie(req, "gsicm_session") === sessionToken;
  app.get("/api/auth", (req, res) =>
    res.json({ required: !!password, authenticated: authorized(req) }),
  );
  app.post("/api/login", (req, res) => {
    if (!password) return res.json({ ok: true });
    const attempt = String(req.body?.password ?? "");
    const expected = Buffer.from(password);
    const actual = Buffer.from(attempt);
    const matches =
      expected.length === actual.length &&
      crypto.timingSafeEqual(expected, actual);
    if (!matches) return res.status(401).json({ error: "Incorrect password." });
    res.cookie("gsicm_session", sessionToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: false,
      path: "/",
    });
    res.json({ ok: true });
  });
  app.post("/api/logout", (_req, res) => {
    res.clearCookie("gsicm_session", { path: "/" });
    res.json({ ok: true });
  });
  app.use("/api", (req, res, next) =>
    authorized(req)
      ? next()
      : res.status(401).json({ error: "Password login required." }),
  );
  const resources = path.join(root, "bin", "Resources");
  const underlays = (await readdir(resources)).filter((f) =>
    /^world\..*\.(jpg|png)$/.test(f),
  );
  app.get("/api/state", (_req, res) =>
    res.json({
      sources: store.sources(),
      profiles: store
        .profiles()
        .filter(
          (p) =>
            !store.get("profiles", "pacific-raw") ||
            !["map", "globe"].includes(p.id),
        )
        .map((p) => ({ ...p, blockers: blockers(p, store.sources()) })),
      settings: store.settings(),
      jobs: store
        .list<Job>("jobs")
        .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
        .map(({ logs, ...j }) => j),
      outputs: store.outputs().map(({ path: _, ...o }) => o),
      underlays,
      activeJob: engine.active?.id,
    }),
  );
  app.post("/api/presets/install", (_req, res) => {
    if (locked())
      return res.status(409).json({ error: "Wait for active operations." });
    const presets = [
      [
        "aws-goes19",
        "GOES-19 ABI C13",
        "GOES-19",
        "Americas",
        -75.2,
        "goes-abi",
        "M6C13_G19_.*\\.nc$",
        "_s(\\d{13})",
        "julian",
        "noaa-goes19",
        "ABI-L1b-RadF/{YYYY}/{DDD}/{HH}/",
      ],
      [
        "aws-goes18",
        "GOES-18 ABI C13",
        "GOES-18",
        "Americas",
        -137,
        "goes-abi",
        "M6C13_G18_.*\\.nc$",
        "_s(\\d{13})",
        "julian",
        "noaa-goes18",
        "ABI-L1b-RadF/{YYYY}/{DDD}/{HH}/",
      ],
      [
        "aws-gk2a",
        "GK-2A AMI IR105",
        "GK2A-AMI-IR105",
        "Asia-Pacific",
        128.2,
        "gk2a-ami",
        "gk2a_ami_le1b_ir105_fd020ge_.*\\.nc$",
        "(\\d{12})",
        "minute",
        "noaa-gk2a-pds",
        "AMI/L1B/FD/{YYYY}{MM}/{DD}/{HH}/",
      ],
      [
        "aws-himawari9",
        "Himawari-9 AHI B13",
        "Himawari-9-AHI-B13",
        "Asia-Pacific",
        140.7,
        "himawari-ahi",
        "HS_H09_.*_B13_FLDK_R20_S(?:0[1-9]|10)10\\.DAT\\.bz2$",
        "(\\d{8}_\\d{4})",
        "minute",
        "noaa-himawari9",
        "AHI-L1b-FLDK/{YYYY}/{MM}/{DD}/{HH}{mm}/",
      ],
    ] as const;
    for (const [
      id,
      name,
      satellite,
      region,
      longitude,
      product,
      pattern,
      timestampRegex,
      timestampFormat,
      bucket,
      prefix,
    ] of presets) {
      if (!store.get("sources", id))
        store.put(
          "sources",
          id,
          sourceSchema.parse({
            id,
            name,
            satellite,
            region,
            longitude,
            product,
            pattern,
            timestampRegex,
            timestampFormat,
            bucket,
            prefix,
            location: "",
            enabled: true,
            transport: "s3",
            attribution: `NOAA public AWS: ${bucket}`,
            cleanConfirmed: true,
            blocker: "",
          }),
        );
    }
    for (const [id, name, satellite, longitude, folder] of [
      ["electro-l2", "Electro-L No.2", "Electro-L N2", -14.5, "ELECTRO_L_2"],
      ["electro-l3", "Electro-L No.3", "Electro-L N3", 76, "ELECTRO_L_3"],
    ] as const) {
      if (!store.get("sources", id))
        store.put(
          "sources",
          id,
          sourceSchema.parse({
            id,
            name,
            satellite,
            region: "Eurasia / Indian Ocean",
            longitude,
            enabled: false,
            product: "elektro-l",
            transport: "ftp",
            location: `ftp://ntsomz.gptl.ru:2121/${folder}/`,
            username: "electro",
            password: "electro",
            expectedWidth: 2784,
            expectedHeight: 2784,
            crop: [0.012703, 0.012703, 0.012703, 0.012703],
            invert: true,
            brightness: id === "electro-l2" ? 1.2 : 1.3,
            cadenceMinutes: 30,
            pattern: "\\d{6}_\\d{4}\\.zip$",
            timestampRegex: "(\\d{6}_\\d{4})",
            timestampFormat: "elektro",
            attribution: "NTSOMZ Elektro-L FTP",
            blocker:
              "Test full-resolution channel 9 from ZIP; archive times are Moscow UTC+3.",
          }),
        );
    }
    if (!store.get("sources", "electro-l4"))
      store.put(
        "sources",
        "electro-l4",
        sourceSchema.parse({
          id: "electro-l4",
          name: "Electro-L No.4",
          satellite: "Electro-L N4",
          region: "Western Pacific",
          longitude: 165.8,
          enabled: false,
          product: "elektro-rgb",
          transport: "ftp",
          location: "ftp://ntsomz.gptl.ru:2121/ELECTRO_L_4/",
          username: "electro",
          password: "electro",
          expectedWidth: 11136,
          expectedHeight: 11136,
          crop: [0.012703, 0.012703, 0.012703, 0.012703],
          invert: false,
          brightness: 1,
          cadenceMinutes: 30,
          pattern: "\\d{6}_\\d{4}_original_RGB_VIS_IR\\.jpg$",
          timestampRegex: "(\\d{6}_\\d{4})",
          timestampFormat: "elektro",
          attribution: "NTSOMZ Elektro-L FTP RGB VIS/IR",
          blocker: "Test RGB full-disc JPEG; archive times are Moscow UTC+3.",
        }),
      );
    res.json({ installed: presets.map(([id]) => id) });
  });
  const locked = () =>
    !!engine.active ||
    engine.maintaining ||
    store.list<Job>("jobs").some((j) => j.status === "queued") ||
    testing.size > 0;
  const testing = new Set<string>();
  app.put("/api/sources/:id", (req, res) => {
    if (locked())
      return res.status(409).json({
        error:
          "Wait for active jobs and source tests before editing configuration.",
      });
    const source = sourceSchema.parse({ ...req.body, id: req.params.id });
    new RegExp(source.pattern);
    new RegExp(source.timestampRegex);
    if (source.enabled && !source.location && source.transport !== "s3")
      throw new Error("Enter a source URL.");
    const prior = store.get<SourceRecord>("sources", source.id);
    const unchanged =
      prior &&
      JSON.stringify({
        ...prior,
        validation: undefined,
        enabled: undefined,
      }) ===
        JSON.stringify({
          ...source,
          validation: undefined,
          enabled: undefined,
        });
    store.put("sources", source.id, {
      ...source,
      ...(unchanged ? { validation: prior.validation } : {}),
    });
    if (!unchanged)
      for (const image of store
        .images()
        .filter((i) => i.sourceId === source.id))
        store.delete("images", image.id);
    res.json({ ok: true });
  });
  app.delete("/api/sources/:id", (req, res) => {
    if (locked())
      return res.status(409).json({ error: "Processing is active." });
    if (store.profiles().some((p) => p.sourceIds.includes(req.params.id)))
      return res
        .status(409)
        .json({ error: "Remove this source from profiles first." });
    store.delete("sources", req.params.id);
    res.json({ ok: true });
  });
  app.post("/api/sources/:id/test", async (req, res) => {
    const source = store.get<SourceRecord>("sources", req.params.id);
    if (!source) return res.status(404).json({ error: "Source not found." });
    if (locked())
      return res
        .status(409)
        .json({ error: "Wait for the active operation to finish." });
    testing.add(source.id);
    try {
      const requestedTarget = req.body?.targetTime
        ? new Date(req.body.targetTime)
        : targetTime(new Date(), store.settings().pollMinutes);
      if (!Number.isFinite(+requestedTarget))
        throw new Error("targetTime must be a valid UTC timestamp.");
      const image = await acquire(
        store,
        source,
        requestedTarget,
        30,
        AbortSignal.timeout(
          source.product === "elektro-l" || source.product === "elektro-rgb"
            ? 900000
            : 180000,
        ),
      );
      const validation = {
        at: new Date().toISOString(),
        compatible: source.cleanConfirmed,
        message: source.cleanConfirmed
          ? `Image validated at ${image.observationTime}. ${
              source.product === "elektro-l"
                ? "Full-resolution MSU-GS channel 9; Moscow filename converted to UTC."
                : source.product === "elektro-rgb"
                  ? "Full-disc RGB VIS/IR JPEG; Moscow filename converted to UTC."
                  : "Dimensions and observation timestamp match. Clean imagery confirmed by operator."
            }`
          : "Image decoded. Inspect preview, verify full-disc geometry and absence of labels/coastlines, then confirm and retest.",
        imageId: image.id,
      };
      store.put("sources", source.id, { ...source, validation });
      res.json({ ...validation, image: { ...image, path: undefined } });
    } catch (error) {
      const validation = {
        at: new Date().toISOString(),
        compatible: false,
        message: String(error),
      };
      store.put("sources", source.id, { ...source, validation });
      res.status(422).json(validation);
    } finally {
      testing.delete(source.id);
    }
  });
  app.get("/api/images/:id", (req, res) => {
    const image = store.get<AcquiredImage>("images", req.params.id);
    if (!image) return res.sendStatus(404);
    res.sendFile(image.path);
  });
  app.put("/api/profiles/:id", (req, res) => {
    if (locked())
      return res.status(409).json({ error: "Processing is active." });
    const profile = profileSchema.parse({ ...req.body, id: req.params.id });
    if (!underlays.includes(profile.underlay))
      throw new Error("Choose a bundled underlay.");
    if (new Set(profile.sourceIds).size !== profile.sourceIds.length)
      throw new Error("Duplicate required sources.");
    const names = profile.sourceIds.map(
      (id) => store.get<SourceRecord>("sources", id)?.satellite,
    );
    if (names.some((n) => !n) || new Set(names).size !== names.length)
      throw new Error(
        "Choose existing sources with distinct satellite identities.",
      );
    store.put("profiles", profile.id, profile);
    res.json({ ok: true });
  });
  app.post("/api/profiles/:id/run", (req, res) => {
    if (testing.size)
      return res.status(409).json({ error: "Source testing is active." });
    let target: Date | undefined;
    if (req.body?.targetTime !== undefined) {
      target = new Date(req.body.targetTime);
      if (!Number.isFinite(+target))
        return res
          .status(400)
          .json({ error: "targetTime must be a valid UTC timestamp." });
    }
    res.json(engine.enqueue(req.params.id, target));
  });
  app.get("/api/jobs/:id", (req, res) => {
    const job = store.get<Job>("jobs", req.params.id);
    job ? res.json(job) : res.sendStatus(404);
  });
  app.post("/api/jobs/:id/cancel", (req, res) => {
    engine.cancel(req.params.id);
    res.json({ ok: true });
  });
  app.get("/api/outputs/:id", (req, res) => {
    const output = store.get<PublishedOutput>("outputs", req.params.id);
    if (!output) return res.sendStatus(404);
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(output.path);
  });
  app.put("/api/settings", (req, res) => {
    if (locked())
      return res
        .status(409)
        .json({ error: "Wait for the active operation to finish." });
    store.put("settings", "main", settingsSchema.parse(req.body));
    res.json({ ok: true });
  });
  app.post("/api/shutdown", (_req, res) => {
    if (!shutdown)
      return res
        .status(409)
        .json({ error: "Shutdown is unavailable for this instance." });
    res.json({ ok: true });
    setTimeout(shutdown, 100);
  });
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Unknown endpoint." }),
  );
  app.use(express.static(path.join(root, "dist")));
  app.get("/{*path}", (_req, res) =>
    res.sendFile(path.join(root, "dist", "index.html")),
  );
  app.use(
    (
      error: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => res.status(400).json({ error: error.message }),
  );
  const tick = () => {
    if (!testing.size)
      void engine.tick().catch((error) => console.error("Scheduler:", error));
  };
  return { app, store, engine, tick };
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
    data = path.resolve(process.env.GSICM_DATA_DIR ?? path.join(root, "data"));
  await mkdir(data, { recursive: true });
  // The listening port is also the process-wide lock: bind before opening/recovering the database.
  const gate = express();
  let application: express.Express | undefined;
  gate.use((req, res, next) =>
    application
      ? application(req, res, next)
      : res.status(503).send("Starting manager"),
  );
  const server = gate.listen(Number(process.env.PORT ?? 3210), "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const lockPath = path.join(data, "manager.lock");
  let lock;
  try {
    lock = await open(lockPath, "wx");
  } catch {
    const { readFile } = await import("node:fs/promises");
    const pid = Number(await readFile(lockPath, "utf8"));
    let live = false;
    try {
      process.kill(pid, 0);
      live = true;
    } catch {}
    if (live) {
      server.close();
      throw new Error("A manager is already using this data directory.");
    }
    await unlink(lockPath);
    lock = await open(lockPath, "wx");
  }
  await lock.writeFile(String(process.pid));
  await lock.close();
  const stop = async () => {
    clearInterval(timer);
    instance.engine.shutdown();
    server.close();
    await unlink(lockPath).catch(() => {});
    setTimeout(() => process.exit(0), 1000).unref();
  };
  const instance = await createApp(root, data, () => void stop());
  application = instance.app;
  const timer = setInterval(instance.tick, 15000);
  instance.tick();
  console.log(`GSICM is ready at http://127.0.0.1:${process.env.PORT ?? 3210}`);
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
