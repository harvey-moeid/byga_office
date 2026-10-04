import { test, expect, type Page } from "@playwright/test";
import type { MeetingSnapshot } from "../src/core/meeting";
import {
  defaultConfig,
  defaultCharacters,
  workersAIModel,
} from "../src/core/contracts";
test("Admin and Simulation modules load only when their routes are opened", async ({
  page,
}) => {
  const modules: string[] = [];
  page.on("request", (request) =>
    modules.push(new URL(request.url()).pathname),
  );
  await page.goto("/signals");
  await expect(
    page.getByRole("heading", { name: "Signals", exact: true }),
  ).toBeVisible();
  expect(modules.some((path) => path.endsWith("/src/ui/admin.tsx"))).toBe(
    false,
  );
  expect(modules.some((path) => path.endsWith("/src/ui/simulation.tsx"))).toBe(
    false,
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /Admin$/ })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect(modules.some((path) => path.endsWith("/src/ui/admin.tsx"))).toBe(true);
  expect(modules.some((path) => path.endsWith("/src/ui/simulation.tsx"))).toBe(
    false,
  );
  await page
    .getByRole("navigation")
    .getByRole("link", { name: /Simulation$/ })
    .click();
  await expect(
    page.getByRole("heading", { name: "Simulation", exact: true }),
  ).toBeVisible();
  expect(modules.some((path) => path.endsWith("/src/ui/simulation.tsx"))).toBe(
    true,
  );
});
test("APPLY NOW cancels on dismissal and sends confirmed changes only on acceptance", async ({
  page,
}) => {
  let posts = 0;
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { admin: true } }),
  );
  await page.route("**/api/v1/admin/config", (route) => {
    if (route.request().method() === "POST") {
      posts++;
      expect(route.request().postDataJSON()).toMatchObject({
        activation: "APPLY NOW",
        confirmed: true,
      });
      return route.fulfill({ json: { id: "TRADING-CONFIG-v2" } });
    }
    return route.fulfill({
      json: { config: defaultConfig, id: "TRADING-CONFIG-v1", versions: [] },
    });
  });
  await page.goto("/admin");
  await page
    .getByRole("combobox", { name: "Activation", exact: true })
    .selectOption("APPLY NOW");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  expect(posts).toBe(0);
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Tersimpan: TRADING-CONFIG-v2",
  );
  expect(posts).toBe(1);
});
test("case and character provider metadata are visible only in Admin views", async ({
  page,
}) => {
  let admin = false;
  const analyst = {
    id: "trend",
    status: "SUCCESS",
    vote: "BUY",
    summary: "Fixture analysis",
    provider: "fixture-provider",
    model: "fixture-model",
    output: { vote: "BUY", summary: "Fixture analysis" },
  };
  const caseData = {
    id: "CASE-fixture",
    status: "COMPLETED",
    direction: "BUY",
    created_at: Date.now(),
    analysts: [analyst],
  };
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { admin } }),
  );
  await page.route(
    /\/api\/v1\/(?:admin\/)?cases\/CASE-fixture(?:\/public)?(?:\?.*)?$/,
    (route) => route.fulfill({ json: caseData }),
  );
  await page.route("**/api/v1/characters/trend", (route) =>
    route.fulfill({
      json: [{ ...analyst, case_id: "CASE-fixture", updated_at: Date.now() }],
    }),
  );
  await page.goto("/cases/CASE-fixture");
  await expect(
    page.getByText("Fixture analysis", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Provider fixture-provider · Model fixture-model", {
      exact: true,
    }),
  ).toHaveCount(0);
  await page.goto("/characters/trend");
  await expect(
    page.getByText("Fixture analysis", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Provider fixture-provider · Model fixture-model", {
      exact: true,
    }),
  ).toHaveCount(0);
  admin = true;
  await page.goto("/characters/trend");
  await expect(
    page.getByText("Provider fixture-provider · Model fixture-model", {
      exact: true,
    }),
  ).toBeVisible();
  await page.goto("/cases/CASE-fixture");
  await expect(
    page.getByText("Provider fixture-provider · Model fixture-model", {
      exact: true,
    }),
  ).toBeVisible();
});
test("Admin saves scanner minimum and Operations shows the stored threshold", async ({
  page,
}) => {
  let config = { ...defaultConfig };
  let version = 1;
  await page.route("**/api/v1/auth/session", (route) =>
    route.fulfill({ json: { admin: true } }),
  );
  await page.route("**/api/v1/admin/config", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      expect(body.activation).toBe("NEXT CASE");
      expect(body.config.scannerConsensusMin).toBe(4);
      config = body.config;
      version++;
      return route.fulfill({ json: { id: `TRADING-CONFIG-v${version}` } });
    }
    return route.fulfill({
      json: { config, id: `TRADING-CONFIG-v${version}`, versions: [] },
    });
  });
  await page.route("**/api/v1/office/state", (route) =>
    route.fulfill({
      json: {
        office: "MONITORING",
        active: null,
        scanners: [],
        scanner_consensus_min: config.scannerConsensusMin,
      },
    }),
  );
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/admin");
  const minimum = page.getByRole("combobox", {
    name: "Minimal Scanner Consensus",
  });
  await expect(minimum).toHaveValue("2");
  await expect(minimum.locator("option")).toHaveCount(6);
  await minimum.selectOption("4");
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Tersimpan: TRADING-CONFIG-v2",
  );
  await page.reload();
  await expect(minimum).toHaveValue("4");
  await page.goto("/operations");
  await expect(
    page.getByText("Minimal 4 · majority unik", { exact: true }),
  ).toBeVisible();
});
test("Admin selects Workers AI for primary and fallback and persists model IDs", async ({
  page,
}) => {
  let characters = defaultCharacters();
  await page.route("**/api/v1/auth/session", (r) =>
    r.fulfill({ json: { admin: true } }),
  );
  await page.route("**/api/v1/admin/characters", (route) => {
    if (route.request().method() === "POST") {
      const updated = route.request().postDataJSON();
      expect(updated).toMatchObject({
        primary_provider: "workers-ai",
        fallback_provider: "workers-ai",
        primary_model: workersAIModel,
        fallback_model: workersAIModel,
      });
      characters = characters.map((c) => (c.id === updated.id ? updated : c));
      return route.fulfill({ json: { ok: true } });
    }
    return route.fulfill({ json: characters });
  });
  await page.route("**/api/v1/admin/models", (route) => {
    expect(route.request().postDataJSON().id).toBe("workers-ai");
    return route.fulfill({ json: { models: [workersAIModel] } });
  });
  await page.goto("/admin");
  await page
    .getByRole("button", { name: "AI Characters", exact: true })
    .click();
  for (const role of ["primary", "fallback"]) {
    await page
      .getByLabel(`${role}_provider`, { exact: true })
      .selectOption({ label: "Cloudflare Workers AI" });
    await expect(page.getByLabel(`${role}_model`, { exact: true })).toHaveValue(
      workersAIModel,
    );
    await page
      .getByRole("button", { name: `Discover ${role} models`, exact: true })
      .click();
    await expect(page.locator(`#${role}_model-options option`)).toHaveCount(1);
  }
  await page
    .getByRole("button", { name: "Save character & prompt", exact: true })
    .click();
  await expect(
    page.getByText("Karakter tersimpan dengan prompt version baru.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "AI Characters", exact: true })
    .click();
  await expect(
    page.getByLabel("primary_provider", { exact: true }),
  ).toHaveValue("workers-ai");
  await expect(
    page.getByLabel("fallback_provider", { exact: true }),
  ).toHaveValue("workers-ai");
});
// UI contract fixtures are explicitly local tests; production data still comes from D1.
test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(
        path.endsWith("/auth/session")
          ? { admin: false }
          : path.endsWith("/characters")
            ? [
                { id: "trend", avatar: "emerald" },
                { id: "structure", avatar: "navy" },
                { id: "momentum", avatar: "gold" },
                { id: "liquidity", avatar: "plum" },
              ]
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
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("button", { name: /Sholat/ })).toHaveCount(0);
  await expect(page.locator(".metrics")).toHaveCount(0);
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Home", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Menu", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Operations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Scanner Command Center" }),
  ).toBeVisible();
  await expect(page.locator(".metrics")).toBeVisible();
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
  await expect(page.locator(".connection-banner")).toContainText("Offline");
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
  // Software WebGL on CI also renders three camera views, captures the scene,
  // and verifies native context-loss recovery within this single test.
  test.setTimeout(60_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
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
  const scene = await page.locator(".office-scene").boundingBox();
  const viewport = page.viewportSize()!;
  expect(scene?.x).toBe(0);
  expect(scene?.y).toBe(0);
  expect(scene?.width).toBe(viewport.width);
  expect(scene?.height).toBe(viewport.height);
  await expect(page.locator(".metrics, .two-columns, footer")).toHaveCount(0);
  await expect(page.getByText("Musolla", { exact: true })).toHaveCount(0);
  await expect(page.getByText("War Room", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Area analis", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Area analis", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Ruang meeting", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Ruang meeting", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Reset View/ }).click();
  await expect(
    page.getByRole("button", { name: "Seluruh kantor", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
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

async function fixtureMeeting(page: Page, enabled: () => boolean = () => true) {
  const snapshot: MeetingSnapshot = {
    case_id: "CASE-meeting-fixture",
    status: "COMPLETED",
    finished: true,
    cancelled: false,
    turns: (["trend", "risk", "boss"] as const).map((character) => ({
      character,
      analysis: {
        vote: "BUY",
        confidence: 74,
        summary: `Fixture ${character}: ringkasan hasil AI tersimpan. Kalimat kedua. Kalimat ketiga hanya di detail.`,
        reasoning: `Fixture ${character}: penjelasan lengkap dari case ini.`,
        evidence: [],
        risk_flags: [],
        price_levels: null,
      },
    })),
    unavailable: [],
  };
  await page.route("**/api/v1/office/meeting", (route) =>
    route.fulfill({ json: { meeting: enabled() ? snapshot : null } }),
  );
  return snapshot;
}
test("meeting dialogue rotates actual case results, opens details, admits Boss last and closes on mobile", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.clock.install();
  await fixtureMeeting(page);
  await page.goto("/");
  await expect(
    page.getByText("Tim menuju ruang meeting", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(15000);
  const trend = page.getByRole("button", {
    name: "Baca percakapan Trend Analyst",
    exact: true,
  });
  await expect(trend).toBeVisible();
  await expect(page.locator(".meeting-bubble")).toHaveCount(1);
  await expect(trend).not.toContainText("Kalimat ketiga");
  await trend.click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Kalimat ketiga hanya di detail.");
  await expect(dialog).toContainText("Fixture trend: penjelasan lengkap");
  await page.clock.fastForward(30000);
  await expect(dialog).toContainText("Trend Analyst");
  const bounds = await dialog.boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Baca percakapan Risk Manager",
      exact: true,
    }),
  ).toBeVisible();
  await page.clock.fastForward(7500);
  await expect(
    page.getByText("Bos masuk untuk menutup meeting", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".meeting-bubble")).toHaveCount(0);
  await page.clock.fastForward(8500);
  const boss = page.getByRole("button", {
    name: "Baca percakapan Head Trader",
    exact: true,
  });
  await expect(boss).toContainText("Keputusan akhir");
  await expect(page.locator(".meeting-bubble")).toHaveCount(1);
  await page.screenshot({
    path: testInfo.outputPath("meeting-boss-fallback.png"),
  });
  await page.clock.fastForward(7500);
  await expect(
    page.getByText("Meeting ditutup · kembali ke meja", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".meeting-bubble")).toHaveCount(0);
  await page.clock.fastForward(8500);
  await expect(page.locator(".meeting-status")).toHaveCount(0);
});
test("3D speech follows the seated character and opens the actual result detail", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Detailed 3D speech acceptance runs once; mobile meeting/layout coverage is separate.",
  );
  test.setTimeout(120000);
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Probe WebGL before navigation. The meeting itself is enabled only after
  // the 3D renderer is ready, so production walking/timing stays realistic.
  const supported = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2");
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
    return !!gl;
  });
  test.skip(
    !supported,
    "WebGL unavailable; meeting fallback is tested separately",
  );
  let meetingEnabled = false;
  await fixtureMeeting(page, () => meetingEnabled);
  await page.goto("/");
  await expect(page.getByRole("button", { name: /Reset View/ })).toBeVisible();
  meetingEnabled = true;
  const bubble = page.getByRole("button", {
    name: "Baca percakapan Trend Analyst",
    exact: true,
  });
  await expect(bubble).toBeVisible({ timeout: 60000 });
  // Open the finite-lived speech immediately. The modal intentionally pauses
  // presentation, making the remaining assertions deterministic on slow CI.
  await bubble.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Fixture trend: penjelasan lengkap",
  );
  await expect(page.locator(".meeting-bubble")).toHaveCount(1);
  await expect(
    page.getByRole("button", { name: "Ruang meeting", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page
    .getByRole("button", { name: "Tutup percakapan", exact: true })
    .click();
  const boss = page.getByRole("button", {
    name: "Baca percakapan Head Trader",
    exact: true,
  });
  await expect(boss).toBeVisible({ timeout: 60000 });
  await boss.click();
  await expect(page.getByRole("dialog")).toContainText(
    "Fixture boss: penjelasan lengkap",
  );
  await page.screenshot({ path: testInfo.outputPath("meeting-boss-3d.png") });
  expect(errors).toEqual([]);
});
