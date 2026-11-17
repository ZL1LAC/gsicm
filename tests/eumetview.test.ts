import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { decoderPython, decoderStatus } from "../server/raw.js";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Store } from "../server/store.js";
import { acquireEumetview, eumetviewPreset } from "../server/eumetview.js";

test(
  "IODC capabilities requests preserve endpoint parameters and replace WMS parameters",
  {
    skip: !decoderStatus().ready,
  },
  async () => {
    let requested: URL | undefined;
    const server = http.createServer((req, res) => {
      requested = new URL(req.url!, "http://localhost");
      // Stop after observing the real capabilities request; no decoder is needed.
      res.writeHead(400).end();
    });
    const root = await mkdtemp(path.join(os.tmpdir(), "gsicm-wms-query-"));
    const store = new Store(root);
    try {
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      const port = (server.address() as { port: number }).port;
      await assert.rejects(
        acquireEumetview(
          store,
          {
            ...eumetviewPreset,
            location: `http://127.0.0.1:${port}/wms?map=iodc.map&token=a%2Bb%26c&tag=one&tag=two&empty=&REQUEST=GetMap&SERVICE=old&VERSION=1.1.1`,
          },
          new Date(),
          30,
          AbortSignal.timeout(5000),
          () => {},
        ),
        /HTTP 400/,
      );
      assert.ok(requested);
      assert.equal(requested.searchParams.get("map"), "iodc.map");
      assert.equal(requested.searchParams.get("token"), "a+b&c");
      assert.deepEqual(requested.searchParams.getAll("tag"), ["one", "two"]);
      assert.equal(requested.searchParams.get("empty"), "");
      assert.equal(requested.searchParams.get("request"), "GetCapabilities");
      assert.equal(requested.searchParams.get("service"), "WMS");
      assert.equal(requested.searchParams.get("version"), "1.3.0");
      for (const key of ["REQUEST", "SERVICE", "VERSION"])
        assert.equal(requested.searchParams.has(key), false);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.db.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);

test(
  "IODC rejects stale observations and changed geometry; reprojection preserves location and orientation",
  {
    skip: !decoderStatus().ready,
    timeout: 120000,
  },
  async () => {
    await promisify(execFile)(
      decoderPython,
      [fileURLToPath(new URL("./eumetview_test.py", import.meta.url))],
      { timeout: 110000 },
    );
  },
);
