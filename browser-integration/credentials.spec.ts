import { test, expect, type Page } from "@playwright/test";
import type { CredentialInventory } from "../src/core/credentials";

async function readKeys(page: Page) {
  return page.evaluate(async () => {
    const response = await fetch("/api/v1/admin/credentials", {
      credentials: "same-origin",
    });
    return { status: response.status, text: await response.text() };
  });
}

test("Admin saves, replaces and deletes encrypted API keys through the real Worker without inference or browser persistence", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:8788/__test/reset");
  const key = "fixture-only-browser-provider-key";
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  expect((await page.request.get("/api/v1/admin/credentials")).status()).toBe(
    401,
  );
  await page.goto("/admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-fixture-password");
  await page.getByRole("button", { name: "Login →", exact: true }).click();
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  const input = page.getByLabel("API key baru", { exact: true });
  await expect(input).toBeEnabled();
  await expect(input).toHaveAttribute("type", "password");
  await input.fill(key);
  await page
    .getByRole("button", { name: "Simpan API key", exact: true })
    .click();
  await expect(
    page.getByText(
      "API key tersimpan. Gunakan Test connection untuk memeriksa akses provider.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(input).toHaveValue("");
  await expect(page.getByLabel("Status API key")).toContainText(
    "Key tersimpan dari Admin",
  );
  const result = await readKeys(page);
  expect(result.status).toBe(200);
  const text = result.text;
  expect(text).not.toContain(key);
  expect(text).not.toContain("encrypted");
  const first = JSON.parse(text) as CredentialInventory;
  const firstVersion = first.items.find(
    (item) => item.id === "openrouter",
  )!.version;
  expect(firstVersion).toBeTruthy();
  await page.reload();
  await page.getByRole("button", { name: "Providers", exact: true }).click();
  await expect(input).toHaveValue("");
  await expect(page.getByLabel("Status API key")).toContainText(
    "Key tersimpan dari Admin",
  );
  await input.fill("fixture-only-browser-rotated-key");
  await page
    .getByRole("button", { name: "Ganti API key", exact: true })
    .click();
  await expect(input).toHaveValue("");
  await expect
    .poll(async () => {
      const result = await readKeys(page);
      expect(result.status).toBe(200);
      const data = JSON.parse(result.text) as CredentialInventory;
      return data.items.find((item) => item.id === "openrouter")!.version;
    })
    .not.toBe(firstVersion);
  await expect(
    page.getByText(
      "API key tersimpan. Gunakan Test connection untuk memeriksa akses provider.",
      { exact: true },
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain("provider-key");
  page.once("dialog", (dialog) => dialog.dismiss());
  await page
    .getByRole("button", { name: "Hapus key dari UI", exact: true })
    .click();
  await expect(page.getByLabel("Status API key")).toContainText(
    "Key tersimpan dari Admin",
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Hapus key dari UI", exact: true })
    .click();
  await expect(page.getByLabel("Status API key")).toContainText(
    "Belum ada API key",
  );
  expect(
    (await (await request.get("http://127.0.0.1:8788/__test/stats")).json())
      .outboundCalls,
  ).toBe(0);
  await expect(
    page.getByRole("button", { name: "Hapus key dari UI", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Logout", exact: true }).click();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  expect((await page.request.get("/api/v1/admin/credentials")).status()).toBe(
    401,
  );
  expect(errors).toEqual([]);
});
