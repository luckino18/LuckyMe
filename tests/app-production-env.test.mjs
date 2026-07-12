import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const SCRIPT = "app-seeker/scripts/validate-production-env.mjs";
const LUCKYME_SCREEN = "app-seeker/src/LuckyMeScreen.tsx";
const STITCH_SCREENS = "app-seeker/src/stitchScreens.ts";
const APP_JSON = "app-seeker/app.json";

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

test("Seeker publishes the approved ticket targets and automatic-refund copy", () => {
  const content = readFileSync(STITCH_SCREENS, "utf8");

  assert.match(content, /name: "Mini"[\s\S]*?minimumTickets: 25/);
  assert.match(content, /name: "Normal"[\s\S]*?minimumTickets: 13/);
  assert.match(content, /name: "High"[\s\S]*?minimumTickets: 3/);
  assert.match(
    content,
    /name: "Premium"[\s\S]*?minimumTickets: 3[\s\S]*?minimumDistinctEntrants: 3/,
  );
  assert.match(content, /\$\{hasRound \? threshold\.sold : "&mdash;"\} \/ \$\{threshold\.minimumTickets\} tickets sold/);
  assert.match(content, /100% of the ticket purchase amount is automatically returned/);
  assert.match(content, /Solana network fees are not refundable/);
  assert.match(content, /No claim button is required/);
  assert.match(content, /Mini needs 25 tickets sold in total, not 25 different players/);
  assert.doesNotMatch(content, /25 players/i);
  assert.doesNotMatch(content, /no loss|zero cost/i);
});

test("Seeker release metadata advances without changing the Android package", () => {
  const app = JSON.parse(readFileSync(APP_JSON, "utf8")).expo;

  assert.equal(app.version, "1.1.3");
  assert.equal(app.android.package, "com.luckyme.seeker");
  assert.equal(app.android.versionCode, 6);
  assert.equal(app.icon, "./assets/icon.png");
  assert.equal(app.android.adaptiveIcon.foregroundImage, "./assets/adaptive-icon.png");
});

test("Seeker APK includes opt-in notification and winner card surfaces", () => {
  const screen = readFileSync(LUCKYME_SCREEN, "utf8");
  const stitch = readFileSync(STITCH_SCREENS, "utf8");

  assert.match(screen, /ROUND_ALERTS_CHANNEL_ID = "luckyme-round-alerts"/);
  assert.match(screen, /Max 2 alerts per active round/);
  assert.match(screen, /Notifications\.requestPermissionsAsync/);
  assert.match(screen, /PermissionsAndroid\.request/);
  assert.match(screen, /PermissionsAndroid\.PERMISSIONS\.POST_NOTIFICATIONS/);
  assert.doesNotMatch(screen, /Linking\.openSettings/);
  assert.match(screen, /Notifications\.getExpoPushTokenAsync/);
  assert.match(screen, /\/notifications\/register/);
  assert.match(screen, /if \(permissions\.granted\)[\s\S]*?registerExpoPushToken\(token, walletAddress\)/);
  assert.match(screen, /signAndSendTransactions/);
  assert.match(screen, /\/transactions\/buy-tickets/);
  assert.match(screen, /screenName === "winner"/);
  assert.doesNotMatch(stitch, /data-route="syncing">Confirm entry/);
  assert.match(stitch, /Solana Winner Card/);
  assert.match(stitch, /SHARE ON/);
  assert.match(stitch, /WhatsApp/);
  assert.match(stitch, /Download PNG/);
});

test("Seeker entry readiness is evaluated for the selected pool", () => {
  const screen = readFileSync(LUCKYME_SCREEN, "utf8");
  const stitch = readFileSync(STITCH_SCREENS, "utf8");

  assert.match(stitch, /function hasLivePoolState\(poolId: string/);
  assert.match(stitch, /export function isLivePoolEntryReady/);
  assert.match(stitch, /export function hasVerifiedMinimumPolicy/);
  assert.match(stitch, /!hasVerifiedMinimumPolicy\(pool\)/);
  assert.match(stitch, /numberValue\(round\.minimumTickets, Number\.NaN\)/);
  assert.match(stitch, /startTs === 0 && endTs === 0/);
  assert.match(stitch, /isLivePoolEntryReady\(facts\.live\)/);
  assert.match(screen, /isLivePoolEntryReady\(livePool\)/);
  assert.match(screen, /setOnchainAvailable\(hasMainnetState\)/);
  assert.match(screen, /setLivePools\(hasMainnetState \? pools\.pools : \[\]\)/);
  assert.match(screen, /expectedRoundId/);
  assert.match(screen, /expectedTotalTickets/);
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
