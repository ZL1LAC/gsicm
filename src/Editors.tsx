import {
  cloneElement,
  useId,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import {
  profileSchema,
  sourceSchema,
  type Profile,
  type SourceRecord,
} from "../shared/types";
import { Dialog } from "./Dialog";

type FieldErrors = Record<string, string>;
type FieldControl = {
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

function Field({
  label,
  help,
  error,
  children,
}: {
  label: string;
  help?: string;
  error?: string;
  children: ReactElement<FieldControl>;
}) {
  const id = useId();
  const description = [help && `${id}-help`, error && `${id}-error`]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {cloneElement(children, {
        id,
        "aria-describedby": description || undefined,
        "aria-invalid": !!error,
      })}
      {help && (
        <small className="field-help" id={`${id}-help`}>
          {help}
        </small>
      )}
      {error && (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="editor-section">
      <div className="section-copy">
        <h3>{title}</h3>
        {description && <p className="muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function errorsFor(issues: { path: PropertyKey[]; message: string }[]) {
  return Object.fromEntries(
    issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "The change could not be saved.";
}

function UnsavedChanges({
  onDiscard,
  onKeep,
}: {
  onDiscard: () => void;
  onKeep: () => void;
}) {
  return (
    <div className="editor-confirm" role="alert">
      <h3>Discard unsaved changes?</h3>
      <p>Your saved configuration will stay as it is.</p>
      <div className="actions">
        <button type="button" className="primary" autoFocus onClick={onKeep}>
          Keep editing
        </button>
        <button type="button" className="danger" onClick={onDiscard}>
          Discard changes
        </button>
      </div>
    </div>
  );
}

export function SourceEditor({
  source,
  onClose,
  onSave,
  onDelete,
  locked,
}: {
  source: SourceRecord;
  onClose: () => void;
  onSave: (source: SourceRecord) => Promise<boolean>;
  onDelete?: (source: SourceRecord) => Promise<boolean>;
  locked: boolean;
}) {
  const [draft, setDraft] = useState(() => ({
    ...source,
    crop: [...source.crop] as SourceRecord["crop"],
  }));
  const original = useRef(JSON.stringify(source));
  const [busy, setBusy] = useState<"save" | "delete">();
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [confirm, setConfirm] = useState<"discard" | "delete">();
  const [advanced, setAdvanced] = useState(false);
  const dirty = JSON.stringify(draft) !== original.current;
  const update = <K extends keyof SourceRecord>(
    key: K,
    value: SourceRecord[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };
  const close = () => {
    if (busy) return;
    if (confirm) {
      setConfirm(undefined);
      return;
    }
    if (dirty) setConfirm("discard");
    else onClose();
  };
  const save = async () => {
    if (locked || busy) return;
    setError("");
    const result = sourceSchema.safeParse(draft);
    if (!result.success) {
      const fields = errorsFor(result.error.issues);
      setFieldErrors(fields);
      if (
        Object.keys(fields).some((field) =>
          /^(crop|longitudeAdjustment|brightness|expected)/.test(field),
        )
      )
        setAdvanced(true);
      setError("Check the highlighted fields before saving.");
      return;
    }
    try {
      new RegExp(draft.pattern);
      new RegExp(draft.timestampRegex);
    } catch {
      setError(
        "The filename or timestamp pattern is not a valid regular expression.",
      );
      return;
    }
    if (draft.enabled && draft.transport !== "s3" && !draft.location.trim()) {
      setFieldErrors({ location: "Enter a URL before enabling this source." });
      setError("Add a connection URL before enabling this source.");
      return;
    }
    setBusy("save");
    try {
      if (await onSave({ ...draft, ...result.data })) onClose();
      else
        setError("The source could not be saved. Your changes are still here.");
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(undefined);
    }
  };
  const remove = async () => {
    if (!onDelete || locked || busy) return;
    setBusy("delete");
    setError("");
    try {
      if (await onDelete(source)) onClose();
      else setError("The source could not be deleted.");
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(undefined);
    }
  };
  const numeric = (
    key:
      | "cadenceMinutes"
      | "longitude"
      | "longitudeAdjustment"
      | "brightness"
      | "expectedWidth"
      | "expectedHeight",
    label: string,
    min: number,
    max: number,
    step: number | "any" = "any",
  ) => (
    <Field label={label} error={fieldErrors[key]}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isNaN(draft[key]) ? "" : draft[key]}
        onChange={(event) => update(key, event.target.valueAsNumber)}
      />
    </Field>
  );

  return (
    <Dialog title="Configure source" onClose={close} className="editor-dialog">
      {confirm === "discard" ? (
        <UnsavedChanges
          onDiscard={onClose}
          onKeep={() => setConfirm(undefined)}
        />
      ) : confirm === "delete" ? (
        <div className="editor-confirm" role="alert">
          <h3>Delete {source.name}?</h3>
          <p>
            Remove this source from any profiles before deleting it. Its
            connection and validation settings will be removed.
          </p>
          {error && (
            <p className="editor-error" role="alert">
              {error}
            </p>
          )}
          <div className="actions">
            <button
              type="button"
              autoFocus
              disabled={!!busy}
              onClick={() => setConfirm(undefined)}
            >
              Keep source
            </button>
            <button
              type="button"
              className="danger"
              disabled={!!busy || locked}
              onClick={() => void remove()}
            >
              {busy === "delete" ? "Deleting…" : "Delete source"}
            </button>
          </div>
        </div>
      ) : (
        <form
          className="editor-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {locked && (
            <p className="editor-notice" role="status">
              Configuration is in use. You can review this source and save after
              processing finishes.
            </p>
          )}
          {error && (
            <p className="editor-error" role="alert">
              {error}
            </p>
          )}
          <fieldset disabled={!!busy}>
            <Section
              title="Identity"
              description="Name this feed so it is easy to find in profiles and job history."
            >
              <div className="form-grid">
                {(
                  [
                    ["name", "Name"],
                    ["satellite", "Satellite"],
                    ["region", "Region"],
                    ["attribution", "Attribution"],
                  ] as const
                ).map(([key, label]) => (
                  <Field key={key} label={label} error={fieldErrors[key]}>
                    <input
                      required={key === "name" || key === "satellite"}
                      value={draft[key]}
                      onChange={(event) => update(key, event.target.value)}
                    />
                  </Field>
                ))}
              </div>
              <label className="editor-check check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => update("enabled", event.target.checked)}
                />
                Enable source
              </label>
            </Section>
            <Section
              title="Connection"
              description="Choose where the manager retrieves the satellite imagery."
            >
              <div className="form-grid">
                <Field label="Transport">
                  <select
                    value={draft.transport}
                    onChange={(event) =>
                      update(
                        "transport",
                        event.target.value as SourceRecord["transport"],
                      )
                    }
                  >
                    {["http", "ftp", "ftps", "s3"].map((value) => (
                      <option key={value} value={value}>
                        {value.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Image product">
                  <select
                    value={draft.product}
                    onChange={(event) =>
                      update(
                        "product",
                        event.target.value as SourceRecord["product"],
                      )
                    }
                  >
                    <option value="raster">Raster image (PNG / JPEG)</option>
                    <option value="goes-abi">GOES ABI infrared</option>
                    <option value="gk2a-ami">GK-2A AMI infrared</option>
                    <option value="himawari-ahi">Himawari AHI infrared</option>
                    <option value="elektro-l">Elektro-L raw infrared</option>
                    <option value="elektro-rgb">Elektro-L RGB imagery</option>
                  </select>
                </Field>
                {draft.transport === "s3" ? (
                  <>
                    {(
                      [
                        ["bucket", "Bucket"],
                        ["prefix", "Object prefix"],
                        ["awsRegion", "AWS region"],
                      ] as const
                    ).map(([key, label]) => (
                      <Field key={key} label={label} error={fieldErrors[key]}>
                        <input
                          value={draft[key]}
                          onChange={(event) => update(key, event.target.value)}
                        />
                      </Field>
                    ))}
                  </>
                ) : (
                  <Field
                    label={
                      draft.transport === "http"
                        ? "Image URL template"
                        : "Directory URL"
                    }
                    error={fieldErrors.location}
                  >
                    <input
                      value={draft.location}
                      onChange={(event) =>
                        update("location", event.target.value)
                      }
                      placeholder="https://example.org/{YYYY}/{MM}/{DD}/IR_{HH}{mm}.png"
                    />
                  </Field>
                )}
                {(draft.transport === "ftp" || draft.transport === "ftps") && (
                  <>
                    <Field
                      label="Username"
                      help="Leave blank for anonymous access."
                    >
                      <input
                        autoComplete="off"
                        value={draft.username}
                        onChange={(event) =>
                          update("username", event.target.value)
                        }
                      />
                    </Field>
                    <Field label="Password">
                      <input
                        type="password"
                        autoComplete="new-password"
                        value={draft.password}
                        onChange={(event) =>
                          update("password", event.target.value)
                        }
                      />
                    </Field>
                  </>
                )}
              </div>
            </Section>
            <Section
              title="Observation timing"
              description="Timestamps identify when the image was observed, so composites use matching imagery."
            >
              <div className="form-grid">
                {numeric(
                  "cadenceMinutes",
                  "Image interval (minutes)",
                  1,
                  180,
                  1,
                )}
                <Field label="Timestamp format">
                  <select
                    value={draft.timestampFormat}
                    onChange={(event) =>
                      update(
                        "timestampFormat",
                        event.target.value as SourceRecord["timestampFormat"],
                      )
                    }
                  >
                    <option value="compact">YYYYMMDDTHHmmssZ</option>
                    <option value="iso">UTC ISO timestamp</option>
                    <option value="julian">YYYYDDDHHmmss</option>
                    <option value="minute">YYYYMMDDHHmm</option>
                    <option value="elektro">YYMMDD_HHmm (Moscow UTC+3)</option>
                  </select>
                </Field>
                <Field
                  label="Filename selection regex"
                  error={fieldErrors.pattern}
                >
                  <input
                    value={draft.pattern}
                    onChange={(event) => update("pattern", event.target.value)}
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Observation timestamp regex (capture group 1)"
                  error={fieldErrors.timestampRegex}
                >
                  <input
                    value={draft.timestampRegex}
                    onChange={(event) =>
                      update("timestampRegex", event.target.value)
                    }
                    spellCheck={false}
                  />
                </Field>
              </div>
              <p className="field-help">
                UTC URL tokens: {"{YYYY} {MM} {DD} {DDD} {HH} {mm} {ss}"}. A
                filename such as latest.jpg alone cannot establish freshness.
              </p>
            </Section>
            <Section
              title="Image geometry"
              description="Set the satellite location and confirm the preview before using this feed."
            >
              <div className="form-grid">
                {numeric("longitude", "Longitude (°)", -180, 180)}
              </div>
              <details
                className="editor-advanced"
                open={advanced}
                onToggle={(event) => setAdvanced(event.currentTarget.open)}
              >
                <summary>Advanced image adjustments</summary>
                <div className="form-grid">
                  {numeric(
                    "longitudeAdjustment",
                    "Longitude adjustment (°)",
                    -10,
                    10,
                  )}
                  {numeric("brightness", "Brightness multiplier", 0.1, 3)}
                  {numeric(
                    "expectedWidth",
                    "Expected width (pixels)",
                    64,
                    30000,
                    1,
                  )}
                  {numeric(
                    "expectedHeight",
                    "Expected height (pixels)",
                    64,
                    30000,
                    1,
                  )}
                  {draft.crop.map((value, index) => (
                    <Field
                      key={index}
                      label={`Crop ${["top", "right", "bottom", "left"][index]} (fraction)`}
                      error={fieldErrors[`crop.${index}`]}
                    >
                      <input
                        type="number"
                        min={0}
                        max={0.49}
                        step={0.001}
                        value={Number.isNaN(value) ? "" : value}
                        onChange={(event) => {
                          const crop = [...draft.crop] as SourceRecord["crop"];
                          crop[index] = event.target.valueAsNumber;
                          update("crop", crop);
                        }}
                      />
                    </Field>
                  ))}
                </div>
                <label className="editor-check check">
                  <input
                    type="checkbox"
                    checked={draft.invert}
                    onChange={(event) => update("invert", event.target.checked)}
                  />
                  Invert IR intensity
                </label>
              </details>
              <label className="editor-check check">
                <input
                  type="checkbox"
                  checked={draft.cleanConfirmed}
                  onChange={(event) =>
                    update("cleanConfirmed", event.target.checked)
                  }
                />
                I inspected the preview: clean full-disc IR, correct crop and
                geometry, no annotations
              </label>
              <p className="field-help">
                Changing feed settings resets validation. Save, test the source,
                and inspect its preview.
              </p>
            </Section>
          </fieldset>
          <div className="editor-footer">
            {onDelete && (
              <button
                type="button"
                className="danger"
                disabled={!!busy || locked}
                onClick={() => {
                  setError("");
                  setConfirm("delete");
                }}
              >
                Delete source
              </button>
            )}
            <div className="actions">
              <button type="button" disabled={!!busy} onClick={close}>
                Discard
              </button>
              <button className="primary" disabled={!!busy || locked}>
                {busy === "save" ? "Saving…" : "Save source"}
              </button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function ProfileEditor({
  profile,
  sources,
  underlays,
  onClose,
  onSave,
  locked,
}: {
  profile: Profile;
  sources: SourceRecord[];
  underlays: string[];
  onClose: () => void;
  onSave: (profile: Profile) => Promise<boolean>;
  locked: boolean;
}) {
  const [draft, setDraft] = useState(() => ({ ...profile }));
  const original = useRef(JSON.stringify(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [discard, setDiscard] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const dirty = JSON.stringify(draft) !== original.current;
  const update = <K extends keyof Profile>(key: K, value: Profile[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setFieldErrors((current) => ({ ...current, [key]: "" }));
  };
  const close = () => {
    if (busy) return;
    if (discard) setDiscard(false);
    else if (dirty) setDiscard(true);
    else onClose();
  };
  const save = async () => {
    if (locked || busy) return;
    setError("");
    const result = profileSchema.safeParse(draft);
    if (!result.success) {
      const fields = errorsFor(result.error.issues);
      setFieldErrors(fields);
      if (
        ["brightness", "saturation", "haze", "tint"].some((key) => fields[key])
      )
        setAdvanced(true);
      setError("Check the highlighted fields before saving.");
      return;
    }
    if (
      draft.projection === "disk" &&
      (draft.sourceIds.length !== 1 || draft.optionalSourceIds.length)
    ) {
      setError("Choose exactly one satellite for a satellite disk.");
      return;
    }
    if (!underlays.includes(draft.underlay)) {
      setFieldErrors({ underlay: "Choose an available underlay." });
      setError("Choose an available underlay before saving.");
      return;
    }
    const selected = [...draft.sourceIds, ...draft.optionalSourceIds].map(
      (id) => sources.find((source) => source.id === id),
    );
    if (
      selected.some((source) => !source) ||
      new Set(selected.map((source) => source?.satellite)).size !==
        selected.length
    ) {
      setError("Choose available sources with distinct satellite identities.");
      return;
    }
    setBusy(true);
    try {
      if (await onSave(result.data)) onClose();
      else
        setError(
          "The profile could not be saved. Your changes are still here.",
        );
    } catch (error) {
      setError(messageFor(error));
    } finally {
      setBusy(false);
    }
  };
  const numeric = (
    key:
      "longitude" | "toleranceMinutes" | "brightness" | "saturation" | "haze",
    label: string,
    min: number,
    max: number,
    step: number | "any" = "any",
  ) => (
    <Field label={label} error={fieldErrors[key]}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number.isNaN(draft[key]) ? "" : draft[key]}
        onChange={(event) => update(key, event.target.valueAsNumber)}
      />
    </Field>
  );

  return (
    <Dialog title="Edit profile" onClose={close} className="editor-dialog">
      {discard ? (
        <UnsavedChanges onDiscard={onClose} onKeep={() => setDiscard(false)} />
      ) : (
        <form
          className="editor-form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          {locked && (
            <p className="editor-notice" role="status">
              Configuration is in use. You can review this profile and save
              after processing finishes.
            </p>
          )}
          {error && (
            <p className="editor-error" role="alert">
              {error}
            </p>
          )}
          <fieldset disabled={busy}>
            <Section
              title="Output"
              description="Choose the view and image quality for your composite."
            >
              <div className="form-grid">
                <Field label="Name" error={fieldErrors.name}>
                  <input
                    required
                    value={draft.name}
                    onChange={(event) => update("name", event.target.value)}
                  />
                </Field>
                <Field label="Output type">
                  <select
                    value={draft.projection}
                    onChange={(event) => {
                      const projection = event.target
                        .value as Profile["projection"];
                      setDraft((current) => ({
                        ...current,
                        projection,
                        ...(projection === "disk"
                          ? {
                              sourceIds: current.sourceIds.slice(0, 1),
                              optionalSourceIds: [],
                            }
                          : {}),
                      }));
                    }}
                  >
                    <option value="map">Global map</option>
                    <option value="globe">Virtual satellite globe</option>
                    <option value="disk">False-color satellite disk</option>
                  </select>
                </Field>
                <Field
                  label="Resolution"
                  help="Smaller values produce more detail and take longer to process."
                >
                  <select
                    value={draft.resolution}
                    onChange={(event) =>
                      update(
                        "resolution",
                        Number(event.target.value) as Profile["resolution"],
                      )
                    }
                  >
                    {[4, 2, 1, 0.5].map((value) => (
                      <option key={value} value={value}>
                        {value} km
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Format">
                  <select
                    value={draft.format}
                    onChange={(event) =>
                      update("format", event.target.value as Profile["format"])
                    }
                  >
                    <option value="jpg">JPEG</option>
                    <option value="png">PNG</option>
                  </select>
                </Field>
                <Field label="Underlay" error={fieldErrors.underlay}>
                  <select
                    value={draft.underlay}
                    onChange={(event) => update("underlay", event.target.value)}
                  >
                    {!underlays.includes(draft.underlay) && (
                      <option value={draft.underlay}>
                        {draft.underlay || "Choose an underlay"} (unavailable)
                      </option>
                    )}
                    {underlays.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                </Field>
                {draft.projection !== "disk" &&
                  numeric("longitude", "Longitude (°)", -180, 180)}
              </div>
            </Section>
            <Section
              title="Included sources"
              description={
                draft.projection === "disk"
                  ? "A satellite disk uses exactly one source and centers itself on that satellite."
                  : "Required sources must be available. Optional sources are included when matching imagery is ready."
              }
            >
              {draft.projection === "disk" ? (
                <Field label="Satellite">
                  <select
                    required
                    value={draft.sourceIds[0] ?? ""}
                    onChange={(event) => {
                      const source = sources.find(
                        (item) => item.id === event.target.value,
                      );
                      if (source)
                        setDraft((current) => ({
                          ...current,
                          sourceIds: [source.id],
                          optionalSourceIds: [],
                          name:
                            current.name === "Satellite disk"
                              ? `${source.satellite} false-color disk`
                              : current.name,
                        }));
                    }}
                  >
                    <option value="" disabled>
                      Select a satellite
                    </option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </Field>
              ) : (
                <div className="source-inclusion">
                  {!sources.length && (
                    <p className="muted">
                      Add a source before including satellite imagery in this
                      profile.
                    </p>
                  )}
                  {sources.map((source) => (
                    <div className="inclusion-row" key={source.id}>
                      <div className="inclusion-copy">
                        <strong>{source.name}</strong>
                        <small>
                          {source.enabled
                            ? source.validation?.compatible
                              ? "Validated"
                              : "Needs validation"
                            : "Disabled"}
                          {source.region ? ` · ${source.region}` : ""}
                        </small>
                      </div>
                      <select
                        aria-label={`${source.name} inclusion`}
                        value={
                          draft.sourceIds.includes(source.id)
                            ? "required"
                            : draft.optionalSourceIds.includes(source.id)
                              ? "optional"
                              : "off"
                        }
                        onChange={(event) => {
                          const inclusion = event.target.value;
                          setDraft((current) => ({
                            ...current,
                            sourceIds: [
                              ...current.sourceIds.filter(
                                (id) => id !== source.id,
                              ),
                              ...(inclusion === "required" ? [source.id] : []),
                            ],
                            optionalSourceIds: [
                              ...current.optionalSourceIds.filter(
                                (id) => id !== source.id,
                              ),
                              ...(inclusion === "optional" ? [source.id] : []),
                            ],
                          }));
                        }}
                      >
                        <option value="off">Not included</option>
                        <option value="required">Required</option>
                        <option value="optional">
                          Optional — when available
                        </option>
                      </select>
                    </div>
                  ))}
                </div>
              )}
              <div className="form-grid">
                {numeric(
                  "toleranceMinutes",
                  "Observation tolerance (± minutes)",
                  1,
                  180,
                  1,
                )}
              </div>
            </Section>
            <Section
              title="Appearance"
              description="Fine-tune the finished image without changing the original imagery."
            >
              <details
                className="editor-advanced"
                open={advanced}
                onToggle={(event) => setAdvanced(event.currentTarget.open)}
              >
                <summary>Color and atmosphere settings</summary>
                <div className="form-grid">
                  {numeric("brightness", "Brightness multiplier", 0.1, 3)}
                  {numeric("saturation", "Saturation", 0, 2)}
                  {numeric("haze", "Atmospheric haze", 0, 1)}
                  <Field
                    label="Tint (hex)"
                    error={fieldErrors.tint}
                    help="Enter six hexadecimal characters, without #."
                  >
                    <input
                      value={draft.tint}
                      maxLength={6}
                      spellCheck={false}
                      onChange={(event) => update("tint", event.target.value)}
                    />
                  </Field>
                </div>
              </details>
            </Section>
            <Section
              title="Scheduling"
              description="Scheduled profiles run at the interval configured in Settings while the manager server is running."
            >
              <label className="editor-check check">
                <input
                  type="checkbox"
                  checked={draft.enabled}
                  onChange={(event) => update("enabled", event.target.checked)}
                />
                Enable scheduled processing
              </label>
              <p className="field-help">
                You can also run this profile manually or choose a specific
                observation hour.
              </p>
            </Section>
          </fieldset>
          <div className="editor-footer">
            <span className="muted">
              {dirty ? "Unsaved changes" : "Configuration up to date"}
            </span>
            <div className="actions">
              <button type="button" disabled={busy} onClick={close}>
                Discard
              </button>
              <button className="primary" disabled={busy || locked}>
                {busy ? "Saving…" : "Save profile"}
              </button>
            </div>
          </div>
        </form>
      )}
    </Dialog>
  );
}
