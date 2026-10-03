import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "./browser-tests",
  use: {
    baseURL: "http://127.0.0.1:5173",
    screenshot: "only-on-failure",
    launchOptions: process.env.BYGA_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.BYGA_CHROMIUM_EXECUTABLE_PATH }
      : {},
  },
  webServer: {
    command: "npm run dev -- --host 127.0.0.1",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-portrait", use: { ...devices["Pixel 7"] } },
    {
      name: "mobile-landscape",
      use: { ...devices["Pixel 7"], viewport: { width: 915, height: 412 } },
    },
  ],
});
