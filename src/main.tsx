import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  SourceRecord,
  Profile,
  Settings,
  Job,
  PublishedOutput,
} from "../shared/types";
import "./style.css";
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
  const [busy, setBusy] = useState(false);
  const refreshAuth = async () => setAuth(await api("/auth"));
  const refresh = async () => {
    const authState = await api("/auth");
    setAuth(authState);
    if (authState.authenticated) setState(await api("/state"));
  };
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
    const timer = setInterval(
      () => void refresh().catch((e) => setError(e.message)),
      4000,
    );
    return () => clearInterval(timer);
  }, []);
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
          {["Overview", "Sources", "Profiles", "Jobs", "Settings"].map(
            (name, i) => (
              <button
                className={page === name ? "selected" : ""}
                onClick={() => {
                  setPage(name);
                  setNotice("");
                }}
                key={name}
              >
                <span aria-hidden="true">{["◈", "◎", "◫", "≡", "⚙"][i]}</span>
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
                              {o.observations.length} required sources included
                              · {o.width} × {o.height}
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
                            () => api(`/profiles/${p.id}/run`, "POST", {}),
                            "Composition queued",
                          )
                        }
                      >
                        Run now
                      </button>
                      <button
                        disabled={busy || p.blockers.length > 0}
                        onClick={() => {
                          const value = window.prompt(
                            "UTC hour (YYYY-MM-DDTHH:00)",
                          );
                          if (!value) return;
                          const target = new Date(`${value}:00Z`);
                          if (
                            !Number.isFinite(+target) ||
                            target.getUTCMinutes() !== 0
                          ) {
                            setError(
                              "Enter a UTC hour such as 2026-09-28T03:00",
                            );
                            return;
                          }
                          action(
                            () =>
                              api(`/profiles/${p.id}/run`, "POST", {
                                targetTime: target.toISOString(),
                              }),
                            "Hourly composition queued",
                          );
                        }}
                      >
                        Stitch UTC hour
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
                    id: crypto.randomUUID(),
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
                    : `Globe at ${p.longitude}°`}{" "}
                  · {p.resolution} km
                </p>
                <p>
                  {p.sourceIds.length} required sources · ±{p.toleranceMinutes}{" "}
                  minutes
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
                  disabled={busy || !!p.blockers.length}
                  onClick={() =>
                    action(
                      () => api(`/profiles/${p.id}/run`, "POST", {}),
                      "Composition queued",
                    )
                  }
                >
                  Run now
                </button>
                <button
                  disabled={busy || !!p.blockers.length}
                  onClick={() => {
                    const value = window.prompt("UTC hour (YYYY-MM-DDTHH:00)");
                    if (!value) return;
                    const target = new Date(`${value}:00Z`);
                    if (
                      !Number.isFinite(+target) ||
                      target.getUTCMinutes() !== 0
                    ) {
                      setError("Enter a UTC hour such as 2026-09-28T03:00");
                      return;
                    }
                    action(
                      () =>
                        api(`/profiles/${p.id}/run`, "POST", {
                          targetTime: target.toISOString(),
                        }),
                      "Hourly composition queued",
                    );
                  }}
                >
                  Stitch UTC hour
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
              {auth?.required ? "Password login enabled" : "No account required"}
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
                ).map((k) => (
                  <Field key={k} label={k}>
                    <input
                      type="number"
                      step="any"
                      value={profile[k]}
                      onChange={(e) =>
                        setProfile({ ...profile, [k]: Number(e.target.value) })
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
              <h3>Required sources</h3>
              {state.sources.map((s) => (
                <label className="check" key={s.id}>
                  <input
                    type="checkbox"
                    checked={profile.sourceIds.includes(s.id)}
                    onChange={(e) =>
                      setProfile({
                        ...profile,
                        sourceIds: e.target.checked
                          ? [...profile.sourceIds, s.id]
                          : profile.sourceIds.filter((id) => id !== s.id),
                      })
                    }
                  />
                  {s.name}
                </label>
              ))}
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
