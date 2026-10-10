import { test, expect, type Page, type Route } from "@playwright/test";
import {
  defaultConfig,
  defaultCharacters,
  providers,
} from "../src/core/contracts";

async function fixture(
  page: Page,
  override: (route: Route, path: string) => Promise<boolean> = async () =>
    false,
) {
  await page.addInitScript(() => {
    class TestEventSource extends EventTarget {
      static instances: TestEventSource[] = [];
      closed = false;
      constructor(_url: string) {
        super();
        TestEventSource.instances.push(this);
      }
      close() {
        this.closed = true;
      }
    }
    Object.assign(window, { EventSource: TestEventSource });
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (await override(route, path)) return;
    const json =
      path === "/auth/session"
        ? { admin: true }
        : path === "/admin/config"
          ? { id: "TRADING-CONFIG-v1", config: defaultConfig, versions: [] }
          : path === "/office/state"
            ? { office: "MONITORING", scanners: [], active: null, error: null }
            : path === "/office/meeting"
              ? { meeting: null }
              : path === "/market/status"
                ? {
                    price: 100,
                    tickSize: 0.01,
                    timeframes: { H1: [], M15: [], M5: [] },
                  }
                : path === "/admin/characters"
                  ? defaultCharacters()
                  : path === "/characters"
                    ? defaultCharacters().map(({ id, avatar }) => ({
                        id,
                        avatar,
                      }))
                    : path === "/admin/providers"
                      ? providers.map((id) => ({
                          id,
                          state: "CLOSED",
                          failures: 0,
                          policy: {
                            retries: 1,
                            jitter: true,
                            threshold: 3,
                            cooldownMs: 60000,
                          },
                        }))
                      : path === "/admin/health"
                        ? {
                            configured: providers.map((id) => ({
                              id,
                              configured: true,
                            })),
                          }
                        : /\/(cases|simulation)\//.test(path)
                          ? {
                              id: path.split("/").at(-1),
                              status: "QUEUED",
                              created_at: Date.now(),
                              events: [],
                              analysts: [],
                            }
                          : [];
    await route.fulfill({ json });
  });
}

test("new polling snapshots replace stale SSE, stream failure exposes polling errors", async ({
  page,
}) => {
  let office = "MONITORING",
    stamp = 1,
    fail = false,
    hits = 0;
  await fixture(page, async (route, path) => {
    if (path !== "/office/state") return false;
    hits++;
    await route.fulfill({
      status: fail ? 503 : 200,
      json: fail
        ? { error: "POLL_UNAVAILABLE" }
        : {
            office,
            observed_at: stamp,
            scanners: [],
            active: null,
            error: null,
          },
    });
    return true;
  });
  await page.clock.install();
  await page.goto("/operations");
  await expect(page.locator(".metrics")).toContainText("MONITORING");
  await page.evaluate(() => {
    const source = (
      EventSource as unknown as {
        instances: (EventTarget & { closed: boolean })[];
      }
    ).instances
      .filter((s) => !s.closed)
      .at(-1)!;
    source.dispatchEvent(
      new MessageEvent("office", {
        data: JSON.stringify({
          office: "WATCHING",
          observed_at: 2,
          scanners: [],
          active: null,
          error: null,
        }),
      }),
    );
  });
  await expect(page.locator(".metrics")).toContainText("WATCHING");
  office = "BOSS_REVIEW";
  stamp = 3;
  const before = hits;
  await page.clock.fastForward(5500);
  await expect.poll(() => hits).toBeGreaterThan(before);
  await expect(page.locator(".metrics")).toContainText("BOSS REVIEW");
  fail = true;
  await page.evaluate(() => {
    const source = (
      EventSource as unknown as {
        instances: (EventTarget & { closed: boolean })[];
      }
    ).instances
      .filter((s) => !s.closed)
      .at(-1)!;
    source.dispatchEvent(new Event("error"));
  });
  await page.clock.fastForward(5500);
  await expect(page.getByRole("alert")).toContainText("POLL_UNAVAILABLE");
});

