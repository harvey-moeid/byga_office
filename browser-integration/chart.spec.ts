import { expect, test } from "@playwright/test";
import { formatPrice } from "../src/core/contracts";
import type { ChartResponse } from "../src/core/chart";

test("public Chart renders real Worker/D1 candles for all timeframes without inference", async ({
  page,
  request,
}) => {
  await request.post("http://127.0.0.1:8788/__test/reset?publicSignals=true");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/chart");
  for (const timeframe of ["M5", "M15", "H1"]) {
    await page.getByRole("button", { name: timeframe, exact: true }).click();
    await expect(page.locator(".chart-caption")).toContainText("300 candle");
    const response = await request.get(
      `/api/v1/market/candles?timeframe=${timeframe}`,
    );
    expect(response.status()).toBe(200);
    const data = (await response.json()) as ChartResponse;
    await expect(page.getByLabel("Ringkasan candle terakhir")).toContainText(
      formatPrice(data.candles.at(-1)!.close),
    );
    await expect(page.locator(".chart-canvas canvas").first()).toBeVisible();
    const delta = await request.get(
      `/api/v1/market/candles?timeframe=${timeframe}&after=${data.latest_timestamp}`,
    );
    expect(await delta.json()).toMatchObject({
      candles: [],
      status: "OK",
      latest_timestamp: data.latest_timestamp,
    });
  }
  expect(errors).toEqual([]);
});
