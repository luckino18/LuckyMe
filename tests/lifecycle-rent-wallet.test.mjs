import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  appendRefundJournalEvent,
  appendSettlementArchive,
  latestArchivedSettlement,
  readSettlementArchive,
  refundProgressForRound,
} from "../scripts/settlement-archive.mjs";
import { isConfirmedRefundTransaction } from "../scripts/refund-transaction-verifier.mjs";

const root = process.cwd();
const programSource = fs.readFileSync(path.join(root, "programs/luckyme/src/lib.rs"), "utf8");
const keeperSource = fs.readFileSync(path.join(root, "scripts/settlement-keeper.mjs"), "utf8");
const backendSource = fs.readFileSync(path.join(root, "backend/src/server.mjs"), "utf8");
const webSource = fs.readFileSync(path.join(root, "site/lucky-me.app/app.js"), "utf8");
const webHtml = fs.readFileSync(path.join(root, "site/lucky-me.app/play/index.html"), "utf8");
const walletStandardSource = fs.readFileSync(path.join(root, "site/lucky-me.app/wallet-standard.js"), "utf8");

test("round countdown starts with the first ticket instead of open_round", () => {
  assert.match(programSource, /round\.start_ts = 0;\s*round\.end_ts = 0;/);
  assert.match(programSource, /if ctx\.accounts\.round\.start_ts == 0/);
  assert.match(programSource, /ctx\.accounts\.round\.end_ts = now\s*\.checked_add\(ctx\.accounts\.config\.round_duration_secs\)/);
  assert.match(keeperSource, /action: "wait_first_ticket"/);
});

test("keeper refunds rounds below approved minimums before requesting ORAO", () => {
  const refundBranch = keeperSource.indexOf('reason: "cancelled_below_minimum"');
  const providerBranch = keeperSource.indexOf("handleExpiredRoundWithEntries({");
  assert.ok(refundBranch > 0);
  assert.ok(providerBranch > refundBranch);
  assert.match(keeperSource, /roundMeetsMinimums\(poolSpec, totalTickets, entrantCount\)/);
  assert.match(keeperSource, /action: "refund_cancelled_below_minimum_entry"/);
  assert.match(keeperSource, /action: "blocked_randomness_below_minimum"/);
  assert.match(programSource, /require_round_eligible_for_draw\(&ctx\.accounts\.pool, &ctx\.accounts\.round\)/);
  assert.match(programSource, /require_round_below_draw_minimum\(&ctx\.accounts\.pool, &ctx\.accounts\.round\)/);
});

test("keeper rotates immediately after archive while historical cleanup continues", () => {
  assert.match(
    keeperSource,
    /const archived = await archiveSettledRound\(poolSpec, pool, round, roundAccount\);/,
  );
  assert.match(
    keeperSource,
    /await executeOpenRoundAfterSettlement\(poolSpec, pool, round, currentRound \+ 1\)/,
  );
  assert.match(programSource, /pub fn open_round_after_settlement/);
  assert.match(programSource, /previous_round\.settled/);
  assert.match(programSource, /previous_round\.total_lamports == 0[\s\S]*previous_round\.entrant_count == 0/);
});

test("settled Entry cleanup batches eight players into one simulated transaction", () => {
  assert.match(keeperSource, /SETTLEMENT_KEEPER_ENTRY_CLEANUP_BATCH_SIZE \?\? "8"/);
  assert.match(keeperSource, /const batch = entries\.slice\(0, ENTRY_CLEANUP_BATCH_SIZE\)/);
  assert.match(keeperSource, /action: "close_settled_entry_batch"/);
  assert.match(keeperSource, /const transaction = new Transaction\(\)/);
  assert.match(keeperSource, /simulateAndSendTransaction\(transaction, summary\)/);
});

