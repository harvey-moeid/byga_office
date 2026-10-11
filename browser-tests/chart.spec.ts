import { expect, test, type Page } from "@playwright/test";
import { candleDuration, type ChartResponse } from "../src/core/chart";
import {
  defaultCharacters,
  formatWib,
  type Timeframe,
} from "../src/core/contracts";

const base = Math.floor(Date.now() / 300000) * 300000 - 600000;
function snapshot(timeframe: Timeframe, count = 500): ChartResponse {
  return {
    market: "BTCUSDT.P",
    timeframe,
    candles: Array.from({ length: count }, (_, i) => {
      const close = 60000 + Math.sin(i / 8) * 120 + i;
      return {
        timestamp: base - (count - i - 1) * candleDuration[timeframe],
        open: close - 10,
        high: close + 20,
        low: close - 20,
        close,
        volume: 20 + (i % 30),
      };
    }),
    latest_timestamp: count ? base : null,
    observed_at: Date.now(),
    status: count ? "OK" : "EMPTY",
    has_more: false,
    gap_count: 0,
    tickSize: 0.01,
    development: false,
  };
}
async function session(page: Page) {
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { admin: false } }),
  );
}
test("Chart loads only on navigation, renders candles and volume and fits narrow screens", async ({
  page,
}, testInfo) => {
  await session(page);
  const paths: string[] = [],
    errors: string[] = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/v1/market/candles?*", (route) => {
    const tf = new URL(route.request().url()).searchParams.get(
      "timeframe",
    ) as Timeframe;
    return route.fulfill({ json: snapshot(tf) });
  });
  await page.goto("/characters");
  await expect(
    page.getByRole("heading", { name: "AI Team", exact: true }),
  ).toBeVisible();
  expect(
    paths.some(
      (path) =>
        path.endsWith("/src/ui/chart.tsx") ||
        path.includes("lightweight-charts"),
    ),
  ).toBe(false);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /Chart$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Chart", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chart-caption")).toContainText("500 candle");
  await expect(page.locator(".chart-canvas canvas").first()).toBeVisible();
  expect(paths.some((path) => path.endsWith("/src/ui/chart.tsx"))).toBe(true);
  expect(paths.some((path) => path.endsWith("/src/ui/scene.tsx"))).toBe(false);
  await page.getByRole("button", { name: "M15", exact: true }).click();
  await expect(page).toHaveURL(/timeframe=M15/);
  await expect(
    page.getByRole("button", { name: "M15", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-caption")).toContainText("500 candle");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "M15", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".chart-canvas canvas").first()).toBeVisible();
  await page.getByRole("button", { name: "H1", exact: true }).click();
  await expect(page.locator(".chart-caption")).toContainText("500 candle");
  await page
    .getByRole("button", { name: "Ke candle terbaru", exact: true })
    .click();
  await page.screenshot({
    path: testInfo.outputPath("chart.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await expect(page.locator(".chart-canvas canvas").first()).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
});
test("incremental polling stops when hidden, offline or unmounted and resumes with the cursor", async ({
  page,
  context,
}) => {
  await session(page);
  await page.clock.install();
  const requests: URL[] = [];
  let sentDelta = false;
  const data = snapshot("M5");
  const next = {
    ...data.candles.at(-1)!,
    timestamp: base + 300000,
    close: 60620,
    high: 60640,
    low: 60400,
    open: 60480,
  };
  await page.route("**/api/v1/market/candles?*", (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    const delta = url.searchParams.has("after");
    const candles = delta ? (sentDelta ? [] : [next]) : data.candles;
    if (delta) sentDelta = true;
    return route.fulfill({
      json: {
        ...data,
        candles,
        latest_timestamp: delta ? next.timestamp : base,
      },
    });
  });
  await page.goto("/chart");
  await expect(page.locator(".chart-caption")).toContainText("500 candle");
  // Development StrictMode deliberately mounts effects twice; discard aborted initial requests.
  const initialRequests = requests.length;
  await page.clock.fastForward(30000);
  await expect(page.locator(".chart-caption")).toContainText("501 candle");
  expect(requests.at(-1)!.searchParams.get("after")).toBe(String(base));
  await page.clock.fastForward(30000);
  await expect.poll(() => requests.length).toBe(initialRequests + 2);
  expect(requests.at(-1)!.searchParams.get("after")).toBe(
    String(next.timestamp),
  );
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(90000);
  expect(requests).toHaveLength(initialRequests + 2);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => requests.length).toBe(initialRequests + 3);
  await context.setOffline(true);
  await expect(page.getByRole("alert")).toContainText("Koneksi terputus");
  await page.clock.fastForward(90000);
  expect(requests).toHaveLength(initialRequests + 3);
  await context.setOffline(false);
  await expect.poll(() => requests.length).toBe(initialRequests + 4);
  await expect(page.getByRole("alert")).toHaveCount(0);
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /AI Team$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "AI Team", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chart-canvas")).toHaveCount(0);
  const count = requests.length;
  await page.clock.fastForward(90000);
  expect(requests).toHaveLength(count);
});
test("failures retain the chart with UNKNOWN status and retry; stale and empty histories are explicit", async ({
  page,
}) => {
  await session(page);
  await page.clock.install();
  let mode: "ok" | "fail" | "stale" | "empty" = "ok";
  await page.route("**/api/v1/market/candles?*", (route) => {
    if (mode === "fail")
      return route.fulfill({
        status: 503,
        json: { error: "Fixture chart unavailable" },
      });
    const tf = new URL(route.request().url()).searchParams.get(
      "timeframe",
    ) as Timeframe;
    const data = snapshot(tf, mode === "empty" ? 0 : 500);
    if (mode === "stale") data.status = "STALE";
    return route.fulfill({ json: data });
  });
  await page.goto("/chart");
  await expect(page.locator(".chart-caption")).toContainText("500 candle");
  mode = "fail";
  await page.clock.fastForward(30000);
  await expect(page.getByRole("alert")).toContainText(
    "Fixture chart unavailable",
  );
  await expect(page.locator(".chart-summary")).toContainText("UNKNOWN");
  await expect(page.locator(".chart-canvas canvas").first()).toBeVisible();
  mode = "ok";
  await page.getByRole("button", { name: "Coba lagi", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveCount(0);
  mode = "stale";
  await page.getByRole("button", { name: "M15", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Data candle terlambat");
  mode = "empty";
  await page.getByRole("button", { name: "H1", exact: true }).click();
  await expect(
    page.getByText("Belum ada candle H1 yang tersedia.", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".chart-canvas")).toHaveCount(0);
});
test("switching from Office 3D to Chart unmounts the renderer and office polling", async ({
  page,
}) => {
  await session(page);
  await page.clock.install();
  // Keep the real router and lifetime effects while removing GPU timing from this lifecycle test.
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      contextId: string,
      options?: unknown,
    ) {
      if (contextId === "webgl2" || contextId === "webgl")
        return { getExtension: () => null };
      return original.call(this, contextId, options);
    } as typeof original;
  });
  await page.route("**/src/ui/scene.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: 'import React from "/node_modules/.vite/deps/react.js"; export default function OfficeScene() { React.useEffect(() => { window.__sceneActive = true; return () => { window.__sceneActive = false; }; }, []); return React.createElement("div", {"data-testid": "office-scene-fixture"}, "Office renderer"); }',
    }),
  );
  await page.route("**/api/v1/office/events", (route) =>
    route.fulfill({ status: 503, body: "" }),
  );
  let officeHits = 0;
  await page.route("**/api/v1/office/state", (route) => {
    officeHits++;
    return route.fulfill({
      json: {
        office: "IDLE",
        active: null,
        scanners: [],
        error: null,
        observed_at: Date.now(),
      },
    });
  });
  await page.route("**/api/v1/office/meeting*", (route) =>
    route.fulfill({ json: { meeting: null } }),
  );
  await page.route("**/api/v1/characters", (route) =>
    route.fulfill({ json: defaultCharacters }),
  );
  await page.route("**/api/v1/health", (route) =>
    route.fulfill({ json: { api: "OK", chart_db: "OK" } }),
  );
  await page.route("**/api/v1/market/status", (route) =>
    route.fulfill({
      json: {
        price: 60000,
        tickSize: 0.01,
        candle_timestamp: base,
        timeframes: { M5: [], M15: [], H1: [] },
      },
    }),
  );
  await page.route("**/api/v1/market/candles?*", (route) =>
    route.fulfill({ json: snapshot("M5") }),
  );
  await page.goto("/");
  await expect(page.getByTestId("office-scene-fixture")).toBeVisible();
  await page.getByRole("button", { name: /^Menu/ }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /Chart$/ })
    .click();
  await expect(page.locator(".chart-caption")).toContainText("500 candle");
  await expect(page.getByTestId("office-scene-fixture")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { __sceneActive: boolean }).__sceneActive,
    ),
  ).toBe(false);
  const hits = officeHits;
  await page.clock.fastForward(60000);
  expect(officeHits).toBe(hits);
});
test("a large backlog resumes with one recent snapshot and resets a discarded viewport", async ({
  page,
}) => {
  await session(page);
  await page.clock.install();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const fresh = snapshot("M5");
  const old = {
    ...fresh,
    candles: fresh.candles.map((candle) => ({
      ...candle,
      timestamp: candle.timestamp - 4000 * 300000,
    })),
    latest_timestamp: base - 4000 * 300000,
    status: "STALE" as const,
  };
  let initial = true;
  let deltaCalls = 0;
  await page.route("**/api/v1/market/candles?*", (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("after");
    if (cursor) {
      deltaCalls++;
      initial = false;
      return route.fulfill({ json: { ...fresh, candles: [], has_more: true } });
    }
    return route.fulfill({ json: initial ? old : fresh });
  });
  await page.goto("/chart");
  await expect(page.locator(".chart-caption")).toContainText(
    formatWib(old.latest_timestamp),
  );
  await page.clock.fastForward(30000);
  await expect.poll(() => deltaCalls).toBe(1);
  await page.clock.fastForward(150);
  await expect(page.locator(".chart-caption")).toContainText(formatWib(base));
  await expect(page.locator(".chart-caption")).toContainText("500 candle");
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.locator(".chart-canvas canvas").first()).toBeVisible();
  expect(errors).toEqual([]);
});
