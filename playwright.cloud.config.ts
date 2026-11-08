import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4175",
    headless: true,
    trace: "retain-on-failure",
    actionTimeout: 10000,
  },
  webServer: {
    command: "node scripts/cloud-e2e-server.mjs",
    url: "http://127.0.0.1:4175/api/health",
    reuseExistingServer: false,
    timeout: 60000,
  },
});