test("live actions across all pools run before historical cleanup", () => {
  assert.match(
    keeperSource,
    /for \(const poolSpec of pools\) \{[\s\S]*?await handlePool\(poolSpec\);[\s\S]*?if \(ACTION_SCOPE !== OPEN_ROUND_ONLY_SCOPE && executed\.length < MAX_ACTIONS\) \{[\s\S]*?await cleanupHistoricalPool\(poolSpec\);/,
  );
  const liveHandler = keeperSource.slice(
    keeperSource.indexOf("async function handlePool"),
    keeperSource.indexOf("async function cleanupHistoricalPool"),
  );
  assert.doesNotMatch(liveHandler, /cleanupHistoricalRounds/);
});

test("open-round-only scope returns before lifecycle and historical cleanup paths", () => {
  const scopeBranch = keeperSource.indexOf("if (ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE)");
  const lifecycleBranch = keeperSource.indexOf("if (currentRound <= 0)", scopeBranch);
  const historicalCleanup = keeperSource.indexOf("await cleanupHistoricalRounds", scopeBranch);

  assert.ok(scopeBranch > 0);
  assert.ok(lifecycleBranch > scopeBranch);
  assert.ok(historicalCleanup > lifecycleBranch);
  assert.match(
    keeperSource,
    /if \(ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE\) \{\s*await handleOpenRoundOnly\(poolSpec, pool, currentRound\);\s*return;\s*\}/,
  );
  assert.match(keeperSource, /previous Round .* still exists; open_round_only refuses cleanup/);
  assert.match(keeperSource, /action: "open_round_only_ready"/);
  assert.match(keeperSource, /action: "skip_approved_round_exists"/);
  assert.match(keeperSource, /outside the approved open-round allowlist/);
});

test("a missing current Round PDA stays unavailable until the keeper opens the next round", () => {
  assert.match(
    backendSource,
    /const activeRound = fetchedActiveRound\?\.missing \? null : fetchedActiveRound;/,
  );
  assert.match(
    webSource,
    /return round && round\.missing !== true \? round : null;/,
  );
  assert.match(
    webSource,
    /const poolStateReady = state\.onchainAvailable && state\.poolsLoaded &&\s*Boolean\(round\) && hasVerifiedMinimumPolicy\(pool\.id\);/,
  );
  assert.doesNotMatch(
    webSource,
    /const poolStateReady = state\.onchainAvailable && state\.poolsLoaded && Boolean\(livePool\?\.activeRound\);/,
  );
});

test("temporary LuckyMe accounts have explicit rent cleanup paths", () => {
  assert.equal(programSource.match(/close = keeper/g)?.length, 4);
  assert.doesNotMatch(programSource, /close = treasury/);
  assert.match(programSource, /close = keeper,\s*seeds = \[b"round_randomness"/);
  assert.match(programSource, /pub fn close_settled_entry/);
  assert.match(programSource, /pub fn close_settled_round/);
  assert.match(programSource, /close = keeper, has_one = pool/);
  assert.match(programSource, /close = player,\s*constraint = entry\.round/);
  assert.match(programSource, /pub struct KeeperConfig/);
  assert.match(programSource, /keeper_config\.keeper == keeper\.key\(\)/);
  assert.match(programSource, /rent_recipient: ctx\.accounts\.keeper\.key\(\)/);
  assert.match(programSource, /PreviousRoundStillExists/);
});

test("settlement archive is append-only and deduplicated by pool and round", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luckyme-archive-"));
  const file = path.join(dir, "settlements.jsonl");
  const record = { pool: "mini", roundId: 7, settled: true };
  assert.equal(appendSettlementArchive(file, record), true);
  assert.equal(appendSettlementArchive(file, record), false);
  assert.equal(readSettlementArchive(file).length, 1);
});

test("settlement archive identities cannot cross Solana genesis hashes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luckyme-cluster-archive-"));
  const file = path.join(dir, "settlements.jsonl");
  const base = {
    pool: "mini",
    roundId: 7,
    programId: "program-1",
    poolAddress: "pool-1",
    address: "round-7",
    accountDataHash: "hash-1",
  };
  assert.equal(appendSettlementArchive(file, { ...base, genesisHash: "mainnet-genesis" }), true);
  assert.equal(appendSettlementArchive(file, { ...base, genesisHash: "mainnet-genesis" }), false);
  assert.equal(appendSettlementArchive(file, { ...base, genesisHash: "localnet-genesis" }), true);
  assert.equal(readSettlementArchive(file).length, 2);
});

test("settlement archive preserves append-only corrected on-chain account states", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luckyme-corrected-archive-"));
  const file = path.join(dir, "settlements.jsonl");
  const base = {
    genesisHash: "mainnet-genesis",
    programId: "program-1",
    pool: "mini",
    roundId: 7,
    poolAddress: "pool-1",
    address: "round-7",
  };
  assert.equal(appendSettlementArchive(file, {
    ...base,
    accountDataHash: "stale-hash",
    winnerCount: 0,
    winners: [],
  }), true);
  assert.equal(appendSettlementArchive(file, {
    ...base,
    accountDataHash: "confirmed-hash",
    winnerCount: 1,
    winners: [{ rank: 1, winner: "winner-wallet" }],
  }), true);
  const records = readSettlementArchive(file);
  assert.equal(records.length, 2);
  assert.equal(records.at(-1).accountDataHash, "confirmed-hash");
  assert.equal(records.at(-1).winners[0].winner, "winner-wallet");
  assert.equal(
    latestArchivedSettlement(file, "mini", 7, {
      genesisHash: "mainnet-genesis",
      programId: "program-1",
      poolAddress: "pool-1",
      address: "round-7",
    }).accountDataHash,
    "confirmed-hash",
  );
});

test("keeper waits for post-settlement RPC convergence before archiving winners", () => {
  assert.match(keeperSource, /fetchSettledRoundForArchive\(round/);
  assert.match(keeperSource, /latest\.settled && winnersMatch && randomnessMatches/);
  assert.match(keeperSource, /did not converge before archive write/);
});

test("a stale append lock cannot permanently stop keeper recovery after restart", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luckyme-stale-lock-"));
  const file = path.join(dir, "settlements.jsonl");
  const lock = `${file}.lock`;
  fs.writeFileSync(lock, "interrupted keeper\n", { mode: 0o600 });
  const staleAt = new Date(Date.now() - 10 * 60 * 1_000);
  fs.utimesSync(lock, staleAt, staleAt);

  assert.equal(appendSettlementArchive(file, { pool: "mini", roundId: 10 }), true);
  assert.equal(fs.existsSync(lock), false);
  assert.equal(readSettlementArchive(file).length, 1);
});

