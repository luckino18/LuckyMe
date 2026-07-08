import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const SCRIPT = "app-seeker/scripts/validate-production-env.mjs";
const LUCKYME_SCREEN = "app-seeker/src/LuckyMeScreen.tsx";
const STITCH_SCREENS = "app-seeker/src/stitchScreens.ts";

test("Seeker production env validation rejects missing env", () => {
  const result = runValidation({});

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Missing required production env vars/);
});

test("Seeker production env validation rejects localhost backend", () => {
  const result = runValidation({
    EXPO_PUBLIC_LUCKYME_API_URL: "http://localhost:8788",
    EXPO_PUBLIC_LUCKYME_WALLET_CHAIN: "solana:mainnet",
    EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL: "https://api.mainnet-beta.solana.com",
    EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    EXPO_PUBLIC_LUCKYME_TERMS_URL: "https://lucky-me.app/terms",
    EXPO_PUBLIC_LUCKYME_PRIVACY_URL: "https://lucky-me.app/privacy",
    EXPO_PUBLIC_LUCKYME_SUPPORT_URL: "https://lucky-me.app/support",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /production HTTPS backend URL/);
});

test("Seeker production env validation rejects placeholder policy links", () => {
  const exampleHost = ["example", "com"].join(".");
  const result = runValidation({
    EXPO_PUBLIC_LUCKYME_API_URL: "https://api.lucky-me.app",
    EXPO_PUBLIC_LUCKYME_WALLET_CHAIN: "solana:mainnet",
    EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL: "https://api.mainnet-beta.solana.com",
    EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    EXPO_PUBLIC_LUCKYME_TERMS_URL: `https://${exampleHost}/terms`,
    EXPO_PUBLIC_LUCKYME_PRIVACY_URL: "https://lucky-me.app/privacy",
    EXPO_PUBLIC_LUCKYME_SUPPORT_URL: "https://lucky-me.app/support",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /EXPO_PUBLIC_LUCKYME_TERMS_URL must be a final production URL/);
});

test("Seeker production env validation accepts mainnet release config", () => {
  const result = runValidation(mainnetReleaseEnv());

  assert.equal(result.status, 0);
  assert.match(result.output, /LuckyMe production app env is valid/);
});

test("Seeker production env validation rejects UI preview builds", () => {
  const result = runValidation(mainnetReleaseEnv({
    EXPO_PUBLIC_LUCKYME_UI_PREVIEW: "true",
  }));

  assert.notEqual(result.status, 0);
  assert.match(result.output, /EXPO_PUBLIC_LUCKYME_UI_PREVIEW cannot be true/);
});

test("Seeker static UI reflects upgraded pool economics", () => {
  const content = readFileSync(STITCH_SCREENS, "utf8");

  assert.match(content, /name: "Premium"/);
  assert.match(content, /entry: "0\.05 SOL"/);
  assert.match(content, /entry: "0\.1 SOL"/);
  assert.match(content, /prize: "70 \/ 20 \/ 10 split"/);
  assert.match(content, /limits: "1 ticket per wallet"/);
  assert.match(content, /Minimum 3 wallets required/);
  assert.doesNotMatch(content, /High Roller/i);
  assert.doesNotMatch(content, /Win Chance/i);
});

test("Seeker APK includes opt-in notification and winner card surfaces", () => {
  const screen = readFileSync(LUCKYME_SCREEN, "utf8");
  const stitch = readFileSync(STITCH_SCREENS, "utf8");

  assert.match(screen, /ROUND_ALERTS_CHANNEL_ID = "luckyme-round-alerts"/);
  assert.match(screen, /Max 2 alerts per active round/);
  assert.match(screen, /Notifications\.requestPermissionsAsync/);
  assert.match(screen, /Notifications\.getExpoPushTokenAsync/);
  assert.match(screen, /screenName === "winner"/);
  assert.match(stitch, /Solana Winner Card/);
  assert.match(stitch, /SHARE ON/);
  assert.match(stitch, /WhatsApp/);
  assert.match(stitch, /Download PNG/);
});

function mainnetReleaseEnv(overrides = {}) {
  return {
    EXPO_PUBLIC_LUCKYME_API_URL: "https://api.lucky-me.app",
    EXPO_PUBLIC_LUCKYME_WALLET_CHAIN: "solana:mainnet",
    EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL: "https://api.mainnet-beta.solana.com",
    EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    EXPO_PUBLIC_LUCKYME_PROGRAM_ID: "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3",
    EXPO_PUBLIC_LUCKYME_TERMS_URL: "https://lucky-me.app/terms",
    EXPO_PUBLIC_LUCKYME_PRIVACY_URL: "https://lucky-me.app/privacy",
    EXPO_PUBLIC_LUCKYME_SUPPORT_URL: "https://lucky-me.app/support",
    ...overrides,
  };
}

function runValidation(env) {
  const result = spawnSync(process.execPath, [SCRIPT], {
    cwd: process.cwd(),
    env: {
      PATH: process.env.PATH,
      ...env,
    },
    encoding: "utf8",
  });

  return {
    status: result.status,
    output: `${result.stdout}${result.stderr}`,
  };
}
