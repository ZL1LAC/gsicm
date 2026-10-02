import { useEffect, useRef, useState } from "react";

export function HourPicker({
  name,
  onClose,
  onSubmit,
}: {
  name: string;
  onClose: () => void;
  onSubmit: (targetTime: string) => Promise<void>;
}) {
  const now = new Date();
  const [day, setDay] = useState(now.toISOString().slice(0, 10));
  const [hour, setHour] = useState(now.getUTCHours());
  const [month, setMonth] = useState(
    () => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      previous?.focus();
    };
  }, []);
  const year = month.getUTCFullYear();
  const monthIndex = month.getUTCMonth();
  const count = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  const target = `${day}T${String(hour).padStart(2, "0")}:00:00Z`;
  return (
    <dialog
      ref={ref}
      className="hour-picker"
      aria-labelledby="hour-picker-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!pending) onClose();
      }}
    >
      <div className="row">
        <div>
          <div className="eyebrow">{name}</div>
          <h2 id="hour-picker-title">Choose a date & hour</h2>
        </div>
        <button
          type="button"
          aria-label="Close date picker"
          disabled={pending}
          onClick={onClose}
        >
          ✕
        </button>
      </div>
      <p className="muted">
        Create a composite using imagery for your selected hour. All times are
        in UTC.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setPending(true);
          setError("");
          try {
            await onSubmit(target);
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setPending(false);
          }
        }}
      >
        <fieldset disabled={pending}>
          <div className="picker-columns">
            <section aria-label="Calendar">
              <div className="row month-navigation">
                <button
                  type="button"
                  aria-label="Previous month"
                  onClick={() =>
                    setMonth(new Date(Date.UTC(year, monthIndex - 1, 1)))
                  }
                >
                  ‹
                </button>
                <strong aria-live="polite">
                  {month.toLocaleDateString("en", {
                    month: "long",
                    year: "numeric",
                    timeZone: "UTC",
                  })}
                </strong>
                <button
                  type="button"
                  aria-label="Next month"
                  onClick={() =>
                    setMonth(new Date(Date.UTC(year, monthIndex + 1, 1)))
                  }
                >
                  ›
                </button>
              </div>
              <div className="calendar-grid">
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
                  <span className="weekday" key={d}>
                    {d}
                  </span>
                ))}
                {Array.from({ length: month.getUTCDay() }, (_, i) => (
                  <span key={`blank-${i}`} />
                ))}
                {Array.from({ length: count }, (_, i) => {
                  const value = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(i + 1).padStart(2, "0")}`;
                  return (
                    <button
                      type="button"
                      key={value}
                      aria-label={value}
                      aria-pressed={day === value}
                      aria-current={
                        value === now.toISOString().slice(0, 10)
                          ? "date"
                          : undefined
                      }
                      onClick={() => setDay(value)}
                    >
                      {i + 1}
                    </button>
                  );
                })}
              </div>
              <button
                className="today-button"
                type="button"
                onClick={() => {
                  const today = new Date();
                  setDay(today.toISOString().slice(0, 10));
                  setMonth(
                    new Date(
                      Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1),
                    ),
                  );
                }}
              >
                Today
              </button>
            </section>
            <section aria-label="Hour in UTC">
              <h3>
                Hour <span className="muted">UTC</span>
              </h3>
              <div className="hour-grid">
                {Array.from({ length: 24 }, (_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-pressed={hour === i}
                    onClick={() => setHour(i)}
                  >
                    {String(i).padStart(2, "0")}:00
                  </button>
                ))}
              </div>
            </section>
          </div>
          <div className="picker-summary" aria-live="polite">
            <span className="muted">Selected time</span>
            <strong>
              {new Date(target).toLocaleDateString("en", {
                weekday: "short",
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "UTC",
              })}{" "}
              · {String(hour).padStart(2, "0")}:00 UTC
            </strong>
          </div>
          {error && (
            <p role="alert" className="login-error">
              {error}
            </p>
          )}
          <div className="picker-actions">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary" type="submit">
              {pending ? "Creating…" : "Create composite"}
            </button>
          </div>
        </fieldset>
      </form>
    </dialog>
  );
}
