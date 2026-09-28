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

// Adapted from the caption-band design in the user's overlayer.py.
// Metadata comes from the completed job rather than guessing from filenames.
export function captionBand(
  width: number,
  profile: Profile,
  target: string,
  sources: SourceRecord[],
  images: AcquiredImage[],
  available: SourceRecord[],
) {
  const font = Math.max(12, Math.round(width / 130));
  const limit = Math.max(12, Math.floor((width - 32) / (font * 0.64)));
  const rows: Part[][] = [];
  const wrap = (parts: Part[]) => {
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
          if (previous && !!previous.missing === !!part.missing) previous.text += text;
          else row.push({ ...part, text });
          length += text.length;
        }
      }
    }
    if (row.length) rows.push(row);
  };
  wrap([{ text: `${profile.name} — ${utc(target)}` }]);
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
  wrap([
    {
      text:
        "Observations: " +
        sources
          .map((s, i) => `${s.satellite}: ${utc(images[i].observationTime)}`)
          .join(" · "),
    },
  ]);
  const lineHeight = Math.ceil(font * 1.5),
    padding = Math.ceil(font * 0.75),
    height = rows.length * lineHeight + padding * 2;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="white"/>${rows.map((row, i) => `<text x="${width / 2}" y="${padding + font + i * lineHeight}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${font}">${row.map((p) => `<tspan fill="${p.missing ? "#cc0000" : "#111111"}">${escapeXml(p.text)}</tspan>`).join("")}</text>`).join("")}</svg>`;
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
      background: "white",
    })
    .composite([{ input: Buffer.from(band.svg), left: 0, top: 0 }])
    .toFormat(
      profile.format === "png" ? "png" : "jpeg",
      profile.format === "jpg" ? { quality: 92 } : undefined,
    )
    .toFile(output);
}
