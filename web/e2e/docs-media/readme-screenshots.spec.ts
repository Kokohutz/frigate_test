/**
 * README screenshot generator — not a test suite.
 *
 * Captures the docs/images/v2 screenshots referenced from README.md.
 * Run explicitly (it is skipped unless README_SHOTS=1):
 *
 *   README_SHOTS=1 npx playwright test readme-screenshots --config e2e/playwright.docs.config.ts
 */

import { test } from "../fixtures/frigate-test";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../../docs/images/v2");
mkdirSync(OUT_DIR, { recursive: true });

const THEMES = ["dark", "light"] as const;

test.skip(() => process.env.README_SHOTS !== "1", "README_SHOTS not set");

async function setTheme(page: import("@playwright/test").Page, theme: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("frigate-ui-theme", JSON.stringify({ theme: t }));
  }, theme);
}

test.describe("README screenshots @screenshots", () => {
  for (const theme of THEMES) {
    test(`local mode view ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      await setTheme(frigateApp.page, theme);
      await frigateApp.api.install({
        config: { local_mode: true } as never,
      });
      await frigateApp.goto("/settings?page=localMode");
      await frigateApp.page.waitForTimeout(2500);
      await frigateApp.page.screenshot({
        path: `${OUT_DIR}/localmode-on-${theme}.png`,
      });
    });

    test(`add genai dialog with zai ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      await setTheme(frigateApp.page, theme);
      await frigateApp.goto("/pipeline");
      await frigateApp.page.waitForTimeout(2500);
      await frigateApp.page
        .getByRole("button", { name: "GenAI Agent", exact: true })
        .click();
      await frigateApp.page.waitForTimeout(500);
      // Select the Z.AI provider card so its highlight ring shows
      await frigateApp.page
        .getByRole("button", { name: /Z\.AI \(GLM coding\)/ })
        .click();
      await frigateApp.page.waitForTimeout(500);
      await frigateApp.page.screenshot({
        path: `${OUT_DIR}/genai-zai-${theme}.png`,
      });
    });

    test(`mobile settings menu ${theme}`, async ({ frigateApp }) => {
      test.skip(!frigateApp.isMobile, "mobile only");
      await setTheme(frigateApp.page, theme);
      await frigateApp.api.install({
        config: { local_mode: true } as never,
      });
      await frigateApp.goto("/settings");
      await frigateApp.page.waitForTimeout(2500);
      await frigateApp.page.screenshot({
        path: `${OUT_DIR}/mobile-settings-menu-${theme}.png`,
      });
    });
  }
});
