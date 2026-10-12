import { test, expect, type Locator } from "@playwright/test";

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
              : path.endsWith("/signals")
                ? { items: [], total: 0, page: 1 }
                : [],
    });
  });
});

async function bounds(locator: Locator) {
  const result = await locator.boundingBox();
  expect(result).not.toBeNull();
  return result!;
}

test("camera dock keeps touch actions separate and every preset reachable", async ({
  page,
}, testInfo) => {
  test.setTimeout(90000);
  await page.addInitScript(() =>
    localStorage.setItem("byga:3d-quality", "low"),
  );
  await page.goto("/");
  await expect(page.getByLabel("Kualitas 3D", { exact: true })).toBeVisible();
  const actions = [
    page.getByLabel("Kualitas 3D", { exact: true }),
    page.getByRole("button", { name: "Ikuti pembicara", exact: true }),
    page.getByRole("button", { name: "Perbesar kantor", exact: true }),
    page.getByRole("button", { name: "Perkecil kantor", exact: true }),
    page.getByRole("button", { name: "Reset View", exact: true }),
  ];
  const rectangles = await Promise.all(actions.map(bounds));
  for (const [index, rect] of rectangles.entries()) {
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.x).toBeGreaterThanOrEqual(0);
    expect(rect.x + rect.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    for (const other of rectangles.slice(index + 1)) {
      expect(
        rect.x < other.x + other.width &&
          rect.x + rect.width > other.x &&
          rect.y < other.y + other.height &&
          rect.y + rect.height > other.y,
      ).toBe(false);
    }
  }
  const upstairs = page.getByRole("button", { name: "Lantai 2", exact: true });
  await upstairs.focus();
  const preset = await bounds(upstairs);
  const strip = await bounds(
    page.getByRole("group", { name: "Sudut kamera kantor" }),
  );
  expect(preset.x).toBeGreaterThanOrEqual(strip.x);
  expect(preset.x + preset.width).toBeLessThanOrEqual(
    strip.x + strip.width + 1,
  );
  await page.keyboard.press("Enter");
  await expect(page.locator(".office-scene")).toHaveAttribute(
    "data-camera-view",
    "upper",
  );
  const legend = await bounds(
    page.getByRole("group", { name: "Empat grup analisis", exact: true }),
  );
  const dock = await bounds(page.locator(".scene-controls"));
  expect(legend.y + legend.height).toBeLessThanOrEqual(dock.y);
  await page.screenshot({ path: testInfo.outputPath("premium-office.png") });
});

test("320px office and mobile forms stay inside the viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.goto("/");
  await expect(page.getByLabel("Kualitas 3D", { exact: true })).toBeVisible();
  const dock = await bounds(page.locator(".scene-controls"));
  const quality = await bounds(page.getByLabel("Kualitas 3D", { exact: true }));
  expect(quality.x + quality.width).toBeLessThanOrEqual(dock.x + dock.width);
  await page.goto("/signals");
  await page
    .getByRole("combobox", { name: "scanner", exact: true })
    .selectOption("trend");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.goto("/operations");
  const boss = page.getByRole("button", { name: /Head Trader/ });
  await boss.focus();
  const bossBounds = await bounds(boss);
  expect(bossBounds.x).toBeGreaterThanOrEqual(0);
  expect(bossBounds.x + bossBounds.width).toBeLessThanOrEqual(320);
  await page.goto("/admin");
  const password = page.getByLabel("Password", { exact: true });
  await expect(password).toHaveCSS("font-size", "16px");
  await expect(password).toHaveCSS("min-height", "44px");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("home menu contains keyboard focus and restores its opener", async ({
  page,
}) => {
  await page.addInitScript(() => {
    HTMLCanvasElement.prototype.getContext = (() =>
      null) as typeof HTMLCanvasElement.prototype.getContext;
  });
  await page.goto("/");
  const opener = page.getByRole("button", { name: "Menu", exact: true });
  await opener.click();
  const home = page
    .getByRole("navigation")
    .getByRole("link", { name: "Home", exact: true });
  await expect(home).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Tutup", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(home).toBeFocused();
  await expect(page.locator("main")).toHaveAttribute("inert", "");
  await page.keyboard.press("Escape");
  await expect(opener).toBeFocused();
  await expect(page.locator("main")).not.toHaveAttribute("inert");
});

test("renderer failure opens usable team fallback and selects Operations", async ({
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
      body: 'export default function OfficeScene() { throw new Error("Fixture renderer failure"); }',
    }),
  );
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText(
    "Tampilan 3D tidak tersedia",
  );
  await expect(
    page.getByRole("button", { name: "Operations", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: /Trend Analyst/ }).click();
  await expect(page.getByRole("dialog")).toContainText("Trend Analyst");
});

test("blocked browser storage still allows changing quality and camera", async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("Storage denied", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const quality = page.getByLabel("Kualitas 3D", { exact: true });
  await expect(quality).toHaveValue("medium");
  await quality.selectOption("low");
  await page
    .getByRole("button", { name: "Ikuti pembicara", exact: true })
    .click();
  await page.getByRole("button", { name: "Lantai 2", exact: true }).click();
  await expect(page.locator(".office-scene")).toHaveAttribute(
    "data-camera-view",
    "upper",
  );
  expect(errors).toEqual([]);
});