for (const kind of ["emergency", "simulation"] as const) {
  test(`${kind} retries preserve the exact operation after response loss and reload`, async ({
    page,
  }) => {
    const posts: Record<string, unknown>[] = [];
    await fixture(page, async (route, path) => {
      if (path !== `/admin/${kind}`) return false;
      posts.push(route.request().postDataJSON() as Record<string, unknown>);
      if (posts.length === 1) await route.abort("connectionreset");
      else if (posts.length === 2)
        await route.fulfill({
          status: 400,
          json: { error: "Retry rejected; earlier result remains unknown" },
        });
      else await route.fulfill({ status: 202, json: { id: "CASE-sync" } });
      return true;
    });
    await page.goto(kind === "simulation" ? "/simulation" : "/admin");
    if (kind === "emergency") {
      await page
        .getByRole("button", { name: "Emergency", exact: true })
        .click();
      await page.getByLabel("Send to Discord", { exact: true }).check();
    } else
      await page
        .getByLabel("Historical cutoff", { exact: false })
        .fill("2026-10-09T10:00");
    await page
      .getByRole("button", {
        name:
          kind === "emergency" ? "CALL EMERGENCY MEETING" : "Run simulation",
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("button", { name: "Coba ulang permintaan", exact: true }),
    ).toBeVisible();
    await page.reload();
    if (kind === "emergency")
      await page
        .getByRole("button", { name: "Emergency", exact: true })
        .click();
    await expect(
      page.getByRole("button", {
        name:
          kind === "emergency" ? "CALL EMERGENCY MEETING" : "Run simulation",
        exact: true,
      }),
    ).toBeDisabled();
    await page
      .getByRole("button", { name: "Coba ulang permintaan", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Retry rejected; earlier result remains unknown",
    );
    expect(
      await page.evaluate(
        (kind) => JSON.parse(sessionStorage.getItem(`byga:intent:${kind}`)!),
        kind,
      ),
    ).toMatchObject({ key: posts[0].idempotencyKey });
    await page
      .getByRole("button", { name: "Coba ulang permintaan", exact: true })
      .click();
    await expect(page).toHaveURL(
      new RegExp(
        `/${kind === "emergency" ? "cases" : "simulation"}/CASE-sync$`,
      ),
    );
    expect(posts).toHaveLength(3);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[2]).toEqual(posts[0]);
    expect(posts[0].idempotencyKey).toEqual(expect.any(String));
    expect(
      await page.evaluate(
        (kind) => sessionStorage.getItem(`byga:intent:${kind}`),
        kind,
      ),
    ).toBeNull();
  });
}

test("JSON refresh matches the visible draft, invalid edits block Save and conflicts preserve input", async ({
  page,
}) => {
  let config = structuredClone(defaultConfig),
    version = "TRADING-CONFIG-v1",
    gets = 0;
  const posts: Record<string, unknown>[] = [];
  await fixture(page, async (route, path) => {
    if (path !== "/admin/config") return false;
    if (route.request().method() === "POST") {
      posts.push(route.request().postDataJSON() as Record<string, unknown>);
      await route.fulfill({ json: { id: version, replacement_case_id: null } });
    } else {
      gets++;
      await route.fulfill({ json: { id: version, config, versions: [] } });
    }
    return true;
  });
  await page.goto("/admin");
  await page
    .getByText("Scanner, context, dan budget settings", { exact: true })
    .click();
  const context = page.getByLabel("context", { exact: true }),
    save = page.getByRole("button", { name: "Save new version", exact: true });
  await expect(context).toHaveValue(JSON.stringify(config.context, null, 2));
  config = { ...config, context: { ...config.context, maxChars: 70000 } };
  version = "TRADING-CONFIG-v2";
  let before = gets;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => gets).toBeGreaterThan(before);
  await expect(context).toHaveValue(JSON.stringify(config.context, null, 2));
  await context.fill("{");
  await expect(save).toBeDisabled();
  expect(posts).toHaveLength(0);
  config = { ...config, context: { ...config.context, maxChars: 80000 } };
  version = "TRADING-CONFIG-v3";
  before = gets;
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect.poll(() => gets).toBeGreaterThan(before);
  await expect(page.getByRole("alert")).toContainText("Draft belum ditimpa");
  await expect(context).toHaveValue("{");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Gunakan versi terbaru", exact: true })
    .click();
  await expect(context).toHaveValue(JSON.stringify(config.context, null, 2));
  await expect(save).toBeEnabled();
  await save.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]).toMatchObject({
    config,
    expectedVersion: version,
    idempotencyKey: expect.any(String),
  });
});

