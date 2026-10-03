import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";
import type { useAutoRefresh } from "../src/useAutoRefresh";
import type { api } from "../src/api";

type Request = {
  key: string;
  aborted: boolean;
  resolve: (value: string) => void;
  reject: (error: Error) => void;
};
declare global {
  interface Window {
    refreshTest: {
      requests: Request[];
      history: { key: string; data?: string }[];
      resource: ReturnType<typeof useAutoRefresh<string>>;
      setKey: (key: string) => void;
      setEnabled: (enabled: boolean) => void;
      unmount: () => void;
      finished: boolean;
      api: typeof api;
      pendingApi?: {
        signal: AbortSignal;
        resolve: (response: Response) => void;
      };
      apiResult?: unknown;
    };
  }
}

const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { useAutoRefresh } from '/src/useAutoRefresh.ts';
import { api } from '/src/api.ts';
const root = createRoot(document.getElementById('root'));
window.refreshTest = {requests: [], history: [], finished: false, api, unmount: () => root.unmount()};
function Harness() {
  const [key, setKey] = useState('first');
  const [enabled, setEnabled] = useState(true);
  const resource = useAutoRefresh(key, signal => new Promise((resolve, reject) => {
    const request = {key, resolve, reject, aborted: signal.aborted};
    signal.addEventListener('abort', () => { request.aborted = true; });
    window.refreshTest.requests.push(request);
  }), enabled);
  Object.assign(window.refreshTest, {resource, setKey, setEnabled});
  window.refreshTest.history.push({key, data: resource.data});
  return React.createElement('div', null,
    React.createElement('p', {id: 'data'}, resource.data ?? 'empty'),
    React.createElement('p', {id: 'connection'}, resource.connection),
    React.createElement('p', {id: 'error'}, resource.error?.message ?? ''),
  );
}
root.render(React.createElement(Harness));
`;

const server = await createServer({
  server: { port: 0 },
  plugins: [
    {
      name: "refresh-hook-harness",
      resolveId(id) {
        if (id === "/__refresh-harness.js") return "\0refresh-hook-harness";
      },
      load(id) {
        if (id === "\0refresh-hook-harness") return harness;
      },
      configureServer(instance) {
        instance.middlewares.use((req, res, next) => {
          if (req.url !== "/__refresh-test") return next();
          res.setHeader("Content-Type", "text/html");
          res.end(
            '<!doctype html><html><body><div id="root"></div><script type="module" src="/__refresh-harness.js"></script></body></html>',
          );
        });
      },
    },
  ],
});
await server.listen();
const browser = await chromium.launch({ headless: true });
const errors: string[] = [];
const freshPage = async () => {
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install({ time: new Date("2026-10-03T00:00:00Z") });
  await page.clock.pauseAt(new Date("2026-10-03T00:00:01Z"));
  await page.goto(server.resolvedUrls!.local[0] + "__refresh-test");
  await expect
    .poll(() => page.evaluate(() => window.refreshTest?.requests.length))
    .toBe(1);
  return page;
};
const count = (page: Page, expected: number) =>
  expect
    .poll(() => page.evaluate(() => window.refreshTest.requests.length))
    .toBe(expected);

try {
  const races = await freshPage();
  await races.evaluate(() => {
    const { resource } = window.refreshTest;
    void Promise.all([
      resource.refresh(),
      resource.refresh(),
      resource.refresh(),
    ]).then(() => {
      window.refreshTest.finished = true;
    });
  });
  await count(races, 2);
  expect(
    await races.evaluate(() => window.refreshTest.requests[0].aborted),
  ).toBe(true);
  await races.evaluate(() =>
    window.refreshTest.requests[1].resolve("fresh mutation result"),
  );
  await expect(races.locator("#data")).toHaveText("fresh mutation result");
  await expect
    .poll(() => races.evaluate(() => window.refreshTest.finished))
    .toBe(true);
  await races.evaluate(() =>
    window.refreshTest.requests[0].resolve("stale result"),
  );
  await expect(races.locator("#data")).toHaveText("fresh mutation result");
  await races.clock.runFor(3999);
  await count(races, 2);
  await races.clock.runFor(1);
  await count(races, 3);
  await races.close();

  const identity = await freshPage();
  await identity.evaluate(() =>
    window.refreshTest.requests[0].resolve("first value"),
  );
  await expect(identity.locator("#data")).toHaveText("first value");
  await identity.evaluate(() => window.refreshTest.setKey("second"));
  await count(identity, 2);
  await expect(identity.locator("#data")).toHaveText("empty");
  await identity.evaluate(() => window.refreshTest.setKey("third"));
  await count(identity, 3);
  expect(
    await identity.evaluate(() => window.refreshTest.requests[1].aborted),
  ).toBe(true);
  await identity.evaluate(() => {
    window.refreshTest.requests[1].resolve("second value");
    window.refreshTest.requests[2].resolve("third value");
  });
  await expect(identity.locator("#data")).toHaveText("third value");
  expect(
    await identity.evaluate(() =>
      window.refreshTest.history.some(
        (entry) => entry.key !== "first" && entry.data === "first value",
      ),
    ),
  ).toBe(false);
  await identity.evaluate(() => void window.refreshTest.resource.refresh());
  await count(identity, 4);
  await identity.evaluate(() => window.refreshTest.setEnabled(false));
  await expect(identity.locator("#data")).toHaveText("empty");
  expect(
    await identity.evaluate(() => window.refreshTest.requests[3].aborted),
  ).toBe(true);
  await identity.clock.runFor(20000);
  await count(identity, 4);
  await identity.evaluate(() => window.refreshTest.setEnabled(true));
  await count(identity, 5);
  await identity.evaluate(() => window.refreshTest.unmount());
  expect(
    await identity.evaluate(() => window.refreshTest.requests[4].aborted),
  ).toBe(true);
  await identity.clock.runFor(20000);
  await count(identity, 5);
  await identity.close();

  const stalled = await freshPage();
  await stalled.clock.runFor(15000);
  await expect(stalled.locator("#connection")).toHaveText("reconnecting");
  await expect(stalled.locator("#error")).toContainText("15 seconds");
  expect(
    await stalled.evaluate(() => window.refreshTest.requests[0].aborted),
  ).toBe(true);
  await stalled.clock.runFor(4000);
  await count(stalled, 2);
  await stalled.evaluate(() =>
    window.refreshTest.requests[1].resolve("recovered"),
  );
  await expect(stalled.locator("#data")).toHaveText("recovered");
  await expect(stalled.locator("#connection")).toHaveText("live");
  await expect(stalled.locator("#error")).toBeEmpty();
  expect(
    await stalled.evaluate(() => window.refreshTest.resource.lastUpdated),
  ).toBeGreaterThan(0);
  await stalled.evaluate(() =>
    window.refreshTest.requests[0].resolve("late timeout result"),
  );
  await expect(stalled.locator("#data")).toHaveText("recovered");
  await stalled.evaluate(() => void window.refreshTest.resource.refresh());
  await count(stalled, 3);
  await stalled.evaluate(() =>
    window.refreshTest.requests[2].reject(new Error("Temporarily unavailable")),
  );
  await expect(stalled.locator("#connection")).toHaveText("reconnecting");
  await expect(stalled.locator("#data")).toHaveText("recovered");
  await stalled.close();

  const visibility = await freshPage();
  await visibility.evaluate(() =>
    window.refreshTest.requests[0].resolve("visible data"),
  );
  await expect(visibility.locator("#data")).toHaveText("visible data");
  await visibility.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await visibility.clock.runFor(20000);
  await count(visibility, 1);
  await visibility.evaluate(() => {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await count(visibility, 2);
  await visibility.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    window.dispatchEvent(new Event("offline"));
  });
  await expect(visibility.locator("#connection")).toHaveText("offline");
  await expect(visibility.locator("#data")).toHaveText("visible data");
  await visibility.clock.runFor(20000);
  await count(visibility, 2);
  await visibility.evaluate(() => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: true,
    });
    window.dispatchEvent(new Event("online"));
  });
  await count(visibility, 3);
  await visibility.evaluate(() =>
    window.refreshTest.requests[2].resolve("online again"),
  );
  await expect(visibility.locator("#connection")).toHaveText("live");
  await expect(visibility.locator("#error")).toBeEmpty();
  await visibility.evaluate(() => window.dispatchEvent(new Event("focus")));
  await count(visibility, 4);
  await visibility.close();

  const client = await freshPage();
  await client.evaluate(() => window.refreshTest.unmount());
  await client.route("**/api/unauthorized", (route) =>
    route.fulfill({
      status: 401,
      contentType: "text/plain",
      body: "Sign in again",
    }),
  );
  expect(
    await client.evaluate(async () => {
      try {
        await window.refreshTest.api("/unauthorized");
      } catch (error) {
        const e = error as Error & { status: number };
        return { name: e.name, status: e.status, message: e.message };
      }
    }),
  ).toEqual({ name: "ApiError", status: 401, message: "Sign in again" });
  await client.route("**/api/html", (route) =>
    route.fulfill({
      status: 502,
      contentType: "text/html",
      body: "<html>Bad gateway</html>",
    }),
  );
  expect(
    await client.evaluate(async () => {
      try {
        await window.refreshTest.api("/html");
      } catch (error) {
        return (error as Error & { status: number }).status;
      }
    }),
  ).toBe(502);
  await client.evaluate(() => {
    window.fetch = (_input, options) =>
      new Promise<Response>((resolve, reject) => {
        const signal = options!.signal!;
        window.refreshTest.pendingApi = { signal, resolve };
        signal.addEventListener("abort", () => reject(signal.reason), {
          once: true,
        });
      });
    void window.refreshTest.api("/slow-mutation", "POST", {}).then((value) => {
      window.refreshTest.apiResult = value;
    });
  });
  await client.clock.runFor(20000);
  expect(
    await client.evaluate(() => window.refreshTest.pendingApi!.signal.aborted),
  ).toBe(false);
  await client.evaluate(() =>
    window.refreshTest.pendingApi!.resolve(new Response('{"ok":true}')),
  );
  await expect
    .poll(() => client.evaluate(() => window.refreshTest.apiResult))
    .toEqual({ ok: true });
  await client.evaluate(() => {
    window.refreshTest.apiResult = undefined;
    void window.refreshTest.api("/slow-read").catch((error: Error) => {
      window.refreshTest.apiResult = error.message;
    });
  });
  await client.clock.runFor(15000);
  expect(
    await client.evaluate(() => window.refreshTest.pendingApi!.signal.aborted),
  ).toBe(true);
  await expect
    .poll(() => client.evaluate(() => window.refreshTest.apiResult))
    .toContain("15 seconds");
  await client.close();

  expect(errors).toEqual([]);
  console.log(
    "Refresh hook passed: mutation races, coalescing, resource identity, timeout recovery, visibility, reconnect, abort cleanup, and API errors.",
  );
} finally {
  await browser.close();
  await server.close();
}
