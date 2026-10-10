import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./browser-integration",
  workers: 1,
  fullyParallel: false,
  outputDir: "browser-api-results",
  use: {
    baseURL: "http://127.0.0.1:5175",
    screenshot: "only-on-failure",
    launchOptions: process.env.BYGA_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.BYGA_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: [
    {
      command: "node tests/browser-api-server.mjs",
      url: "http://127.0.0.1:8788/__health",
      reuseExistingServer: false,
      timeout: 60000,
    },
    {
      command:
        "BYGA_API_URL=http://127.0.0.1:8788 npm run dev -- --host 127.0.0.1 --port 5175 --strictPort",
      url: "http://127.0.0.1:5175",
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-portrait", use: { ...devices["Pixel 7"] } },
    {
      name: "mobile-landscape",
      use: { ...devices["Pixel 7"], viewport: { width: 915, height: 412 } },
    },
  ],
});
