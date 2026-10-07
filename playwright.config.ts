import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: "html",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "mobile-chrome",
      use: { ...devices["Pixel 7"] },
    },
    {
      // The same dashboard specs with the browser on the far side of the date
      // line from the store (America/New_York): the UI must still show the
      // store's day and times, not the device's.
      name: "mobile-chrome-far-timezone",
      testMatch: /demo\.spec\.ts/,
      use: { ...devices["Pixel 7"], timezoneId: "Pacific/Kiritimati" },
    },
    {
      // iPad Air portrait size (the tablet size class) in Chromium, which is
      // the only browser CI installs. Layout specs only — the dashboard specs
      // in demo.spec.ts target the phone header.
      name: "tablet-chrome",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 820, height: 1180 }, hasTouch: true },
    },
    {
      // iPad Air landscape (desk size class).
      name: "tablet-landscape-chrome",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1180, height: 820 }, hasTouch: true },
    },
    {
      // Desktop monitor (wide size class).
      name: "desktop-chrome",
      testMatch: /responsive\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], viewport: { width: 1600, height: 1000 } },
    },
  ],
  webServer: {
    command: process.env.CI ? "npm start" : "npm run dev",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    // E2E specs intercept all /api/* calls client-side and run without a
    // Supabase instance; this skips the server-side auth gate (app/page.tsx).
    env: { E2E_BYPASS_AUTH: "1" },
  },
});
