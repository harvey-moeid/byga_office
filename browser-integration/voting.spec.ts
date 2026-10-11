import { test, expect, type Page } from "@playwright/test";
type CaseSnapshot = {
  context: { config: { aiVoterCount: number }; characters: { id: string }[] };
};

async function browserGet(page: Page, path: string) {
  return page.evaluate(async (path) => {
    const response = await fetch(path, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`Fixture HTTP ${response.status}`);
    return response.json();
  }, path);
}
test("Admin switches 4/8 voters, reload preserves the choice, and APPLY NOW replaces the pinned council through the real API", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:8788/__test/reset");
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/admin");
  await page
    .getByLabel("Password", { exact: true })
    .fill("browser-fixture-password");
  await page.getByRole("button", { name: "Login →", exact: true }).click();
  const selector = page.getByLabel("Jumlah AI untuk voting", { exact: true });
  await expect(selector).toHaveValue("8");
  await selector.selectOption("4");
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Tersimpan:");
  expect(await browserGet(page, "/api/v1/admin/config")).toMatchObject({
    config: { aiVoterCount: 4 },
  });
  await page.reload();
  await expect(selector).toHaveValue("4");
  await page.goto("/operations");
  await expect(
    page.getByText("Voting case baru: 4 AI + Risk/Boss", { exact: true }),
  ).toBeVisible();
  await page.goto("/admin");
  await page.getByRole("button", { name: "Emergency", exact: true }).click();
  await page
    .getByRole("button", { name: "CALL EMERGENCY MEETING", exact: true })
    .click();
  await expect(page).toHaveURL(/\/cases\/CASE-\d/);
  const oldId = page.url().split("/").at(-1)!;
  const old = (await browserGet(
    page,
    `/api/v1/admin/cases/${oldId}`,
  )) as CaseSnapshot;
  expect(old.context.config.aiVoterCount).toBe(4);
  expect(old.context.characters.map((c: { id: string }) => c.id)).toEqual([
    "trend",
    "structure",
    "volume",
    "derivatives",
    "risk",
    "boss",
  ]);
  await page.goto("/admin");
  await selector.selectOption("8");
  await page
    .getByRole("combobox", { name: "Activation", exact: true })
    .selectOption("APPLY NOW");
  page.once("dialog", (dialog) => dialog.accept());
  await page
    .getByRole("button", { name: "Save new version", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Case pengganti:");
  const stats = await (
    await request.get("http://127.0.0.1:8788/__test/stats")
  ).json();
  expect(stats.cases.find((c: { id: string }) => c.id === oldId).status).toBe(
    "CONFIG_CHANGED",
  );
  const replacement = stats.cases.find(
    (c: { status: string }) => c.status === "QUEUED",
  );
  const latest = (await browserGet(
    page,
    `/api/v1/admin/cases/${replacement.id}`,
  )) as CaseSnapshot;
  expect(latest.context.config.aiVoterCount).toBe(8);
  expect(latest.context.characters).toHaveLength(10);
  expect(stats.outboundCalls).toBe(0);
  await page.reload();
  await expect(selector).toHaveValue("8");
  expect(errors).toEqual([]);
});
