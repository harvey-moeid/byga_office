import { test, expect, type Page } from "@playwright/test";
test.beforeEach(async ({ request, page }) => {
  await request.post("http://127.0.0.1:8788/__test/reset");
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
});
async function browserGet(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: "same-origin" });
    return {
      status: response.status,
      body: (await response.json()) as unknown,
    };
  }, path);
}
async function login(page: Page) {
  await page.goto("/admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-fixture-password");
  await page.getByRole("button", { name: "Login →", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save new version", exact: true }),
  ).toBeVisible();
}
test("real auth, versioned config, scanner mutation and logout agree with the UI", async ({
  page,
}) => {
  await login(page);
  const previous = (await browserGet(page, "/api/v1/admin/config").then(
    (r) => r.body,
  )) as { id: string };
  await page.getByLabel("minRR", { exact: true }).fill("2");
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Tersimpan: TRADING-CONFIG-",
  );
  const current = (await browserGet(page, "/api/v1/admin/config").then(
    (r) => r.body,
  )) as { id: string; config: { minRR: number } };
  expect(current.id).not.toBe(previous.id);
  expect(current.config.minRR).toBe(2);
  await page.reload();
  await expect(page.getByLabel("minRR", { exact: true })).toHaveValue("2");
  expect((await browserGet(page, "/api/v1/admin/scan")).status).toBe(405);
  await page.getByRole("button", { name: "Emergency", exact: true }).click();
  await page
    .getByRole("button", { name: "Run scanner check", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("Scan diminta");
  const state = (await (
    await page.request.get("/api/v1/office/state")
  ).json()) as { scanners: unknown[]; observed_at: number };
  expect(state.scanners.length).toBeGreaterThan(0);
  expect(state.observed_at).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect((await browserGet(page, "/api/v1/admin/config")).status).toBe(401);
});
test("real private summaries and meeting prices obey Public Signals OFF and ON", async ({
  page,
  browser,
}) => {
  await page.goto("/cases/CASE-private-fixture");
  await expect(
    page.getByText("Detail analisis dirahasiakan karena Public Signals OFF.", {
      exact: true,
    }),
  ).toBeVisible();
  const privateMeeting = (await (
    await page.request.get("/api/v1/office/meeting")
  ).json()) as {
    meeting: {
      prices_private: boolean;
      turns: { analysis: { price_levels: unknown } }[];
    };
  };
  expect(privateMeeting.meeting.prices_private).toBe(true);
  expect(privateMeeting.meeting.turns[0].analysis.price_levels).toBeNull();
  await login(page);
  await page.goto("/cases/CASE-private-fixture");
  await expect(
    page.getByText("Fixture entry 96.78 and target 104.08", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin");
  await page.getByLabel("publicSignals", { exact: true }).check();
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Tersimpan");
  const guest = await browser.newContext({ baseURL: "http://127.0.0.1:5175" }),
    publicPage = await guest.newPage();
  try {
    await publicPage.goto("/cases/CASE-private-fixture");
    await expect(
      publicPage.getByText("Fixture entry 96.78 and target 104.08", {
        exact: true,
      }),
    ).toBeVisible();
    const meeting = (await (
      await publicPage.request.get("/api/v1/office/meeting")
    ).json()) as {
      meeting: {
        prices_private: boolean;
        turns: { analysis: { price_levels: { entry: number } } }[];
      };
    };
    expect(meeting.meeting.prices_private).toBe(false);
    expect(meeting.meeting.turns[0].analysis.price_levels.entry).toBe(96.78);
  } finally {
    await guest.close();
  }
});
test("APPLY NOW replaces a queued case atomically and a rejected quota preserves both config and case", async ({
  page,
  request,
}) => {
  await login(page);
  await page.getByRole("button", { name: "Emergency", exact: true }).click();
  await page
    .getByRole("button", { name: "CALL EMERGENCY MEETING", exact: true })
    .click();
  await expect(page).toHaveURL(/\/cases\/CASE-\d/);
  const oldId = page.url().split("/").at(-1);
  await page.goto("/admin");
  await page.getByLabel("minRR", { exact: true }).fill("2");
  await page
    .getByRole("combobox", { name: "Activation", exact: true })
    .selectOption("APPLY NOW");
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Case pengganti: CASE-");
  const current = (await browserGet(page, "/api/v1/admin/config")).body as {
    id: string;
    config: { budgets: Record<string, number> };
  };
  let stats = (await (
    await request.get("http://127.0.0.1:8788/__test/stats")
  ).json()) as {
    cases: { id: string; status: string }[];
    outboundCalls: number;
  };
  expect(stats.cases.find((c) => c.id === oldId)?.status).toBe(
    "CONFIG_CHANGED",
  );
  const replacement = stats.cases.find((c) => c.status === "QUEUED");
  expect(replacement).toBeDefined();
  await page
    .getByText("Scanner, context, dan budget settings", { exact: true })
    .click();
  await page
    .getByLabel("budgets", { exact: true })
    .fill(JSON.stringify({ ...current.config.budgets, casesPerDay: 1 }));
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Daily AI case budget reached",
  );
  expect(
    ((await browserGet(page, "/api/v1/admin/config")).body as { id: string })
      .id,
  ).toBe(current.id);
  stats = (await (
    await request.get("http://127.0.0.1:8788/__test/stats")
  ).json()) as typeof stats;
  expect(stats.cases.find((c) => c.id === replacement?.id)?.status).toBe(
    "QUEUED",
  );
  expect(stats.cases).toHaveLength(3);
  expect(stats.outboundCalls).toBe(0);
});
for (const kind of ["emergency", "simulation", "config"] as const) {
  test(`real ${kind} commits once across response loss, expired retry and reauthentication`, async ({
    page,
    request,
  }) => {
    await login(page);
    const posts: Record<string, unknown>[] = [];
    await page.route(`**/api/v1/admin/${kind}`, async (route) => {
      if (route.request().method() !== "POST") {
        await route.continue();
        return;
      }
      posts.push(route.request().postDataJSON() as Record<string, unknown>);
      const headers = route.request().headers();
      if (posts.length === 2) {
        // Expire the session precisely when the retry is sent, after the
        // reloaded UI finished authenticating. The Worker receives no cookie.
        await page.context().clearCookies();
        delete headers.cookie;
      }
      const response = await route.fetch({ headers });
      if (posts.length === 2) {
        expect(response.status()).toBe(401);
        await route.fulfill({ response });
        return;
      }
      expect(response.ok()).toBe(true);
      if (posts.length === 1) await route.abort("connectionreset");
      else await route.fulfill({ response });
    });
    if (kind === "emergency")
      await page
        .getByRole("button", { name: "Emergency", exact: true })
        .click();
    if (kind === "simulation") {
      await page.goto("/simulation");
      const wib = new Date(Date.now() - 60000 + 7 * 3600000)
        .toISOString()
        .slice(0, 16);
      await page.getByLabel("Historical cutoff", { exact: false }).fill(wib);
    }
    await page
      .getByRole("button", {
        name:
          kind === "emergency"
            ? "CALL EMERGENCY MEETING"
            : kind === "simulation"
              ? "Run simulation"
              : "Save new version",
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
    await page
      .getByRole("button", { name: "Coba ulang permintaan", exact: true })
      .click();
    await expect.poll(() => posts.length).toBe(2);
    await expect(
      page.getByRole("link", { name: "Admin terhubung", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(
        (kind) => JSON.parse(sessionStorage.getItem(`byga:intent:${kind}`)!),
        kind,
      ),
    ).toMatchObject({ key: posts[0].idempotencyKey });
    await login(page);
    if (kind === "emergency")
      await page
        .getByRole("button", { name: "Emergency", exact: true })
        .click();
    else if (kind === "simulation") await page.goto("/simulation");
    await page
      .getByRole("button", { name: "Coba ulang permintaan", exact: true })
      .click();
    if (kind === "config")
      await expect(page.getByRole("status")).toContainText("Tersimpan");
    else
      await expect(page).toHaveURL(
        new RegExp(`/${kind === "simulation" ? "simulation" : "cases"}/CASE-`),
      );
    expect(posts).toHaveLength(3);
    expect(posts[1]).toEqual(posts[0]);
    expect(posts[2]).toEqual(posts[0]);
    const stats = (await (
      await request.get("http://127.0.0.1:8788/__test/stats")
    ).json()) as {
      cases: { idempotency_key: string; mode: string }[];
      simulations: unknown[];
      operations: { key: string }[];
      outboundCalls: number;
    };
    if (kind === "config")
      expect(
        stats.operations.filter(
          (op) => op.key === `config:${posts[0].idempotencyKey}`,
        ),
      ).toHaveLength(1);
    else
      expect(
        stats.cases.filter(
          (c) => c.idempotency_key === `${kind}:${posts[0].idempotencyKey}`,
        ),
      ).toHaveLength(1);
    if (kind === "simulation") {
      expect(stats.simulations).toHaveLength(1);
      const history = (await browserGet(
        page,
        "/api/v1/admin/simulation/history",
      ).then((r) => r.body)) as { id: string }[];
      expect(history).toHaveLength(1);
      expect(page.url()).toContain(history[0].id);
    }
    expect(stats.outboundCalls).toBe(0);
  });
}
