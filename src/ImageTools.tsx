import React, { useEffect, useRef, useState } from "react";

type Format = "jpeg" | "png" | "webp";
type Result = {
  url: string;
  size: number;
  width: number;
  height: number;
  name: string;
  met: boolean;
};
const bytes = (n: number) =>
  n < 1024 * 1024
    ? `${(n / 1024).toFixed(1)} KB`
    : `${(n / 1024 / 1024).toFixed(2)} MB`;
const presets = {
  custom: { label: "Custom", width: 2048, height: 2048, target: 5 },
  discord: {
    label: "Discord · shared image",
    width: 1920,
    height: 1920,
    target: 5,
  },
  facebook: {
    label: "Facebook · shared photo",
    width: 2048,
    height: 2048,
    target: 5,
  },
};

export function ImageTools() {
  const [file, setFile] = useState<File>();
  const [preset, setPreset] = useState<keyof typeof presets>("custom");
  const [width, setWidth] = useState(2048);
  const [height, setHeight] = useState(2048);
  const [target, setTarget] = useState(5);
  const [format, setFormat] = useState<Format>("jpeg");
  const [quality, setQuality] = useState(90);
  const [result, setResult] = useState<Result>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (result) URL.revokeObjectURL(result.url);
    },
    [result],
  );
  const invalidate = () => {
    generation.current++;
    setResult(undefined);
    setError("");
    setBusy(false);
  };

  async function process(event: React.FormEvent) {
    event.preventDefault();
    if (!file) return;
    const token = ++generation.current;
    setBusy(true);
    setError("");
    setResult(undefined);
    let bitmap: ImageBitmap | undefined;
    try {
      if (
        ![width, height].every(
          (n) => Number.isInteger(n) && n >= 1 && n <= 8192,
        ) ||
        !Number.isFinite(target) ||
        target < 0.01 ||
        target > 100
      )
        throw new Error(
          "Choose dimensions from 1 to 8192 pixels and a target from 0.01 to 100 MB.",
        );
      bitmap = await createImageBitmap(file, {
        imageOrientation: "from-image",
      });
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d");
      if (!context)
        throw new Error("Image processing is unavailable in this browser.");
      const scale = Math.min(1, width / bitmap.width, height / bitmap.height);
      let w = Math.max(1, Math.round(bitmap.width * scale));
      let h = Math.max(1, Math.round(bitmap.height * scale));
      const limit = target * 1024 * 1024;
      const encode = async (q: number) => {
        const blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) =>
              b
                ? resolve(b)
                : reject(
                    new Error(
                      "Could not encode this image. Try smaller dimensions.",
                    ),
                  ),
            `image/${format}`,
            q,
          ),
        );
        if (blob.type !== `image/${format}`)
          throw new Error(
            `This browser does not support ${format.toUpperCase()} export. Choose another format.`,
          );
        return blob;
      };
      let output: Blob | undefined;
      for (let attempt = 0; attempt < 16; attempt++) {
        if (generation.current !== token) return;
        canvas.width = w;
        canvas.height = h;
        if (format === "jpeg") {
          context.fillStyle = "#ffffff";
          context.fillRect(0, 0, w, h);
        }
        context.drawImage(bitmap, 0, 0, w, h);
        output = await encode(quality / 100);
        if (output.size > limit && format !== "png") {
          let low = 0.1,
            high = quality / 100;
          const smallest = await encode(low);
          output = smallest;
          if (smallest.size <= limit) {
            for (let step = 0; step < 7; step++) {
              const mid = (low + high) / 2;
              const candidate = await encode(mid);
              if (candidate.size <= limit) {
                output = candidate;
                low = mid;
              } else high = mid;
            }
          }
        }
        if (output.size <= limit || (w === 1 && h === 1)) break;
        const shrink = Math.min(0.85, Math.sqrt(limit / output.size) * 0.9);
        w = Math.max(1, Math.floor(w * shrink));
        h = Math.max(1, Math.floor(h * shrink));
      }
      if (generation.current !== token) return;
      if (!output) throw new Error("Could not process the image.");
      setResult({
        url: URL.createObjectURL(output),
        size: output.size,
        width: canvas.width,
        height: canvas.height,
        name: `${file.name.replace(/\.[^.]+$/, "")}-prepared.${format === "jpeg" ? "jpg" : format}`,
        met: output.size <= limit,
      });
    } catch (e) {
      if (generation.current === token)
        setError(
          e instanceof Error
            ? e.message
            : "Unable to read this image. Try a JPEG, PNG, or WebP file.",
        );
    } finally {
      bitmap?.close();
      if (generation.current === token) setBusy(false);
    }
  }

  return (
    <div className="image-tools">
      <form
        className="panel image-tool-settings"
        onSubmit={process}
        onChange={invalidate}
      >
        <h2>Prepare an image</h2>
        <p className="muted">
          Images stay in your browser. Resize, compress, and convert before
          sharing.
        </p>
        <label className="field">
          <span>Choose image</span>
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => setFile(e.target.files?.[0])}
          />
        </label>
        {file && (
          <p className="muted">
            {file.name} · {bytes(file.size)}
          </p>
        )}
        <label className="field">
          <span>Sharing preset</span>
          <select
            value={preset}
            onChange={(e) => {
              const key = e.target.value as keyof typeof presets;
              setPreset(key);
              setWidth(presets[key].width);
              setHeight(presets[key].height);
              setTarget(presets[key].target);
            }}
          >
            {Object.entries(presets).map(([key, p]) => (
              <option value={key} key={key}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">
          Presets are starting points. Adjust the target to the upload limit
          shown by your account.
        </p>
        <div className="image-tool-dimensions">
          <label className="field">
            <span>Maximum width (px)</span>
            <input
              required
              type="number"
              min="1"
              max="8192"
              value={width}
              onChange={(e) => {
                setWidth(e.target.valueAsNumber);
                setPreset("custom");
              }}
            />
          </label>
          <label className="field">
            <span>Maximum height (px)</span>
            <input
              required
              type="number"
              min="1"
              max="8192"
              value={height}
              onChange={(e) => {
                setHeight(e.target.valueAsNumber);
                setPreset("custom");
              }}
            />
          </label>
        </div>
        <label className="field">
          <span>Target file size (MB)</span>
          <input
            required
            type="number"
            min="0.01"
            max="100"
            step="0.01"
            value={target}
            onChange={(e) => setTarget(e.target.valueAsNumber)}
          />
        </label>
        <label className="field">
          <span>Output format</span>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as Format)}
          >
            <option value="jpeg">JPEG · photos, white background</option>
            <option value="webp">WebP · photos and transparency</option>
            <option value="png">PNG · lossless, transparency</option>
          </select>
        </label>
        {format !== "png" && (
          <label className="field">
            <span>Maximum quality · {quality}%</span>
            <input
              type="range"
              min="10"
              max="100"
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
            />
          </label>
        )}
        <p className="muted">
          Keeps proportions and never enlarges. Quality and dimensions may
          decrease to meet the target. Animated images export as a still image.
        </p>
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <button className="primary" disabled={!file || busy}>
          {busy ? "Preparing…" : "Prepare image"}
        </button>
      </form>
      <section
        className="panel image-tool-preview"
        aria-label="Image preview"
        aria-busy={busy}
      >
        <h2>Output preview</h2>
        {result ? (
          <>
            <img src={result.url} alt="Prepared image" />
            <p role="status">
              {result.width} × {result.height} px · {bytes(result.size)}
              {file && result.size < file.size
                ? ` · ${Math.round((1 - result.size / file.size) * 100)}% smaller`
                : ""}
            </p>
            {!result.met && (
              <p className="inline-error" role="alert">
                Could not reach this target. Try a larger file-size target or
                another format.
              </p>
            )}
            <a
              className="button primary"
              href={result.url}
              download={result.name}
            >
              Download image
            </a>
          </>
        ) : (
          <p className="muted" role="status">
            {busy
              ? "Optimizing your image…"
              : "Choose an image and prepare it to see the result here."}
          </p>
        )}
      </section>
    </div>
  );
}
