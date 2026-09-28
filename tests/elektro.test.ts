import test from "node:test";
import assert from "node:assert/strict";
import {
  elektroDirectories,
  observationTime,
  candidates,
} from "../server/acquisition.js";
import { sourceSchema } from "../shared/types.js";
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
test("Elektro archive time is Moscow, and discovery aligns padded tolerance to half-hour slots", () => {
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
    "/ELECTRO_L_2/2026/September/28/1400",
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
