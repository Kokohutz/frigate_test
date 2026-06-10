/**
 * README screenshot generator — not a test suite.
 *
 * Captures the docs/images/v2 screenshots referenced from README.md.
 * All desktop shots are 16:9 1080p (1920×1080, set by the desktop project
 * in playwright.docs.config.ts). Run explicitly (skipped unless README_SHOTS=1):
 *
 *   README_SHOTS=1 npx playwright test readme-screenshots --config e2e/playwright.docs.config.ts
 */

import { test } from "../fixtures/frigate-test";
import { BASE_CONFIG } from "../fixtures/mock-data/config";
import { mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, "../../../docs/images/v2");
mkdirSync(OUT_DIR, { recursive: true });

const THEMES = ["dark", "light"] as const;

test.skip(() => process.env.README_SHOTS !== "1", "README_SHOTS not set");

async function setTheme(page: Page, theme: string) {
  await page.addInitScript((t) => {
    localStorage.setItem("frigate-ui-theme", JSON.stringify({ theme: t }));
  }, theme);
}

/** Demo config matching the README pipeline shots: 4 cameras, 2 detectors,
 *  2 GenAI agents, MQTT on homeassistant.local. */
function richConfig() {
  const cfg = structuredClone(BASE_CONFIG) as Record<string, never> & {
    cameras: Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    detectors: Record<string, unknown>;
    genai: Record<string, unknown>;
    mqtt: { host: string };
  };
  cfg.cameras.driveway = structuredClone(cfg.cameras.garage);
  cfg.cameras.driveway.name = "driveway";
  cfg.cameras.driveway.friendly_name = "Driveway";
  cfg.cameras.driveway.detect.fps = 10;
  for (const name of Object.keys(cfg.cameras)) {
    cfg.cameras[name].detect.enabled = true;
    cfg.cameras[name].record.enabled = true;
  }
  cfg.cameras.front_door.objects.genai.enabled = true;
  cfg.cameras.garage.objects.genai.enabled = true;
  cfg.detectors = {
    coral_tpu: { type: "edgetpu", device: "usb" },
    nvidia_gpu: { type: "tensorrt", device: "0" },
  };
  cfg.genai = {
    claude_describe: {
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      roles: ["descriptions"],
      api_key: "",
      base_url: "",
    },
    gpt4o_chat: {
      provider: "openai",
      model: "gpt-4o-mini",
      roles: ["chat"],
      api_key: "",
      base_url: "",
    },
  };
  cfg.mqtt.host = "homeassistant.local";
  return cfg;
}

/** Tiered storage + event router demo state (read from localStorage). */
async function installPipelineState(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem(
      "argus-storage-tiers",
      JSON.stringify({
        enabled: true,
        hot: { path: "/media/frigate/recordings", maxDays: 7, maxGb: 500 },
        cold: { path: "/mnt/nas/frigate/recordings", maxDays: 90 },
      }),
    );
    localStorage.setItem(
      "argus-event-router",
      JSON.stringify({
        webhook: { enabled: false, url: "" },
        discord: {
          enabled: true,
          url: "https://discord.com/api/webhooks/1234/secret",
        },
        slack: { enabled: true, url: "https://hooks.slack.com/services/T0/B0" },
        telegram: { enabled: false, token: "", chatId: "" },
        mqtt: {
          enabled: true,
          host: "homeassistant.local",
          port: 1883,
          prefix: "argus",
        },
        rateLimit: 30,
      }),
    );
  });
}

async function installRichConfig(page: Page) {
  const cfg = richConfig();
  await page.route("**/api/config", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: cfg });
    }
    return route.fulfill({ json: { success: true } });
  });
}

const MOCK_USERS = [
  { username: "admin", role: "admin", totp_enabled: true },
  { username: "alice", role: "admin", totp_enabled: false },
  { username: "kid", role: "gate", totp_enabled: false },
  { username: "viewer1", role: "viewer", totp_enabled: false },
];

async function installUsers(page: Page) {
  await page.route("**/api/users", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: MOCK_USERS });
    }
    return route.fulfill({ json: { success: true } });
  });
}

async function installTotpEndpoints(page: Page) {
  await page.route("**/api/2fa/setup", (route) =>
    route.fulfill({
      json: {
        secret: "JBSWY3DPEHPK3PXPMNQGSZTBOI4WIYY=",
        uri: "otpauth://totp/Argus:alice?secret=JBSWY3DPEHPK3PXPMNQGSZTBOI4WIYY=&issuer=Argus",
      },
    }),
  );
  await page.route("**/api/2fa/enable", (route) =>
    route.fulfill({
      json: {
        recovery_codes: [
          "K7QP-2MXR-9TLD",
          "H3VN-8WCY-4JSB",
          "R9FK-5ZQM-1XPT",
          "D2LW-7HNG-6YVC",
          "T8BJ-3RKS-0QMF",
          "W5XD-9PLH-2NZR",
          "M1CV-6TQY-8KJW",
          "F4SN-0GXB-5RHL",
        ],
      },
    }),
  );
}

