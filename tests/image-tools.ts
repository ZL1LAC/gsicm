import { chromium, expect } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";

const dir = await mkdtemp(path.join(os.tmpdir(), "gsicm-image-tools-"));
const instance = await createApp(process.cwd(), dir);
const server = instance.app.listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto(
    `http://127.0.0.1:${(server.address() as { port: number }).port}/#image-tools`,
  );
  await expect(
    page.getByRole("heading", { name: "Image Tools", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Image Tools", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  const png = await sharp({
    create: {
      width: 1200,
      height: 600,
      channels: 4,
      background: { r: 180, g: 80, b: 120, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  await page
    .getByLabel("Choose image")
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  await page.getByLabel("Sharing preset").selectOption("discord");
  await expect(page.getByLabel("Maximum width (px)")).toHaveValue("1920");
  await page.getByLabel("Maximum width (px)").fill("600");
  for (const [format, mime] of [
    ["jpeg", "image/jpeg"],
    ["png", "image/png"],
    ["webp", "image/webp"],
  ]) {
    await page.getByLabel("Output format").selectOption(format);
    await page.getByLabel("Target file size (MB)").fill("0.01");
    await page
      .getByRole("button", { name: "Prepare image", exact: true })
      .click();
    const download = page.getByRole("link", { name: "Download image" });
    await expect(download).toBeVisible();
    const output = await download.getAttribute("href");
    const details = await page.evaluate(async (url) => {
      const blob = await (await fetch(url!)).blob();
      const image = await createImageBitmap(blob);
      return {
        type: blob.type,
        size: blob.size,
        width: image.width,
        height: image.height,
      };
    }, output);
    assert.equal(details.type, mime);
    assert.ok(details.size <= 0.01 * 1024 * 1024);
    assert.equal(details.width, 600);
    assert.equal(details.height, 300);
  }
  await page.getByLabel("Maximum width (px)").fill("400");
  await expect(page.getByRole("link", { name: "Download image" })).toHaveCount(
    0,
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page
    .getByLabel("Choose image")
    .setInputFiles({
      name: "broken.png",
      mimeType: "image/png",
      buffer: Buffer.from("broken"),
    });
  await page
    .getByRole("button", { name: "Prepare image", exact: true })
    .click();
  await expect(page.getByRole("alert")).toBeVisible();
  assert.deepEqual(errors, []);
  console.log(
    "Image Tools browser checks passed: presets, dimensions, size targets, JPEG/PNG/WebP, stale results, mobile layout, invalid image.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  instance.store.db.close();
  await rm(dir, { recursive: true, force: true });
}
