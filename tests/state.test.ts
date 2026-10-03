import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import sharp from "sharp";
import { createApp } from "../server/index.js";
import {
  profileSchema,
  sourceSchema,
  type ManagerState,
} from "../shared/types.js";

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "gsicm-state-"));
  const instance = await createApp(process.cwd(), directory);
  const server = instance.app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const read = async () =>
    (await (await fetch(`${base}/state`)).json()) as ManagerState;
  const write = (route: string, method = "POST", body: unknown = {}) =>
    fetch(base + route, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  const close = async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    instance.store.db.close();
    await rm(directory, { recursive: true, force: true });
  };
  return { ...instance, read, write, close };
}

test("operation metadata preserves queueing and per-profile deletion while configuration is locked", async () => {
  const app = await fixture();
  app.engine.drain = async () => {};
  const source = sourceSchema.parse({
    id: "test",
    name: "Fixture",
    satellite: "Fixture",
    region: "Test",
    enabled: true,
    transport: "http",
    location: "http://example.test/image.png",
    longitude: 0,
    attribution: "Synthetic test",
  });
  app.store.put("sources", source.id, {
    ...source,
    validation: {
      at: new Date().toISOString(),
      compatible: true,
      message: "Test",
    },
  });
  const underlay = (await app.read()).underlays[0];
  for (const id of ["first", "second", "unused"])
    app.store.put(
      "profiles",
      id,
      profileSchema.parse({
        id,
        name: id,
        enabled: false,
        sourceIds: [source.id],
        projection: "map",
        underlay,
      }),
    );
  try {
    let state = await app.read();
    assert.equal(state.locked, false);
    assert.equal(state.canRunJobs, true);
    assert.deepEqual(state.testingSourceIds, []);
    const first = await (await app.write("/profiles/first/run")).json();
    state = await app.read();
    assert.equal(state.locked, true);
    assert.equal(
      state.canRunJobs,
      true,
      "queued jobs must not prevent queueing another profile",
    );
    assert.ok(state.jobs.every((job) => !("logs" in job)));
    assert.equal((await app.write("/profiles/second/run")).status, 200);
    assert.equal(
      (await app.write("/settings", "PUT", app.store.settings())).status,
      409,
    );
    assert.equal((await app.write("/profiles/first", "DELETE")).status, 409);
    assert.equal((await app.write("/profiles/unused", "DELETE")).status, 200);
    assert.equal((await app.write(`/jobs/${first.id}/cancel`)).status, 200);
    assert.equal((await app.write("/profiles/first", "DELETE")).status, 200);
    app.engine.maintaining = true;
    state = await app.read();
    assert.equal(state.locked, true);
    assert.equal(state.canRunJobs, false);
    assert.equal((await app.write("/profiles/second/run")).status, 400);
  } finally {
    await app.close();
  }
});

test("source test activity appears in state and clears when acquisition finishes", async () => {
  const app = await fixture();
  const png = await sharp({
    create: { width: 64, height: 64, channels: 3, background: "#888" },
  })
    .png()
    .toBuffer();
  let release!: () => void;
  let arrived!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestArrived = new Promise<void>((resolve) => {
    arrived = resolve;
  });
  const feed = http.createServer(async (_request, response) => {
    arrived();
    await held;
    response.setHeader("Content-Type", "image/png");
    response.end(png);
  });
  await new Promise<void>((resolve) => feed.listen(0, "127.0.0.1", resolve));
  const port = (feed.address() as { port: number }).port;
  const source = sourceSchema.parse({
    id: "file-deletion",
    name: "Fixture",
    satellite: "Fixture",
    region: "Test",
    enabled: true,
    transport: "http",
    location: `http://127.0.0.1:${port}/IR_{YYYY}{MM}{DD}T{HH}{mm}00Z.png`,
    longitude: 0,
    expectedWidth: 64,
    expectedHeight: 64,
    attribution: "Synthetic test",
    cleanConfirmed: true,
  });
  app.store.put("sources", source.id, source);
  const testing = app.write(`/sources/${source.id}/test`);
  try {
    await requestArrived;
    const state = await app.read();
    assert.equal(state.locked, true);
    assert.equal(state.canRunJobs, false);
    assert.deepEqual(
      state.testingSourceIds,
      [source.id],
      "real source IDs must never collide with internal operation markers",
    );
    assert.equal((await app.write("/profiles/map/run")).status, 409);
    release();
    assert.equal((await testing).status, 200);
    const finished = await app.read();
    assert.equal(finished.locked, false);
    assert.equal(finished.canRunJobs, true);
    assert.deepEqual(finished.testingSourceIds, []);
    assert.equal(finished.sources[0].validation?.compatible, true);
  } finally {
    release();
    await testing.catch(() => {});
    feed.closeAllConnections();
    await new Promise<void>((resolve) => feed.close(() => resolve()));
    await app.close();
  }
});
