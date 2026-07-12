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

test("settlement keeper refuses mainnet writes without explicit confirmation", () => {
  const result = runNodeScript("scripts/settlement-keeper.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    DRY_RUN: "false",
    LUCKYME_RANDOMNESS_MODE: "orao_vrf",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /CONFIRM_MAINNET_SETTLEMENT_KEEPER=true/);
  assert.doesNotMatch(result.output, /settlement_keeper_start/);
});

test("open-round-only mainnet writes require their own confirmation", () => {
  const result = runNodeScript("scripts/settlement-keeper.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    DRY_RUN: "false",
    CONFIRM_MAINNET_SETTLEMENT_KEEPER: "true",
    LUCKYME_RANDOMNESS_MODE: "orao_vrf",
    SETTLEMENT_KEEPER_ACTION_SCOPE: "open_round_only",
    SETTLEMENT_KEEPER_APPROVED_OPEN_ROUNDS: "normal:6",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /CONFIRM_MAINNET_OPEN_ROUNDS=true/);
  assert.doesNotMatch(result.output, /settlement_keeper_start/);
});

test("legacy rent recovery refuses mainnet writes without explicit confirmation", () => {
  const result = runNodeScript("scripts/recover-legacy-empty-round-rent.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    DRY_RUN: "false",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /CONFIRM_MAINNET_RENT_RECOVERY=true/);
  assert.doesNotMatch(result.output, /legacy_empty_round_rent_inventory/);
});

test("software-keypair keeper configuration cannot write mainnet", () => {
  const result = runNodeScript("scripts/configure-keeper.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    DRY_RUN: "false",
    CONFIRM_MAINNET_KEEPER_CONFIG: "true",
  });

  assert.notEqual(result.status, 0);
  assert.match(result.output, /Mainnet KeeperConfig writes are Ledger-only/);
  assert.doesNotMatch(result.output, /keeper_configuration_plan/);
});

test("Ledger keeper configuration requires both mainnet and hardware approvals", () => {
  const cases = [
    {},
    { CONFIRM_MAINNET_KEEPER_CONFIG: "true" },
    { CONFIRM_LEDGER_AUTHORITY: "true" },
  ];
  for (const approvals of cases) {
    const result = runNodeScript("scripts/configure-keeper-ledger.mjs", {
      ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
      DRY_RUN: "false",
      ...approvals,
    });

    assert.notEqual(result.status, 0);
    assert.match(result.output, /CONFIRM_MAINNET_KEEPER_CONFIG=true and CONFIRM_LEDGER_AUTHORITY=true/);
    assert.doesNotMatch(result.output, /keeper_configuration_ledger_plan/);
  }
});

test("Ledger KeeperConfig writer is mainnet-pinned, init-only, and plan-hash gated", () => {
  const source = fs.readFileSync("scripts/configure-keeper-ledger.mjs", "utf8");
  assert.match(source, /genesisHash !== MAINNET_GENESIS_HASH/);
  assert.match(source, /KeeperConfig rotation is not authorized by Stage 1/);
  assert.doesNotMatch(source, /\.setKeeper\(/);
  assert.doesNotMatch(source, /process\.env\.LUCKYME_(?:EXPECTED_AUTHORITY|EXPECTED_FEE_PAYER|KEEPER_PUBKEY|LEDGER_PATH)/);
  assert.match(source, /feePayer: EXPECTED_AUTHORITY/);
  assert.doesNotMatch(source, /partialSign|readFeePayer/);
  assert.match(source, /LUCKYME_APPROVED_KEEPER_CONFIG_PLAN_HASH/);
  assert.match(source, /planHash: null/);
  assert.match(source, /simulationStatus: "succeeded"/);
  assert.ok(source.indexOf("simulation.value.err") < source.indexOf("const planHash"));
  assert.ok(source.indexOf("simulateTransaction") < source.indexOf("TransportNodeHid.create"));
  assert.ok(source.indexOf("simulateTransaction") < source.indexOf("sendRawTransaction"));
});

test("legacy operational writers default to dry-run and simulate before rpc", () => {
  const scripts = [
    "scripts/open-round.mjs",
    "scripts/close-empty-round.mjs",
    "scripts/randomness-request.mjs",
    "scripts/randomness-settle.mjs",
    "scripts/settle-round.mjs",
  ];

  for (const script of scripts) {
    const source = fs.readFileSync(path.join(process.cwd(), script), "utf8");
    assert.match(source, /process\.env\.DRY_RUN !== "false"/, script);
    assert.ok(source.indexOf(".simulate()") >= 0, `${script} must simulate`);
    assert.ok(source.indexOf(".simulate()") < source.indexOf(".rpc()"), `${script} must simulate before rpc`);
  }
});

test("standalone commit-reveal and empty crank cannot write mainnet", () => {
  for (const script of ["scripts/open-round.mjs", "scripts/settle-round.mjs"]) {
    const result = runNodeScript(script, {
      ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, /disabled on mainnet/);
  }

  const close = runNodeScript("scripts/close-empty-round.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    DRY_RUN: "false",
  });
  assert.notEqual(close.status, 0);
  assert.match(close.output, /Direct mainnet close-empty is disabled/);

  const crank = runNodeScript("scripts/crank-empty-rounds.mjs", {});
  assert.notEqual(crank.status, 0);
  assert.match(crank.output, /retired and cannot submit transactions/);
});

test("legacy empty-round rotation is retired at both route and builder layers", () => {
  const source = fs.readFileSync("backend/src/server.mjs", "utf8");
  assert.match(source, /\/transactions\/crank-empty-rounds[\s\S]{0,240}idle_round_crank_retired/);
  assert.match(
    source,
    /async function buildCrankEmptyRoundsTransaction\(payload\) \{\s*throw httpError\(\s*410,\s*"idle_round_crank_retired"/,
  );
});

test("direct provider writers require dedicated mainnet approvals", () => {
  const cases = [
    ["scripts/randomness-request.mjs", /CONFIRM_MAINNET_RANDOMNESS_REQUEST=true/],
    ["scripts/randomness-settle.mjs", /CONFIRM_MAINNET_PROVIDER_SETTLEMENT=true/],
  ];

  for (const [script, expected] of cases) {
    const result = runNodeScript(script, {
      ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
      DRY_RUN: "false",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.output, expected);
  }
});

test("direct refund writers are retired in favor of the journaled settlement keeper", () => {
  const result = runNodeScript("scripts/refund-cranker.mjs", {
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    DRY_RUN: "false",
    CONFIRM_MAINNET_REFUND_CRANK: "true",
  });
  assert.notEqual(result.status, 0);
  assert.match(result.output, /Direct refund writes are retired/);

  const backend = fs.readFileSync("backend/src/server.mjs", "utf8");
  assert.match(
    backend,
    /\/transactions\/refund-entry[\s\S]{0,260}automatic_refund_only/,
  );
  assert.doesNotMatch(backend, /program\.methods\s*\.refundEntryAfterTimeout/);
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
