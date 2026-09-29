import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  readFile,
  rm,
  mkdir,
  access,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import sharp from "sharp";
import {
  sourceSchema,
  profileSchema,
  settingsSchema,
  type Job,
  type AcquiredImage,
} from "../shared/types.js";
import {
  observationTime,
  discover,
  download,
  acquire,
  template,
  candidates,
  inspectImage,
} from "../server/acquisition.js";
import { Store } from "../server/store.js";
import {
  targetTime,
  blockers,
  cleanup,
  sanchezArgs,
  runProcess,
  Engine,
} from "../server/engine.js";
import { createApp } from "../server/index.js";
const source = sourceSchema.parse({
  id: "fixture",
  name: "Fixture",
  satellite: "Fixture",
  region: "Test",
  enabled: true,
  transport: "http",
  location: "http://127.0.0.1/image_{YYYY}{MM}{DD}T{HH}{mm}00Z.png",
  longitude: 0,
  expectedWidth: 64,
  expectedHeight: 64,
  attribution: "Test data",
  cleanConfirmed: true,
});
const profile = profileSchema.parse({
  id: "test",
  name: "Test",
  enabled: true,
  sourceIds: ["fixture"],
  projection: "map",
  underlay: "world.200412.3x21600x10800.jpg",
});
async function temp() {
  return mkdtemp(path.join(os.tmpdir(), "gsicm-test-"));
}
test("UTC parsing, calendar validation, time templates, and strict selection", () => {
  assert.equal(
    observationTime("IR_20260928T120000Z.png", source),
    "2026-09-28T12:00:00.000Z",
  );
  assert.throws(() => observationTime("latest.png", source));
  assert.throws(() => observationTime("IR_20260230T120000Z.png", source));
  assert.equal(
    observationTime("s2026271120000", {
      ...source,
      timestampRegex: "s(\\d{13})",
      timestampFormat: "julian",
    }),
    "2026-09-28T12:00:00.000Z",
  );
  assert.equal(
    template("{YYYY}/{DDD}/{HH}{mm}", new Date("2026-01-02T03:04:00Z")),
    "2026/002/0304",
  );
  assert.equal(
    targetTime(new Date("2026-09-28T12:10:01Z")).toISOString(),
    "2026-09-28T12:00:00.000Z",
  );
  assert.equal(
    candidates(
      [
        { key: "IR_20200101T120000Z.png", url: "a" },
        { key: "latest.jpg", url: "b" },
      ],
      source,
      new Date("2020-01-01T12:00:00Z"),
      30,
    ).length,
    1,
  );
  assert.equal(blockers(profile, [source]).length, 1);
  assert.deepEqual(
    blockers(profile, [
      { ...source, validation: { compatible: true, at: "", message: "" } },
    ]),
    [],
  );
});
test("HTTP discovery, retries, partial files, decoding, deduplication and timeout", async () => {
  const directory = await temp(),
    store = new Store(directory);
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#888" },
  })
    .png()
    .toBuffer();
  let count = 0;
  const server = http.createServer((req, res) => {
    if (req.url?.startsWith("/retry") && ++count < 3) {
      res.writeHead(503);
      res.end();
    } else if (req.url?.startsWith("/bad")) res.end("not an image");
    else if (req.url?.startsWith("/slow")) setTimeout(() => res.end(png), 3500);
    else if (req.url?.startsWith("/partial")) {
      res.writeHead(200, { "Content-Length": 999999 });
      res.write(png.subarray(0, 20));
      res.destroy();
    } else res.end(png);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const s = {
    ...source,
    location: `http://127.0.0.1:${port}/IR_{YYYY}{MM}{DD}T{HH}{mm}00Z.png`,
  };
  const target = new Date("2020-01-01T12:00:00Z");
  const signal = new AbortController().signal;
  try {
    const found = await discover(s, target, 10, store.settings(), signal);
    assert.equal(found.length, 3);
    const first = await acquire(store, s, target, 10, signal);
    const again = await acquire(store, s, target, 10, signal);
    assert.equal(first.id, again.id);
    assert.equal(store.images().length, 1);
    const dest = path.join(directory, "download.part");
    await download(
      s,
      {
        key: "x",
        url: `http://127.0.0.1:${port}/retry`,
        observationTime: target.toISOString(),
      },
      dest,
      store.settings(),
      signal,
    );
    assert.equal(count, 3);
    await inspectImage(dest, s);
    await download(
      s,
      { key: "x", url: `http://127.0.0.1:${port}/bad`, observationTime: "" },
      dest,
      store.settings(),
      signal,
    );
    await assert.rejects(inspectImage(dest));
    await assert.rejects(
      download(
        s,
        {
          key: "x",
          url: `http://127.0.0.1:${port}/partial`,
          observationTime: "",
        },
        dest,
        store.settings(),
        signal,
      ),
    );
    await assert.rejects(access(dest));
    await assert.rejects(
      download(
        s,
        { key: "x", url: `http://127.0.0.1:${port}/slow`, observationTime: "" },
        dest,
        { ...store.settings(), downloadTimeoutSeconds: 2 },
        AbortSignal.timeout(2300),
      ),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("restart recovery, retention and cleanup containment", async () => {
  const directory = await temp();
  let store = new Store(directory);
  const job: Job = {
    id: "old",
    profileId: "test",
    profileName: "test",
    targetTime: "2020-01-01T00:00:00Z",
    startedAt: "2020-01-01T00:00:00Z",
    status: "running",
    message: "",
    logs: "",
  };
  store.put("jobs", job.id, job);
  store.db.close();
  store = new Store(directory);
  assert.equal(store.get<Job>("jobs", "old")?.status, "interrupted");
  await mkdir(path.join(directory, "cache"));
  const file = path.join(directory, "cache", "old.png");
  await writeFile(file, "old");
  store.put("images", "old", {
    id: "old",
    path: file,
    acquiredAt: "2020-01-01T00:00:00Z",
  });
  await cleanup(store);
  assert.equal(store.images().length, 0);
  await assert.rejects(access(file));
  store.put("images", "unsafe", {
    id: "unsafe",
    path: path.join(directory, "manager.sqlite"),
    acquiredAt: "2020-01-01T00:00:00Z",
  });
  await assert.rejects(cleanup(store), /outside manager storage/);
  store.db.close();
  await rm(directory, { recursive: true, force: true });
});
test("argument arrays and process cancellation, timeout and failures", async () => {
  const args = sanchezArgs(
    profile,
    "C:/with spaces/stage",
    "C:/result.jpg",
    "C:/resources",
    "2020-01-01T12:00:00.000Z",
  );
  assert.equal(args[0], "reproject");
  assert.ok(args.includes("--nocrop"));
  assert.equal(args[args.indexOf("-m") + 1], "1");
  assert.equal(args[args.indexOf("-T") + 1], "2020-01-01T12:00:00");
  assert.ok(
    sanchezArgs(
      { ...profile, projection: "globe" },
      "s",
      "o",
      "r",
      "t",
    ).includes("-l"),
  );
  const signal = new AbortController();
  const task = runProcess(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    process.cwd(),
    signal.signal,
    10000,
    () => {},
  );
  setTimeout(() => signal.abort(), 100);
  await assert.rejects(task, /Cancelled/);
  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", "setInterval(()=>{},1000)"],
      process.cwd(),
      new AbortController().signal,
      100,
      () => {},
    ),
    /timeout/,
  );
  await assert.rejects(
    runProcess(
      process.execPath,
      ["-e", "process.exit(2)"],
      process.cwd(),
      new AbortController().signal,
      10000,
      () => {},
    ),
    /code 2/,
  );
});
test("local API validation, setup blockers and editing invalidates compatibility", async () => {
  const directory = await temp();
  const { app, store } = await createApp(process.cwd(), directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  try {
    const state = await (await fetch(base + "/state")).json();
    assert.equal(state.sources.length, 0);
    assert.equal(state.profiles.length, 2);
    assert.equal(state.outputs.length, 0);
    assert.equal(
      (
        await fetch(base + "/profiles/map/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        })
      ).status,
      400,
    );
    assert.equal(
      (
        await fetch(base + "/settings", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Origin: "https://hostile.example",
          },
          body: "{}",
        })
      ).status,
      403,
    );
    store.put("sources", "fixture", {
      ...source,
      validation: { compatible: true, at: "", message: "" },
    });
    await fetch(base + "/sources/fixture", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...source,
        longitude: 20,
        validation: { compatible: true },
      }),
    });
    assert.equal(
      store.sources().find((s) => s.id === "fixture")?.validation,
      undefined,
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("password login protects API endpoints when configured", async () => {
  const directory = await temp();
  const prior = process.env.GSICM_PASSWORD;
  process.env.GSICM_PASSWORD = "correct horse";
  const { app, store } = await createApp(process.cwd(), directory);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  try {
    assert.equal(
      (await (await fetch(base + "/auth")).json()).authenticated,
      false,
    );
    assert.equal((await fetch(base + "/state")).status, 401);
    assert.equal(
      (
        await fetch(base + "/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password: "wrong" }),
        })
      ).status,
      401,
    );
    const login = await fetch(base + "/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "correct horse" }),
    });
    assert.equal(login.status, 200);
    const session = login.headers.get("set-cookie")?.split(";")[0];
    assert.ok(session);
    assert.equal(
      (
        await fetch(base + "/state", {
          headers: { Cookie: session },
        })
      ).status,
      200,
    );
  } finally {
    if (prior === undefined) delete process.env.GSICM_PASSWORD;
    else process.env.GSICM_PASSWORD = prior;
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("scheduler deduplicates intervals, blocks incomplete profiles, and protects an active cache", async () => {
  const directory = await temp(),
    store = new Store(directory),
    engine = new Engine(store, process.cwd());
  engine.drain = async () => {};
  store.put("sources", source.id, {
    ...source,
    validation: { compatible: true, at: "", message: "" },
  });
  store.put("profiles", profile.id, profile);
  const now = new Date("2020-01-01T12:15:00Z");
  await engine.tick(now);
  await engine.tick(now);
  assert.equal(store.list<Job>("jobs").length, 1);
  assert.equal(
    store.list<Job>("jobs")[0].targetTime,
    "2020-01-01T12:00:00.000Z",
  );
  const first = store.list<Job>("jobs")[0];
  engine.cancel(first.id);
  await engine.tick(now);
  assert.equal(store.list<Job>("jobs").length, 1);
  await engine.tick(new Date("2020-01-01T12:25:00Z"));
  assert.equal(store.list<Job>("jobs").length, 2);
  engine.cancel(store.list<Job>("jobs").find((j) => j.status === "queued")!.id);
  store.put("sources", source.id, { ...source, enabled: false });
  await engine.tick(new Date("2020-01-01T12:35:00Z"));
  assert.equal(store.list<Job>("jobs").length, 2);
  await mkdir(path.join(directory, "cache"));
  const file = path.join(directory, "cache", "protected.png");
  await writeFile(file, "fixture");
  store.put("images", "protected", {
    id: "protected",
    path: file,
    acquiredAt: "1999-01-01T00:00:00Z",
  });
  engine.active = { id: "fixture", controller: new AbortController() };
  await engine.tick(new Date("2020-01-01T12:45:00Z"));
  await access(file);
  engine.active = undefined;
  await engine.tick(new Date("2020-01-01T12:46:00Z"));
  await assert.rejects(access(file));
  store.db.close();
  await rm(directory, { recursive: true, force: true });
});
