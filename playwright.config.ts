import { defineConfig, devices } from "@playwright/test";

/* jsdom (the vitest suite) has no layout engine: every rect it reports is zero,
   so the unit tests can only check the extractor's rules against stubbed
   geometry. Whether a bone actually lands on its element is a real-browser
   question, and tests/ is the only place it gets asked. */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: "http://localhost:5179",
    trace: "retain-on-failure",
  },
  webServer: {
    command: "pnpm exec vite",
    url: "http://localhost:5179",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
