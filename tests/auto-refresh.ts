import { chromium, expect } from "@playwright/test";
import { createServer } from "vite";

const server = await createServer({ server: { port: 0 } });
await server.listen();
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  let message = "Acquiring imagery";
  let logs = "First log line";
  let stateRequests = 0;
  let logRequests = 0;
  const job = () => ({
    id: "test",
    profileName: "Test composite",
    status: "running",
    message,
    logs,
  });
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname === "/api/auth")
      body = { required: false, authenticated: true };
    else if (url.pathname === "/api/state") {
      stateRequests++;
      body = {
        sources: [],
        profiles: [],
        settings: { pollMinutes: 10, logDays: 7 },
        jobs: [job()],
        outputs: [],
        underlays: [],
      };
    } else if (url.pathname === "/api/jobs/test") {
      logRequests++;
      body = job();
    } else body = { files: [], locked: false };
    await route.fulfill({ json: body });
  });
  await page.goto(server.resolvedUrls!.local[0]);
  await page.getByRole("button", { name: "Jobs", exact: true }).click();
  await page.getByRole("button", { name: "Logs", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Job logs" });
  await expect(dialog.locator("pre")).toHaveText("First log line");
  logs = "New output arrived";
  await expect(dialog.locator("pre")).toHaveText(logs, { timeout: 10000 });
  const before = stateRequests;
  message = "Publishing composite";
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await expect.poll(() => stateRequests).toBeGreaterThan(before);
  await expect(dialog.getByText(message, { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Close", exact: true }).click();
  const closedRequests = logRequests;
  await page.waitForTimeout(4500);
  expect(logRequests).toBe(closedRequests);
  await expect(dialog).toHaveCount(0);
  console.log(
    "Auto-refresh passed: live logs, reconnect refresh, and cleanup on close.",
  );
} finally {
  await browser.close();
  await server.close();
}
