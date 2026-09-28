import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type {
  SourceRecord,
  Profile,
  Settings,
  Job,
  AcquiredImage,
  PublishedOutput,
} from "../shared/types.js";
import {
  sourceSchema,
  profileSchema,
  settingsSchema,
} from "../shared/types.js";
export class Store {
  db: DatabaseSync;
  constructor(public root: string) {
    mkdirSync(root, { recursive: true });
    this.db = new DatabaseSync(path.join(root, "manager.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY(kind,id));",
    );
    for (const job of this.list<Job>("jobs"))
      if (["running", "queued"].includes(job.status))
        this.put("jobs", job.id, {
          ...job,
          status: "interrupted",
          finishedAt: new Date().toISOString(),
          message: "Manager stopped before this job completed.",
        });
    if (!this.get("settings", "main"))
      this.put("settings", "main", settingsSchema.parse({}));
    if (!this.get("meta", "seeded")) this.seed();
  }
  get<T>(kind: string, id: string): T | undefined {
    const row = this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }
  list<T>(kind: string): T[] {
    return (
      this.db.prepare("SELECT body FROM records WHERE kind=?").all(kind) as {
        body: string;
      }[]
    ).map((r) => JSON.parse(r.body));
  }
  put(kind: string, id: string, value: unknown) {
    this.db
      .prepare("INSERT OR REPLACE INTO records VALUES (?,?,?)")
      .run(kind, id, JSON.stringify(value));
  }
  delete(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  settings() {
    return this.get<Settings>("settings", "main")!;
  }
  sources() {
    return this.list<SourceRecord>("sources");
  }
  profiles() {
    return this.list<Profile>("profiles");
  }
  images() {
    return this.list<AcquiredImage>("images");
  }
  outputs() {
    return this.list<PublishedOutput>("outputs");
  }
  seed() {
    const regions = [
      ["goes-east", "GOES East", "Americas east", -75.2],
      ["goes-west", "GOES West", "Americas west", -137],
      ["himawari", "Himawari", "Asia-Pacific", 140.7],
      ["meteosat", "Meteosat", "Europe / Africa", 0],
      ["iodc", "Indian Ocean", "Indian Ocean", 45.5],
    ] as const;
    for (const [id, name, region, longitude] of regions)
      this.put(
        "sources",
        id,
        sourceSchema.parse({
          id,
          name,
          satellite: name,
          region,
          longitude,
          enabled: false,
          transport: "http",
          location: "",
          attribution: "",
          blocker:
            "No clean, timestamped full-disc feed has been verified. Configure and test a compatible source before enabling.",
        }),
      );
    for (const projection of ["map", "globe"] as const)
      this.put(
        "profiles",
        projection,
        profileSchema.parse({
          id: projection,
          name: projection === "map" ? "Global map" : "Pacific globe",
          enabled: false,
          sourceIds: regions.map((r) => r[0]),
          projection,
          underlay: "world.200412.3x21600x10800.jpg",
        }),
      );
    this.put("meta", "seeded", true);
  }
}
