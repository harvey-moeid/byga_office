import { test, expect, type Page, type Route } from "@playwright/test";
import { defaultConfig, providers } from "../src/core/contracts";
import type { CredentialInventory } from "../src/core/credentials";

async function fixture(
  page: Page,
  override: (route: Route, path: string) => Promise<boolean>,
) {
  await page.addInitScript(() => {
    class QuietEvents extends EventTarget {
      close() {}
    }
    Object.assign(window, { EventSource: QuietEvents });
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.route("**/api/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname.replace("/api/v1", "");
    if (await override(route, path)) return;
    await route.fulfill({
      json:
        path === "/auth/session"
          ? { admin: true }
          : path === "/admin/config"
            ? { id: "TRADING-CONFIG-v1", config: defaultConfig, versions: [] }
            : path === "/admin/health"
              ? {
                  configured: providers.map((id) => ({
                    id,
                    configured: false,
                  })),
                }
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
                : path === "/office/state"
                  ? { office: "MONITORING", scanners: [], active: null }
                  : path === "/office/meeting"
                    ? { meeting: null }
                    : [],
    });
  });
}
function inventory(version: string | null, ready = true): CredentialInventory {
  return {
    storage_ready: ready,
    items: providers.map((id) => ({
      id,
      configured: id === "openrouter" && !!version,
      source: id === "openrouter" && version ? "UI" : "MISSING",
      version: id === "openrouter" ? version : null,
      updated_at: null,
    })),
  };
}
async function open(page: Page) {
  await page.goto("/admin");
  await page.getByRole("button", { name: "Providers", exact: true }).click();
}

test("lost save response clears the key, refreshes committed status and never retries a stored secret", async ({
  page,
}) => {
  let version: string | null = null,
    writes = 0;
  await fixture(page, async (route, path) => {
    if (path !== "/admin/credentials") return false;
    if (route.request().method() === "POST") {
      writes++;
      expect(route.request().postDataJSON()).toMatchObject({
        id: "openrouter",
        action: "SAVE",
        key: "fixture-only-lost-response-key",
        expectedVersion: null,
      });
      version = "11111111-1111-4111-8111-111111111111";
      await route.abort("failed");
    } else await route.fulfill({ json: inventory(version) });
    return true;
  });
  await open(page);
  const input = page.getByLabel("API key baru", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill("fixture-only-lost-response-key");
  await page
    .getByRole("button", { name: "Simpan API key", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await expect(
    page.getByText(/Permintaan belum dapat dipastikan/),
  ).toBeVisible();
  await expect(page.getByLabel("Status API key")).toContainText(
    "Key tersimpan dari Admin",
  );
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("fixture-only-lost-response-key");
  await page.reload();
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Ganti API key", exact: true }),
  ).toBeDisabled();
  expect(writes).toBe(1);
});

test("conflicts never reflect secret errors and provider changes or session expiration clear drafts", async ({
  page,
}) => {
  let version: string | null = null;
  const key = "fixture-only-conflicting-key";
  await fixture(page, async (route, path) => {
    if (path !== "/admin/credentials") return false;
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON().expectedVersion).toBeNull();
      version = "22222222-2222-4222-8222-222222222222";
      await route.fulfill({
        status: 409,
        json: { error: key, code: "CREDENTIAL_CONFLICT" },
      });
    } else await route.fulfill({ json: inventory(version) });
    return true;
  });
  await open(page);
  const input = page.getByLabel("API key baru", { exact: true });
  await expect(input).toBeEnabled();
  await input.fill(key);
  version = "22222222-2222-4222-8222-222222222222";
  await page.evaluate(() =>
    document.dispatchEvent(new Event("visibilitychange")),
  );
  await expect(page.getByLabel("Status API key")).toContainText(
    "Key tersimpan dari Admin",
  );
  await page
    .getByRole("button", { name: "Ganti API key", exact: true })
    .click();
  await expect(
    page.getByText(/Key sudah berubah\. Status dimuat ulang/),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(key);
  await input.fill("fixture-only-unsaved-draft");
  await page.getByLabel("Tampilkan key yang sedang diketik").check();
  await expect(input).toHaveAttribute("type", "text");
  await page
    .getByLabel("Provider API key", { exact: true })
    .selectOption("gemini");
  await expect(input).toHaveValue("");
  await expect(input).toHaveAttribute("type", "password");
  await expect(
    page.getByLabel("Provider API key", { exact: true }).locator("option"),
  ).toHaveCount(8);
  await input.fill("fixture-only-expired-draft");
  await page.evaluate(() =>
    window.dispatchEvent(new Event("byga:auth-expired")),
  );
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(input).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    ),
  ).not.toContain("fixture-only");
});

test("missing encryption root disables secret input and the form fits a narrow screen", async ({
  page,
}) => {
  let writes = 0;
  await fixture(page, async (route, path) => {
    if (path !== "/admin/credentials") return false;
    if (route.request().method() === "POST") writes++;
    await route.fulfill({ json: inventory(null, false) });
    return true;
  });
  await page.setViewportSize({ width: 320, height: 740 });
  await open(page);
  await expect(
    page.getByText(/Administrator server perlu menyiapkan enkripsi/),
  ).toBeVisible();
  await expect(page.getByLabel("API key baru", { exact: true })).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Simpan API key", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(writes).toBe(0);
});