test("config Save locks concurrent submissions and reuses a committed request after response loss", async ({
  page,
}) => {
  const posts: Record<string, unknown>[] = [];
  let release: (() => void) | undefined;
  const held = new Promise<void>((r) => {
    release = r;
  });
  await fixture(page, async (route, path) => {
    if (path !== "/admin/config" || route.request().method() !== "POST")
      return false;
    posts.push(route.request().postDataJSON() as Record<string, unknown>);
    if (posts.length === 1) {
      await held;
      await route.abort("connectionreset");
    } else if (posts.length === 2)
      await route.fulfill({
        status: 409,
        json: { error: "Retry conflict; earlier result remains unknown" },
      });
    else
      await route.fulfill({
        json: {
          id: "TRADING-CONFIG-v2",
          replacement_case_id: "CASE-replacement",
        },
      });
    return true;
  });
  await page.goto("/admin");
  await page
    .getByRole("combobox", { name: "Activation", exact: true })
    .selectOption("APPLY NOW");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(
    page.getByRole("button", { name: "Menyimpan…", exact: true }),
  ).toBeDisabled();
  await expect(page.getByLabel("minRR", { exact: true })).toBeDisabled();
  release!();
  await expect(
    page.getByRole("button", { name: "Coba ulang permintaan", exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole("button", { name: "Coba ulang permintaan", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({
      hasText: "Retry conflict; earlier result remains unknown",
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.parse(sessionStorage.getItem("byga:intent:config")!),
    ),
  ).toMatchObject({ key: posts[0].idempotencyKey });
  await page
    .getByRole("button", { name: "Coba ulang permintaan", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Case pengganti: CASE-replacement",
  );
  expect(posts).toHaveLength(3);
  expect(posts[1]).toEqual(posts[0]);
  expect(posts[2]).toEqual(posts[0]);
});

test("401 clears private cases and invalidates the shared Admin session", async ({
  page,
}) => {
  let expired = false,
    hits = 0;
  await fixture(page, async (route, path) => {
    if (path === "/auth/session") {
      await route.fulfill({ json: { admin: !expired } });
      return true;
    }
    if (path !== "/admin/cases") return false;
    hits++;
    await route.fulfill({
      status: expired ? 401 : 200,
      json: expired
        ? { error: "Admin authentication required" }
        : [
            {
              id: "CASE-private-sync",
              status: "COMPLETED",
              direction: "BUY",
              created_at: Date.now(),
            },
          ],
    });
    return true;
  });
  await page.clock.install();
  await page.goto("/cases");
  await expect(
    page.getByText("CASE-private-sync", { exact: true }),
  ).toBeVisible();
  expired = true;
  const before = hits;
  await page.clock.fastForward(5500);
  await expect.poll(() => hits).toBeGreaterThan(before);
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(
    page.getByText("CASE-private-sync", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Admin terhubung", exact: true }),
  ).toHaveCount(0);
});

test("session expiration closes already-open private meeting details", async ({
  page,
}) => {
  let admin = true;
  await fixture(page, async (route, path) => {
    if (path === "/auth/session") {
      await route.fulfill({ json: { admin } });
      return true;
    }
    if (path !== "/office/meeting") return false;
    await route.fulfill({
      json: {
        meeting: {
          case_id: "CASE-private-meeting",
          status: "COMPLETED",
          finished: true,
          cancelled: false,
          prices_private: !admin,
          unavailable: [],
          turns: [
            {
              character: "risk",
              analysis: {
                vote: "BUY",
                confidence: 75,
                summary: admin ? "Private risk summary" : "Detail dirahasiakan",
                reasoning: admin
                  ? "Private risk reasoning"
                  : "Detail dirahasiakan",
                evidence: [],
                risk_flags: [],
                price_levels: admin
                  ? { entry: 96.78, stop_loss: 95.77, take_profit: 104.08 }
                  : null,
              },
            },
          ],
        },
      },
    });
    return true;
  });
  await page.clock.install();
  await page.goto("/");
  await expect(
    page.getByText("Tim menuju ruang meeting", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(15000);
  const bubble = page
    .locator(".meeting-bubble")
    .filter({ hasText: "Risk Manager" });
  await expect(bubble).toBeVisible();
  await bubble.dispatchEvent("click");
  await expect(page.getByRole("dialog")).toContainText(
    "Private risk reasoning",
  );
  admin = false;
  await page.evaluate(() =>
    window.dispatchEvent(new Event("byga:auth-expired")),
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Private risk reasoning", { exact: true }),
  ).toHaveCount(0);
});

test("character dialog traps keyboard focus, Escape closes and restores the opener", async ({
  page,
}) => {
  await fixture(page);
  await page.goto("/operations");
  const opener = page
    .locator(".operations-grid")
    .getByRole("button", { name: /Trend Analyst/ });
  await opener.click();
  await expect(
    page.getByRole("dialog", { name: "Trend Analyst", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tutup", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Tab");
  expect(
    await page.evaluate(() => !!document.activeElement?.closest("dialog")),
  ).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(opener).toBeFocused();
});

test("320px Admin navigation remains reachable within its scroll container", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await fixture(page);
  await page.goto("/admin");
  const admin = page
    .getByRole("navigation")
    .getByRole("link", { name: /Admin$/ });
  await admin.focus();
  const bounds = await admin.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(321); // Chromium rounds scroll offsets to whole pixels.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(
    320,
  );
});

test("failed state and health checks show UNKNOWN and logout failure has actionable feedback", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await fixture(page, async (route, path) => {
    if (!["/office/state", "/admin/health", "/auth/logout"].includes(path))
      return false;
    await route.fulfill({
      status: 503,
      json: { error: "SERVICE_UNAVAILABLE" },
    });
    return true;
  });
  await page.goto("/characters");
  await expect(
    page.locator(".character-grid").getByText("UNKNOWN", { exact: true }),
  ).toHaveCount(10);
  await expect(page.getByRole("alert")).toContainText("SERVICE_UNAVAILABLE");
  await page.goto("/admin");
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("SERVICE_UNAVAILABLE");
  await expect(
    page.getByText("Configuration unknown", { exact: true }),
  ).toHaveCount(providers.length);
  await expect(page.getByText("Secret missing", { exact: true })).toHaveCount(
    0,
  );
  await expect(
    page.getByText("AI binding missing", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page.getByRole("alert").first()).toContainText(
    "Logout belum terkonfirmasi",
  );
  expect(errors).toEqual([]);
});
