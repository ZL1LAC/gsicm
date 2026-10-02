import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  readFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { Store } from "../server/store.js";
import { listFiles, deleteFile } from "../server/files.js";
import { createApp } from "../server/index.js";

test("file manager deletes records and previews without removing validation or profiles; rejects unsafe paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gsicm-files-"));
  const store = new Store(root);
  try {
    await mkdir(path.join(root, "cache"));
    await mkdir(path.join(root, "outputs"));
    const imagePath = path.join(root, "cache", "image.jpg");
    const outputPath = path.join(root, "outputs", "stitch.jpg");
    await writeFile(imagePath, "image");
    await writeFile(outputPath, "stitch");
    await writeFile(path.join(root, "private.txt"), "keep");
    await symlink(
      path.join(root, "private.txt"),
      path.join(root, "cache", "link"),
    );
    store.put("images", "image", {
      id: "image",
      path: imagePath,
      sourceId: "source",
    });
    store.put("sources", "source", {
      id: "source",
      validation: { compatible: true, imageId: "image" },
    });
    store.put("outputs", "map", { profileId: "map", path: outputPath });
    assert.equal((await listFiles(store)).length, 2);
    await assert.rejects(deleteFile(store, "cache", "../private.txt"));
    await assert.rejects(deleteFile(store, "cache", "link"));
    await assert.rejects(deleteFile(store, "..", "private.txt"));
    await deleteFile(store, "cache", "image.jpg");
    assert.equal(store.images().length, 0);
    assert.equal(store.sources()[0].validation?.compatible, true);
    assert.equal(store.sources()[0].validation?.imageId, undefined);
    await deleteFile(store, "outputs", "stitch.jpg");
    assert.equal(store.outputs().length, 0);
    assert.ok(store.get("profiles", "map"));
    assert.equal(
      await readFile(path.join(root, "private.txt"), "utf8"),
      "keep",
    );
  } finally {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("file deletion API refuses active processing and deletes when idle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gsicm-files-api-"));
  const { app, store, engine } = await createApp(process.cwd(), root);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/files`;
  try {
    await mkdir(path.join(root, "cache"));
    await writeFile(path.join(root, "cache", "test.jpg"), "test");
    engine.maintaining = true;
    const remove = () =>
      fetch(base + "/cache/test.jpg", {
        method: "DELETE",
        body: "{}",
        headers: { "Content-Type": "application/json" },
      });
    assert.equal((await remove()).status, 409);
    engine.maintaining = false;
    assert.equal((await (await fetch(base)).json()).files.length, 1);
    assert.equal((await remove()).status, 200);
    assert.equal((await (await fetch(base)).json()).files.length, 0);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("profile deletion preserves stitches and history and refuses deletion while busy", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gsicm-profile-delete-"));
  const { app, store, engine } = await createApp(process.cwd(), root);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/profiles/map`;
  const remove = () =>
    fetch(url, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
  try {
    store.put("outputs", "map", {
      profileId: "map",
      path: path.join(root, "outputs", "saved.jpg"),
    });
    store.put("jobs", "old", {
      id: "old",
      profileId: "map",
      status: "succeeded",
    });
    store.put("jobs", "active", {
      id: "active",
      profileId: "map",
      status: "running",
    });
    assert.equal((await remove()).status, 409);
    assert.ok(store.get("profiles", "map"));
    store.put("jobs", "active", {
      id: "active",
      profileId: "map",
      status: "queued",
    });
    assert.equal((await remove()).status, 409);
    store.put("jobs", "active", {
      id: "active",
      profileId: "globe",
      status: "running",
    });
    assert.equal((await remove()).status, 200);
    assert.equal(store.get("profiles", "map"), undefined);
    assert.ok(store.get("outputs", "map"));
    assert.ok(store.get("jobs", "old"));
    assert.equal((await remove()).status, 404);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    store.db.close();
    await rm(root, { recursive: true, force: true });
  }
});
