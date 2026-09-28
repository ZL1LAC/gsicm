import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import sharp from "sharp";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { sourceSchema, profileSchema, type Job } from "../shared/types.js";
const directory = await mkdtemp(path.join(os.tmpdir(), "gsicm-smoke-"));
const store = new Store(directory);
const size = 5424;
const raw = Buffer.alloc(size * size);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const dx = (x - size / 2) / (size * 0.46),
      dy = (y - size / 2) / (size * 0.46);
    raw[y * size + x] =
      dx * dx + dy * dy < 1
        ? Math.round(100 + 90 * Math.sin(x / 110) * Math.cos(y / 150))
        : 0;
  }
const png = await sharp(raw, {
  raw: { width: size, height: size, channels: 1 },
})
  .png()
  .toBuffer();
const server = http.createServer((_req, res) => {
  res.setHeader("Content-Type", "image/png");
  res.end(png);
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
const port = (server.address() as { port: number }).port;
const source = sourceSchema.parse({
  id: "synthetic",
  name: "Synthetic IR",
  satellite: "Synthetic IR",
  region: "Fixture only",
  enabled: true,
  transport: "http",
  location: `http://127.0.0.1:${port}/IR_{YYYY}{MM}{DD}T{HH}{mm}00Z.png`,
  longitude: 180,
  attribution: "Synthetic test fixture — not satellite observations",
  cleanConfirmed: true,
});
store.put("sources", source.id, {
  ...source,
  validation: {
    compatible: true,
    at: new Date().toISOString(),
    message: "Synthetic fixture",
  },
});
const engine = new Engine(store, process.cwd());
const secondSource = {
  ...source,
  id: "synthetic-west",
  name: "Synthetic second disc",
  satellite: "Synthetic second disc",
  longitude: 0,
};
store.put("sources", secondSource.id, {
  ...secondSource,
  validation: {
    compatible: true,
    at: new Date().toISOString(),
    message: "Synthetic fixture",
  },
});
try {
  for (const projection of ["map", "globe"] as const) {
    const profile = profileSchema.parse({
      id: `smoke-${projection}`,
      name: `Smoke ${projection}`,
      enabled: false,
      sourceIds: [source.id, secondSource.id],
      projection,
      underlay: "world.200412.3x21600x10800.jpg",
    });
    store.put("profiles", profile.id, profile);
    const job = engine.enqueue(profile.id);
    const duplicate = engine.enqueue(profile.id);
    assert.equal(duplicate.id, job.id);
    while (
      ["queued", "running"].includes(store.get<Job>("jobs", job.id)!.status) ||
      engine.active
    )
      await new Promise((r) => setTimeout(r, 500));
    const result = store.get<Job>("jobs", job.id)!;
    console.log(projection, result.status, result.message);
    if (result.status !== "succeeded") {
      console.error(result.logs);
      throw new Error("Real Sanchez smoke failed");
    }
    const output = store.outputs().find((o) => o.profileId === profile.id)!;
    assert.ok(output.width > 1000);
    assert.equal(output.observations.length, 2);
    console.log("Output dimensions:", output.width, output.height);
    const before = JSON.stringify(output);
    store.put("profiles", profile.id, {
      ...profile,
      underlay: "does-not-exist.jpg",
    });
    const failed = engine.enqueue(profile.id);
    while (
      ["queued", "running"].includes(
        store.get<Job>("jobs", failed.id)!.status,
      ) ||
      engine.active
    )
      await new Promise((r) => setTimeout(r, 200));
    assert.equal(store.get<Job>("jobs", failed.id)!.status, "failed");
    assert.equal(
      JSON.stringify(store.outputs().find((o) => o.profileId === profile.id)),
      before,
    );
    console.log("Failed run preserved published output.");
    store.put("profiles", profile.id, profile);
    const cancel = engine.enqueue(profile.id);
    engine.cancel(cancel.id);
    while (engine.active) await new Promise((r) => setTimeout(r, 100));
    assert.equal(store.get<Job>("jobs", cancel.id)!.status, "cancelled");
    assert.equal(
      JSON.stringify(store.outputs().find((o) => o.profileId === profile.id)),
      before,
    );
    console.log("Cancelled run preserved published output.");
  }
} finally {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  store.db.close();
  await rm(directory, { recursive: true, force: true });
}
