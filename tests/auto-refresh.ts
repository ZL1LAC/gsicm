import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";
import {
  profileSchema,
  settingsSchema,
  sourceSchema,
} from "../shared/types.js";
import type { FilesState, Job, ManagerState } from "../shared/types.js";

const server = await createServer({
  server: { port: 0, hmr: false, watch: null },
});
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let documentLoads = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentLoads++;
  });
  const source = sourceSchema.parse({
    id: "source",
    name: "Test satellite",
    satellite: "Test satellite",
    region: "Pacific",
    enabled: true,
    transport: "http",
    location: "https://example.test/image.png",
    longitude: 180,
    attribution: "Synthetic fixture",
    cleanConfirmed: true,
  });
  const profile = profileSchema.parse({
    id: "map",
    name: "Test composite",
    enabled: false,
    sourceIds: [source.id],
    projection: "map",
    underlay: "world.jpg",
  });
  const job: Job = {
    id: "job-1",
    profileId: profile.id,
    profileName: profile.name,
    status: "running",
    stage: "acquiring",
    message: "Acquiring imagery",
    targetTime: "2026-10-01T01:00:00Z",
    startedAt: "2026-10-01T01:01:00Z",
    logs: Array.from(
      { length: 100 },
      (_, index) => `First log line ${index}`,
    ).join("\n"),
  };
  const state: ManagerState = {
    sources: [
      {
        ...source,
        validation: {
          at: "2026-10-01T01:00:00Z",
          compatible: false,
          message: "Needs validation",
        },
      },
    ],
    profiles: [{ ...profile, blockers: [] }],
    settings: settingsSchema.parse({}),
    jobs: [job],
    outputs: [
      {
        profileId: profile.id,
        jobId: "published-1",
        targetTime: "2026-10-01T00:00:00Z",
        publishedAt: "2026-10-01T00:02:00Z",
        width: 100,
        height: 50,
        observations: [],
      },
    ],
    underlays: ["world.jpg"],
    locked: false,
    testingSourceIds: [],
    canRunJobs: true,
  };
  const files: FilesState = {
    files: [
      {
        folder: "outputs",
        name: "first.jpg",
        label: "First composite",
        bytes: 2048,
        modifiedAt: "2026-10-01T00:02:00Z",
        preview: "/api/outputs/map",
      },
    ],
    locked: false,
  };
  let stateRequests = 0;
  let logRequests = 0;
  let stateFailure = 0;
  let deleteFailure = true;
  let authenticated = true;
  let delayedLog: (() => Promise<void>) | undefined;
  let holdNextLog = false;
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    if (url.pathname.startsWith("/api/outputs/")) {
      await route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="50"><rect width="100" height="50" fill="#2dd4bf"/></svg>',
      });
      return;
    }
    let body: unknown;
    let status = 200;
    if (url.pathname === "/api/auth")
      body = { required: !authenticated, authenticated };
    else if (url.pathname === "/api/state") {
      stateRequests++;
      if (stateFailure) {
        status = stateFailure;
        body = {
          error:
            stateFailure === 401 ? "Session expired" : "Connection interrupted",
        };
      } else body = state;
    } else if (url.pathname === "/api/jobs/job-1") {
      logRequests++;
      if (holdNextLog) {
        holdNextLog = false;
        const snapshot = structuredClone(job);
        delayedLog = async () => {
          await route.fulfill({ json: snapshot }).catch(() => {});
        };
        return;
      }
      body = job;
    } else if (url.pathname === "/api/files") body = files;
    else if (url.pathname.startsWith("/api/files/") && method === "DELETE") {
      if (deleteFailure) {
        status = 409;
        body = { error: "File is temporarily in use" };
      } else {
        files.files = files.files.filter(
          (file) => !url.pathname.endsWith(`/${file.name}`),
        );
        body = { ok: true };
      }
    } else if (url.pathname === "/api/settings" && method === "PUT") {
      state.settings = route.request().postDataJSON();
      body = { ok: true };
    } else if (url.pathname === "/api/login") {
      authenticated = true;
      stateFailure = 0;
      body = { ok: true };
    } else body = { ok: true };
    await route.fulfill({ status, json: body });
  });
  const nav = (name: string) =>
    page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name, exact: true });
  const reconnect = () =>
    page.evaluate(() => window.dispatchEvent(new Event("online")));

  await page.goto(server.resolvedUrls!.local[0]);
  const image = page.getByRole("img", { name: "Test composite", exact: true });
  await expect(image).toHaveAttribute("src", /published-1/);
  state.outputs[0].jobId = "published-2";
  state.outputs[0].publishedAt = "2026-10-01T01:02:00Z";
  job.message = "Publishing composite";
  job.stage = "publishing";
  await expect(image).toHaveAttribute("src", /published-2/, { timeout: 10000 });

  await nav("Sources").click();
  const card = page.locator("article").filter({
    has: page.getByRole("heading", { name: "Test satellite", exact: true }),
  });
  await card.getByRole("button", { name: "Configure", exact: true }).click();
  const sourceDialog = page.getByRole("dialog", { name: "Configure source" });
  await sourceDialog
    .getByLabel("Name", { exact: true })
    .fill("Unsaved source name");
  state.sources[0].validation = {
    at: "2026-10-01T01:00:00Z",
    compatible: true,
    message: "Validated source",
  };
  await reconnect();
  await expect(card.getByText("Validated", { exact: true })).toBeVisible();
  await expect(sourceDialog.getByLabel("Name", { exact: true })).toHaveValue(
    "Unsaved source name",
  );
  await sourceDialog
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await sourceDialog
    .getByRole("button", { name: "Discard changes", exact: true })
    .click();
  await expect(sourceDialog).toHaveCount(0);
  state.testingSourceIds = [source.id];
  await reconnect();
  await expect(card.getByText("Testing", { exact: true })).toBeVisible();
  state.testingSourceIds = [];
  await reconnect();
  await expect(card.getByText("Testing", { exact: true })).toHaveCount(0);

  await nav("Jobs").click();
  await page.getByRole("button", { name: "View logs", exact: true }).click();
  const logDialog = page.getByRole("dialog", { name: "Job logs", exact: true });
  await expect(logDialog.locator("pre")).toHaveText(job.logs);
  await logDialog.getByLabel("Follow output").uncheck();
  await logDialog.locator("pre").evaluate((element) => {
    element.scrollTop = 0;
  });
  job.logs += "\nNew output arrived";
  await expect(logDialog.locator("pre")).toHaveText(job.logs, {
    timeout: 10000,
  });
  expect(
    await logDialog.locator("pre").evaluate((element) => element.scrollTop),
  ).toBe(0);
  await expect(
    logDialog.getByText("Publishing composite", { exact: true }),
  ).toBeVisible();
  holdNextLog = true;
  await reconnect();
  await expect.poll(() => !!delayedLog).toBe(true);
  await logDialog.getByRole("button", { name: "Close", exact: true }).click();
  await delayedLog!();
  await expect(logDialog).toHaveCount(0);
  const closedRequests = logRequests;
  await reconnect();
  await page.waitForTimeout(200);
  expect(logRequests).toBe(closedRequests);

  stateFailure = 503;
  await reconnect();
  await expect(page.getByText("Reconnecting", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Publishing composite", { exact: true }),
  ).toBeVisible();
  stateFailure = 0;
  const previousRequests = stateRequests;
  await reconnect();
  await expect.poll(() => stateRequests).toBeGreaterThan(previousRequests);
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByText(/Connection interrupted/)).toHaveCount(0);
  job.status = "succeeded";
  job.finishedAt = "2026-10-01T01:02:00Z";
  job.message = "Published complete composite";
  await expect(
    page.getByText("Published complete composite", { exact: true }),
  ).toBeVisible({ timeout: 10000 });

  await nav("Files").click();
  await page.getByLabel("Search files").fill("composite");
  await page.getByLabel("File category").selectOption("outputs");
  files.files.push({
    folder: "outputs",
    name: "second.jpg",
    label: "Second composite",
    bytes: 4096,
    modifiedAt: "2026-10-01T01:02:00Z",
  });
  await expect(page.getByText("Second composite", { exact: true })).toBeVisible(
    { timeout: 10000 },
  );
  await expect(page.getByLabel("Search files")).toHaveValue("composite");
  await expect(page.getByLabel("File category")).toHaveValue("outputs");
  await page
    .getByRole("button", { name: "Delete Second composite", exact: true })
    .click();
  const deleteDialog = page.getByRole("dialog", {
    name: "Delete file",
    exact: true,
  });
  await deleteDialog
    .getByRole("button", { name: "Delete file", exact: true })
    .click();
  await expect(deleteDialog.getByRole("alert")).toHaveText(
    "File is temporarily in use",
  );
  deleteFailure = false;
  await deleteDialog
    .getByRole("button", { name: "Delete file", exact: true })
    .click();
  await expect(deleteDialog).toHaveCount(0);
  await expect(page.getByText("Second composite", { exact: true })).toHaveCount(
    0,
  );

  await nav("Settings").click();
  const interval = page.getByLabel("Composition interval (minutes)", {
    exact: true,
  });
  await interval.fill("15");
  state.settings.pollMinutes = 12;
  await reconnect();
  await expect(interval).toHaveValue("15");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await expect.poll(() => state.settings.pollMinutes).toBe(15);
  state.settings.pollMinutes = 20;
  await reconnect();
  await expect(interval).toHaveValue("20");
  await page.goBack();
  await expect(
    page.getByRole("heading", { name: "Files", exact: true }),
  ).toBeVisible();

  authenticated = false;
  stateFailure = 401;
  await reconnect();
  await expect(
    page.getByRole("heading", { name: "Your view of Earth.", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Password", { exact: true }).fill("fixture-password");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Files", exact: true }),
  ).toBeVisible();
  expect(documentLoads).toBe(1);
  expect(errors).toEqual([]);
  console.log(
    "Auto-refresh passed: images, source validation/testing, jobs, live logs, retained scroll, close races, file updates/deletion, draft preservation, recovery, history, and session expiry without page reload.",
  );
} finally {
  await browser.close();
  await server.close();
}
