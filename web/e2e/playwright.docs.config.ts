/**
 * Playwright config for the README media generators in e2e/docs-media.
 *
 * These are utility scripts (screenshots + demo-GIF frames), not tests, so
 * they live outside e2e/specs and are exempt from the spec lint rules.
 *
 *   README_SHOTS=1 npx playwright test --config e2e/playwright.docs.config.ts readme-screenshots
 *   README_GIF=1  npx playwright test --config e2e/playwright.docs.config.ts readme-demo-gif --project=desktop
 *
 * Then assemble the GIF (requires Pillow):
 *   python3 e2e/docs-media/assemble_gif.py
 */

import { defineConfig, devices } from "@playwright/test";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(__dirname, "..");

const DESKTOP_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export default defineConfig({
  testDir: "./docs-media",
  workers: 2,
  reporter: [["line"]],
  timeout: 60_000,

  use: {
    baseURL: "http://localhost:4173",
  },

  webServer: {
    command: "npx vite preview --port 4173",
    port: 4173,
    cwd: webRoot,
    reuseExistingServer: true,
  },

  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1920, height: 1080 },
        userAgent: DESKTOP_UA,
      },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        userAgent: MOBILE_UA,
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
});
