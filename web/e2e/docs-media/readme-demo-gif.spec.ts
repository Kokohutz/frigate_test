/**
 * README demo GIF frame generator — not a test suite.
 *
 * Drives a short product tour (pipeline → Add GenAI with Z.AI →
 * Local/Offline Mode toggle) and dumps numbered PNG frames into
 * /tmp/demo-frames. A Pillow script assembles them into
 * docs/images/demo.gif afterwards.
 *
 * Run explicitly (skipped unless README_GIF=1):
 *
 *   README_GIF=1 npx playwright test readme-demo-gif --config e2e/playwright.docs.config.ts --project=desktop
 */

import { test } from "../fixtures/frigate-test";
import { mkdirSync, rmSync } from "node:fs";

const FRAME_DIR = "/tmp/demo-frames";

test.skip(() => process.env.README_GIF !== "1", "README_GIF not set");

test.describe("README demo gif @screenshots", () => {
  test("capture tour frames", async ({ frigateApp }) => {
    test.skip(frigateApp.isMobile, "desktop only");
    test.setTimeout(180_000);

    rmSync(FRAME_DIR, { recursive: true, force: true });
    mkdirSync(FRAME_DIR, { recursive: true });

    const page = frigateApp.page;
    await page.setViewportSize({ width: 960, height: 600 });
    await page.addInitScript(() => {
      localStorage.setItem(
        "frigate-ui-theme",
        JSON.stringify({ theme: "dark" }),
      );
    });

    let frame = 0;
    const snap = async (copies = 1) => {
      const buf = await page.screenshot();
      const { writeFileSync } = await import("node:fs");
      for (let i = 0; i < copies; i++) {
        writeFileSync(
          `${FRAME_DIR}/${String(frame).padStart(4, "0")}.png`,
          buf,
        );
        frame++;
      }
    };

    // ---- Scene 1: pipeline canvas ----------------------------------
    await frigateApp.goto("/pipeline");
    await page.waitForTimeout(3000);
    await snap(10); // hold 1s

    // gentle pan of the canvas
    const canvas = page.locator(".react-flow__pane");
    const box = await canvas.boundingBox();
    if (box) {
      const cx = box.x + box.width / 2;
      const cy = box.y + box.height / 2;
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await page.mouse.move(cx - i * 12, cy - i * 4);
        await snap();
      }
      await page.mouse.up();
    }
    await snap(8);

    // ---- Scene 2: Add GenAI dialog, pick Z.AI ----------------------
    await page
      .getByRole("button", { name: "GenAI Agent", exact: true })
      .click();
    await page.waitForTimeout(600);
    await snap(12);
    await page.getByRole("button", { name: /Z\.AI \(GLM coding\)/ }).click();
    await page.waitForTimeout(400);
    await snap(16);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(400);
    await snap(4);

    // ---- Scene 3: Local / Offline Mode -----------------------------
    await page.goto("/settings?page=localMode");
    await page.waitForTimeout(2500);
    await snap(12);
    // flip the toggle — the mocked PUT returns success and SWR refetches
    // the same (unchanged) config, so re-render keeps OFF; still shows
    // the interaction + toast.
    await page.locator("#local-mode-toggle").click();
    await page.waitForTimeout(700);
    await snap(18);

    // ---- Scene 4: model converter ----------------------------------
    await page.goto("/settings?page=modelConverter");
    await page.waitForTimeout(2500);
    await snap(16);

    // eslint-disable-next-line no-console
    console.log(`captured ${frame} frames in ${FRAME_DIR}`);
  });
});
