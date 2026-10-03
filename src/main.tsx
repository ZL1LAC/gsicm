import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { profileSchema, sourceSchema, settingsSchema } from "../shared/types";
import type {
  AuthState,
  Job,
  JobSummary,
  ManagerState,
  Profile,
  Settings,
  SourceRecord,
} from "../shared/types";
import { api, ApiError } from "./api";
import { useAutoRefresh } from "./useAutoRefresh";
import { Dialog } from "./Dialog";
import { SourceEditor, ProfileEditor } from "./Editors";
import { HourPicker } from "./HourPicker";
import { FileManager } from "./FileManager";
import "./style.css";

const pages = [
  "Overview",
  "Sources",
  "Profiles",
  "Jobs",
  "Files",
  "Settings",
] as const;
type Page = (typeof pages)[number];
const readPage = (): Page =>
  pages.find((p) => p.toLowerCase() === location.hash.slice(1).split("?")[0]) ??
  "Overview";
const date = (value?: string) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";
const relative = (value: number | string) => {
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
const active = (job: JobSummary) =>
  job.status === "queued" || job.status === "running";
const stageName = (job: JobSummary) =>
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
function newId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
function Icon({ name, size = 20 }: { name: string; size?: number }) {
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
function Status({
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
function Empty({
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
function JobStages({ job }: { job: JobSummary }) {
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
function JobLogs({
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
function SettingsPage({
  value,
  locked,
  onSave,
  onLogout,
  loginRequired,
}: {
  value: Settings;
  locked: boolean;
  onSave: (value: Settings) => Promise<void>;
  onLogout: () => Promise<void>;
  loginRequired: boolean;
}) {
  const [draft, setDraft] = useState<Settings>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const groups = [
    {
      title: "Automation",
      description:
        "Scheduled profiles run while the server is running, even when this browser is closed.",
      fields: [["pollMinutes", "Composition interval (minutes)", 1, 180]],
    },
    {
      title: "Storage & history",
      description:
        "Keep the latest successful output per profile and choose how long to retain temporary imagery and job history.",
      fields: [
        ["cacheHours", "Source cache (hours)", 1, 48],
        ["logDays", "Job retention (days)", 1, 90],
      ],
    },
    {
      title: "Processing limits",
      description: "These limits apply to future operations.",
      fields: [
        ["processTimeoutMinutes", "Composition timeout (minutes)", 1, 120],
        ["downloadTimeoutSeconds", "Download timeout (seconds)", 2, 300],
        ["maxDownloadMb", "Maximum image size (MB)", 1, 500],
      ],
    },
  ];
  return (
    <form
      className="settings-form panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        try {
          const result = settingsSchema.safeParse(draft ?? value);
          if (!result.success)
            throw new Error(
              result.error.issues.map((i) => i.message).join(". "),
            );
          await onSave(result.data);
          setDraft(undefined);
        } catch (e) {
          setError((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {groups.map((group) => (
        <section className="editor-section" key={group.title}>
          <div className="section-copy">
            <h2>{group.title}</h2>
            <p>{group.description}</p>
          </div>
          <div className="form-grid">
            {group.fields.map(([key, label, min, max]) => (
              <label className="field" key={key}>
                <span>{label}</span>
                <input
                  type="number"
                  required
                  min={min}
                  max={max}
                  step={key === "cacheHours" ? "any" : 1}
                  value={(draft ?? value)[key as keyof Settings]}
                  disabled={busy}
                  onChange={(e) =>
                    setDraft({
                      ...(draft ?? value),
                      [key]: Number(e.target.value),
                    })
                  }
                />
              </label>
            ))}
          </div>
        </section>
      ))}
      {locked && (
        <p className="inline-notice">
          Configuration is locked while processing, testing, or cleanup is
          active. You can save when it finishes.
        </p>
      )}
      {error && (
        <p role="alert" className="inline-error">
          {error}
        </p>
      )}
      <div className="editor-footer">
        <span className="muted">
          {draft ? "You have unsaved changes" : "Settings are up to date"}
        </span>
        <div className="actions">
          <button
            type="button"
            disabled={!draft || busy}
            onClick={() => {
              setDraft(undefined);
              setError("");
            }}
          >
            Discard changes
          </button>
          <button className="primary" disabled={busy || locked || !draft}>
            {busy ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
      <div className="settings-access">
        <span className="muted">
          {loginRequired
            ? "Password login enabled"
            : "Password login is not enabled"}
        </span>
        {loginRequired && (
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onLogout();
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Log out
          </button>
        )}
      </div>
    </form>
  );
}

function App() {
  const manager = useAutoRefresh("manager", async (signal) => {
    const auth = await api<AuthState>("/auth", "GET", undefined, signal);
    const state = auth.authenticated
      ? await api<ManagerState>("/state", "GET", undefined, signal)
      : undefined;
    return {
      auth,
      // A running manager may still serve the previous API until its next restart.
      state: state && {
        ...state,
        locked: state.locked ?? (!!state.activeJob || state.jobs.some(active)),
        testingSourceIds: state.testingSourceIds ?? [],
        canRunJobs: state.canRunJobs ?? true,
      },
    };
  });
  const [page, setPage] = useState<Page>(readPage);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginBusy, setLoginBusy] = useState(false);
  const [source, setSource] = useState<SourceRecord>();
  const [profile, setProfile] = useState<Profile>();
  const [jobId, setJobId] = useState<string>();
  const [hourProfile, setHourProfile] = useState<Profile>();
  const [deleteProfile, setDeleteProfile] = useState<Profile>();
  const [archiveSource, setArchiveSource] = useState<SourceRecord>();
  const [archiveTime, setArchiveTime] = useState("");
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState("");
  const [sourceSearch, setSourceSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [jobSearch, setJobSearch] = useState("");
  const [jobFilter, setJobFilter] = useState("all");
  const [, tick] = useState(0);
  useEffect(() => {
    const onHash = () => setPage(readPage());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 10000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);
  useEffect(() => {
    if (manager.error instanceof ApiError && manager.error.status === 401)
      setExpired(true);
  }, [manager.error]);
  const auth = manager.data?.auth;
  const state = manager.data?.state;
  const unauthorized = React.useCallback(() => {
    setExpired(true);
  }, []);
  useEffect(() => {
    if (expired || auth?.authenticated === false) {
      setSource(undefined);
      setProfile(undefined);
      setJobId(undefined);
      setHourProfile(undefined);
      setDeleteProfile(undefined);
      setArchiveSource(undefined);
    }
  }, [expired, auth?.authenticated]);
  const handleError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 401) unauthorized();
    return e instanceof Error ? e.message : String(e);
  };
  const execute = async (
    key: string,
    fn: () => Promise<unknown>,
    message?: string,
  ) => {
    if (pending.has(key)) return false;
    setPending((previous) => new Set(previous).add(key));
    setErrors((previous) => ({ ...previous, [key]: "" }));
    try {
      await fn();
      await manager.refresh();
      if (message) setNotice(message);
      return true;
    } catch (e) {
      setErrors((previous) => ({ ...previous, [key]: handleError(e) }));
      await manager.refresh();
      return false;
    } finally {
      setPending((previous) => {
        const next = new Set(previous);
        next.delete(key);
        return next;
      });
    }
  };
  const save = async (path: string, value: unknown, message: string) => {
    try {
      await api(path, "PUT", value);
      await manager.refresh();
      setNotice(message);
      return true;
    } catch (e) {
      handleError(e);
      throw e;
    }
  };
  const run = async (p: Profile, targetTime?: string) => {
    await api<Job>(
      `/profiles/${encodeURIComponent(p.id)}/run`,
      "POST",
      targetTime ? { targetTime } : {},
    );
  };
  const feedback = (key: string) =>
    errors[key] ? (
      <p className="inline-error" role="alert">
        {errors[key]}
      </p>
    ) : null;
  const navigate = (next: Page) => {
    location.hash = next.toLowerCase();
  };
  // Names are required only on save; construct the blank draft without parsing those fields.
  const addSource = () =>
    setSource({
      ...sourceSchema.parse({
        id: newId(),
        name: "New source",
        satellite: "New satellite",
        region: "",
        enabled: false,
        transport: "http",
        location: "",
        longitude: 0,
        attribution: "",
      }),
      name: "",
      satellite: "",
    });
  const addProfile = () =>
    setProfile(
      profileSchema.parse({
        id: newId(),
        name: "New profile",
        enabled: false,
        projection: "map",
        sourceIds: [],
        underlay: state?.underlays[0] ?? "",
      }),
    );
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginBusy(true);
    setLoginError("");
    try {
      await api("/login", "POST", { password });
      setPassword("");
      setExpired(false);
      await manager.refresh();
    } catch (e) {
      setLoginError(handleError(e));
    } finally {
      setLoginBusy(false);
    }
  };
  if (expired || (auth?.required && !auth.authenticated))
    return (
      <main className="login-page">
        <form className="login-card panel" onSubmit={login}>
          <div className="brand">
            <span className="brand-mark">
              <Icon name="Sources" size={25} />
            </span>
            <div>
              GSICM<small>EARTH OBSERVATION</small>
            </div>
          </div>
          <span className="eyebrow">WELCOME BACK</span>
          <h1>Your view of Earth.</h1>
          <p className="muted">Enter your manager password to continue.</p>
          <label className="field">
            <span>Password</span>
            <input
              autoFocus
              autoComplete="current-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {loginError && (
            <p role="alert" className="inline-error">
              {loginError}
            </p>
          )}
          <button className="primary" disabled={loginBusy || !password}>
            {loginBusy ? "Logging in…" : "Log in"}
            <Icon name="arrow" size={16} />
          </button>
        </form>
      </main>
    );
  if (!state)
    return (
      <main className="connecting-page">
        <span className="brand-mark">
          <Icon name="Sources" size={30} />
        </span>
        <h1>GSICM</h1>
        <p>
          {manager.error
            ? "Unable to reach the manager. Reconnecting automatically…"
            : "Connecting to your satellite manager…"}
        </p>
        {manager.error && (
          <button onClick={() => void manager.refresh()}>Try again</button>
        )}
        <div className="loading-line" />
      </main>
    );
  const runningJobs = state.jobs.filter(active);
  const readySources = state.sources.filter(
    (s) => s.enabled && s.validation?.compatible,
  );
  const blockedProfiles = state.profiles.filter((p) => p.blockers.length);
  const lockedReason = state.locked
    ? "Configuration is locked during processing, source tests, or cleanup."
    : "";
  const runReason = (p: ManagerState["profiles"][number]) =>
    p.blockers.length
      ? p.blockers[0]
      : !state.canRunJobs
        ? "Wait for source testing or cleanup to finish."
        : "";
  const runButtons = (p: ManagerState["profiles"][number]) => {
    const key = `run:${p.id}`;
    const existing = runningJobs.find((j) => j.profileId === p.id);
    return (
      <>
        <div className="actions">
          <button
            className="primary"
            disabled={pending.has(key) || !!runReason(p)}
            onClick={() =>
              existing
                ? setJobId(existing.id)
                : void execute(key, () => run(p), "Composition queued")
            }
          >
            <Icon name={existing ? "Jobs" : "play"} size={15} />
            {pending.has(key)
              ? "Queueing…"
              : existing
                ? "View progress"
                : "Run now"}
          </button>
          <button
            disabled={!!runReason(p) || !!existing}
            onClick={() => setHourProfile(p)}
          >
            <Icon name="clock" size={15} />
            Choose hour
          </button>
        </div>
        {runReason(p) && (
          <p className="action-hint">
            {runReason(p)}{" "}
            <button className="text-button" onClick={() => setProfile(p)}>
              Review setup
            </button>
          </p>
        )}
        {feedback(key)}
      </>
    );
  };
  const renderJob = (job: JobSummary) => (
    <article className="job-card panel" key={job.id}>
      <div className="section-heading">
        <div>
          <h2>{job.profileName}</h2>
          <p className="muted">Target {date(job.targetTime)}</p>
        </div>
        <Status tone={job.status}>{stageName(job)}</Status>
      </div>
      <p className="job-message">{job.message}</p>
      {active(job) && <JobStages job={job} />}
      <div className="job-footer">
        <span className="muted">
          Started {date(job.startedAt)}
          {job.finishedAt ? ` · Finished ${date(job.finishedAt)}` : ""}
        </span>
        <div className="actions">
          <button onClick={() => setJobId(job.id)}>View logs</button>
          {active(job) && (
            <button
              className="danger subtle"
              disabled={pending.has(`cancel:${job.id}`)}
              onClick={() =>
                void execute(
                  `cancel:${job.id}`,
                  () =>
                    api(
                      `/jobs/${encodeURIComponent(job.id)}/cancel`,
                      "POST",
                      {},
                    ),
                  "Cancellation requested",
                )
              }
            >
              {pending.has(`cancel:${job.id}`) ? "Cancelling…" : "Cancel job"}
            </button>
          )}
        </div>
      </div>
      {feedback(`cancel:${job.id}`)}
    </article>
  );
  const descriptions: Record<Page, string> = {
    Overview: "Your latest view of Earth, all in one place.",
    Sources: "Connect, inspect, and validate your satellite imagery.",
    Profiles: "Choose what to create and how it should look.",
    Jobs: "Follow your composites from acquisition to publication.",
    Files: "Browse your generated composites and cached imagery.",
    Settings: "Tune automation, storage, and processing.",
  };
  const connectionLabel = {
    live: "Live",
    connecting: "Connecting",
    reconnecting: "Reconnecting",
    offline: "Offline",
  }[manager.connection];
  const shownJobs = state.jobs.filter(
    (j) =>
      (jobFilter === "all" || j.status === jobFilter) &&
      `${j.profileName} ${j.message}`
        .toLowerCase()
        .includes(jobSearch.toLowerCase()),
  );
  const shownSources = state.sources.filter(
    (s) =>
      `${s.name} ${s.satellite} ${s.region}`
        .toLowerCase()
        .includes(sourceSearch.toLowerCase()) &&
      (sourceFilter === "all" ||
        (sourceFilter === "ready"
          ? s.enabled && s.validation?.compatible
          : sourceFilter === "disabled"
            ? !s.enabled
            : s.enabled && !s.validation?.compatible)),
  );
  return (
    <div className="shell">
      <a
        className="skip-link"
        href="#main-content"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        Skip to content
      </a>
      <aside className="sidebar">
        <a className="brand" href="#overview">
          <span className="brand-mark">
            <Icon name="Sources" size={25} />
          </span>
          <div>
            GSICM<small>EARTH OBSERVATION</small>
          </div>
        </a>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {pages.map((name) => (
            <a
              href={`#${name.toLowerCase()}`}
              key={name}
              aria-label={name}
              className={page === name ? "selected" : ""}
              aria-current={page === name ? "page" : undefined}
            >
              <Icon name={name} />
              <span>{name}</span>
              {name === "Jobs" && runningJobs.length > 0 && (
                <span className="nav-count">{runningJobs.length}</span>
              )}
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="eyebrow">SATELLITE COMPOSITOR</span>
          <p>
            One planet.
            <br />A clearer perspective.
          </p>
          <span className="muted">{location.host}</span>
        </div>
      </aside>
      <div className="workspace">
        <header className="page-header">
          <div>
            <div className="eyebrow">
              EARTH OBSERVATION / {page.toUpperCase()}
            </div>
            <h1>{page}</h1>
            <p>{descriptions[page]}</p>
          </div>
          <div className="connection">
            <Status tone={manager.connection === "live" ? "good" : "warning"}>
              {connectionLabel}
            </Status>
            <span
              title={
                manager.lastUpdated
                  ? date(new Date(manager.lastUpdated).toISOString())
                  : undefined
              }
            >
              {manager.lastUpdated
                ? `Updated ${relative(manager.lastUpdated)}`
                : "Waiting for data"}
            </span>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {manager.error && (
            <div className="connection-warning" role="status">
              <div>
                <strong>
                  {manager.connection === "offline"
                    ? "You’re offline"
                    : "Connection interrupted"}
                </strong>
                <p>
                  Showing the last available data. Updates will resume
                  automatically.
                </p>
              </div>
              <button onClick={() => void manager.refresh()}>
                Retry connection
              </button>
            </div>
          )}
          {notice && (
            <div className="toast" role="status">
              <Icon name="check" size={18} />
              <span>{notice}</span>
              <button
                className="icon-button"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                ×
              </button>
            </div>
          )}
          {page !== "Overview" && page !== "Jobs" && runningJobs.length > 0 && (
            <div className="activity-strip">
              <span className="activity-pulse" />
              <span>
                <strong>
                  {runningJobs.length} active{" "}
                  {runningJobs.length === 1 ? "job" : "jobs"}
                </strong>{" "}
                · {runningJobs[0].profileName}
              </span>
              <button className="text-button" onClick={() => navigate("Jobs")}>
                View activity <Icon name="arrow" size={15} />
              </button>
            </div>
          )}
          {page === "Overview" && (
            <>
              <div className="metrics">
                <div>
                  <span className="metric-icon">
                    <Icon name="Sources" />
                  </span>
                  <div>
                    <strong>
                      {readySources.length}
                      <small> / {state.sources.length}</small>
                    </strong>
                    <span>Sources ready</span>
                  </div>
                </div>
                <div>
                  <span className="metric-icon">
                    <Icon name="Profiles" />
                  </span>
                  <div>
                    <strong>
                      {
                        state.outputs.filter((o) =>
                          state.profiles.some((p) => p.id === o.profileId),
                        ).length
                      }
                    </strong>
                    <span>Latest composites</span>
                  </div>
                </div>
                <div>
                  <span className="metric-icon">
                    <Icon name="Jobs" />
                  </span>
                  <div>
                    <strong>{runningJobs.length}</strong>
                    <span>Active jobs</span>
                  </div>
                </div>
                <div>
                  <span className="metric-icon">
                    <Icon name="clock" />
                  </span>
                  <div>
                    <strong>
                      {state.settings.pollMinutes}
                      <small> min</small>
                    </strong>
                    <span>Composition interval</span>
                  </div>
                </div>
              </div>
              <div className="overview-layout">
                <section>
                  <div className="section-heading">
                    <div>
                      <h2>Latest imagery</h2>
                      <p className="muted">
                        The latest successful output from each profile
                      </p>
                    </div>
                    <button
                      className="text-button"
                      onClick={() => navigate("Profiles")}
                    >
                      Manage profiles <Icon name="arrow" size={15} />
                    </button>
                  </div>
                  <div className="output-grid">
                    {state.profiles.map((p) => {
                      const output = state.outputs.find(
                        (o) => o.profileId === p.id,
                      );
                      return (
                        <article className="output-card panel" key={p.id}>
                          <div className={`image-area ${p.projection}`}>
                            {output ? (
                              <a
                                href={`/api/outputs/${encodeURIComponent(p.id)}?v=${output.jobId}`}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${p.name} image`}
                              >
                                <img
                                  src={`/api/outputs/${encodeURIComponent(p.id)}?v=${output.jobId}`}
                                  alt={p.name}
                                />
                                <span className="image-open">
                                  Open full image ↗
                                </span>
                              </a>
                            ) : (
                              <div className="image-placeholder">
                                <div className="orbital-grid">
                                  <Icon name="Sources" size={96} />
                                </div>
                                <strong>
                                  {p.blockers.length
                                    ? "Your next view starts here"
                                    : "Ready for your first composite"}
                                </strong>
                                <span>
                                  {p.blockers.length
                                    ? "Complete profile setup to create imagery"
                                    : "Run this profile to create an image"}
                                </span>
                              </div>
                            )}
                            <span className="projection-label">
                              {p.projection === "map"
                                ? "GLOBAL MAP"
                                : p.projection === "disk"
                                  ? "SATELLITE DISK"
                                  : "VIRTUAL GLOBE"}
                            </span>
                          </div>
                          <div className="output-body">
                            <div className="section-heading">
                              <h2>{p.name}</h2>
                              <Status
                                tone={p.blockers.length ? "warning" : "good"}
                              >
                                {p.blockers.length ? "Setup needed" : "Ready"}
                              </Status>
                            </div>
                            <p className="output-meta">
                              {p.resolution} km · {p.format.toUpperCase()} ·{" "}
                              {p.enabled ? "Scheduled" : "Manual"}
                            </p>
                            {output ? (
                              <>
                                <div className="image-times">
                                  <div>
                                    <span>Observation</span>
                                    <strong>{date(output.targetTime)}</strong>
                                  </div>
                                  <div>
                                    <span>
                                      Published {relative(output.publishedAt)}
                                    </span>
                                    <strong>{date(output.publishedAt)}</strong>
                                  </div>
                                </div>
                                <details className="image-details">
                                  <summary>
                                    {output.observations.length} observations ·{" "}
                                    {output.width} × {output.height}
                                  </summary>
                                  {output.observations.map((o) => (
                                    <p key={o.sourceId}>
                                      <strong>{o.satellite}</strong> ·{" "}
                                      {date(o.time)}
                                      <br />
                                      {o.attribution}
                                    </p>
                                  ))}
                                </details>
                              </>
                            ) : (
                              <p className="muted output-empty-copy">
                                {p.blockers.length
                                  ? `${p.blockers.length} setup ${p.blockers.length === 1 ? "requirement" : "requirements"} to resolve`
                                  : "No image published yet"}
                              </p>
                            )}
                            {runButtons(p)}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  {!state.profiles.length && (
                    <div className="panel">
                      <Empty title="Create your first profile">
                        <p>
                          Choose a map, virtual globe, or satellite disk to get
                          started.
                        </p>
                        <button
                          className="primary"
                          disabled={!state.underlays.length}
                          onClick={addProfile}
                        >
                          New profile
                        </button>
                      </Empty>
                    </div>
                  )}
                </section>
                <aside className="overview-rail">
                  <section className="panel rail-panel">
                    <div className="section-heading">
                      <h2>Activity</h2>
                      <span className="count-badge">{runningJobs.length}</span>
                    </div>
                    {runningJobs.length ? (
                      runningJobs.map((j) => (
                        <div className="activity-item" key={j.id}>
                          <div className="row">
                            <strong>{j.profileName}</strong>
                            <Status tone={j.status}>{stageName(j)}</Status>
                          </div>
                          <p>{j.message}</p>
                          <button
                            className="text-button"
                            onClick={() => setJobId(j.id)}
                          >
                            View progress <Icon name="arrow" size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="rail-empty">
                        <span className="idle-indicator">
                          <Icon name="check" />
                        </span>
                        <strong>All quiet here</strong>
                        <p>No composites in progress.</p>
                      </div>
                    )}
                    <a className="rail-link" href="#jobs">
                      View job history <Icon name="arrow" size={15} />
                    </a>
                  </section>
                  <section className="panel rail-panel">
                    <div className="section-heading">
                      <h2>
                        {blockedProfiles.length
                          ? "Needs attention"
                          : "Ready to create"}
                      </h2>
                      {blockedProfiles.length > 0 && (
                        <span className="count-badge warning">
                          {blockedProfiles.length}
                        </span>
                      )}
                    </div>
                    {blockedProfiles.length ? (
                      blockedProfiles.map((p) => (
                        <div className="readiness-item" key={p.id}>
                          <strong>{p.name}</strong>
                          <p>
                            {p.blockers[0]}
                            {p.blockers.length > 1
                              ? ` (+${p.blockers.length - 1} more)`
                              : ""}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setProfile(p)}
                          >
                            Review setup <Icon name="arrow" size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <p className="muted">
                        {state.profiles.length
                          ? "Your profiles have the sources they need. Start a composite whenever you’re ready."
                          : "Add a profile to start creating composites."}
                      </p>
                    )}
                  </section>
                  <section className="panel rail-panel">
                    <div className="section-heading">
                      <h2>Source health</h2>
                      <span className="muted">
                        {readySources.length}/{state.sources.length}
                      </span>
                    </div>
                    <div className="source-health">
                      {state.sources.map((s) => (
                        <button key={s.id} onClick={() => setSource(s)}>
                          <span
                            className={`health-dot ${s.enabled && s.validation?.compatible ? "good" : s.enabled ? "warning" : ""}`}
                          />
                          <span>
                            {s.name}
                            <small>
                              {!s.enabled
                                ? "Disabled"
                                : s.validation?.compatible
                                  ? "Validated"
                                  : "Needs validation"}
                            </small>
                          </span>
                          <Icon name="arrow" size={14} />
                        </button>
                      ))}
                    </div>
                    <a className="rail-link" href="#sources">
                      Manage sources <Icon name="arrow" size={15} />
                    </a>
                  </section>
                </aside>
              </div>
            </>
          )}
          {page === "Sources" && (
            <>
              <div className="page-toolbar">
                <div className="filters">
                  <label className="search-field">
                    <span className="sr-only">Search sources</span>
                    <input
                      type="search"
                      placeholder="Search sources…"
                      value={sourceSearch}
                      onChange={(e) => setSourceSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Source status"
                    value={sourceFilter}
                    onChange={(e) => setSourceFilter(e.target.value)}
                  >
                    <option value="all">All sources</option>
                    <option value="ready">Ready</option>
                    <option value="attention">Needs validation</option>
                    <option value="disabled">Disabled</option>
                  </select>
                </div>
                <div className="actions">
                  <button
                    disabled={state.locked || pending.has("presets")}
                    onClick={() =>
                      void execute(
                        "presets",
                        () => api("/presets/install", "POST", {}),
                        "Verified presets installed",
                      )
                    }
                  >
                    {pending.has("presets")
                      ? "Installing…"
                      : "Install verified presets"}
                  </button>
                  <button className="primary" onClick={addSource}>
                    <Icon name="plus" size={16} />
                    Add source
                  </button>
                </div>
              </div>
              {feedback("presets")}
              {lockedReason && <p className="inline-notice">{lockedReason}</p>}
              <div className="source-grid">
                {shownSources.map((s) => {
                  const testing =
                    state.testingSourceIds.includes(s.id) ||
                    pending.has(`test:${s.id}`);
                  return (
                    <article className="source-card panel" key={s.id}>
                      <div className="section-heading">
                        <span className="source-icon">
                          <Icon name="Sources" size={24} />
                        </span>
                        <Status
                          tone={
                            testing
                              ? "running"
                              : !s.enabled
                                ? "neutral"
                                : s.validation?.compatible
                                  ? "good"
                                  : "warning"
                          }
                        >
                          {testing
                            ? "Testing"
                            : !s.enabled
                              ? "Disabled"
                              : s.validation?.compatible
                                ? "Validated"
                                : "Needs validation"}
                        </Status>
                      </div>
                      <h2>{s.name}</h2>
                      <p className="source-location">
                        {s.satellite} · {s.region || "Region not set"}
                      </p>
                      <div className="source-spec">
                        <span>{s.transport.toUpperCase()}</span>
                        <span>{s.longitude}° longitude</span>
                      </div>
                      <p className="source-validation">
                        {s.validation?.message ||
                          s.blocker ||
                          "Configure and test this source to check its imagery."}
                      </p>
                      <div className="source-tested">
                        {s.validation
                          ? `Last tested ${date(s.validation.at)}`
                          : "Not tested yet"}
                        {!s.enabled &&
                          s.validation?.compatible &&
                          " · Validated"}
                      </div>
                      <div className="actions">
                        <button onClick={() => setSource(s)}>Configure</button>
                        <button
                          disabled={
                            state.locked ||
                            testing ||
                            (!s.location && s.transport !== "s3")
                          }
                          onClick={() =>
                            void execute(
                              `test:${s.id}`,
                              () =>
                                api(
                                  `/sources/${encodeURIComponent(s.id)}/test`,
                                  "POST",
                                  {},
                                ),
                              "Source test finished",
                            )
                          }
                        >
                          {testing ? "Testing…" : "Test source"}
                        </button>
                        {s.validation?.imageId && (
                          <a
                            className="button"
                            href={`/api/images/${encodeURIComponent(s.validation.imageId)}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Preview ↗
                          </a>
                        )}
                      </div>
                      {(s.product === "elektro-l" ||
                        s.product === "elektro-rgb") && (
                        <button
                          className="text-button archive-button"
                          disabled={state.locked || testing}
                          onClick={() => {
                            setArchiveTime("");
                            setArchiveSource(s);
                          }}
                        >
                          Test archive time
                        </button>
                      )}
                      {feedback(`test:${s.id}`)}
                    </article>
                  );
                })}
              </div>
              {!shownSources.length && (
                <div className="panel">
                  <Empty
                    title={
                      state.sources.length
                        ? "No matching sources"
                        : "Add your first satellite source"
                    }
                  >
                    <p>
                      {state.sources.length
                        ? "Try a different search or status filter."
                        : "Start with verified presets or configure a source of your own."}
                    </p>
                  </Empty>
                </div>
              )}
            </>
          )}
          {page === "Profiles" && (
            <>
              <div className="page-toolbar">
                <span className="muted">
                  {state.profiles.length}{" "}
                  {state.profiles.length === 1 ? "profile" : "profiles"} ·{" "}
                  {state.profiles.filter((p) => p.enabled).length} scheduled
                </span>
                <button
                  className="primary"
                  disabled={!state.underlays.length}
                  onClick={addProfile}
                >
                  <Icon name="plus" size={16} />
                  New profile
                </button>
              </div>
              {!state.underlays.length && (
                <p className="inline-notice">
                  Add the Sanchez distribution and its bundled underlays to
                  create profiles.
                </p>
              )}
              {lockedReason && <p className="inline-notice">{lockedReason}</p>}
              <div className="profile-grid">
                {state.profiles.map((p) => (
                  <article className="profile-card panel" key={p.id}>
                    <div className="section-heading">
                      <span className="source-icon">
                        <Icon
                          name={p.projection === "map" ? "Overview" : "Sources"}
                          size={24}
                        />
                      </span>
                      <Status tone={p.enabled ? "good" : "neutral"}>
                        {p.enabled ? "Scheduled" : "Manual"}
                      </Status>
                    </div>
                    <h2>{p.name}</h2>
                    <p className="muted">
                      {p.projection === "map"
                        ? "Global equirectangular map"
                        : p.projection === "disk"
                          ? "False-color satellite disk"
                          : `Virtual globe · ${p.longitude}°`}
                    </p>
                    <dl className="profile-specs">
                      <div>
                        <dt>Resolution</dt>
                        <dd>{p.resolution} km</dd>
                      </div>
                      <div>
                        <dt>Format</dt>
                        <dd>{p.format.toUpperCase()}</dd>
                      </div>
                      <div>
                        <dt>Sources</dt>
                        <dd>
                          {p.sourceIds.length} required ·{" "}
                          {p.optionalSourceIds.length} optional
                        </dd>
                      </div>
                      <div>
                        <dt>Time tolerance</dt>
                        <dd>±{p.toleranceMinutes} min</dd>
                      </div>
                    </dl>
                    {p.blockers.length > 0 && (
                      <details className="blocker-details">
                        <summary>
                          {p.blockers.length} setup{" "}
                          {p.blockers.length === 1
                            ? "requirement"
                            : "requirements"}
                        </summary>
                        <ul>
                          {p.blockers.map((b) => (
                            <li key={b}>{b}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {runButtons(p)}
                    <div className="card-footer">
                      <button
                        className="text-button"
                        onClick={() => setProfile(p)}
                      >
                        Edit profile
                      </button>
                      <button
                        className="text-button danger"
                        disabled={runningJobs.some((j) => j.profileId === p.id)}
                        onClick={() => setDeleteProfile(p)}
                      >
                        Delete profile
                      </button>
                    </div>
                    {runningJobs.some((j) => j.profileId === p.id) && (
                      <p className="action-hint">
                        Finish or cancel this profile’s job before deleting it.
                      </p>
                    )}
                  </article>
                ))}
              </div>
              {!state.profiles.length && (
                <div className="panel">
                  <Empty title="Build a view of your own">
                    <p>
                      Create a profile to choose your satellites, projection,
                      and appearance.
                    </p>
                  </Empty>
                </div>
              )}
            </>
          )}
          {page === "Jobs" && (
            <>
              <div className="page-toolbar">
                <div className="filters">
                  <label className="search-field">
                    <span className="sr-only">Search jobs</span>
                    <input
                      type="search"
                      placeholder="Search jobs…"
                      value={jobSearch}
                      onChange={(e) => setJobSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Job status"
                    value={jobFilter}
                    onChange={(e) => setJobFilter(e.target.value)}
                  >
                    <option value="all">All statuses</option>
                    {[
                      "queued",
                      "running",
                      "succeeded",
                      "failed",
                      "cancelled",
                      "interrupted",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {s[0].toUpperCase() + s.slice(1)}
                      </option>
                    ))}
                  </select>
                </div>
                <span className="muted">
                  History retained for {state.settings.logDays} days
                </span>
              </div>
              {shownJobs.some(active) && (
                <section className="jobs-section">
                  <div className="section-heading">
                    <h2>In progress</h2>
                    <span className="muted">Updates automatically</span>
                  </div>
                  {shownJobs.filter(active).map(renderJob)}
                </section>
              )}
              {shownJobs.some((j) => !active(j)) && (
                <section className="jobs-section">
                  <div className="section-heading">
                    <h2>History</h2>
                    <span className="muted">
                      Previous successful imagery stays available after failures
                    </span>
                  </div>
                  {shownJobs.filter((j) => !active(j)).map(renderJob)}
                </section>
              )}
              {!shownJobs.length && (
                <div className="panel">
                  <Empty
                    title={
                      state.jobs.length
                        ? "No matching jobs"
                        : "Your next composite starts here"
                    }
                  >
                    <p>
                      {state.jobs.length
                        ? "Try another search or status filter."
                        : "Run a profile to see its progress and results here."}
                    </p>
                    {!state.jobs.length && (
                      <a className="button primary" href="#profiles">
                        Explore profiles <Icon name="arrow" size={16} />
                      </a>
                    )}
                  </Empty>
                </div>
              )}
            </>
          )}
          {page === "Files" && (
            <FileManager
              onChange={manager.refresh}
              onUnauthorized={unauthorized}
            />
          )}
          {page === "Settings" && (
            <SettingsPage
              value={state.settings}
              locked={state.locked}
              loginRequired={!!auth?.required}
              onSave={async (value) => {
                await save("/settings", value, "Settings saved");
              }}
              onLogout={async () => {
                await api("/logout", "POST", {});
                setExpired(true);
                await manager.refresh();
              }}
            />
          )}
        </main>
        <footer className="workspace-footer">
          <span>GSICM · Satellite compositor manager</span>
          <span>
            Display times use your local timezone · Hour selection uses UTC
          </span>
        </footer>
      </div>
      {source && (
        <SourceEditor
          key={source.id}
          source={source}
          locked={state.locked}
          onClose={() => setSource(undefined)}
          onSave={(value) =>
            save(
              `/sources/${encodeURIComponent(value.id)}`,
              value,
              "Source saved",
            )
          }
          onDelete={
            state.sources.some((s) => s.id === source.id)
              ? async (value) => {
                  try {
                    await api(
                      `/sources/${encodeURIComponent(value.id)}`,
                      "DELETE",
                      {},
                    );
                    await manager.refresh();
                    setNotice("Source deleted");
                    return true;
                  } catch (e) {
                    handleError(e);
                    throw e;
                  }
                }
              : undefined
          }
        />
      )}
      {profile && (
        <ProfileEditor
          key={profile.id}
          profile={profile}
          sources={state.sources}
          underlays={state.underlays}
          locked={state.locked}
          onClose={() => setProfile(undefined)}
          onSave={(value) =>
            save(
              `/profiles/${encodeURIComponent(value.id)}`,
              value,
              "Profile saved",
            )
          }
        />
      )}
      {jobId && (
        <JobLogs
          key={jobId}
          id={jobId}
          onClose={() => setJobId(undefined)}
          onUnauthorized={unauthorized}
        />
      )}
      {hourProfile && (
        <HourPicker
          name={hourProfile.name}
          onClose={() => setHourProfile(undefined)}
          onSubmit={async (targetTime) => {
            try {
              await run(hourProfile, targetTime);
              await manager.refresh();
              setNotice("Hourly composition queued");
            } catch (e) {
              handleError(e);
              throw e;
            }
          }}
        />
      )}
      {deleteProfile && (
        <Dialog
          title="Delete profile"
          onClose={() => {
            if (!pending.has(`delete:${deleteProfile.id}`))
              setDeleteProfile(undefined);
          }}
        >
          <p>
            Delete <strong>{deleteProfile.name}</strong>? Generated composites
            remain in Files and job history is kept.
          </p>
          {feedback(`delete:${deleteProfile.id}`)}
          <div className="dialog-actions">
            <button
              disabled={pending.has(`delete:${deleteProfile.id}`)}
              onClick={() => setDeleteProfile(undefined)}
            >
              Keep profile
            </button>
            <button
              className="danger"
              disabled={
                pending.has(`delete:${deleteProfile.id}`) ||
                runningJobs.some((j) => j.profileId === deleteProfile.id)
              }
              onClick={async () => {
                if (
                  await execute(
                    `delete:${deleteProfile.id}`,
                    () =>
                      api(
                        `/profiles/${encodeURIComponent(deleteProfile.id)}`,
                        "DELETE",
                        {},
                      ),
                    "Profile deleted",
                  )
                )
                  setDeleteProfile(undefined);
              }}
            >
              {pending.has(`delete:${deleteProfile.id}`)
                ? "Deleting…"
                : "Delete profile"}
            </button>
          </div>
        </Dialog>
      )}
      {archiveSource && (
        <Dialog
          title="Test archive imagery"
          onClose={() => {
            if (!pending.has(`archive:${archiveSource.id}`))
              setArchiveSource(undefined);
          }}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (
                await execute(
                  `archive:${archiveSource.id}`,
                  () =>
                    api(
                      `/sources/${encodeURIComponent(archiveSource.id)}/test`,
                      "POST",
                      { targetTime: new Date(`${archiveTime}Z`).toISOString() },
                    ),
                  "Archive source test finished",
                )
              )
                setArchiveSource(undefined);
            }}
          >
            <p>
              Choose an observation time for {archiveSource.name}. Enter UTC;
              archive folder times are converted automatically.
            </p>
            <label className="field">
              <span>Observation time (UTC)</span>
              <input
                required
                type="datetime-local"
                value={archiveTime}
                onChange={(e) => setArchiveTime(e.target.value)}
              />
            </label>
            {feedback(`archive:${archiveSource.id}`)}
            <div className="dialog-actions">
              <button
                className="primary"
                disabled={
                  state.locked || pending.has(`archive:${archiveSource.id}`)
                }
              >
                {pending.has(`archive:${archiveSource.id}`)
                  ? "Testing…"
                  : "Test archive time"}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
