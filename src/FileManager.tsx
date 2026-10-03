import { useEffect, useState } from "react";
import type { FileEntry, FilesState } from "../shared/types";
import { api, ApiError } from "./api";
import { Dialog } from "./Dialog";
import { useAutoRefresh } from "./useAutoRefresh";

const size = (bytes: number) =>
  bytes < 1048576
    ? `${(bytes / 1024).toFixed(1)} KB`
    : `${(bytes / 1048576).toFixed(1)} MB`;
const identity = (file: FileEntry) => `${file.folder}/${file.name}`;

export function FileManager({
  onChange,
  onUnauthorized,
}: {
  onChange: () => Promise<void>;
  onUnauthorized?: () => void;
}) {
  const resource = useAutoRefresh<FilesState>("files", (signal) =>
    api("/files", "GET", undefined, signal),
  );
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [deleting, setDeleting] = useState<FileEntry>();
  const [pending, setPending] = useState<string>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const files = resource.data?.files ?? [];
  const locked = resource.data?.locked ?? false;

  useEffect(() => {
    if (resource.error instanceof ApiError && resource.error.status === 401)
      onUnauthorized?.();
  }, [resource.error, onUnauthorized]);

  const remove = async (file: FileEntry) => {
    setPending(identity(file));
    setError("");
    setNotice("");
    try {
      await api(
        `/files/${file.folder}/${encodeURIComponent(file.name)}`,
        "DELETE",
        {},
      );
      setDeleting(undefined);
      await Promise.all([resource.refresh(), onChange()]);
      setNotice(`Deleted ${file.label || file.name}.`);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) onUnauthorized?.();
      setError((e as Error).message);
    } finally {
      setPending(undefined);
    }
  };
  const search = query.trim().toLowerCase();
  const visible = files.filter(
    (file) =>
      (filter === "all" || file.folder === filter) &&
      `${file.label ?? ""} ${file.name}`.toLowerCase().includes(search),
  );
  return (
    <section className="file-manager panel">
      <div className="section-head">
        <div>
          <h2>Stored files</h2>
          <p className="muted">
            {files.length} files ·{" "}
            {size(files.reduce((sum, file) => sum + file.bytes, 0))}
          </p>
        </div>
        <div className="filter-bar">
          <label className="field">
            <span>Search files</span>
            <input
              type="search"
              placeholder="Name or filename"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <label className="field">
            <span>File category</span>
            <select
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option value="all">All files</option>
              <option value="outputs">Composites</option>
              <option value="cache">Cached imagery</option>
            </select>
          </label>
        </div>
      </div>
      <p className="muted">
        Downloaded imagery and published composites. Deleting a composite keeps
        its profile and job history.
      </p>
      {locked && (
        <p role="status" className="inline-notice">
          Files are in use. Deletion is available when processing and source
          tests finish.
        </p>
      )}
      {resource.error && (
        <div role="alert" className="alert error">
          <span>
            {resource.error.message}{" "}
            {resource.data
              ? "Showing the last available files."
              : "Files could not be loaded."}{" "}
            Automatic updates will retry.
          </span>
          <button onClick={() => void resource.refresh()}>Retry</button>
        </div>
      )}
      {error && !deleting && (
        <p role="alert" className="alert error">
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="inline-notice">
          {notice}
        </p>
      )}
      {!resource.data && !resource.error ? (
        <div className="empty-state" role="status">
          Loading files…
        </div>
      ) : !visible.length ? (
        <div className="empty-state">
          <h3>{files.length ? "No matching files" : "No stored files yet"}</h3>
          <p>
            {files.length
              ? "Try another search or category."
              : "Test a source or run a profile to create imagery."}
          </p>
        </div>
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
                <tr key={identity(file)}>
                  <td data-label="File">
                    <strong>{file.label || file.name}</strong>
                    {file.label && <small>{file.name}</small>}
                  </td>
                  <td data-label="Type">
                    {file.folder === "outputs" ? "Composite" : "Cached imagery"}
                  </td>
                  <td data-label="Observation">
                    {file.observationTime
                      ? new Date(file.observationTime).toLocaleString()
                      : "—"}
                  </td>
                  <td data-label="Size">{size(file.bytes)}</td>
                  <td data-label="Actions">
                    <div className="file-actions">
                      {file.preview && (
                        <a
                          className="button"
                          href={file.preview}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`View ${file.label || file.name}`}
                        >
                          View
                        </a>
                      )}
                      <button
                        className="danger"
                        disabled={!!pending || locked}
                        title={
                          locked
                            ? "Wait for processing and source tests to finish."
                            : undefined
                        }
                        onClick={() => {
                          setDeleting(file);
                          setError("");
                        }}
                        aria-label={`Delete ${file.label || file.name}`}
                      >
                        {pending === identity(file) ? "Deleting…" : "Delete"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {resource.lastUpdated && (
        <p className="muted freshness">
          Files updated {new Date(resource.lastUpdated).toLocaleTimeString()} ·
          Updates every 4 seconds
        </p>
      )}
      {deleting && (
        <Dialog
          title="Delete file"
          onClose={() => {
            if (!pending) setDeleting(undefined);
          }}
          className="confirm-dialog"
        >
          <p>
            Delete <strong>{deleting.label || deleting.name}</strong>?
          </p>
          <p className="muted">
            {deleting.folder === "outputs"
              ? "This removes the published composite. You can generate it again."
              : "This removes the cached file and its preview. It will need to be downloaded again."}
          </p>
          {locked && (
            <p role="status">
              Wait for processing and source tests to finish before deleting
              this file.
            </p>
          )}
          {error && (
            <p role="alert" className="alert error">
              {error}
            </p>
          )}
          <div className="dialog-actions">
            <button disabled={!!pending} onClick={() => setDeleting(undefined)}>
              Keep file
            </button>
            <button
              className="danger"
              disabled={!!pending || locked}
              onClick={() => void remove(deleting)}
            >
              {pending ? "Deleting…" : "Delete file"}
            </button>
          </div>
        </Dialog>
      )}
    </section>
  );
}
