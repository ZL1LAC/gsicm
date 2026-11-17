import test from "node:test";
import assert from "node:assert/strict";
import {
  elektroDirectories,
  observationTime,
  candidates,
} from "../server/acquisition.js";
import { sourceSchema } from "../shared/types.js";
import {
  acquireElektro,
  acquireElektroRgb,
  elektroGeometryError,
} from "../server/elektro.js";
import { Store } from "../server/store.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const source = sourceSchema.parse({
  id: "electro",
  name: "Electro",
  satellite: "Electro-L N2",
  region: "",
  enabled: true,
  transport: "ftp",
  product: "elektro-l",
  location: "ftp://example.org/ELECTRO_L_2/",
  longitude: -14.5,
  attribution: "test",
  timestampFormat: "elektro",
  timestampRegex: "(\\d{6}_\\d{4})",
  pattern: "\\d{6}_\\d{4}\\.zip$",
});
test("Elektro archive time is Moscow, and discovery includes quarter-hour slots", () => {
  assert.equal(
    observationTime("260928_1400.zip", source),
    "2026-09-28T11:00:00.000Z",
  );
  const dirs = elektroDirectories(
    "/ELECTRO_L_2",
    new Date("2026-09-28T11:00:00Z"),
    31,
  );
  assert.deepEqual(dirs, [
    "/ELECTRO_L_2/2026/September/28/1330",
    "/ELECTRO_L_2/2026/September/28/1345",
    "/ELECTRO_L_2/2026/September/28/1400",
    "/ELECTRO_L_2/2026/September/28/1415",
    "/ELECTRO_L_2/2026/September/28/1430",
  ]);
  assert.deepEqual(
    elektroDirectories("/ELECTRO_L_3", new Date("2026-09-30T21:00:00Z"), 0),
    ["/ELECTRO_L_3/2026/October/01/0000"],
  );
});
test("Elektro candidates exclude previews and out-of-window archive slots", () => {
  const keys = ["260928_1400.zip", "260928_1400_9.jpg", "260928_1000.zip"].map(
    (key) => ({ key, url: key }),
  );
  assert.deepEqual(
    candidates(keys, source, new Date("2026-09-28T11:00:00Z"), 1).map(
      (c) => c.key,
    ),
    ["260928_1400.zip"],
  );
  assert.throws(() => observationTime("260231_1400.zip", source));
});

test("N3 at its new longitude rejects historical and handover-day geometry", () => {
  for (const product of ["elektro-l", "elektro-rgb"] as const) {
    const n3 = {
      ...source,
      product,
      id: "electro-l3",
      satellite: "Electro-L N3",
      location: "ftp://example.org/ELECTRO_L_3/",
    };
    for (const time of ["2026-09-28T11:00:00Z", "2026-10-26T23:59:59Z"])
      assert.match(elektroGeometryError(n3, time)!, /historical geometry/);
    assert.equal(elektroGeometryError(n3, "2026-10-27T00:00:00Z"), undefined);
    assert.equal(
      elektroGeometryError({ ...n3, longitude: 76 }, "2026-09-28T11:00:00Z"),
      undefined,
    );
    assert.ok(
      elektroGeometryError(
        { ...n3, id: "custom", satellite: "Custom" },
        "2026-09-28T11:00:00Z",
      ),
      "Cloned N3 sources are recognized by their archive URL",
    );
  }
  assert.equal(elektroGeometryError(source, "2026-09-28T11:00:00Z"), undefined);
});

test("N3 acquisition rejects historical candidates before cache reuse or download", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "gsicm-n3-geometry-"));
  const store = new Store(root);
  try {
    for (const product of ["elektro-l", "elektro-rgb"] as const) {
      const extension = product === "elektro-l" ? "zip" : "jpg";
      const n3 = sourceSchema.parse({
        ...source,
        id: "electro-l3",
        product,
        transport: "http",
        location: `http://example.invalid/ELECTRO_L_3/{YYYY}{MM}{DD}T{HH}{mm}00Z.${extension}`,
        timestampFormat: "compact",
        timestampRegex: "(\\d{8}T\\d{6}Z)",
        pattern: ".*",
        cadenceMinutes: 10,
      });
      for (const cached of [false, true]) {
        if (cached)
          store.put("images", "historical", {
            id: "historical",
            sourceId: n3.id,
            observationTime: "2026-09-28T11:00:00Z",
            remoteKey: `/ELECTRO_L_3/20260928T110000Z.${extension}`,
            path: path.join(root, "historical.png"),
          });
        const acquire =
          product === "elektro-l" ? acquireElektro : acquireElektroRgb;
        await assert.rejects(
          acquire(
            store,
            n3,
            new Date("2026-09-28T11:00:00Z"),
            0,
            AbortSignal.timeout(5000),
            () => {},
          ),
          /historical geometry is not supported/,
        );
        store.delete("images", "historical");
      }
    }
  } finally {
    store.db.close();
    await rm(root, { recursive: true, force: true });
  }
});
