import { chromium } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import sharp from "sharp";
import assert from "node:assert/strict";
import { createApp } from "../server/index.js";
import type { Job } from "../shared/types.js";
const dir = await mkdtemp(path.join(os.tmpdir(), "gsicm-ui-"));
const instance = await createApp(process.cwd(), dir);
const server = instance.app.listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const size = 5424,
  raw = Buffer.alloc(size * size);
for (let y = 0; y < size; y++)
  for (let x = 0; x < size; x++) {
    const dx = (x - size / 2) / (size * 0.46),
      dy = (y - size / 2) / (size * 0.46);
    raw[y * size + x] =
      dx * dx + dy * dy < 1
        ? Math.round(140 + 60 * Math.sin(x / 100) * Math.cos(y / 200))
        : 0;
  }
const png = await sharp(raw, {
  raw: { width: size, height: size, channels: 1 },
})
  .png()
  .toBuffer();
const feed = http.createServer((_req, res) => res.end(png));
await new Promise<void>((r) => feed.listen(0, "127.0.0.1", r));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(
    `http://127.0.0.1:${(server.address() as { port: number }).port}`,
  );
  await page.getByText("Global coverage needs setup").waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("button", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "+ Add source" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("name", { exact: true })
    .fill("Synthetic browser fixture");
  await dialog
    .getByLabel("satellite", { exact: true })
    .fill("Synthetic browser fixture");
  await dialog.getByLabel("region", { exact: true }).fill("Test only");
  await dialog
    .getByLabel("attribution", { exact: true })
    .fill("Synthetic test data, not live imagery");
  await dialog
    .getByLabel("Image URL template")
    .fill(
      `http://127.0.0.1:${(feed.address() as { port: number }).port}/IR_{YYYY}{MM}{DD}T{HH}{mm}00Z.png`,
    );
  await dialog.getByLabel("longitude", { exact: true }).fill("180");
  await dialog.getByLabel("Enable source", { exact: true }).check();
  await dialog.getByRole("button", { name: "Save source" }).click();
  await dialog.waitFor({ state: "hidden" });
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Synthetic browser fixture" }),
  });
  await card.getByRole("button", { name: "Test source" }).click();
  await card.getByText(/Inspect preview/).waitFor({ timeout: 30000 });
  await card.getByRole("link", { name: "Preview" }).waitFor();
  await card.getByRole("button", { name: "Configure", exact: true }).click();
  await page.getByLabel(/I inspected the preview/).check();
  await page.getByRole("button", { name: "Save source" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await card.getByRole("button", { name: "Test source" }).click();
  await card
    .getByText("Validated", { exact: true })
    .waitFor({ timeout: 30000 });
  await page.getByRole("button", { name: "Profiles", exact: true }).click();
  const map = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Global map", exact: true }),
  });
  await map.getByRole("button", { name: "Edit profile" }).click();
  for (const name of [
    "GOES East",
    "GOES West",
    "Himawari",
    "Meteosat",
    "Indian Ocean",
  ])
    await page.getByRole("dialog").getByLabel(name, { exact: true }).uncheck();
  await page
    .getByRole("dialog")
    .getByLabel("Synthetic browser fixture", { exact: true })
    .check();
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  await map.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await page
    .getByText("succeeded", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "Logs", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Published complete composite", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.getByRole("img", { name: "Global map", exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("img", { name: "Global map", exact: true })
      .evaluate(
        (img: HTMLImageElement) => img.complete && img.naturalWidth > 1000,
      ),
    true,
  );
  await page.screenshot({ path: "test-results/composite.png", fullPage: true });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Poll interval (minutes)").fill("15");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByRole("status").getByText("Saved", { exact: true }).waitFor();
  assert.equal(instance.store.settings().pollMinutes, 15);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Overview", exact: true }).click();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    "Browser workflow passed: setup, test, confirmation, composition, logs, preview, settings, mobile.",
  );
} finally {
  await browser.close();
  server.closeAllConnections();
  feed.closeAllConnections();
  await Promise.all([
    new Promise<void>((r) => server.close(() => r())),
    new Promise<void>((r) => feed.close(() => r())),
  ]);
  instance.store.db.close();
  await rm(dir, { recursive: true, force: true });
}
