import { useEffect, useState } from "react";
import type { JobSummary } from "../shared/types";
import { active, date, duration, relative } from "./ui";

export function StitchProgress({
  job,
  detailed = false,
}: {
  job: JobSummary;
  detailed?: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  const running = active(job);
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [running, job.id]);
  const end = job.finishedAt ?? new Date(now).toISOString();
  const sources = job.sources ?? [];
  const ready = sources.filter((source) => source.status === "ready").length;
  const settled = sources.filter(
    (source) => !["waiting", "fetching"].includes(source.status),
  ).length;
  return (
    <section className="stitch-progress" aria-label="Stitching progress">
      <div className="stitch-timing">
        <span>
          {running ? "Elapsed" : "Duration"}{" "}
          <strong>{duration(job.startedAt, end)}</strong>
        </span>
        {job.stageStartedAt && job.status === "running" && (
          <span>
            In this stage <strong>{duration(job.stageStartedAt, end)}</strong>
          </span>
        )}
        {job.lastActivityAt && running && (
          <span>Activity {relative(job.lastActivityAt)}</span>
        )}
      </div>
      {sources.length > 0 && (
        <>
          <div className="stitch-input-summary">
            <span>
              {ready} of {sources.length} satellite inputs ready
            </span>
            <span className="muted">{settled} checked</span>
          </div>
          <progress
            value={settled}
            max={sources.length}
            aria-label="Satellite inputs checked"
          />
          {detailed && (
            <ul className="stitch-inputs">
              {sources.map((source) => (
                <li key={source.sourceId} className={`input-${source.status}`}>
                  <div className="stitch-input-heading">
                    <strong>{source.name}</strong>
                    <span className="muted">
                      {source.optional ? "Optional" : "Required"}
                    </span>
                    <span className="stitch-input-status">
                      {
                        {
                          waiting: "Waiting",
                          fetching: "Fetching…",
                          ready: "Ready",
                          skipped: "Skipped",
                          failed: "Failed",
                          cancelled: "Cancelled",
                        }[source.status]
                      }
                    </span>
                  </div>
                  {source.observationTime && (
                    <p>Observation {date(source.observationTime)}</p>
                  )}
                  {source.message && (
                    <details>
                      <summary>Why {source.status}?</summary>
                      <p>{source.message}</p>
                    </details>
                  )}
                  {source.imageId && (
                    <a
                      href={`/api/images/${encodeURIComponent(source.imageId)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Inspect input image ↗
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {detailed && job.status === "running" && job.stage === "composing" && (
        <p className="muted">
          The stitcher is combining the ready inputs. Process output appears
          below as it becomes available.
        </p>
      )}
    </section>
  );
}