test.describe("README screenshots @screenshots", () => {
  for (const theme of THEMES) {
    // ---- Pipeline canvas with tiered storage + router -----------------
    test(`pipeline tiered ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      await setTheme(frigateApp.page, theme);
      await installPipelineState(frigateApp.page);
      await installRichConfig(frigateApp.page);
      await frigateApp.goto("/pipeline");
      await frigateApp.page.waitForTimeout(3000);
      await frigateApp.page.screenshot({
        path: `${OUT_DIR}/pipeline-tiered-${theme}.png`,
      });
    });

    // ---- Storage tiers dialog -----------------------------------------
    test(`storage tiers dialog ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      await setTheme(frigateApp.page, theme);
      await installPipelineState(frigateApp.page);
      await installRichConfig(frigateApp.page);
      await frigateApp.goto("/pipeline");
      await frigateApp.page.waitForTimeout(3000);
      await frigateApp.page
        .getByRole("button", { name: "Storage Tiers", exact: true })
        .click();
      await frigateApp.page.waitForTimeout(600);
      await frigateApp.page.screenshot({
        path: `${OUT_DIR}/dialog-tiers-${theme}.png`,
      });
    });

    // ---- Event router dialog -------------------------------------------
    test(`event router dialog ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      await setTheme(frigateApp.page, theme);
      await installPipelineState(frigateApp.page);
      await installRichConfig(frigateApp.page);
      await frigateApp.goto("/pipeline");
      await frigateApp.page.waitForTimeout(3000);
      await frigateApp.page
        .getByRole("button", { name: "Event Router", exact: true })
        .click();
      await frigateApp.page.waitForTimeout(600);
      await frigateApp.page.screenshot({
        path: `${OUT_DIR}/dialog-router-${theme}.png`,
      });
    });

    // ---- Local / Offline Mode ------------------------------------------
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

    // ---- Add GenAI dialog with Z.AI selected -----------------------------
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

    // ---- Model converter --------------------------------------------------
    test(`model converter ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      const page = frigateApp.page;
      await setTheme(page, theme);
      await page.route("**/api/models/targets", (route) =>
        route.fulfill({
          json: {
            targets: [
              "onnx",
              "tflite",
              "tflite_edgetpu",
              "tensorrt",
              "openvino",
              "rknn",
              "hailo",
            ],
            sources: ["pt", "pth", "onnx", "tflite", "h5", "pb", "engine"],
            detector_suggestions: {
              coral_tpu: "tflite_edgetpu",
              nvidia_gpu: "tensorrt",
              intel_igpu: "openvino",
            },
          },
        }),
      );
      await frigateApp.goto("/settings?page=modelConverter");
      await page.waitForTimeout(2500);
      await page.screenshot({
        path: `${OUT_DIR}/model-converter-${theme}.png`,
      });

      // Open the target-format dropdown for the second shot
      await page.getByRole("combobox").click();
      await page.waitForTimeout(500);
      await page.screenshot({
        path: `${OUT_DIR}/model-converter-targets-${theme}.png`,
      });
    });

    // ---- Users list ---------------------------------------------------------
    test(`users list ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      await setTheme(frigateApp.page, theme);
      await installUsers(frigateApp.page);
      await frigateApp.goto("/settings?page=users");
      await frigateApp.page.waitForTimeout(2500);
      await frigateApp.page.screenshot({
        path: `${OUT_DIR}/users-list-${theme}.png`,
      });
    });

    // ---- 2FA enrollment wizard (all four stages) -------------------------
    test(`2fa wizard ${theme}`, async ({ frigateApp }) => {
      test.skip(frigateApp.isMobile, "desktop only");
      const page = frigateApp.page;
      await setTheme(page, theme);
      await installUsers(page);
      await installTotpEndpoints(page);
      await frigateApp.goto("/settings?page=users");
      await page.waitForTimeout(2500);

      // alice is the admin without 2FA — her row has the Enable button
      await page.getByRole("button", { name: "Enable 2FA" }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT_DIR}/twofa-intro-${theme}.png` });

      await page.getByRole("button", { name: "Continue" }).click();
      await page.waitForTimeout(600);
      await page.screenshot({ path: `${OUT_DIR}/twofa-scan-${theme}.png` });

      await page.getByRole("button", { name: "I've scanned it" }).click();
      await page.waitForTimeout(400);
      await page.locator('input[placeholder="000000"]').fill("123456");
      await page.waitForTimeout(300);
      await page.screenshot({ path: `${OUT_DIR}/twofa-verify-${theme}.png` });

      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await page.waitForTimeout(600);
      await page.screenshot({
        path: `${OUT_DIR}/twofa-recovery-${theme}.png`,
      });
    });

    // ---- Mobile settings menu ----------------------------------------------
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
