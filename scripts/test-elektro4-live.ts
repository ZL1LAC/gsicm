import path from "node:path";
import assert from "node:assert/strict";
import { Store } from "../server/store.js";
import { sourceSchema, profileSchema } from "../shared/types.js";
import { acquire } from "../server/acquisition.js";
import { Engine } from "../server/engine.js";

const store = new Store(path.resolve("data/elektro4-live-verification"));
store.put("settings", "main", {
  ...store.settings(),
  downloadTimeoutSeconds: 300,
  maxDownloadMb: 300,
});

const source = sourceSchema.parse({
  id: "electro-l4",
  name: "Electro-L No.4",
  satellite: "Electro-L N4",
  region: "Western Pacific",
  enabled: true,
  product: "elektro-rgb",
  transport: "ftp",
  location: "ftp://ntsomz.gptl.ru:2121/ELECTRO_L_4/",
  username: "electro",
  password: "electro",
  pattern: "\\d{6}_\\d{4}_original_RGB_VIS_IR\\.jpg$",
  timestampRegex: "(\\d{6}_\\d{4})",
  timestampFormat: "elektro",
  cadenceMinutes: 30,
  longitude: 165.8,
  expectedWidth: 11136,
  expectedHeight: 11136,
  crop: [0.012703, 0.012703, 0.012703, 0.012703],
  invert: false,
  brightness: 1,
  attribution: "NTSOMZ Elektro-L FTP RGB VIS/IR",
  cleanConfirmed: true,
});

const target = "2026-09-28T21:00:00Z";
console.log("TEST", source.name, target);
const img = await acquire(
  store,
  source,
  new Date(target),
  1,
  AbortSignal.timeout(900000),
  console.log,
);
store.put("sources", source.id, {
  ...source,
  validation: {
    at: new Date().toISOString(),
    compatible: true,
    message: "live test",
    imageId: img.id,
  },
});
store.put(
  "profiles",
  source.id,
  profileSchema.parse({
    id: source.id,
    name: source.name,
    enabled: false,
    sourceIds: [source.id],
    projection: "map",
    underlay: "world.200412.3x21600x10800.jpg",
  }),
);
const engine = new Engine(store, process.cwd());
const job = engine.enqueue(source.id, new Date(target));
while (engine.active) await new Promise((r) => setTimeout(r, 1000));
const result = store.get<{ status: string; message: string }>("jobs", job.id)!;
console.log(result);
assert.equal(result.status, "succeeded", result.message);
store.db.close();
