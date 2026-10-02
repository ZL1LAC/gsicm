import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  SourceRecord,
  Profile,
  Settings,
  Job,
  PublishedOutput,
} from "../shared/types";
import { profileSchema } from "../shared/types";
import "./style.css";
import { HourPicker } from "./HourPicker";
import { FileManager } from "./FileManager";
import { useAutoRefresh } from "./useAutoRefresh";
// getRandomValues also works when the manager is opened over HTTP on a LAN.
function newRecordId() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
type State = {
  sources: SourceRecord[];
  profiles: (Profile & { blockers: string[] })[];
  settings: Settings;
  jobs: Job[];
  outputs: PublishedOutput[];
  underlays: string[];
  activeJob?: string;
};
type AuthState = {
  required: boolean;
  authenticated: boolean;
};
async function api(url: string, method = "GET", body?: unknown) {
  const response = await fetch("/api" + url, {
    method,
    cache: "no-store",
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error ?? data.message ?? "Request failed");
  return data;
}
const date = (value: string) => new Date(value).toLocaleString();
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function App() {
  const [auth, setAuth] = useState<AuthState>();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>();
  const [page, setPage] = useState("Overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [source, setSource] = useState<SourceRecord>();
  const [profile, setProfile] = useState<Profile>();
  const [settings, setSettings] = useState<Settings>();
  const [job, setJob] = useState<Job>();
  const [hourProfile, setHourProfile] = useState<Profile>();
  const [trackedJobs, setTrackedJobs] = useState<Job[]>([]);
  const [expandedStage, setExpandedStage] = useState<string>();
  const [busy, setBusy] = useState(false);
  const refreshAuth = async () => setAuth(await api("/auth"));
  const refresh = async () => {
    const authState = await api("/auth");
    setAuth(authState);
    if (authState.authenticated) setState(await api("/state"));
  };
  useAutoRefresh(async () => {
    try {
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  });
  useAutoRefresh(async () => {
    if (!job) return;
    const id = job.id;
    try {
      const updated: Job = await api(`/jobs/${id}`);
      // Closing or switching logs while a request is pending must not reopen them.
      setJob((current) => (current?.id === id ? updated : current));
    } catch (e) {
      setError((e as Error).message);
    }
  }, !!job && !!auth?.authenticated);
  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/login", "POST", { password });
      setPassword("");
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const action = async (fn: () => Promise<unknown>, message = "Saved") => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      await refresh();
      setNotice(message);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const startComposition = async (profileId: string, targetTime?: string) => {
    const queued: Job = await api(
      `/profiles/${profileId}/run`,
      "POST",
      targetTime ? { targetTime } : {},
    );
    setTrackedJobs((jobs) => [
      ...jobs.filter((j) => j.id !== queued.id),
      queued,
    ]);
    return queued;
  };
  if (auth?.required && !auth.authenticated)
    return (
      <main className="login">
        <form onSubmit={login}>
          <div className="brand">
            <span className="orbit">◎</span>
            <div>
              GSICM<small>EARTH OBSERVATION</small>
            </div>
          </div>
          <h1>Password required</h1>
          <Field label="Password">
            <input
              autoFocus
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
          {error && <p className="login-error">{error}</p>}
          <button className="primary" disabled={busy || !password}>
            Log in
          </button>
        </form>
      </main>
    );
  if (!state)
    return (
      <main>
        <h1>GSICM</h1>
        <p>{error || "Connecting to the satellite manager…"}</p>
      </main>
    );
  const ready = state.sources.filter(
    (s) => s.enabled && s.validation?.compatible,
  ).length;
  return (
    <div className="shell">
      <aside>
        <div className="brand">
          <span className="orbit">◉</span>
          <div>
            GSICM<small>EARTH OBSERVATION</small>
          </div>
        </div>
        <nav>
          {["Overview", "Sources", "Profiles", "Jobs", "Files", "Settings"].map(
            (name, i) => (
              <button
                className={page === name ? "selected" : ""}
                onClick={() => {
                  setPage(name);
                  setNotice("");
                }}
                key={name}
              >
                <span aria-hidden="true">
                  {["◈", "◎", "◫", "≡", "▤", "⚙"][i]}
                </span>
                {name}
              </button>
            ),
          )}
        </nav>
        <div className="local">
          <i /> Local manager<small>127.0.0.1 · Sanchez 1.0.26</small>
        </div>
      </aside>
      <main>
        <header>
          <div>
            <div className="eyebrow">SATELLITE COMPOSITOR MANAGER</div>
            <h1>{page}</h1>
          </div>
          <span className="pill">
            {state.activeJob ? "● Processing" : "● Manager online"}
          </span>
        </header>
        {error && (
          <div role="alert" className="alert error">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        {notice && (
          <div role="status" className="alert success">
            {notice}
          </div>
        )}
        {[
          ...state.jobs.filter((j) => ["queued", "running"].includes(j.status)),
          ...trackedJobs.map(
            (j) => state.jobs.find((current) => current.id === j.id) ?? j,
          ),
        ]
          .filter(
            (j, i, jobs) => jobs.findIndex((other) => other.id === j.id) === i,
          )
          .map((j) => {
            const active = ["queued", "running"].includes(j.status);
            const stages = [
              "Queued",
              "Fetch imagery",
              "Prepare",
              "Stitch",
              "Publish",
            ];
            const step =
              j.status === "succeeded"
                ? 5
                : j.status === "queued"
                  ? 0
                  : { acquiring: 1, preparing: 2, composing: 3, publishing: 4 }[
                      j.stage ?? "acquiring"
                    ];
            const stageDetails = [
              "The composition is waiting in the manager queue.",
              "Downloading and validating the latest imagery for each region.",
              "Normalizing timing, projection, and image properties.",
              "Combining the prepared frames into one composite.",
              "Writing the finished composite and making it available below.",
            ];
            const progress = j.status === "succeeded" ? 100 : Math.round((step / 5) * 100);
            const selectedStage = expandedStage?.startsWith(`${j.id}:`)
              ? Number(expandedStage.split(":")[1])
              : undefined;
            return (
              <section
                className="composition-progress"
                key={j.id}
                aria-label={`${j.profileName} progress`}
              >
                <div className="row">
                  <strong>
                    {j.profileName} ·{" "}
                    {active
                      ? j.status === "queued"
                        ? "Waiting to start"
                        : "Creating your composite…"
                      : j.status === "succeeded"
                        ? "Composite ready"
                        : `Composition ${j.status}`}
                  </strong>
                  <button onClick={() => setPage("Jobs")}>View jobs</button>
                </div>
                <div className="progress-summary">
                  <p role="status">{j.message}</p>
                  <strong>{progress}%</strong>
                </div>
                <div
                  className="composition-steps"
                  aria-label="Composition stages"
                >
                  {stages.map((label, i) => (
                    <button
                      key={label}
                      type="button"
                      className={
                        i < step
                          ? "done"
                          : i === step && active
                            ? "current"
                            : ""
                      }
                      aria-current={i === step ? "step" : undefined}
                      aria-expanded={selectedStage === i}
                      onClick={() =>
                        setExpandedStage(
                          selectedStage === i ? undefined : `${j.id}:${i}`,
                        )
                      }
                    >
                      {i < step ? "✓ " : ""}
                      {label}
                    </button>
                  ))}
                </div>
                {selectedStage !== undefined && (
                  <div className="stage-detail" role="status">
                    <span className="stage-detail-dot" />
                    <div>
                      <strong>{stages[selectedStage]}</strong>
                      <p>{stageDetails[selectedStage]}</p>
                    </div>
                  </div>
                )}
                {active && (
                  <div
                    className="activity-track"
                    role="progressbar"
                    aria-label={`${j.profileName}: ${j.message}`}
                  >
                    <span />
                  </div>
                )}
                {!active && (
                  <button
                    onClick={() =>
                      setTrackedJobs((jobs) =>
                        jobs.filter((job) => job.id !== j.id),
                      )
                    }
                  >
                    Dismiss
                  </button>
                )}
              </section>
            );
          })}
        {page === "Overview" && (
          <>
            <section className="stats">
              <article>
                <small>VERIFIED SOURCES</small>
                <strong>
                  {ready}
                  <em> / {state.sources.length}</em>
                </strong>
                <p>Required imagery, independently checked</p>
              </article>
              <article>
                <small>LATEST COMPOSITES</small>
                <strong>
                  {state.outputs.length}
                  <em> outputs</em>
                </strong>
                <p>Only successful results are published</p>
              </article>
              <article>
                <small>UPDATE INTERVAL</small>
                <strong>
                  {state.settings.pollMinutes}
                  <em> min</em>
                </strong>
                <p>Runs while the manager stays open</p>
              </article>
            </section>
            {state.profiles.some((p) => p.blockers.length > 0) && (
              <div className="alert">
                <div>
                  <b>Global coverage needs setup</b>
                  <p>
                    Clean public imagery has not been verified for every region.
                    Configure and test all required feeds before composition.
                  </p>
                </div>
                <button onClick={() => setPage("Sources")}>
                  Configure sources →
                </button>
              </div>
            )}
            <div className="section-title">
              <h2>Latest imagery</h2>
              <span>Complete input sets only</span>
            </div>
            <section className="output-grid">
              {state.profiles.map((p) => {
                const o = state.outputs.find((o) => o.profileId === p.id);
                return (
                  <article className="output" key={p.id}>
                    <div className="image-area">
                      {o ? (
                        <a
                          href={`/api/outputs/${p.id}`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <img
                            src={`/api/outputs/${p.id}?v=${o.jobId}`}
                            alt={p.name}
                          />
                        </a>
                      ) : (
                        <div className="empty-earth">
                          <div className="earth-grid" />
                          <b>
                            {p.projection === "map"
                              ? "Global equirectangular map"
                              : p.projection === "disk"
                                ? "False-color satellite disk"
                                : "Virtual satellite globe"}
                          </b>
                          <span>Awaiting first complete observation set</span>
                        </div>
                      )}
                    </div>
                    <div className="output-body">
                      <div className="row">
                        <h2>{p.name}</h2>
                        <span className="tag">
                          {p.resolution} km · {p.format.toUpperCase()}
                        </span>
                      </div>
                      {o ? (
                        <>
                          <p>
                            Published {date(o.publishedAt)} ·{" "}
                            {Math.floor(
                              (Date.now() - +new Date(o.publishedAt)) / 60000,
                            )}{" "}
                            min ago
                          </p>
                          <details>
                            <summary>
                              {o.observations.length} sources included ·{" "}
                              {o.width} × {o.height}
                            </summary>
                            {o.observations.map((s) => (
                              <p key={s.sourceId}>
                                {s.satellite} · {date(s.time)}
                                <br />
                                {s.attribution}
                              </p>
                            ))}
                          </details>
                        </>
                      ) : (
                        <p className="muted">
                          {p.blockers.length
                            ? `${p.blockers.length} source requirements need attention`
                            : "Ready for first composition"}
                        </p>
                      )}
                      <button
                        disabled={busy || p.blockers.length > 0}
                        onClick={() =>
                          action(
                            () => startComposition(p.id),
                            "Composition queued",
                          )
                        }
                      >
                        Run now
                      </button>
                      <button
                        disabled={busy || p.blockers.length > 0}
                        onClick={() => setHourProfile(p)}
                      >
                        Create for a specific hour…
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
            <div className="section-title">
              <h2>Coverage readiness</h2>
              <button onClick={() => setPage("Sources")}>Manage feeds →</button>
            </div>
            <section className="coverage">
              {state.sources.map((s) => (
                <div key={s.id}>
                  <span
                    className={
                      s.enabled && s.validation?.compatible
                        ? "dot ready"
                        : "dot"
                    }
                  />
                  <div>
                    <b>{s.name}</b>
                    <small>
                      {s.validation?.compatible
                        ? "Validated"
                        : s.enabled
                          ? "Needs validation"
                          : "Unconfigured coverage placeholder"}
                    </small>
                  </div>
                </div>
              ))}
            </section>
          </>
        )}
        {page === "Sources" && (
          <>
            <div className="section-title">
              <p>Configure clean, timestamped full-disc IR imagery.</p>
              <button
                onClick={() =>
                  action(
                    () => api("/presets/install", "POST", {}),
                    "Verified AWS presets installed",
                  )
                }
              >
                Install verified AWS presets
              </button>
              <button
                onClick={() =>
                  setSource({
                    id: newRecordId(),
                    name: "New source",
                    satellite: "New satellite",
                    region: "",
                    enabled: false,
                    product: "raster",
                    transport: "http",
                    username: "",
                    password: "",
                    location: "",
                    bucket: "",
                    prefix: "",
                    awsRegion: "us-east-1",
                    pattern: ".*",
                    timestampRegex: "(\\d{8}T\\d{6}Z)",
                    timestampFormat: "compact",
                    cadenceMinutes: 10,
                    longitude: 0,
                    longitudeAdjustment: 0,
                    crop: [0, 0, 0, 0],
                    invert: false,
                    brightness: 1,
                    expectedWidth: 5424,
                    expectedHeight: 5424,
                    attribution: "",
                    cleanConfirmed: false,
                    blocker: "",
                  })
                }
              >
                + Add source
              </button>
            </div>
            <div className="cards">
              {state.sources.map((s) => (
                <article key={s.id}>
                  <div className="row">
                    <h2>{s.name}</h2>
                    <span
                      className={
                        "tag " + (s.validation?.compatible ? "good" : "")
                      }
                    >
                      {s.validation?.compatible
                        ? "Validated"
                        : "Setup required"}
                    </span>
                  </div>
                  <p>
                    {s.region} · {s.longitude}° · {s.transport.toUpperCase()}
                  </p>
                  <p className="muted">
                    {s.validation?.message || s.blocker || "Not yet tested"}
                  </p>
                  {s.blocker && s.validation && (
                    <p className="muted">{s.blocker}</p>
                  )}
                  <button onClick={() => setSource(s)}>Configure</button>
                  <button
                    disabled={busy || (!s.location && s.transport !== "s3")}
                    onClick={() =>
                      action(
                        () => api(`/sources/${s.id}/test`, "POST", {}),
                        "Source test finished",
                      )
                    }
                  >
                    Test source
                  </button>
                  {s.product === "elektro-l" && (
                    <button
                      disabled={busy}
                      onClick={() => {
                        const value = window.prompt(
                          "Archive observation in UTC (for example 2026-09-10T04:30:00Z). FTP folder times are UTC+3.",
                        );
                        if (!value) return;
                        if (
                          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(
                            value,
                          ) ||
                          !Number.isFinite(+new Date(value))
                        ) {
                          setError("Enter a UTC timestamp ending in Z.");
                          return;
                        }
                        action(
                          () =>
                            api(`/sources/${s.id}/test`, "POST", {
                              targetTime: value,
                            }),
                          "Archive source test finished",
                        );
                      }}
                    >
                      Test archive time
                    </button>
                  )}
                  {s.validation?.imageId && (
                    <a
                      className="button"
                      href={`/api/images/${s.validation.imageId}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Preview ↗
                    </a>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {page === "Profiles" && (
          <div className="cards">
            <article>
              <h2>False-color satellite disk</h2>
              <p>
                Create a full disk from one satellite, centered automatically on
                its longitude.
              </p>
              <button
                disabled={!state.sources.length || !state.underlays.length}
                onClick={() =>
                  setProfile(
                    profileSchema.parse({
                      id: newRecordId(),
                      name: "Satellite disk",
                      enabled: false,
                      projection: "disk",
                      sourceIds: [],
                      underlay: state.underlays[0],
                    }),
                  )
                }
              >
                New satellite disk profile
              </button>
            </article>
            {state.profiles.map((p) => (
              <article key={p.id}>
                <div className="row">
                  <h2>{p.name}</h2>
                  <span className="tag">
                    {p.enabled ? "Scheduled" : "Manual"}
                  </span>
                </div>
                <p>
                  {p.projection === "map"
                    ? "Equirectangular map"
                    : p.projection === "disk"
                      ? "False-color satellite disk"
                      : `Globe at ${p.longitude}°`}{" "}
                  · {p.resolution} km
                </p>
                <p>
                  {p.sourceIds.length} required +{" "}
                  {(p.optionalSourceIds ?? []).length} optional sources · ±
                  {p.toleranceMinutes} minutes
                </p>
                {p.blockers.length > 0 && (
                  <details>
                    <summary>{p.blockers.length} setup blockers</summary>
                    {p.blockers.map((b) => (
                      <p key={b}>{b}</p>
                    ))}
                  </details>
                )}
                <button onClick={() => setProfile(p)}>Edit profile</button>
                <button
                  className="danger"
                  disabled={
                    busy ||
                    state.jobs.some(
                      (j) =>
                        j.profileId === p.id &&
                        ["running", "queued"].includes(j.status),
                    )
                  }
                  onClick={() => {
                    if (
                      window.confirm(
                        `Delete profile “${p.name}”? Generated stitches remain in Files and job history is kept.`,
                      )
                    )
                      void action(
                        () =>
                          api(
                            `/profiles/${encodeURIComponent(p.id)}`,
                            "DELETE",
                            {},
                          ),
                        "Profile deleted",
                      );
                  }}
                >
                  Delete profile
                </button>
                {state.jobs.some(
                  (j) =>
                    j.profileId === p.id &&
                    ["running", "queued"].includes(j.status),
                ) && (
                  <p className="muted">
                    This profile has an active job. Wait for it to finish or
                    cancel it in Jobs to delete this profile.
                  </p>
                )}
                <button
                  disabled={busy || !!p.blockers.length}
                  onClick={() =>
                    action(() => startComposition(p.id), "Composition queued")
                  }
                >
                  Run now
                </button>
                <button
                  disabled={busy || !!p.blockers.length}
                  onClick={() => setHourProfile(p)}
                >
                  Create for a specific hour…
                </button>
              </article>
            ))}
          </div>
        )}
        {page === "Jobs" && (
          <>
            <p className="muted">
              Jobs are retained for {state.settings.logDays} days. Previous
              successful imagery remains available after failures.
            </p>
            {!state.jobs.length ? (
              <article className="blank">
                <h2>No jobs yet</h2>
                <p>
                  Once sources are ready, run a profile to create your first
                  composite.
                </p>
              </article>
            ) : (
              state.jobs.map((j) => (
                <article className="job" key={j.id}>
                  <div>
                    <b>{j.profileName}</b>
                    <p>
                      {date(j.startedAt)} · Observation target{" "}
                      {date(j.targetTime)}
                    </p>
                    <small>{j.message}</small>
                  </div>
                  <span
                    className={
                      "tag " + (j.status === "succeeded" ? "good" : "")
                    }
                  >
                    {j.status}
                  </span>
                  <button
                    onClick={() =>
                      action(
                        async () => setJob(await api(`/jobs/${j.id}`)),
                        "Logs loaded",
                      )
                    }
                  >
                    Logs
                  </button>
                  {["queued", "running"].includes(j.status) && (
                    <button
                      onClick={() =>
                        action(
                          () => api(`/jobs/${j.id}/cancel`, "POST", {}),
                          "Cancellation requested",
                        )
                      }
                    >
                      Cancel
                    </button>
                  )}
                </article>
              ))
            )}
          </>
        )}
        {page === "Files" && <FileManager onChange={refresh} />}
        {page === "Settings" && (
          <article>
            <h2>Processing & retention</h2>
            <p>
              Settings apply to future operations. Cleanup is restricted to
              manager-owned storage.
            </p>
            <div className="form-grid">
              {Object.entries({
                pollMinutes: "Poll interval (minutes)",
                cacheHours: "Source cache (hours)",
                logDays: "Job retention (days)",
                processTimeoutMinutes: "Sanchez timeout (minutes)",
                downloadTimeoutSeconds: "Download timeout (seconds)",
                maxDownloadMb: "Maximum image size (MB)",
              }).map(([key, label]) => (
                <Field key={key} label={label}>
                  <input
                    type="number"
                    value={(settings ?? state.settings)[key as keyof Settings]}
                    onChange={(e) =>
                      setSettings({
                        ...(settings ?? state.settings),
                        [key]: Number(e.target.value),
                      })
                    }
                  />
                </Field>
              ))}
            </div>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                action(() =>
                  api("/settings", "PUT", settings ?? state.settings),
                )
              }
            >
              Save settings
            </button>
            <p className="muted">
              Latest successful output only · Server listens on localhost ·{" "}
              {auth?.required
                ? "Password login enabled"
                : "No account required"}
            </p>
            {auth?.required && (
              <button
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api("/logout", "POST", {});
                    setState(undefined);
                    await refreshAuth();
                  }, "Logged out")
                }
              >
                Log out
              </button>
            )}
          </article>
        )}
      </main>
      {hourProfile && (
        <HourPicker
          name={hourProfile.name}
          onClose={() => setHourProfile(undefined)}
          onSubmit={async (targetTime) => {
            await startComposition(hourProfile.id, targetTime);
            setNotice("Hourly composition queued");
            void refresh().catch((e) => setError(e.message));
          }}
        />
      )}
      {source && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Configure source"
          >
            <div className="row">
              <h2>Configure source</h2>
              <button onClick={() => setSource(undefined)}>Close</button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await api(`/sources/${source.id}`, "PUT", source);
                  setSource(undefined);
                });
              }}
            >
              <div className="form-grid">
                {(["name", "satellite", "region", "attribution"] as const).map(
                  (k) => (
                    <Field key={k} label={k}>
                      <input
                        required={k === "name" || k === "satellite"}
                        value={source[k]}
                        onChange={(e) =>
                          setSource({ ...source, [k]: e.target.value })
                        }
                      />
                    </Field>
                  ),
                )}
                <Field label="Transport">
                  <select
                    value={source.transport}
                    onChange={(e) =>
                      setSource({
                        ...source,
                        transport: e.target.value as SourceRecord["transport"],
                      })
                    }
                  >
                    {["http", "ftp", "ftps", "s3"].map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </select>
                </Field>
                {source.transport === "s3" ? (
                  <>
                    {(["bucket", "prefix", "awsRegion"] as const).map((k) => (
                      <Field key={k} label={k}>
                        <input
                          value={source[k]}
                          onChange={(e) =>
                            setSource({ ...source, [k]: e.target.value })
                          }
                        />
                      </Field>
                    ))}
                  </>
                ) : (
                  <Field
                    label={
                      source.transport === "http"
                        ? "Image URL template"
                        : "Anonymous directory URL"
                    }
                  >
                    <input
                      value={source.location}
                      onChange={(e) =>
                        setSource({ ...source, location: e.target.value })
                      }
                      placeholder="https://example.org/{YYYY}/{MM}/{DD}/IR_{YYYY}{MM}{DD}T{HH}{mm}00Z.png"
                    />
                  </Field>
                )}
                <Field label="Filename selection regex">
                  <input
                    value={source.pattern}
                    onChange={(e) =>
                      setSource({ ...source, pattern: e.target.value })
                    }
                  />
                </Field>
                <Field label="Observation timestamp regex (capture group 1)">
                  <input
                    value={source.timestampRegex}
                    onChange={(e) =>
                      setSource({ ...source, timestampRegex: e.target.value })
                    }
                  />
                </Field>
                <Field label="Timestamp format">
                  <select
                    value={source.timestampFormat}
                    onChange={(e) =>
                      setSource({
                        ...source,
                        timestampFormat: e.target
                          .value as SourceRecord["timestampFormat"],
                      })
                    }
                  >
                    <option value="compact">YYYYMMDDTHHmmssZ</option>
                    <option value="iso">UTC ISO timestamp</option>
                    <option value="julian">YYYYDDDHHmmss</option>
                    <option value="minute">YYYYMMDDHHmm</option>
                    <option value="elektro">YYMMDD_HHmm (Moscow UTC+3)</option>
                  </select>
                </Field>
                {(
                  [
                    "cadenceMinutes",
                    "longitude",
                    "longitudeAdjustment",
                    "brightness",
                    "expectedWidth",
                    "expectedHeight",
                  ] as const
                ).map((k) => (
                  <Field key={k} label={k}>
                    <input
                      type="number"
                      step="any"
                      value={source[k]}
                      onChange={(e) =>
                        setSource({ ...source, [k]: Number(e.target.value) })
                      }
                    />
                  </Field>
                ))}
                {source.crop.map((v, i) => (
                  <Field
                    key={i}
                    label={`Crop ${["top", "right", "bottom", "left"][i]} (fraction)`}
                  >
                    <input
                      type="number"
                      step="0.001"
                      min="0"
                      max="0.49"
                      value={v}
                      onChange={(e) => {
                        const crop = [...source.crop] as SourceRecord["crop"];
                        crop[i] = Number(e.target.value);
                        setSource({ ...source, crop });
                      }}
                    />
                  </Field>
                ))}
              </div>
              <p className="muted">
                UTC template tokens: {"{YYYY} {MM} {DD} {DDD} {HH} {mm} {ss}"}.
                Use observation timestamps in filenames; “latest.jpg” without a
                timestamp cannot establish freshness.
              </p>
              {(["invert", "enabled", "cleanConfirmed"] as const).map((k) => (
                <label className="check" key={k}>
                  <input
                    type="checkbox"
                    checked={source[k]}
                    onChange={(e) =>
                      setSource({ ...source, [k]: e.target.checked })
                    }
                  />
                  {k === "cleanConfirmed"
                    ? "I inspected the preview: clean full-disc IR, correct crop and geometry, no annotations"
                    : k === "enabled"
                      ? "Enable source"
                      : "Invert IR intensity"}
                </label>
              ))}
              <p className="muted">
                Saving changes resets validation. Test again after confirming
                the image.
              </p>
              <button className="primary" disabled={busy}>
                Save source
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  action(async () => {
                    await api(`/sources/${source.id}`, "DELETE", {});
                    setSource(undefined);
                  }, "Source deleted")
                }
              >
                Delete source
              </button>
            </form>
          </section>
        </div>
      )}
      {profile && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit profile"
          >
            <div className="row">
              <h2>Edit {profile.name}</h2>
              <button onClick={() => setProfile(undefined)}>Close</button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void action(async () => {
                  await api(`/profiles/${profile.id}`, "PUT", profile);
                  setProfile(undefined);
                });
              }}
            >
              <div className="form-grid">
                <Field label="Name">
                  <input
                    value={profile.name}
                    onChange={(e) =>
                      setProfile({ ...profile, name: e.target.value })
                    }
                  />
                </Field>
                <Field label="Output type">
                  <select
                    value={profile.projection}
                    onChange={(e) => {
                      const projection = e.target
                        .value as Profile["projection"];
                      setProfile({
                        ...profile,
                        projection,
                        ...(projection === "disk"
                          ? {
                              sourceIds: profile.sourceIds.slice(0, 1),
                              optionalSourceIds: [],
                            }
                          : {}),
                      });
                    }}
                  >
                    <option value="map">Global map</option>
                    <option value="globe">Virtual satellite globe</option>
                    <option value="disk">False-color satellite disk</option>
                  </select>
                </Field>
                <Field label="Resolution">
                  <select
                    value={profile.resolution}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        resolution: Number(
                          e.target.value,
                        ) as Profile["resolution"],
                      })
                    }
                  >
                    {[4, 2, 1, 0.5].map((r) => (
                      <option key={r} value={r}>
                        {r} km
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Format">
                  <select
                    value={profile.format}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        format: e.target.value as "jpg" | "png",
                      })
                    }
                  >
                    <option>jpg</option>
                    <option>png</option>
                  </select>
                </Field>
                <Field label="Underlay">
                  <select
                    value={profile.underlay}
                    onChange={(e) =>
                      setProfile({ ...profile, underlay: e.target.value })
                    }
                  >
                    {state.underlays.map((u) => (
                      <option key={u}>{u}</option>
                    ))}
                  </select>
                </Field>
                {(
                  [
                    "longitude",
                    "toleranceMinutes",
                    "brightness",
                    "saturation",
                    "haze",
                  ] as const
                )
                  .filter(
                    (k) => k !== "longitude" || profile.projection !== "disk",
                  )
                  .map((k) => (
                    <Field key={k} label={k}>
                      <input
                        type="number"
                        step="any"
                        value={profile[k]}
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            [k]: Number(e.target.value),
                          })
                        }
                      />
                    </Field>
                  ))}
                <Field label="Tint (hex)">
                  <input
                    value={profile.tint}
                    onChange={(e) =>
                      setProfile({ ...profile, tint: e.target.value })
                    }
                  />
                </Field>
              </div>
              {profile.projection === "disk" ? (
                <Field label="Satellite">
                  <select
                    required
                    value={profile.sourceIds[0] ?? ""}
                    onChange={(e) => {
                      const source = state.sources.find(
                        (s) => s.id === e.target.value,
                      )!;
                      setProfile({
                        ...profile,
                        sourceIds: [source.id],
                        optionalSourceIds: [],
                        name:
                          profile.name === "Satellite disk"
                            ? source.satellite + " false-color disk"
                            : profile.name,
                      });
                    }}
                  >
                    <option value="" disabled>
                      Select a satellite
                    </option>
                    {state.sources.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <>
                  <h3>Sources</h3>
                  <p className="muted">
                    Optional sources are included when available. Missing
                    optional imagery won’t stop a stitch.
                  </p>
                  {state.sources.map((s) => (
                    <Field key={s.id} label={s.name}>
                      <select
                        aria-label={`${s.name} inclusion`}
                        value={
                          profile.sourceIds.includes(s.id)
                            ? "required"
                            : (profile.optionalSourceIds ?? []).includes(s.id)
                              ? "optional"
                              : "off"
                        }
                        onChange={(e) =>
                          setProfile({
                            ...profile,
                            sourceIds: [
                              ...profile.sourceIds.filter((id) => id !== s.id),
                              ...(e.target.value === "required" ? [s.id] : []),
                            ],
                            optionalSourceIds: [
                              ...(profile.optionalSourceIds ?? []).filter(
                                (id) => id !== s.id,
                              ),
                              ...(e.target.value === "optional" ? [s.id] : []),
                            ],
                          })
                        }
                      >
                        <option value="off">Not included</option>
                        <option value="required">Required</option>
                        <option value="optional">
                          Optional — when available
                        </option>
                      </select>
                    </Field>
                  ))}
                </>
              )}
              <label className="check">
                <input
                  type="checkbox"
                  checked={profile.enabled}
                  onChange={(e) =>
                    setProfile({ ...profile, enabled: e.target.checked })
                  }
                />
                Enable scheduled processing
              </label>
              <button className="primary" disabled={busy}>
                Save profile
              </button>
            </form>
          </section>
        </div>
      )}
      {job && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Job logs"
          >
            <div className="row">
              <h2>
                {job.profileName} · {job.status}
              </h2>
              <button onClick={() => setJob(undefined)}>Close</button>
            </div>
            <p>{job.message}</p>
            <p className="muted">Logs update automatically every 4 seconds.</p>
            <pre>{job.logs || "No process output yet."}</pre>
            <button
              onClick={() =>
                action(
                  async () => setJob(await api(`/jobs/${job.id}`)),
                  "Logs refreshed",
                )
              }
            >
              Refresh logs
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
