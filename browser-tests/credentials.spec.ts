import { test, expect, type Page, type Route } from "@playwright/test";
import { defaultConfig, formatWib, providers } from "../src/core/contracts";
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

test("rotation and deletion use committed inventory while older reads finish late", async ({
  page,
}) => {
  const firstVersion = "11111111-1111-4111-8111-111111111111";
  const nextVersion = "22222222-2222-4222-8222-222222222222";
  let version: string | null = firstVersion;
  const updatedAt = 1_791_721_500_000;
  const snapshot = () => {
    const result = inventory(version);
    result.items.find((item) => item.id === "openrouter")!.updated_at =
      version === nextVersion ? updatedAt : null;
    return result;
  };
  let delayedRead: { arrived: () => void; gate: Promise<void> } | undefined;
  const writes: string[] = [];
  await fixture(page, async (route, path) => {
    if (path !== "/admin/credentials") return false;
    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON();
      expect(payload.expectedVersion).toBe(version);
      writes.push(payload.action);
      version = payload.action === "SAVE" ? nextVersion : null;
      await route.fulfill({ json: snapshot() });
    } else {
      const result = snapshot();
      const delay = delayedRead;
      if (delay) {
        delay.arrived();
        await delay.gate;
      }
      await route.fulfill({ json: result });
    }
    return true;
  });
  await open(page);
  const status = page.getByLabel("Status API key");
  const input = page.getByLabel("API key baru", { exact: true });
  await expect(input).toBeEnabled();
  await expect(status).toHaveText("Key tersimpan dari Admin");

  const holdRead = async () => {
    let arrived!: () => void;
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      arrived = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    delayedRead = { arrived, gate };
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/admin/credentials") &&
        response.request().method() === "GET",
    );
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    await started;
    return async () => {
      delayedRead = undefined;
      release();
      await (await response).finished();
    };
  };
  const finishOldInventory = await holdRead();
  await input.fill("fixture-only-rotated-key");
  await page
    .getByRole("button", { name: "Ganti API key", exact: true })
    .click();
  const rotatedStatus = `Key tersimpan dari Admin · Diperbarui ${formatWib(updatedAt)}`;
  await expect(status).toHaveText(rotatedStatus);
  await finishOldInventory();
  await expect(status).toHaveText(rotatedStatus);

  const finishStoredInventory = await holdRead();
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Hapus key dari UI", exact: true })
    .click();
  await expect(status).toHaveText("Belum ada API key");
  await finishStoredInventory();
  await expect(status).toHaveText("Belum ada API key");
  await expect(
    page.getByRole("button", { name: "Hapus key dari UI", exact: true }),
  ).toBeDisabled();
  expect(writes).toEqual(["SAVE", "DELETE"]);
});

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
