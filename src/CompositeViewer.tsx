import React, { useEffect, useMemo, useState } from "react";
import type { OutputSummary } from "../shared/types";
import { api } from "./api";
import { Dialog } from "./Dialog";

const utc = (value: string) => {
  const date = new Date(value);
  return Number.isFinite(+date)
    ? date
        .toISOString()
        .replace("T", " ")
        .replace(/\.\d{3}Z$/, " UTC")
    : "Unknown";
};
export function observationAge(target: string, observation: string) {
  const minutes = Math.round(
    (Date.parse(target) - Date.parse(observation)) / 60000,
  );
  if (!Number.isFinite(minutes)) return "Age unavailable";
  if (minutes === 0) return "At target time";
  return `${Math.abs(minutes)} min ${minutes > 0 ? "before" : "after"} target${Math.abs(minutes) >= 30 ? " · Large time offset" : ""}`;
}
const colors = [
  "#ffcf68",
  "#5be2ff",
  "#ff89cc",
  "#a7ef8a",
  "#bb9eff",
  "#ff907c",
  "#fff58a",
];
function footprint(longitude: number) {
  // Spherical Earth and nominal geostationary altitude; not Sanchez blend masks.
  const horizon = 6371 / (6371 + 35786);
  const paths: string[] = [];
  let segment: [number, number, number][] = [];
  const flush = () => {
    if (segment.length < 2) {
      segment = [];
      return;
    }
    paths.push(
      `M ${segment.map(([x, top]) => `${x},${top}`).join(" L ")} L ${segment
        .slice()
        .reverse()
        .map(([x, , bottom]) => `${x},${bottom}`)
        .join(" L ")} Z`,
    );
    segment = [];
  };
  for (let lon = -180; lon <= 180; lon += 1) {
    const delta = ((((lon - longitude + 540) % 360) - 180) * Math.PI) / 180;
    const ratio = horizon / Math.cos(delta);
    if (Math.cos(delta) <= 0 || ratio > 1) {
      flush();
      continue;
    }
    const lat = (Math.acos(ratio) * 180) / Math.PI;
    segment.push([
      ((lon + 180) / 360) * 1000,
      ((90 - lat) / 180) * 500,
      ((90 + lat) / 180) * 500,
    ]);
  }
  flush();
  return paths;
}
export function CompositeViewer({
  initial,
  name,
  onClose,
}: {
  initial: OutputSummary;
  name: string;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<OutputSummary[]>([initial]);
  const [selected, setSelected] = useState(initial.jobId);
  const [zoom, setZoom] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [quality, setQuality] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    api<OutputSummary[]>(
      `/outputs/${encodeURIComponent(initial.profileId)}/history`,
      "GET",
      undefined,
      controller.signal,
    )
      .then((items) => {
        if (items.length) setHistory(items);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError("Could not load composite history.");
      });
    return () => controller.abort();
  }, [initial.profileId]);
  useEffect(() => {
    if (!playing || history.length < 2) return;
    const timer = setInterval(
      () =>
        setSelected(
          (id) =>
            history[
              (history.findIndex((item) => item.jobId === id) + 1) %
                history.length
            ].jobId,
        ),
      1000,
    );
    return () => clearInterval(timer);
  }, [playing, history]);
  const current = history.find((item) => item.jobId === selected) ?? initial;
  const index = history.findIndex((item) => item.jobId === current.jobId);
  const base = `/api/outputs/${encodeURIComponent(current.profileId)}/history/${encodeURIComponent(current.jobId)}`;
  const canGuide =
    current.hasClean &&
    current.projection === "map" &&
    current.observations.some((o) => typeof o.longitude === "number");
  const metadata = useMemo(
    () =>
      URL.createObjectURL(
        new Blob(
          [
            JSON.stringify(
              {
                profile: name,
                targetTime: current.targetTime,
                observations: current.observations,
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
      ),
    [current, name],
  );
  useEffect(() => () => URL.revokeObjectURL(metadata), [metadata]);
  return (
    <Dialog title={name} onClose={onClose} className="composite-dialog">
      <p>Target: {utc(current.targetTime)}</p>
      <div className="composite-controls">
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setSelected(history[index - 1].jobId);
          }}
          disabled={index <= 0}
        >
          Previous
        </button>
        <button
          type="button"
          onClick={() => setPlaying(!playing)}
          disabled={history.length < 2}
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => {
            setPlaying(false);
            setSelected(history[index + 1].jobId);
          }}
          disabled={index < 0 || index >= history.length - 1}
        >
          Next
        </button>
        <span>
          {index + 1} / {history.length}
        </span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.max(1, z - 0.5))}
          disabled={zoom <= 1}
        >
          Zoom out
        </button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          onClick={() => setZoom((z) => Math.min(4, z + 0.5))}
          disabled={zoom >= 4}
        >
          Zoom in
        </button>
        <button type="button" onClick={() => setZoom(1)}>
          Reset
        </button>
        {canGuide && (
          <button
            type="button"
            aria-pressed={quality}
            onClick={() => setQuality(!quality)}
          >
            {quality ? "Hide coverage guide" : "Show coverage guide"}
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <div
        className="composite-viewport"
        tabIndex={0}
        aria-label="Composite image; scroll to pan when zoomed"
      >
        <div className="composite-image" style={{ width: `${zoom * 100}%` }}>
          <img
            src={`${base}${current.hasClean ? "?clean=1" : ""}`}
            alt={`${name} satellite composite`}
          />
          {quality && canGuide && (
            <svg
              className="coverage-guide"
              viewBox="0 0 1000 500"
              preserveAspectRatio="none"
              aria-label="Approximate satellite visibility boundaries"
            >
              {current.observations.map(
                (o, i) =>
                  typeof o.longitude === "number" &&
                  footprint(o.longitude).map((d, n) => (
                    <path
                      key={`${o.sourceId}-${n}`}
                      d={d}
                      fill="none"
                      stroke={colors[i % colors.length]}
                      strokeWidth="2"
                      strokeDasharray="6 4"
                    />
                  )),
              )}
            </svg>
          )}
        </div>
      </div>
      {quality && canGuide && (
        <div>
          <p className="muted">
            Approximate geostationary visibility at nominal altitude. Boundaries
            are not measured coverage or stitch seams; cropping and blending can
            change the actual contribution.
          </p>
          <div className="coverage-legend">
            {current.observations.map(
              (o, i) =>
                typeof o.longitude === "number" && (
                  <span
                    key={o.sourceId}
                    style={{ color: colors[i % colors.length] }}
                  >
                    ● {o.satellite}
                  </span>
                ),
            )}
          </div>
        </div>
      )}
      <div className="composite-controls composite-downloads">
        <a className="button" href={base} download>
          Download attributed image
        </a>
        {current.hasClean && (
          <a className="button" href={`${base}?clean=1`} download>
            Download map only
          </a>
        )}
        <a
          className="button"
          href={metadata}
          download={`${current.jobId}-sources.json`}
        >
          Download source details
        </a>
      </div>
      {!current.hasClean && (
        <p className="muted">
          Map-only export and coverage guide are available for newly generated
          composites.
        </p>
      )}
      <details className="image-details">
        <summary>Sources and observation times</summary>
        {current.observations.map((o) => (
          <p key={o.sourceId}>
            <strong>{o.satellite}</strong> · {utc(o.time)} ·{" "}
            {observationAge(current.targetTime, o.time)}
            <br />
            {o.attribution}
          </p>
        ))}
      </details>
    </Dialog>
  );
}