test("refund progress journal survives restarts and deduplicates confirmed entries", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "luckyme-refunds-"));
  const file = path.join(dir, "settlements.jsonl");
  const identity = {
    programId: "program-1",
    pool: "mini",
    roundId: 9,
    address: "round-9",
  };
  const initialized = {
    eventId: "refund:initialized:mini:9",
    kind: "refund_initialized",
    ...identity,
    originalTotalTickets: "24",
    originalTotalLamports: "120000000",
    originalEntrantCount: 2,
    minimumTickets: 25,
    minimumDistinctEntrants: 1,
    entries: [
      { address: "entry-a", player: "alice", ticketCount: "10", lamports: "50000000" },
      { address: "entry-b", player: "bob", ticketCount: "14", lamports: "70000000" },
    ],
  };
  assert.equal(appendRefundJournalEvent(file, initialized), true);
  assert.equal(appendRefundJournalEvent(file, initialized), false);

  appendRefundJournalEvent(file, {
    eventId: "refund:intent:mini:9:entry-a",
    kind: "refund_intent",
    ...identity,
    entry: "entry-a",
    player: "alice",
    ticketCount: "10",
    lamports: "50000000",
  });
  appendRefundJournalEvent(file, {
    eventId: "refund:confirmed:mini:9:entry-a",
    kind: "refund_confirmed",
    ...identity,
    entry: "entry-a",
    player: "alice",
    ticketCount: "10",
    lamports: "50000000",
    signature: "signature-a",
  });

  const afterRestart = refundProgressForRound(file, identity);
  assert.equal(afterRestart.originalTotalTickets, "24");
  assert.equal(afterRestart.refundsCompleted, 1);
  assert.equal(afterRestart.refundsPending, 1);
  assert.deepEqual(afterRestart.refundSignatures, ["signature-a"]);
  assert.equal(
    appendRefundJournalEvent(file, {
      eventId: "refund:confirmed:mini:9:entry-a",
      kind: "refund_confirmed",
      ...identity,
      entry: "entry-a",
      signature: "different-signature-must-not-overwrite",
    }),
    false,
  );
});

test("restart recovery accepts only the exact refund instruction and exact player credit", () => {
  const intent = {
    programId: "program-1",
    address: "round-9",
    entry: "entry-a",
    player: "alice",
    lamports: "50000000",
  };
  const accountKeys = ["keeper", "program-1", "round-9", "entry-a", "alice"];
  const valid = {
    transaction: { message: { accountKeys } },
    meta: {
      err: null,
      logMessages: ["Program log: Instruction: RefundEntryAfterTimeout"],
      preBalances: [100000000, 1, 2895360, 1566000, 10000000],
      postBalances: [99995000, 1, 2895360, 0, 61566000],
    },
  };

  assert.equal(isConfirmedRefundTransaction(valid, intent), true);
  assert.equal(
    isConfirmedRefundTransaction({
      ...valid,
      meta: { ...valid.meta, logMessages: ["Program log: Instruction: CloseSettledEntry"] },
    }, intent),
    false,
  );
  assert.equal(
    isConfirmedRefundTransaction({
      ...valid,
      meta: { ...valid.meta, postBalances: [99995000, 1, 2895360, 0, 61565999] },
    }, intent),
    false,
  );
  assert.equal(
    isConfirmedRefundTransaction(valid, { ...intent, address: "different-round" }),
    false,
  );
});

test("keeper archive lookup uses stable PDA identity while cleanup mutates entrant_count", () => {
  assert.match(
    keeperSource,
    /const archiveIdentity = \{\s*genesisHash,\s*programId:[\s\S]{0,220}address: round\.toBase58\(\),\s*\};/,
  );
  assert.doesNotMatch(
    keeperSource,
    /const archiveIdentity = \{[^}]*accountDataHash/s,
  );
  assert.match(keeperSource, /latestArchivedSettlement\(/);
  assert.match(keeperSource, /archiveMatchesSettledState\(latestArchive, roundAccount\)/);
});

test("web wallet selector is a popup with detected wallets and WalletConnect", () => {
  assert.match(webHtml, /role="dialog" aria-modal="true"/);
  assert.match(webSource, /function openWalletModal\(\)/);
  assert.match(webSource, /Installed wallets/);
  assert.match(webSource, /Reown \/ WalletConnect/);
  assert.match(walletStandardSource, /wallet-standard:app-ready/);
  assert.match(walletStandardSource, /wallet-standard:register-wallet/);
  assert.match(walletStandardSource, /solana:signTransaction/);
  assert.match(webSource, /PublicKey\.isOnCurve/);
  assert.match(webSource, /5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d/);
  assert.match(webSource, /coinbaseSolana/);
  assert.match(webSource, /okxwallet/);
  assert.doesNotMatch(webSource, /\/transactions\/crank-empty-rounds/);
});
