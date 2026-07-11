import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  PROGRAM_ID,
  anchorAccountDiscriminator,
} from "../scripts/anchor-client.mjs";
import {
  classifyLegacyEmptyRound,
  recoveryPlanHash,
  requireExecutionConfirmation,
  validateAndDecodeAccount,
} from "../scripts/recover-legacy-empty-round-rent.mjs";

const empty = Object.freeze({
  startTs: 100,
  endTs: 200,
  settled: false,
  totalTickets: 0n,
  totalLamports: 0n,
  entrantCount: 0,
  current: false,
  now: 300,
  entryAccountCount: 0,
  sidecarAccountCount: 0,
});

test("legacy recovery classifies only expired empty rounds as eligible", () => {
  assert.deepEqual(classifyLegacyEmptyRound(empty), {
    classification: "eligible_expired_legacy_empty",
    eligible: true,
    action: "close_empty_round_after_timeout",
  });
  assert.deepEqual(classifyLegacyEmptyRound({ ...empty, settled: true }), {
    classification: "eligible_settled_legacy_empty",
    eligible: true,
    action: "close_settled_round",
  });
});

test("current waiting round and non-expired round can never be recovered", () => {
  assert.equal(classifyLegacyEmptyRound({
    ...empty,
    startTs: 0,
    endTs: 0,
    current: true,
  }).classification, "waiting_for_first_ticket");
  assert.equal(classifyLegacyEmptyRound({ ...empty, endTs: 400 }).classification, "empty_but_not_expired");
});

test("tickets, funds, entrants, Entry accounts, and sidecars block recovery independently", () => {
  const cases = [
    [{ totalTickets: 1n }, "contains_tickets_or_funds"],
    [{ totalLamports: 1n }, "contains_tickets_or_funds"],
    [{ entrantCount: 1 }, "contains_tickets_or_funds"],
    [{ entryAccountCount: 1 }, "entry_accounts_present"],
    [{ sidecarAccountCount: 1 }, "randomness_sidecar_present"],
  ];
  for (const [override, expected] of cases) {
    const result = classifyLegacyEmptyRound({ ...empty, ...override });
    assert.equal(result.eligible, false);
    assert.equal(result.classification, expected);
  }
});

test("mainnet execution requires both explicit write flags", () => {
  assert.throws(
    () => requireExecutionConfirmation({ dryRun: false, mainnet: true, confirmed: false }),
    /CONFIRM_MAINNET_RENT_RECOVERY=true/,
  );
  assert.doesNotThrow(
    () => requireExecutionConfirmation({ dryRun: true, mainnet: true, confirmed: false }),
  );
  assert.doesNotThrow(
    () => requireExecutionConfirmation({ dryRun: false, mainnet: true, confirmed: true }),
  );
});

test("approved recovery plan hash is stable across read-only slot changes", () => {
  const inventory = {
    genesisHash: "mainnet-genesis",
    programId: PROGRAM_ID.toBase58(),
    config: Keypair.generate().publicKey.toBase58(),
    treasury: Keypair.generate().publicKey.toBase58(),
    keeper: Keypair.generate().publicKey.toBase58(),
    slot: 100,
    eligible: [{
      pool: "mini",
      poolAddress: Keypair.generate().publicKey.toBase58(),
      roundId: 1,
      round: Keypair.generate().publicKey.toBase58(),
      lamports: 2_895_360,
      accountDataHash: "abc123",
      action: "close_empty_round_after_timeout",
      destination: Keypair.generate().publicKey.toBase58(),
    }],
  };
  const approvedHash = recoveryPlanHash(inventory);
  assert.equal(recoveryPlanHash({ ...inventory, slot: 999 }), approvedHash);
  assert.notEqual(
    recoveryPlanHash({
      ...inventory,
      eligible: [{ ...inventory.eligible[0], lamports: 2_895_361 }],
    }),
    approvedHash,
  );
});

test("raw program accounts reject wrong owner, size, and discriminator before decoding", () => {
  const address = Keypair.generate().publicKey;
  const size = 288;
  const data = Buffer.alloc(size);
  anchorAccountDiscriminator("account:Round").copy(data, 0);
  const decoded = { marker: "decoded" };
  const program = {
    account: { round: { size } },
    coder: { accounts: { decode: (name) => name === "round" ? decoded : null } },
  };
  const validInfo = { owner: PROGRAM_ID, data };

  assert.equal(validateAndDecodeAccount({ address, info: validInfo, program, kind: "round" }), decoded);
  assert.throws(
    () => validateAndDecodeAccount({
      address,
      info: { ...validInfo, owner: Keypair.generate().publicKey },
      program,
      kind: "round",
    }),
    /unexpected owner/,
  );
  assert.throws(
    () => validateAndDecodeAccount({
      address,
      info: { ...validInfo, data: Buffer.alloc(size - 1) },
      program,
      kind: "round",
    }),
    /expected 288/,
  );
  assert.throws(
    () => validateAndDecodeAccount({
      address,
      info: { ...validInfo, data: Buffer.alloc(size) },
      program,
      kind: "round",
    }),
    /invalid discriminator/,
  );
});

test("dedicated recovery utility cannot construct ORAO requests or open rounds", () => {
  const source = fs.readFileSync("scripts/recover-legacy-empty-round-rent.mjs", "utf8");
  assert.doesNotMatch(source, /requestOrao|requestRandomness|\.openRound\(/);
  assert.match(source, /closeEmptyRoundAfterTimeout/);
  assert.match(source, /closeSettledRound/);
});
