import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";

test("init:pools refuses mainnet without explicit mainnet confirmation", () => {
  const authority = writeTempKeypair();
  const treasury = Keypair.generate().publicKey.toBase58();

  const result = runNodeScript("scripts/init-pools.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    ANCHOR_WALLET: authority.path,
    LUCKYME_EXPECTED_AUTHORITY_PUBKEY: authority.publicKey,
    LUCKYME_TREASURY_PUBKEY: treasury,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /CONFIRM_MAINNET_INIT_POOLS=true/);
  assert.doesNotMatch(result.output, /Initialized config|Initialized .* pool/);
});

test("init:pools refuses mainnet without explicit treasury public key", () => {
  const authority = writeTempKeypair();

  const result = runNodeScript("scripts/init-pools.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    ANCHOR_WALLET: authority.path,
    CONFIRM_MAINNET_INIT_POOLS: "true",
    LUCKYME_EXPECTED_AUTHORITY_PUBKEY: authority.publicKey,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Mainnet init requires explicit LUCKYME_TREASURY_PUBKEY/);
  assert.doesNotMatch(result.output, /Initialized config|Initialized .* pool/);
});

test("init:pools refuses shared authority and treasury unless explicitly allowed", () => {
  const authority = writeTempKeypair();

  const result = runNodeScript("scripts/init-pools.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    ANCHOR_WALLET: authority.path,
    CONFIRM_MAINNET_INIT_POOLS: "true",
    LUCKYME_EXPECTED_AUTHORITY_PUBKEY: authority.publicKey,
    LUCKYME_TREASURY_PUBKEY: authority.publicKey,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Treasury equals authority/);
  assert.doesNotMatch(result.output, /Initialized config|Initialized .* pool/);
});

test("wallet plan refuses missing public wallet addresses", () => {
  const result = runNodeScript("scripts/mainnet-wallet-plan.mjs", {});

  assert.notEqual(result.status, 0);
  assert.match(result.output, /LUCKYME_DEPLOY_AUTHORITY_PUBKEY is required/);
  assert.match(result.output, /LUCKYME_TREASURY_PUBKEY is required/);
  assert.match(result.output, /LUCKYME_KEEPER_PUBKEY is required/);
  assert.match(result.output, /LUCKYME_PUBLISHER_PUBKEY is required/);
});

test("wallet plan accepts distinct public wallet addresses", () => {
  const authority = Keypair.generate().publicKey.toBase58();
  const treasury = Keypair.generate().publicKey.toBase58();
  const keeper = Keypair.generate().publicKey.toBase58();
  const publisher = Keypair.generate().publicKey.toBase58();
  const seekerTest = Keypair.generate().publicKey.toBase58();

  const result = runNodeScript("scripts/mainnet-wallet-plan.mjs", {
    LUCKYME_DEPLOY_AUTHORITY_PUBKEY: authority,
    LUCKYME_TREASURY_PUBKEY: treasury,
    LUCKYME_KEEPER_PUBKEY: keeper,
    LUCKYME_PUBLISHER_PUBKEY: publisher,
    LUCKYME_SEEKER_TEST_PUBKEY: seekerTest,
  });

  assert.equal(result.status, 0);
  assert.match(result.output, /Wallet plan passed/);
  assert.match(result.output, new RegExp(`LUCKYME_DEPLOY_AUTHORITY_PUBKEY: ${authority}`));
  assert.match(result.output, new RegExp(`LUCKYME_TREASURY_PUBKEY: ${treasury}`));
  assert.match(result.output, new RegExp(`LUCKYME_KEEPER_PUBKEY: ${keeper}`));
  assert.match(result.output, new RegExp(`LUCKYME_PUBLISHER_PUBKEY: ${publisher}`));
  assert.match(result.output, new RegExp(`LUCKYME_SEEKER_TEST_PUBKEY: ${seekerTest}`));
});

test("wallet plan refuses reserved program and PDA addresses as wallets", () => {
  const treasury = Keypair.generate().publicKey.toBase58();
  const keeper = Keypair.generate().publicKey.toBase58();
  const publisher = Keypair.generate().publicKey.toBase58();

  const result = runNodeScript("scripts/mainnet-wallet-plan.mjs", {
    LUCKYME_DEPLOY_AUTHORITY_PUBKEY: "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3",
    LUCKYME_TREASURY_PUBKEY: treasury,
    LUCKYME_KEEPER_PUBKEY: keeper,
    LUCKYME_PUBLISHER_PUBKEY: publisher,
    LUCKYME_SEEKER_TEST_PUBKEY: "Cvx2ffKnwanpUZGsDBKyo2uwoo6gjucQmrRZpiYVyKh",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /LUCKYME_DEPLOY_AUTHORITY_PUBKEY is LuckyMe Program ID/);
  assert.match(result.output, /LUCKYME_SEEKER_TEST_PUBKEY is LuckyMe config PDA/);
});

test("wallet plan refuses off-curve PDA addresses as wallets", () => {
  const pda = PublicKey.findProgramAddressSync(
    [Buffer.from("not-a-wallet")],
    Keypair.generate().publicKey,
  )[0].toBase58();

  const result = runNodeScript("scripts/mainnet-wallet-plan.mjs", {
    LUCKYME_DEPLOY_AUTHORITY_PUBKEY: pda,
    LUCKYME_TREASURY_PUBKEY: Keypair.generate().publicKey.toBase58(),
    LUCKYME_KEEPER_PUBKEY: Keypair.generate().publicKey.toBase58(),
    LUCKYME_PUBLISHER_PUBKEY: Keypair.generate().publicKey.toBase58(),
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /LUCKYME_DEPLOY_AUTHORITY_PUBKEY is an off-curve address\/PDA/);
});

test("wallet plan refuses duplicate role wallets by default", () => {
  const shared = Keypair.generate().publicKey.toBase58();
  const keeper = Keypair.generate().publicKey.toBase58();
  const publisher = Keypair.generate().publicKey.toBase58();

  const result = runNodeScript("scripts/mainnet-wallet-plan.mjs", {
    LUCKYME_DEPLOY_AUTHORITY_PUBKEY: shared,
    LUCKYME_TREASURY_PUBKEY: shared,
    LUCKYME_KEEPER_PUBKEY: keeper,
    LUCKYME_PUBLISHER_PUBKEY: publisher,
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /LUCKYME_TREASURY_PUBKEY and LUCKYME_DEPLOY_AUTHORITY_PUBKEY are the same address/);
});

function runNodeScript(script, env) {
  const result = spawnSync(process.execPath, [script], {
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

function writeTempKeypair() {
  const keypair = Keypair.generate();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luckyme-deploy-test-"));
  const file = path.join(dir, "id.json");
  fs.writeFileSync(file, JSON.stringify([...keypair.secretKey]));
  return {
    path: file,
    publicKey: keypair.publicKey.toBase58(),
  };
}
