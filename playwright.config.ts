import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3000";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium-mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: process.env.DATABASE_URL || "",
      AUTH_SECRET: process.env.AUTH_SECRET || "fidgo-playwright-secret-at-least-32-characters",
      NEXT_PUBLIC_APP_URL: baseURL,
      CARD_RECOVERY_ENABLED: "true",
      RESEND_API_KEY: "re_test_dummy_key",
      EMAIL_FROM: "Fidgo <cards@fidgo.test>",
      EMAIL_REPLY_TO: "support@fidgo.test",\n      EMAIL_VERIFICATION_TEST_MODE: "true",
      STRIPE_ENABLED: "true",
      STRIPE_SECRET_KEY: "sk_test_e2e_placeholder",
      STRIPE_WEBHOOK_SECRET: "whsec_retiko_e2e",
      STRIPE_PRICE_FLEX_MONTHLY: "price_e2e_flex",
      STRIPE_PRICE_RETIKO12_MONTHLY: "price_e2e_retiko12",
      STRIPE_PRICE_ANNUAL: "price_e2e_annual",
    },
  },
});
