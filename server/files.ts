import path from "node:path";
import { lstat, readdir, unlink } from "node:fs/promises";
import type { Store } from "./store.js";

async function folderPath(store: Store, folder: string) {
  if (!["cache", "outputs"].includes(folder))
    throw new Error("Invalid file category.");
  const directory = path.resolve(store.root, folder);
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Invalid storage directory.");
  return directory;
}
export async function listFiles(store: Store) {
  const files = [];
  for (const folder of ["outputs", "cache"]) {
    let directory: string;
    try {
      directory = await folderPath(store, folder);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || /\.clean\.(?:png|jpe?g)$/i.test(entry.name))
        continue;
      const filename = path.join(directory, entry.name);
      let stat;
      try {
        stat = await lstat(filename);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw error;
      }
      if (!stat.isFile() || stat.isSymbolicLink()) continue;
      const output = store
        .outputHistory()
        .concat(store.outputs())
        .find((o) => path.resolve(o.path) === filename);
      const image = store
        .images()
        .find((i) => path.resolve(i.path) === filename);
      files.push({
        folder,
        name: entry.name,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        label: output
          ? store.profiles().find((p) => p.id === output.profileId)?.name
          : image
            ? store.sources().find((s) => s.id === image.sourceId)?.name
            : undefined,
        observationTime: output?.targetTime ?? image?.observationTime,
        preview: output
          ? `/api/outputs/${encodeURIComponent(output.profileId)}/history/${encodeURIComponent(output.jobId)}`
          : image
            ? `/api/images/${encodeURIComponent(image.id)}`
            : undefined,
      });
    }
  }
  return files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}
export async function deleteFile(store: Store, folder: string, name: string) {
  if (!name || name === "." || name === ".." || /[/\\\0]/.test(name))
    throw new Error("Invalid filename.");
  const filename = path.join(await folderPath(store, folder), name);
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink())
    throw new Error("Only regular files can be deleted.");
  await unlink(filename);
  for (const output of [...store.outputHistory(), ...store.outputs()])
    if (path.resolve(output.path) === filename) {
      if (output.jobId) store.delete("outputHistory", output.jobId);
      const latest = store.get<typeof output>("outputs", output.profileId);
      if (latest && path.resolve(latest.path) === filename)
        store.delete("outputs", output.profileId);
      if (output.cleanPath)
        await unlink(output.cleanPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
    }
  for (const image of store.images())
    if (path.resolve(image.path) === filename) {
      store.delete("images", image.id);
      for (const source of store.sources())
        if (source.validation?.imageId === image.id) {
          store.put("sources", source.id, {
            ...source,
            validation: { ...source.validation, imageId: undefined },
          });
        }
    }
}
