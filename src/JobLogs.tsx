import { useEffect, useRef, useState } from "react";
import type { Job } from "../shared/types";
import { api, ApiError } from "./api";
import { useAutoRefresh } from "./useAutoRefresh";
import { Dialog } from "./Dialog";
import { JobStages, Status, stageName, active } from "./ui";
import { StitchProgress } from "./StitchProgress";

export function JobLogs({
  id,
  onClose,
  onUnauthorized,
}: {
  id: string;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const resource = useAutoRefresh(`job:${id}`, (signal) =>
    api<Job>(`/jobs/${encodeURIComponent(id)}`, "GET", undefined, signal),
  );
  const [follow, setFollow] = useState(true);
  const output = useRef<HTMLPreElement>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const [cancelRequested, setCancelRequested] = useState(false);
  useEffect(() => {
    if (resource.error instanceof ApiError && resource.error.status === 401)
      onUnauthorized();
  }, [resource.error, onUnauthorized]);
  useEffect(() => {
    if (follow && output.current)
      output.current.scrollTop = output.current.scrollHeight;
  }, [resource.data?.logs, follow]);
  return (
    <Dialog title="Job logs" onClose={onClose} className="logs-dialog">
      {resource.data && (
        <>
          <div className="section-heading">
            <div>
              <h3>{resource.data.profileName}</h3>
              <p>{resource.data.message}</p>
            </div>
            <Status tone={resource.data.status}>
              {stageName(resource.data)}
            </Status>
          </div>
          <JobStages job={resource.data} />
          <StitchProgress job={resource.data} detailed />
          <div className="actions stitch-actions">
            <button type="button" onClick={() => void resource.refresh()}>
              Refresh progress
            </button>
            {resource.data.status === "succeeded" && (
              <a
                className="button"
                href={`/api/outputs/${encodeURIComponent(resource.data.profileId)}`}
                target="_blank"
                rel="noreferrer"
              >
                Open latest composite ↗
              </a>
            )}
            {active(resource.data) && (
              <button
                className="danger"
                disabled={cancelling || cancelRequested}
                onClick={async () => {
                  setCancelling(true);
                  setCancelError("");
                  try {
                    await api(
                      `/jobs/${encodeURIComponent(id)}/cancel`,
                      "POST",
                      {},
                    );
                    setCancelRequested(true);
                    await resource.refresh();
                  } catch (error) {
                    if (error instanceof ApiError && error.status === 401)
                      onUnauthorized();
                    setCancelError((error as Error).message);
                  } finally {
                    setCancelling(false);
                  }
                }}
              >
                {cancelling || cancelRequested
                  ? "Cancellation requested…"
                  : "Cancel stitch"}
              </button>
            )}
          </div>
          {cancelError && (
            <p className="inline-error" role="alert">
              {cancelError}
            </p>
          )}
        </>
      )}
      <div className="logs-toolbar">
        <span className="muted">Updates automatically every 4 seconds</span>
        <label className="check">
          <input
            type="checkbox"
            checked={follow}
            onChange={(e) => setFollow(e.target.checked)}
          />
          Follow output
        </label>
      </div>
      {resource.error && (
        <p role="alert" className="inline-error">
          {resource.error.message}{" "}
          {resource.error instanceof ApiError && resource.error.status === 404
            ? "This job may have expired from history."
            : "Reconnecting automatically."}
        </p>
      )}
      <pre
        className="log-output"
        ref={output}
        tabIndex={0}
        aria-label="Process output"
      >
        {resource.data?.logs ||
          (resource.loading ? "Loading logs…" : "No process output yet.")}
      </pre>
    </Dialog>
  );
}
