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
    this.removeObsoletePlaceholders();
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
  removeObsoletePlaceholders() {
    const obsoleteIds = new Set([
      "goes-east",
      "goes-west",
      "himawari",
      "meteosat",
      "iodc",
    ]);
    for (const source of this.sources()) {
      if (
        obsoleteIds.has(source.id) &&
        !source.enabled &&
        !source.location &&
        !source.bucket
      )
        this.delete("sources", source.id);
    }
    for (const profile of this.profiles()) {
      const sourceIds = profile.sourceIds.filter((id) => !obsoleteIds.has(id));
      if (sourceIds.length !== profile.sourceIds.length)
        this.put(
          "profiles",
          profile.id,
          profileSchema.parse({ ...profile, sourceIds }),
        );
    }
  }
  seed() {
    for (const projection of ["map", "globe"] as const)
      this.put(
        "profiles",
        projection,
        profileSchema.parse({
          id: projection,
          name: projection === "map" ? "Global map" : "Pacific globe",
          enabled: false,
          sourceIds: [],
          projection,
          underlay: "world.200412.3x21600x10800.jpg",
        }),
      );
    this.put("meta", "seeded", true);
  }
}
