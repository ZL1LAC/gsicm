import { useState } from "react";
import { useAutoRefresh } from "./useAutoRefresh";
type FileEntry = {
  folder: string;
  name: string;
  bytes: number;
  modifiedAt: string;
  label?: string;
  observationTime?: string;
  preview?: string;
};
const size = (bytes: number) =>
  bytes < 1048576
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
export function FileManager({ onChange }: { onChange: () => Promise<void> }) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [filter, setFilter] = useState("all");
  const [locked, setLocked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const refresh = async () => {
    const response = await fetch("/api/files", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to load files.");
    setFiles(data.files);
    setLocked(data.locked);
    setLoading(false);
  };
  useAutoRefresh(async () => {
    try {
      await refresh();
    } catch (e) {
      setError((e as Error).message);
      setLoading(false);
    }
  });
  const remove = async (file: FileEntry) => {
    if (
      !window.confirm(
        `Delete ${file.label || file.name}?\n${file.folder === "outputs" ? "This removes the published stitch. You can generate it again." : "This removes the cached file and its preview. It will need to be downloaded again."}`,
      )
    )
      return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch(
        `/api/files/${file.folder}/${encodeURIComponent(file.name)}`,
        {
          method: "DELETE",
          body: "{}",
          headers: { "Content-Type": "application/json" },
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to delete file.");
      await refresh();
      await onChange();
      setNotice(`Deleted ${file.label || file.name}.`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const visible = files.filter((f) => filter === "all" || f.folder === filter);
  return (
    <section className="file-manager">
      <div className="section-head">
        <div>
          <h2>Stored files</h2>
          <p className="muted">
            {files.length} files ·{" "}
            {size(files.reduce((sum, f) => sum + f.bytes, 0))}
          </p>
        </div>
        <label>
          Show{" "}
          <select
            aria-label="File category"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All files</option>
            <option value="outputs">Stitches</option>
            <option value="cache">Cached imagery</option>
          </select>
        </label>
      </div>
      <p className="muted">
        Manage downloaded imagery and generated stitches. Deleting a stitch
        keeps its profile and job history.
      </p>
      {locked && (
        <p role="status">
          Files are in use. Deletion will be available when processing finishes.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {loading ? (
        <p>Loading files…</p>
      ) : !visible.length ? (
        <p>No files in this category.</p>
      ) : (
        <div className="file-table">
          <table>
            <thead>
              <tr>
                <th>File</th>
                <th>Type</th>
                <th>Observation</th>
                <th>Size</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((file) => (
                <tr key={`${file.folder}/${file.name}`}>
                  <td>
                    <strong>{file.label || file.name}</strong>
                    {file.label && <small>{file.name}</small>}
                  </td>
                  <td>
                    {file.folder === "outputs" ? "Stitch" : "Cached imagery"}
                  </td>
                  <td>
                    {file.observationTime
                      ? new Date(file.observationTime).toLocaleString()
                      : "—"}
                  </td>
                  <td>{size(file.bytes)}</td>
                  <td>
                    <div className="file-actions">
                      {file.preview && (
                        <a
                          className="button"
                          href={file.preview}
                          target="_blank"
                          rel="noreferrer"
                        >
                          View
                        </a>
                      )}
                      <button
                        className="danger"
                        disabled={busy || locked}
                        onClick={() => void remove(file)}
                        aria-label={`Delete ${file.label || file.name}`}
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
