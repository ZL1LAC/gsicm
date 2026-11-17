import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { captionBand, addAttributionOverlay } from "../server/overlay.js";
import {
  profileSchema,
  sourceSchema,
  type AcquiredImage,
} from "../shared/types.js";

test("caption uses job times, escapes names, and preserves image below broadcast band", async () => {
  const source = sourceSchema.parse({
    id: "one",
    name: "One",
    satellite: "Sat & One",
    region: "",
    enabled: true,
    transport: "http",
    location: "https://example.org/image",
    longitude: 0,
    attribution: "test",
  });
  const missing = { ...source, id: "two", satellite: "Absent" };
  const placeholder = {
    ...source,
    id: "empty",
    satellite: "Placeholder",
    location: "",
  };
  const profile = profileSchema.parse({
    id: "map",
    name: "Test <map>",
    enabled: true,
    sourceIds: [source.id],
    projection: "map",
    format: "png",
    underlay: "test.jpg",
  });
  const time = "2026-09-28T20:20:00Z";
  const images = [
    { sourceId: "one", observationTime: "2026-09-28T20:10:20Z" },
  ] as AcquiredImage[];
  const band = captionBand(1024, profile, time, [source], images, [
    source,
    missing,
    placeholder,
  ]);
  assert.match(band.svg, /&lt;map&gt;/);
  assert.match(band.svg, /&amp;/);
  assert.match(band.svg, /#ffb86b/);
  assert.match(band.svg, /20:20:00/);
  assert.match(band.svg, /20:10:20/);
  assert.doesNotMatch(band.svg, /Placeholder/);
  const dir = await mkdtemp(path.join(os.tmpdir(), "overlay-test-"));
  try {
    const input = path.join(dir, "input.png"),
      output = path.join(dir, "output.png");
    await sharp({
      create: { width: 1024, height: 512, channels: 3, background: "#123456" },
    })
      .png()
      .toFile(input);
    await addAttributionOverlay(
      input,
      output,
      profile,
      time,
      [source],
      images,
      [source, missing, placeholder],
    );
    const meta = await sharp(output).metadata();
    assert.equal(meta.width, 1024);
    assert.equal(meta.height, 512 + band.height);
    const original = await sharp(input).raw().toBuffer();
    const retained = await sharp(output)
      .extract({ left: 0, top: band.height, width: 1024, height: 512 })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual(retained, original);
    const corner = await sharp(output)
      .extract({ left: 0, top: 0, width: 1, height: 1 })
      .removeAlpha()
      .raw()
      .toBuffer();
    assert.deepEqual([...corner], [17, 25, 35]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("caption renders distinct letter shapes on hosts without system fonts", async () => {
  const profile = profileSchema.parse({
    id: "map",
    name: "Test",
    enabled: false,
    sourceIds: [],
    projection: "map",
    format: "png",
    underlay: "test.jpg",
  });
  const inkWidth = async (name: string) => {
    const band = captionBand(
      1024,
      { ...profile, name },
      "2026-11-16T05:20:00Z",
      [],
      [],
      [],
    );
    const { data, info } = await sharp(Buffer.from(band.svg))
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const columns = new Set<number>();
    for (let y = 0; y < info.height; y++)
      for (let x = 0; x < info.width; x++) {
        const i = (y * info.width + x) * info.channels;
        // Only the profile title uses near-white; other rows have tinted text.
        if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230)
          columns.add(x);
      }
    assert.ok(columns.size > 0, "Profile title has visible glyphs");
    return Math.max(...columns) - Math.min(...columns) + 1;
  };
  // Missing-character boxes render both strings with the same width.
  assert.ok((await inkWidth("WWW")) > 2 * (await inkWidth("iii")));
});
