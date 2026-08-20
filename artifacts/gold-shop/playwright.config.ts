import { execFileSync } from "node:child_process";
import { defineConfig } from "@playwright/test";

const baseURL = process.env.PDF_E2E_BASE_URL;
if (!baseURL || process.env.PDF_E2E_ALLOW_DEV_MUTATIONS !== "1") {
  throw new Error(
    "PDF browser tests require an explicit PDF_E2E_BASE_URL and PDF_E2E_ALLOW_DEV_MUTATIONS=1",
  );
}
const target = new URL(baseURL);
const isSafeDevTarget = ["localhost", "127.0.0.1"].includes(target.hostname)
  || target.hostname.endsWith(".replit.dev");
if (!isSafeDevTarget) {
  throw new Error(`Refusing to run destructive PDF fixtures against non-development host: ${target.hostname}`);
}
const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
  ?? execFileSync("which", ["chromium"], { encoding: "utf8" }).trim();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "pdf-downloads.spec.ts",
  // The single serialized journey provisions, exercises, and exactly cleans up
  // many database-backed PDF fixtures. Allow the slowest development runs to
  // finish their cleanup rather than timing out while holding the shared suite
  // registry lock.
  timeout: 360_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["line"]],
  use: {
    baseURL,
    acceptDownloads: true,
    viewport: { width: 1440, height: 1200 },
    launchOptions: {
      executablePath: chromiumPath,
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});