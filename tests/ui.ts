import { chromium, expect } from "@playwright/test";
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
  await page
    .getByRole("heading", { name: "Needs attention", exact: true })
    .waitFor();
  await mkdir("test-results", { recursive: true });
  await page.screenshot({ path: "test-results/dashboard.png", fullPage: true });
  await page.getByRole("link", { name: "Sources", exact: true }).click();
  await page.getByRole("button", { name: "Add source" }).click();
  const dialog = page.getByRole("dialog");
  await dialog
    .getByLabel("Name", { exact: true })
    .fill("Synthetic browser fixture");
  await dialog
    .getByLabel("Satellite", { exact: true })
    .fill("Synthetic browser fixture");
  await dialog.getByLabel("Region", { exact: true }).fill("Test only");
  await dialog
    .getByLabel("Attribution", { exact: true })
    .fill("Synthetic test data, not live imagery");
  await dialog
    .getByLabel("Image URL template")
    .fill(
      `http://127.0.0.1:${(feed.address() as { port: number }).port}/IR_{YYYY}{MM}{DD}T{HH}{mm}00Z.png`,
    );
  await dialog.getByLabel("Longitude (°)", { exact: true }).fill("180");
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
  await page.getByRole("link", { name: "Profiles", exact: true }).click();
  await page.getByRole("button", { name: "New profile", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByLabel("Name", { exact: true })
    .fill("Browser map");
  await page
    .getByRole("dialog")
    .getByLabel("Output type", { exact: true })
    .selectOption("map");
  await page
    .getByRole("dialog")
    .getByLabel("Synthetic browser fixture inclusion", { exact: true })
    .selectOption("required");
  await page.getByRole("button", { name: "Save profile" }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const map = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Browser map", exact: true }),
  });
  await map.getByRole("button", { name: "Edit profile" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(map.getByRole("button", { name: "Edit profile" })).toBeFocused();
  await map.getByRole("button", { name: "Run now" }).click();
  await page.getByRole("link", { name: "Jobs", exact: true }).click();
  await page
    .getByText("Complete", { exact: true })
    .waitFor({ timeout: 120000 });
  await page.getByRole("button", { name: "View logs", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByText("Published complete composite", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.getByRole("img", { name: "Browser map", exact: true }).waitFor();
  await expect
    .poll(() =>
      page
        .getByRole("img", { name: "Browser map", exact: true })
        .evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 1000,
        ),
    )
    .toBe(true);
  await page.screenshot({ path: "test-results/composite.png", fullPage: true });
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByLabel("Composition interval (minutes)").fill("15");
  await page.getByRole("button", { name: "Save settings" }).click();
  await expect.poll(() => instance.store.settings().pollMinutes).toBe(15);
  assert.equal(instance.store.settings().pollMinutes, 15);
  await page.getByRole("link", { name: "Files", exact: true }).click();
  await page.getByLabel("Search files").fill("Browser map");
  await page.getByLabel("File category").selectOption("outputs");
  await page.getByRole("button", { name: /Delete Browser map/ }).click();
  await page
    .getByRole("dialog", { name: "Delete file", exact: true })
    .getByRole("button", { name: "Keep file", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("link", { name: "Overview", exact: true }).click();
  await page.screenshot({ path: "test-results/mobile.png", fullPage: true });
  for (const screen of [
    "Overview",
    "Sources",
    "Profiles",
    "Jobs",
    "Files",
    "Settings",
  ]) {
    await page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: screen, exact: true })
      .click();
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      `${screen} fits a 390px viewport`,
    );
  }
  assert.deepEqual(errors, []);
  console.log(
    "Browser workflow passed: setup, validation, profile creation, composition, logs, preview, settings, file dialogs, keyboard focus, and all six mobile screens.",
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
