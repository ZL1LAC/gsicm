import React from "react";
import type { JobSummary } from "../shared/types";

export const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
export const relative = (value: number | string) => {
  const seconds = Math.max(
    0,
    Math.floor((Date.now() - +new Date(value)) / 1000),
  );
  return seconds < 10
    ? "just now"
    : seconds < 60
      ? `${seconds}s ago`
      : seconds < 3600
        ? `${Math.floor(seconds / 60)}m ago`
        : seconds < 86400
          ? `${Math.floor(seconds / 3600)}h ago`
          : `${Math.floor(seconds / 86400)}d ago`;
};
export const active = (job: JobSummary) =>
  job.status === "queued" || job.status === "running";
export const stageName = (job: JobSummary) =>
  job.status === "queued"
    ? "Queued"
    : job.status !== "running"
      ? {
          succeeded: "Complete",
          failed: "Failed",
          cancelled: "Cancelled",
          interrupted: "Interrupted",
        }[job.status]
      : {
          acquiring: "Fetching imagery",
          preparing: "Preparing images",
          composing: "Creating composite",
          publishing: "Publishing",
        }[job.stage ?? "acquiring"];
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    Overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    Sources: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18M5 6h14M5 18h14" />
      </>
    ),
    Profiles: (
      <>
        <path d="m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5" />
      </>
    ),
    Jobs: (
      <>
        <path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01" />
      </>
    ),
    Files: (
      <path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />
    ),
    "Image Tools": (
      <>
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="m3 17 6-6 4 4 3-3 5 5" />
      </>
    ),
    Settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    play: <path d="m8 4 12 8-12 8V4Z" />,
    plus: <path d="M12 5v14M5 12h14" />,
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    check: <path d="m5 12 4 4L19 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.Overview}
    </svg>
  );
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return (
    <span className={`status-badge ${tone}`}>
      <span className="status-dot" />
      {children}
    </span>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="empty-state">
      <Icon name="Sources" size={32} />
      <h3>{title}</h3>
      <div className="muted">{children}</div>
    </div>
  );
}
export function JobStages({ job }: { job: JobSummary }) {
  const stages = ["Queued", "Fetch", "Prepare", "Compose", "Publish"];
  const step =
    job.status === "succeeded"
      ? 5
      : job.status === "queued"
        ? 0
        : { acquiring: 1, preparing: 2, composing: 3, publishing: 4 }[
            job.stage ?? "acquiring"
          ];
  return (
    <ol className="job-stages" aria-label="Composition stages">
      {stages.map((name, i) => (
        <li
          key={name}
          className={
            i < step ? "done" : i === step && active(job) ? "current" : ""
          }
          aria-current={i === step && active(job) ? "step" : undefined}
        >
          <span>{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
          {name}
        </li>
      ))}
    </ol>
  );
}
export function FilterCount({
  shown,
  total,
  noun,
  onClear,
}: {
  shown: number;
  total: number;
  noun: string;
  onClear: () => void;
}) {
  return (
    <p className="muted filter-count" role="status">
      Showing {shown} of {total} {noun}
      <button className="text-button" onClick={onClear}>
        Clear filters
      </button>
    </p>
  );
}
export const duration = (start: string, end: string) => {
  const seconds = Math.max(
    0,
    Math.round((+new Date(end) - +new Date(start)) / 1000),
  );
  return seconds < 60
    ? `${seconds}s`
    : seconds < 3600
      ? `${Math.floor(seconds / 60)}m ${seconds % 60}s`
      : `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
};
