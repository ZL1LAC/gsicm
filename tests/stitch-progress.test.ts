import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import { Engine } from "../server/engine.js";
import { sourceSchema, profileSchema, type Job } from "../shared/types.js";

test("stitch progress tracks live inputs, stage timing, failures and cancellation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gsicm-progress-"));
  const store = new Store(root);
  const engine = new Engine(store, process.cwd());
  let respond = true;
  let requested = () => {};
  const server = http.createServer((_req, res) => {
    requested();
    if (respond) res.writeHead(410).end();
  });
  const waitForFinish = async () => {
    const deadline = Date.now() + 5000;
    while (engine.active) {
      assert.ok(Date.now() < deadline, "Job should finish promptly");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  try {
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    const port = (server.address() as { port: number }).port;
    for (const id of ["first", "second"]) {
      store.put("sources", id, {
        ...sourceSchema.parse({
          id,
          name: id,
          satellite: id,
          region: "Test",
          enabled: true,
          transport: "http",
          location: `http://127.0.0.1:${port}/{YYYY}{MM}{DD}T{HH}{mm}00Z.png`,
          longitude: 0,
          attribution: "Synthetic fixture",
          cleanConfirmed: true,
        }),
        validation: {
          compatible: true,
          at: new Date().toISOString(),
          message: "Fixture",
        },
      });
    }
    store.put(
      "profiles",
      "progress",
      profileSchema.parse({
        id: "progress",
        name: "Progress",
        enabled: false,
        sourceIds: ["first", "second"],
        projection: "map",
        toleranceMinutes: 1,
        underlay: "unused.jpg",
      }),
    );
    const failed = engine.enqueue("progress");
    await waitForFinish();
    const result = store.get<Job>("jobs", failed.id)!;
    assert.equal(result.status, "failed");
    assert.deepEqual(
      result.sources?.map((source) => source.status),
      ["failed", "skipped"],
    );
    assert.match(result.sources![0].message!, /HTTP 410/);
    assert.ok(result.stageStartedAt && result.lastActivityAt);

    respond = false;
    const request = new Promise<void>((resolve) => {
      requested = resolve;
    });
    const cancelled = engine.enqueue("progress");
    await request;
    const live = store.get<Job>("jobs", cancelled.id)!;
    assert.deepEqual(
      live.sources?.map((source) => source.status),
      ["fetching", "waiting"],
    );
    engine.progress(cancelled.id, "acquiring", "Still fetching");
    engine.log(cancelled.id, "More activity\n");
    assert.equal(
      store.get<Job>("jobs", cancelled.id)!.stageStartedAt,
      live.stageStartedAt,
      "Activity within a stage must not reset the stage timer",
    );
    engine.cancel(cancelled.id);
    await waitForFinish();
    const stopped = store.get<Job>("jobs", cancelled.id)!;
    assert.equal(stopped.status, "cancelled");
    assert.deepEqual(
      stopped.sources?.map((source) => source.status),
      ["cancelled", "cancelled"],
    );
    assert.match(stopped.logs, /More activity/);
  } finally {
    engine.shutdown();
    await waitForFinish();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.db.close();
    await rm(root, { recursive: true, force: true });
  }
});
