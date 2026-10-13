import { expect, test, type Page } from "@playwright/test";
import { characterIds } from "../src/core/contracts";

async function setHidden(page: Page, hidden: boolean) {
  await page.evaluate((hidden) => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: hidden,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  }, hidden);
}

test.beforeEach(async ({ page }) => {
  await page.route("**/api/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/auth/session")
        ? { admin: false }
        : path.endsWith("/office/state")
          ? { office: "MONITORING", active: null, scanners: [] }
          : path.endsWith("/market/status")
            ? {
                price: 60000,
                tickSize: 0.01,
                candle_timestamp: Date.now(),
                timeframes: { M5: [], M15: [], H1: [] },
              }
            : path.endsWith("/office/meeting")
              ? { meeting: null }
              : [],
    });
  });
});

test("meeting refresh failure stays compact and retry lives in the status sheet", async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.clock.install();
  let failing = true,
    retries = 0;
  await page.route("**/api/v1/office/meeting*", (route) => {
    retries++;
    return route.fulfill({
      status: failing ? 503 : 200,
      json: failing ? { error: "fixture-unavailable" } : { meeting: null },
    });
  });
  await page.goto("/");
  const status = page.getByRole("button", { name: "Buka status kantor" });
  await expect(status).toHaveAttribute("data-warning", "true");
  await expect(page.locator(".home-notices")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Coba lagi", exact: true }),
  ).toHaveCount(0);
  const bounds = await status.boundingBox();
  expect(bounds!.height).toBeLessThanOrEqual(50);
  expect(bounds!.y).toBeLessThan(150);
  await page.clock.fastForward(4600);
  await expect(page.locator(".office-status-toast")).toHaveCount(0);
  await expect(status).toHaveAttribute("data-warning", "true");
  await status.click();
  const dialog = page.getByRole("dialog", { name: "Status kantor" });
  await expect(dialog).toContainText("Percakapan belum dapat diperbarui");
  await page.screenshot({
    path: testInfo.outputPath("office-status-sheet.png"),
  });
  const panel = await dialog.boundingBox();
  expect(panel!.x).toBeGreaterThanOrEqual(0);
  expect(panel!.x + panel!.width).toBeLessThanOrEqual(
    page.viewportSize()!.width,
  );
  const count = retries;
  failing = false;
  await dialog.getByRole("button", { name: "Coba lagi", exact: true }).click();
  await expect.poll(() => retries).toBeGreaterThan(count);
  await expect(status).toHaveAttribute("data-warning", "false");
  await expect(dialog).toContainText("Belum ada meeting aktif");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(status).toBeFocused();
});

test("meeting waits for arrivals instead of accelerating the visual team", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() => ({
      getExtension: () => null,
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.route("**/src/ui/scene.tsx*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: "export default function OfficeScene(props) { window.__fixtureScene = props; return null; }",
    }),
  );
  await page.clock.install();
  const meeting = {
    case_id: "CASE-natural-arrivals",
    kind: "AI",
    status: "COMPLETED",
    finished: true,
    cancelled: false,
    participants: [...characterIds],
    unavailable: [],
    turns: characterIds.map((character) => ({
      character,
      analysis: {
        vote: "BUY",
        confidence: 75,
        summary: "Fixture analysis",
        reasoning: "Fixture evidence",
        evidence: [],
        risk_flags: [],
        price_levels: null,
      },
    })),
  };
  await page.route("**/api/v1/office/meeting*", (route) =>
    route.fulfill({ json: { meeting } }),
  );
  await page.goto("/");
  await expect(
    page.getByText("Tim menuju ruang meeting", { exact: true }),
  ).toBeVisible();
  await page.clock.fastForward(18000);
  await expect(
    page.getByText("Tim menuju ruang meeting", { exact: true }),
  ).toBeVisible();
  // Background time cannot consume the bounded arrival wait while actors stop.
  await setHidden(page, true);
  await page.clock.fastForward(90000);
  await setHidden(page, false);
  await page.clock.fastForward(500);
  await expect(
    page.getByText("Tim menuju ruang meeting", { exact: true }),
  ).toBeVisible();
  await page.evaluate((ids) => {
    const props = (
      window as unknown as {
        __fixtureScene: {
          meetingId: string;
          onMeetingArrival: (
            caseId: string,
            id: string,
            ready: boolean,
          ) => void;
        };
      }
    ).__fixtureScene;
    ids
      .filter((id) => id !== "boss")
      .forEach((id) => props.onMeetingArrival(props.meetingId, id, true));
  }, characterIds);
  await page.clock.fastForward(500);
  await expect(
    page.getByText("Trend Analyst sedang berbicara", { exact: true }),
  ).toBeVisible();
  await setHidden(page, true);
  await page.clock.fastForward(45000);
  await setHidden(page, false);
  await page.clock.fastForward(500);
  await expect(
    page.getByText("Trend Analyst sedang berbicara", { exact: true }),
  ).toBeVisible();
  // Camera visibility must not be able to freeze the discussion forever.
  await page.clock.fastForward(21000);
  await expect(
    page.getByText("Structure Analyst sedang berbicara", { exact: true }),
  ).toBeVisible();
});

test("Ultra remains selectable alongside compact status and mobile camera controls", async ({
  page,
}) => {
  await page.goto("/");
  const quality = page.getByLabel("Kualitas 3D", { exact: true });
  await expect(quality.locator('option[value="ultra"]')).toHaveText("Ultra");
  const status = page.getByRole("button", { name: "Buka status kantor" });
  await expect(status).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
