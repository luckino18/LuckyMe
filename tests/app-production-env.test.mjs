import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT = "app-seeker/scripts/validate-production-env.mjs";

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
  const result = runValidation({
    EXPO_PUBLIC_LUCKYME_API_URL: "https://api.lucky-me.app",
    EXPO_PUBLIC_LUCKYME_WALLET_CHAIN: "solana:mainnet",
    EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL: "https://api.mainnet-beta.solana.com",
    EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    EXPO_PUBLIC_LUCKYME_PROGRAM_ID: "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3",
    EXPO_PUBLIC_LUCKYME_TERMS_URL: "https://lucky-me.app/terms",
    EXPO_PUBLIC_LUCKYME_PRIVACY_URL: "https://lucky-me.app/privacy",
    EXPO_PUBLIC_LUCKYME_SUPPORT_URL: "https://lucky-me.app/support",
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /LuckyMe production app env is valid/);
});

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
