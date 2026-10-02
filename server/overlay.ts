import sharp from "sharp";
import type { Profile, SourceRecord, AcquiredImage } from "../shared/types.js";

const escapeXml = (text: string) =>
  text.replace(
    /[&<>"' ]/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
        " ": "&#160;",
      })[c]!,
  );
const utc = (time: string) =>
  new Date(time)
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
type Part = { text: string; missing?: boolean };

// A broadcast-style caption stays outside the satellite imagery.
// Metadata comes from the completed job rather than guessing from filenames.
export function captionBand(
  width: number,
  profile: Profile,
  target: string,
  sources: SourceRecord[],
  images: AcquiredImage[],
  available: SourceRecord[],
) {
  const font = Math.max(12, Math.round(width / 110));
  const padding = Math.max(16, Math.round(width / 64));
  const accent = "#53d5ed";
  const elements: string[] = [];
  let y = padding;
  const wrap = (
    parts: Part[],
    size = font,
    color = "#dce5ef",
    weight = 400,
  ) => {
    const limit = Math.max(
      1,
      Math.floor((width - padding * 2) / (size * 0.75)),
    );
    const rows: Part[][] = [];
    let row: Part[] = [],
      length = 0;
    for (const part of parts) {
      for (const word of part.text.split(/(\s+)/).filter(Boolean)) {
        for (let i = 0; i < word.length; i += limit) {
          const text = word.slice(i, i + limit);
          if (length + text.length > limit && row.length) {
            rows.push(row);
            row = [];
            length = 0;
          }
          if (!row.length && !text.trim()) continue;
          const previous = row.at(-1);
          if (previous && !!previous.missing === !!part.missing)
            previous.text += text;
          else row.push({ ...part, text });
          length += text.length;
        }
      }
    }
    if (row.length) rows.push(row);
    for (const row of rows) {
      elements.push(
        `<text x="${padding}" y="${y + size}" font-family="DejaVu Sans, Arial, sans-serif" font-size="${size}" font-weight="${weight}">${row.map((p) => `<tspan fill="${p.missing ? "#ffb86b" : color}">${escapeXml(p.text)}</tspan>`).join("")}</text>`,
      );
      y += Math.ceil(size * 1.45);
    }
  };
  wrap(
    [
      {
        text:
          profile.projection === "disk"
            ? "FALSE-COLOR SATELLITE DISK"
            : "SATELLITE COMPOSITE",
      },
    ],
    font,
    accent,
    700,
  );
  y += Math.ceil(font * 0.4);
  wrap([{ text: profile.name }], Math.round(font * 1.85), "#f5f8fc", 700);
  wrap([{ text: `TARGET  ${utc(target)}` }], font, accent, 600);
  y += Math.ceil(font * 0.8);
  elements.push(
    `<path d="M ${padding} ${y} H ${width - padding}" stroke="#344354"/>`,
  );
  y += Math.ceil(font * 0.8);
  const used = new Set(sources.map((s) => s.satellite));
  const missing = [
    ...new Set(
      available.filter((s) => s.location || s.bucket).map((s) => s.satellite),
    ),
  ].filter((s) => !used.has(s));
  wrap(
    sources
      .flatMap((s, i) => [{ text: `${i ? " + " : ""}${s.satellite}` }])
      .concat(
        missing.flatMap((s) => [
          { text: " + " },
          { text: `${s} (not included)`, missing: true },
        ]),
      ),
  );
  y += Math.ceil(font * 0.4);
  wrap(
    [
      {
        text:
          "Observations: " +
          sources
            .map((s, i) => `${s.satellite}: ${utc(images[i].observationTime)}`)
            .join(" · "),
      },
    ],
    font,
    "#9eafc2",
  );
  const height = Math.ceil(y + padding);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#111923"/>${elements.join("")}<rect x="0" y="${height - 3}" width="${width}" height="3" fill="${accent}"/></svg>`;
  return { svg, height };
}

export async function addAttributionOverlay(
  input: string,
  output: string,
  profile: Profile,
  target: string,
  sources: SourceRecord[],
  images: AcquiredImage[],
  available: SourceRecord[] = sources,
) {
  const meta = await sharp(input).metadata();
  if (!meta.width || !meta.height)
    throw new Error("Cannot annotate an image without dimensions");
  const band = captionBand(
    meta.width,
    profile,
    target,
    sources,
    images,
    available,
  );
  await sharp(input)
    .extend({
      top: band.height,
      bottom: 0,
      left: 0,
      right: 0,
      background: "#111923",
    })
    .composite([{ input: Buffer.from(band.svg), left: 0, top: 0 }])
    .toFormat(
      profile.format === "png" ? "png" : "jpeg",
      profile.format === "png"
        ? {
            // Quantise satellite composites to reduce download sizes without
            // reducing their dimensions. Palette conversion is lossy.
            compressionLevel: 9,
            adaptiveFiltering: true,
            effort: 10,
            palette: true,
            colours: 128,
            // Dithering adds noise that substantially increases PNG size.
            dither: 0,
          }
        : { quality: 85, mozjpeg: true },
    )
    .toFile(output);
}
