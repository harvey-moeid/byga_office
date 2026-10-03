import { test, expect } from "@playwright/test";
import { defaultConfig } from "../src/core/contracts";
// UI contract fixtures are explicitly local tests; production data still comes from D1.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        path.endsWith("/auth/session")
          ? { admin: false }
          : path.endsWith("/office/state")
            ? { office: "MONITORING", active: null, scanners: [] }
            : path.endsWith("/market/status")
              ? {
                  development: true,
                  price: 60000,
                  tickSize: 0.01,
                  candle_timestamp: Date.now() - 300000,
                  timeframes: { H1: [], M15: [], M5: [] },
                }
              : path.endsWith("/signals")
                ? { items: [], total: 0, page: 1 }
                : [],
      ),
    });
  });
});
test("operations, scanner navigation, admin login and mobile layout remain usable without WebGL", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/office");
  await expect(
    page.getByRole("heading", { name: "Trading Office", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Lingkungan pengembangan lokal", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Trend Analyst", { exact: true })).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Scanners" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scanners", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Admin" })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("3D scene loads separately and WebGL failure preserves operations", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/office");
  await expect(
    page.getByRole("heading", { name: "Trading Office", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Operations", exact: true }).click();
  await expect(page.getByText("Head Trader", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
test("offline banner reconnects and refreshes office state automatically", async ({
  page,
  context,
}) => {
  let hits = 0;
  let office = "MONITORING";
  await page.route("**/api/v1/office/state", (route) => {
    hits++;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ office, active: null, scanners: [] }),
    });
  });
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/office");
  await expect(page.getByText("Trend Analyst", { exact: true })).toBeVisible();
  await expect.poll(() => hits).toBeGreaterThan(0);
  await context.setOffline(true);
  await expect(page.getByRole("status")).toContainText("Offline");
  const before = hits;
  office = "WATCHING";
  await context.setOffline(false);
  await expect(page.locator(".connection-banner")).toHaveCount(0);
  await expect.poll(() => hits).toBeGreaterThan(before);
  await expect(
    page.getByText("WATCHING", { exact: true }).first(),
  ).toBeVisible();
});
test("signal scanner filter updates query and stays usable at narrow widths", async ({
  page,
}) => {
  let scanner = "";
  await page.route("**/api/v1/signals?*", (route) => {
    scanner = new URL(route.request().url()).searchParams.get("scanner") ?? "";
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ items: [], total: 0, page: 1 }),
    });
  });
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/signals");
  await page
    .getByRole("combobox", { name: "scanner", exact: true })
    .selectOption("trend");
  await expect.poll(() => scanner).toBe("trend");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("WebGL context loss switches to operations while preserving the case view", async ({
  page,
}) => {
  await page.goto("/office");
  await expect(
    page.getByRole("heading", { name: "Trading Office", exact: true }),
  ).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event("byga:webgl-lost")));
  await expect(page.getByText("Head Trader", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Trend Analyst/ }).click();
  await expect(page.getByRole("link", { name: /Lihat Detail/ })).toBeVisible();
});
test("Admin reviews ambiguous deliveries with explicit confirmation and no resend button", async ({
  page,
}) => {
  let reviewed = false;
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ admin: true }),
    }),
  );
  await page.route("**/api/v1/admin/config", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        config: defaultConfig,
        id: "TRADING-CONFIG-v1",
        versions: [],
      }),
    }),
  );
  await page.route("**/api/v1/admin/deliveries", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify([
        {
          key: "fixture-delivery",
          kind: "SIGNAL",
          status: reviewed ? "SENT" : "UNKNOWN",
          attempts: 1,
          last_error: reviewed ? "" : "Ambiguous delivery",
        },
      ]),
    }),
  );
  await page.route("**/api/v1/admin/deliveries/review", (route) => {
    expect(route.request().postDataJSON()).toEqual({
      key: "fixture-delivery",
      action: "MARK_SENT",
      confirmed: true,
    });
    reviewed = true;
    return route.fulfill({
      contentType: "application/json",
      body: '{"ok":true}',
    });
  });
  await page.goto("/admin");
  await page.getByRole("button", { name: "Usage", exact: true }).click();
  await expect(page.getByText("UNKNOWN", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Kirim ulang", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Tandai terkirim", exact: true })
    .click();
  expect(reviewed).toBe(false);
  await page.getByRole("button", { name: "Konfirmasi", exact: true }).click();
  await expect(page.getByText("SENT", { exact: true })).toBeVisible();
});
test("3D renderer mounts rooms and reset controls when WebGL is available", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/office");
  const supported = await page.evaluate(() => {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    if (gl) gl.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  });
  test.skip(
    !supported,
    "System Chromium does not expose WebGL2; fallback is covered separately",
  );
  await expect(page.getByRole("button", { name: /Reset View/ })).toBeVisible();
  await expect(page.getByText("War Room", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Reset View/ }).click();
  await page.screenshot({
    path: `/tmp/byga-scene-${testInfo.project.name}.png`,
    fullPage: true,
  });
  const lost = await page.locator(".office-scene canvas").evaluate((canvas) => {
    const gl = (canvas as HTMLCanvasElement).getContext("webgl2");
    const extension = gl?.getExtension("WEBGL_lose_context");
    extension?.loseContext();
    return !!extension;
  });
  expect(lost).toBe(true);
  await expect(page.getByText("Head Trader", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
