import { useState } from "react";
import { settingsSchema } from "../shared/types";
import type { Settings } from "../shared/types";

export function SettingsPage({
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
