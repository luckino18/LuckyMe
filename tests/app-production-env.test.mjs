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
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /production HTTPS backend URL/);
});

test("Seeker production env validation accepts mainnet release config", () => {
  const result = runValidation({
    EXPO_PUBLIC_LUCKYME_API_URL: "https://api.luckyme.example",
    EXPO_PUBLIC_LUCKYME_WALLET_CHAIN: "solana:mainnet",
    EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL: "https://api.mainnet-beta.solana.com",
    EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    EXPO_PUBLIC_LUCKYME_PROGRAM_ID: "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3",
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
