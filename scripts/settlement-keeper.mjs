import crypto from "node:crypto";
import oraoVrf from "@orao-network/solana-vrf";
import { Transaction } from "@solana/web3.js";
import {
  ORAO_VRF_PROGRAM_ID,
  POOLS,
  PROGRAM_ID,
  PublicKey,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveKeeperConfig,
  deriveJackpotVault,
  deriveOraoRandomnessAccount,
  derivePool,
  derivePoolVault,
  deriveProviderRoundRandomness,
  deriveRound,
  deriveRoundRandomnessAccount,
  mainPrizePayouts,
  parseOraoRandomnessV2,
  poolMinimums,
  randomModDomain,
  roundMeetsMinimums,
  selectWinnerTickets,
} from "./anchor-client.mjs";
import {
  appendRefundJournalEvent,
  appendSettlementArchive,
  latestArchivedSettlement,
  refundProgressForRound,
} from "./settlement-archive.mjs";
import { isConfirmedRefundTransaction } from "./refund-transaction-verifier.mjs";

const { Orao } = oraoVrf;

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const ACTIVE_KEEPER = "6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N";
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const DRY_RUN = process.env.DRY_RUN !== "false";
const RANDOMNESS_MODE = process.env.LUCKYME_RANDOMNESS_MODE ?? "orao_vrf";
const POOL_FILTER = process.env.POOL?.toLowerCase();
const MAX_ACTIONS = positiveInteger(process.env.SETTLEMENT_KEEPER_MAX_ACTIONS ?? "1", "SETTLEMENT_KEEPER_MAX_ACTIONS");
const MIN_KEEPER_BALANCE_LAMPORTS = nonNegativeInteger(
  process.env.SETTLEMENT_KEEPER_MIN_BALANCE_LAMPORTS ?? "50000000",
  "SETTLEMENT_KEEPER_MIN_BALANCE_LAMPORTS",
);
const OPEN_NEXT_AFTER_SETTLEMENT = process.env.SETTLEMENT_KEEPER_OPEN_NEXT_AFTER_SETTLEMENT !== "false";
const SETTLEMENT_ARCHIVE_PATH = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH ?? "";
const CLEANUP_SCAN_ROUNDS = positiveInteger(
  process.env.SETTLEMENT_KEEPER_CLEANUP_SCAN_ROUNDS ?? "20",
  "SETTLEMENT_KEEPER_CLEANUP_SCAN_ROUNDS",
);
const REFUND_DELAY_SECONDS = 600;
const ENTRY_CLEANUP_BATCH_SIZE = positiveInteger(
  process.env.SETTLEMENT_KEEPER_ENTRY_CLEANUP_BATCH_SIZE ?? "8",
  "SETTLEMENT_KEEPER_ENTRY_CLEANUP_BATCH_SIZE",
);
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));
const OPEN_ROUND_ONLY_SCOPE = "open_round_only";
const ACTION_SCOPE = process.env.SETTLEMENT_KEEPER_ACTION_SCOPE ?? "full_lifecycle";
const APPROVED_OPEN_ROUNDS = parseApprovedOpenRounds(
  process.env.SETTLEMENT_KEEPER_APPROVED_OPEN_ROUNDS ?? "",
);

if (!["full_lifecycle", OPEN_ROUND_ONLY_SCOPE].includes(ACTION_SCOPE)) {
  throw new Error(
    "SETTLEMENT_KEEPER_ACTION_SCOPE must be full_lifecycle or open_round_only",
  );
}
if (ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE && APPROVED_OPEN_ROUNDS.size === 0) {
  throw new Error(
    "open_round_only requires SETTLEMENT_KEEPER_APPROVED_OPEN_ROUNDS=pool:roundId[,pool:roundId]",
  );
}
if (ACTION_SCOPE !== OPEN_ROUND_ONLY_SCOPE && APPROVED_OPEN_ROUNDS.size > 0) {
  throw new Error(
    "SETTLEMENT_KEEPER_APPROVED_OPEN_ROUNDS is valid only with SETTLEMENT_KEEPER_ACTION_SCOPE=open_round_only",
  );
}

requireOraoMode();
requireMainnetWriteConfirmation(RPC_URL, false);

if (POOL_FILTER && !POOL_BY_SLUG.has(POOL_FILTER)) {
  throw new Error(`Unknown POOL=${POOL_FILTER}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const readonlyClient = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await readonlyClient.connection.getGenesisHash();
const mainnet = genesisHash === MAINNET_GENESIS_HASH;
requireMainnetWriteConfirmation(RPC_URL, mainnet);
const { connection, payer, program, provider, url } = DRY_RUN
  ? readonlyClient
  : createClient({ requireSigner: true, url: RPC_URL });
const config = deriveConfig();
const keeperConfig = deriveKeeperConfig(config);
const scopedPools = ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE
  ? POOLS.filter((pool) => APPROVED_OPEN_ROUNDS.has(pool.slug))
  : POOLS;
const pools = POOL_FILTER ? [POOL_BY_SLUG.get(POOL_FILTER)] : scopedPools;
if (
  ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE &&
  POOL_FILTER &&
  !APPROVED_OPEN_ROUNDS.has(POOL_FILTER)
) {
  throw new Error(`POOL=${POOL_FILTER} is not in SETTLEMENT_KEEPER_APPROVED_OPEN_ROUNDS`);
}
let keeper = payer?.publicKey ?? null;
const planned = [];
const executed = [];

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}
if (!(await accountExists(connection, keeperConfig))) {
  planned.push({
    action: "keeper_config_missing",
    keeperConfig: keeperConfig.toBase58(),
    requiredKeeper: process.env.LUCKYME_EXPECTED_KEEPER_PUBKEY ?? ACTIVE_KEEPER,
  });
  printStart();
  printDone();
  process.exit(0);
}

const keeperConfigAccount = await program.account.keeperConfig.fetch(keeperConfig);
const expectedKeeper = new PublicKey(process.env.LUCKYME_EXPECTED_KEEPER_PUBKEY ?? ACTIVE_KEEPER);
keeper ??= keeperConfigAccount.keeper;
if (mainnet && !keeperConfigAccount.keeper.equals(expectedKeeper)) {
  throw new Error(
    `On-chain keeper ${keeperConfigAccount.keeper.toBase58()} does not match expected keeper ${expectedKeeper.toBase58()}`,
  );
}
if (payer && !payer.publicKey.equals(keeperConfigAccount.keeper)) {
  throw new Error(
    `Configured signer ${payer.publicKey.toBase58()} is not on-chain keeper ${keeperConfigAccount.keeper.toBase58()}`,
  );
}

printStart();

if (!DRY_RUN && keeper) {
  const keeperBalanceLamports = await connection.getBalance(keeper, "confirmed");
  if (keeperBalanceLamports < MIN_KEEPER_BALANCE_LAMPORTS) {
    planned.push({
      action: "keeper_needs_funding",
      keeper: keeper.toBase58(),
      balanceLamports: keeperBalanceLamports,
      requiredLamports: MIN_KEEPER_BALANCE_LAMPORTS,
    });
    printDone();
    process.exit(0);
  }
}

for (const poolSpec of pools) {
  if (executed.length >= MAX_ACTIONS) {
    break;
  }

  await handlePool(poolSpec);
}

// Historical rent cleanup is deliberately lower priority than every live-round
// action across every pool. With a one-transaction execution limit, doing this
// inside handlePool could let an old Mini entry delay a Normal/High/Premium
// settlement for another minute (or for an entire large cleanup backlog).
if (ACTION_SCOPE !== OPEN_ROUND_ONLY_SCOPE && executed.length < MAX_ACTIONS) {
  for (const poolSpec of pools) {
    if (executed.length >= MAX_ACTIONS) {
      break;
    }
    await cleanupHistoricalPool(poolSpec);
  }
}

printDone();

async function handlePool(poolSpec) {
  const pool = derivePool(config, poolSpec.id);
  if (!(await accountExists(connection, pool))) {
    planned.push({ pool: poolSpec.slug, action: "skip_pool_missing", poolAddress: pool.toBase58() });
    return;
  }

  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = Number(poolAccount.currentRound.toString());
  if (ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE) {
    await handleOpenRoundOnly(poolSpec, pool, currentRound);
    return;
  }
  if (currentRound <= 0) {
    await executeOpenRound(poolSpec, pool, 1);
    return;
  }

  const round = deriveRound(pool, currentRound);
  if (!(await accountExists(connection, round))) {
    planned.push({ pool: poolSpec.slug, action: "open_after_cleaned_round", roundId: currentRound + 1, previousRoundId: currentRound });
    await executeOpenRound(poolSpec, pool, currentRound + 1);
    return;
  }

  const roundAccount = await program.account.round.fetch(round);
  const endTs = Number(roundAccount.endTs.toString());
  const now = Math.floor(Date.now() / 1000);
  const expired = endTs > 0 && now >= endTs;
  const totalTickets = BigInt(roundAccount.totalTickets.toString());
  const totalLamports = BigInt(roundAccount.totalLamports.toString());
  const empty = totalTickets === 0n &&
    totalLamports === 0n &&
    Number(roundAccount.entrantCount) === 0;

  if (roundAccount.settled) {
    if (roundIsRefundMode(roundAccount) && totalLamports > 0n) {
      await executeNextRefund(poolSpec, pool, round, roundAccount);
      return;
    }
    const archived = await archiveSettledRound(poolSpec, pool, round, roundAccount);
    if (!archived) {
      planned.push({
        pool: poolSpec.slug,
        action: "skip_rotation_archive_missing",
        roundId: currentRound,
      });
      return;
    }
    if (OPEN_NEXT_AFTER_SETTLEMENT) {
      await executeOpenRoundAfterSettlement(poolSpec, pool, round, currentRound + 1);
      return;
    }
    await cleanupSettledRound(poolSpec, pool, round, roundAccount);
    return;
  }

  if (endTs === 0) {
    planned.push({
      pool: poolSpec.slug,
      action: "wait_first_ticket",
      roundId: currentRound,
      round: round.toBase58(),
    });
    return;
  }

  if (!expired) {
    planned.push({ pool: poolSpec.slug, action: "skip_round_open", roundId: currentRound, endTs });
    return;
  }

  if (empty) {
    await executeCloseEmptyRound(poolSpec, pool, round, currentRound);
    return;
  }

  const entrantCount = Number(roundAccount.entrantCount);
  const minimums = poolMinimums(poolSpec);
  if (!roundMeetsMinimums(poolSpec, totalTickets, entrantCount)) {
    await executeNextRefund(poolSpec, pool, round, roundAccount, {
      reason: "cancelled_below_minimum",
      minimumTickets: minimums.minimumTickets,
      minimumDistinctEntrants: minimums.minimumDistinctEntrants,
      totalTickets: totalTickets.toString(),
      entrantCount,
    });
    return;
  }

  await handleExpiredRoundWithEntries({
    poolSpec,
    pool,
    poolAccount,
    round,
    roundAccount,
    roundId: currentRound,
    totalTickets,
  });

}

async function cleanupHistoricalPool(poolSpec) {
  const pool = derivePool(config, poolSpec.id);
  if (!(await accountExists(connection, pool))) {
    return;
  }
  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = Number(poolAccount.currentRound.toString());
  if (currentRound > 1) {
    await cleanupHistoricalRounds(poolSpec, pool, currentRound);
  }
}

async function handleOpenRoundOnly(poolSpec, pool, currentRound) {
  const approvedRoundId = APPROVED_OPEN_ROUNDS.get(poolSpec.slug);
  if (!approvedRoundId) {
    throw new Error(`${poolSpec.slug} has no approved open-round target`);
  }

  const targetRound = deriveRound(pool, approvedRoundId);
  if (await accountExists(connection, targetRound)) {
    const targetState = await program.account.round.fetch(targetRound);
    if (
      Number(targetState.roundId.toString()) !== approvedRoundId ||
      !targetState.pool.equals(pool) ||
      currentRound !== approvedRoundId
    ) {
      throw new Error(`${poolSpec.slug} approved Round PDA exists with unexpected state`);
    }
    planned.push({
      pool: poolSpec.slug,
      action: "skip_approved_round_exists",
      roundId: approvedRoundId,
      round: targetRound.toBase58(),
    });
    return;
  }

  if (currentRound !== approvedRoundId - 1) {
    throw new Error(
      `${poolSpec.slug} currentRound=${currentRound}; expected ${approvedRoundId - 1} before opening ${approvedRoundId}`,
    );
  }

  const previousRound = deriveRound(pool, currentRound);
  if (await accountExists(connection, previousRound)) {
    throw new Error(
      `${poolSpec.slug} previous Round ${previousRound.toBase58()} still exists; open_round_only refuses cleanup`,
    );
  }

  planned.push({
    pool: poolSpec.slug,
    action: "open_round_only_ready",
    roundId: approvedRoundId,
    previousRoundId: currentRound,
    previousRound: previousRound.toBase58(),
    round: targetRound.toBase58(),
  });
  await executeOpenRound(poolSpec, pool, approvedRoundId);
}

async function handleExpiredRoundWithEntries({
  poolSpec,
  pool,
  poolAccount,
  round,
  roundAccount,
  roundId,
  totalTickets,
}) {
  const entrantCount = Number(roundAccount.entrantCount);
  if (!roundMeetsMinimums(poolSpec, totalTickets, entrantCount)) {
    const minimums = poolMinimums(poolSpec);
    planned.push({
      pool: poolSpec.slug,
      action: "blocked_randomness_below_minimum",
      roundId,
      totalTickets: totalTickets.toString(),
      entrantCount,
      ...minimums,
    });
    return;
  }
  const roundRandomness = deriveRoundRandomnessAccount(round);
  const sidecarExists = await accountExists(connection, roundRandomness);

  if (!sidecarExists) {
    await executeRequestRandomness(poolSpec, pool, round, roundId, roundRandomness);
    return;
  }

  const sidecar = await program.account.roundRandomness.fetch(roundRandomness);
  const seed = Buffer.from(sidecar.randomnessSeed);
  const request = sidecar.request;
  const expectedRequest = deriveOraoRandomnessAccount(seed, ORAO_VRF_PROGRAM_ID);
  if (!request.equals(expectedRequest)) {
    planned.push({
      pool: poolSpec.slug,
      action: "error_orao_request_mismatch",
      roundId,
      request: request.toBase58(),
      expectedRequest: expectedRequest.toBase58(),
    });
    return;
  }

  const providerAccount = await connection.getAccountInfo(request, "confirmed");
  if (!providerAccount) {
    await executeRequestOraoRandomness(poolSpec, round, roundId, seed, request);
    return;
  }

  if (!providerAccount.owner.equals(ORAO_VRF_PROGRAM_ID)) {
    planned.push({
      pool: poolSpec.slug,
      action: "error_invalid_orao_owner",
      roundId,
      request: request.toBase58(),
      owner: providerAccount.owner.toBase58(),
    });
    return;
  }

  const parsed = parseOraoRandomnessV2(providerAccount.data);
  if (parsed.status === "pending") {
    planned.push({ pool: poolSpec.slug, action: "wait_orao_pending", roundId, request: request.toBase58() });
    return;
  }
  if (parsed.status !== "fulfilled") {
    planned.push({
      pool: poolSpec.slug,
      action: "error_orao_invalid",
      roundId,
      request: request.toBase58(),
      error: parsed.error ?? parsed.status,
    });
    return;
  }
  if (!parsed.seed.equals(seed)) {
    planned.push({
      pool: poolSpec.slug,
      action: "error_orao_seed_mismatch",
      roundId,
      request: request.toBase58(),
    });
    return;
  }

  await executeSettleProviderRound({
    poolSpec,
    pool,
    poolAccount,
    round,
    roundAccount,
    roundRandomness,
    request,
    parsedRandomness: parsed,
    roundId,
    totalTickets,
  });

  // The settled Round and its Entry accounts must be archived and closed on a
  // later keeper pass before open_round can advance the pool. The on-chain
  // previous_round gate enforces this ordering even if the process restarts.
}

async function executeRequestRandomness(poolSpec, pool, round, roundId, roundRandomness) {
  const roundAccount = await program.account.round.fetch(round);
  const totalTickets = BigInt(roundAccount.totalTickets.toString());
  const entrantCount = Number(roundAccount.entrantCount);
  if (!roundMeetsMinimums(poolSpec, totalTickets, entrantCount)) {
    planned.push({
      pool: poolSpec.slug,
      action: "blocked_randomness_below_minimum",
      roundId,
      totalTickets: totalTickets.toString(),
      entrantCount,
      ...poolMinimums(poolSpec),
    });
    return;
  }
  const summary = {
    pool: poolSpec.slug,
    action: "request_randomness",
    roundId,
    round: round.toBase58(),
    roundRandomness: roundRandomness.toBase58(),
  };
  planned.push(summary);
  if (DRY_RUN || !canExecute()) {
    return;
  }

  const method = program.methods
    .requestRandomness()
    .accounts({
      keeper,
      config,
      keeperConfig,
      pool,
      round,
      roundRandomness,
      systemProgram: SystemProgram.programId,
    });
  const signature = await simulateAndSend(method, summary);
  executed.push({ ...summary, signature });
}

async function executeRequestOraoRandomness(poolSpec, round, roundId, seed, request) {
  const summary = {
    pool: poolSpec.slug,
    action: "request_orao_randomness",
    roundId,
    request: request.toBase58(),
    seed: seed.toString("hex"),
  };
  planned.push(summary);
  if (DRY_RUN || !canExecute()) {
    return;
  }

  await assertRoundEligibleForProviderSpend(poolSpec, round, roundId);
  const vrf = new Orao(provider, ORAO_VRF_PROGRAM_ID);
  const builder = await vrf.request(seed);
  builder.withComputeUnitPrice(0n);
  const method = await builder.build();
  const signature = await simulateAndSend(
    method,
    summary,
    () => assertRoundEligibleForProviderSpend(poolSpec, round, roundId),
  );
  executed.push({ ...summary, signature });
}

async function executeSettleProviderRound({
  poolSpec,
  pool,
  poolAccount,
  round,
  roundAccount,
  roundRandomness,
  request,
  parsedRandomness,
  roundId,
  totalTickets,
}) {
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);
  const configAccount = await program.account.config.fetch(config);
  const entries = await fetchEntriesForRound(round);
  const randomness = deriveProviderRoundRandomness(
    round,
    totalTickets,
    parsedRandomness.randomness,
  );
  const poolConfig = poolSettlementConfig(poolAccount, poolSpec);
  const entrantCount = Number(roundAccount.entrantCount);
  if (!roundMeetsMinimums(poolSpec, totalTickets, entrantCount)) {
    planned.push({
      pool: poolSpec.slug,
      action: "blocked_settlement_below_minimum",
      roundId,
      totalTickets: totalTickets.toString(),
      entrantCount,
      ...poolMinimums(poolSpec),
    });
    return;
  }

  const winnerTickets = selectWinnerTickets(randomness, totalTickets, poolConfig.winnerCount);
  const winnerEntries = winnerTickets
    .slice(0, poolConfig.winnerCount)
    .map((ticket, index) => findEntryByTicket(entries, ticket, `winner ${index + 1}`));
  const jackpotTicket = randomModDomain(randomness, "jackpot-winner", 0, totalTickets);
  const jackpotEntry = findEntryByTicket(entries, jackpotTicket, "jackpot");
  const houseFee = bpsAmount(roundAccount.totalLamports, configAccount.houseFeeBps);
  const jackpotAdd = bpsAmount(roundAccount.totalLamports, configAccount.jackpotBps);
  const mainPrize = BigInt(roundAccount.totalLamports.toString()) - houseFee - jackpotAdd;
  const prizePayouts = mainPrizePayouts(mainPrize, poolConfig);
  const jackpotTriggered = randomModDomain(
    randomness,
    "jackpot-roll",
    0,
    BigInt(configAccount.jackpotOddsDenominator.toString()),
  ) === 0n;
  const jackpotPayout = jackpotTriggered
    ? BigInt(poolAccount.jackpotLamports.toString()) + jackpotAdd
    : 0n;
  const winnerEntry = winnerEntries[0];
  const summary = {
    pool: poolSpec.slug,
    action: "settle_provider_round",
    roundId,
    request: request.toBase58(),
    totalTickets: totalTickets.toString(),
    winner: winnerEntry.player.toBase58(),
    winnerTicket: winnerTickets[0].toString(),
    firstPrizeLamports: prizePayouts[0].toString(),
  };
  planned.push(summary);
  if (DRY_RUN || !canExecute()) {
    return;
  }

  const method = program.methods
    .settleRoundWithProviderRandomness()
    .accounts({
      keeper,
      config,
      keeperConfig,
      pool,
      round,
      roundRandomness,
      providerRandomness: request,
      poolVault,
      jackpotVault,
      winner: winnerEntry.player,
      winnerEntry: winnerEntry.address,
      jackpotWinner: jackpotEntry.player,
      jackpotEntry: jackpotEntry.address,
      treasury: configAccount.treasury,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingWinnerAccounts(winnerEntries));
  const signature = await simulateAndSend(method, summary);
  executed.push({ ...summary, signature });

  const settledRound = await fetchSettledRoundForArchive(round, {
    winners: winnerEntries.map((entry) => entry.player),
    randomness,
  });
  await archiveSettledRound(poolSpec, pool, round, settledRound, signature, {
    houseFeeBps: Number(configAccount.houseFeeBps),
    jackpotBps: Number(configAccount.jackpotBps),
    houseFeeLamports: houseFee.toString(),
    jackpotAddLamports: jackpotAdd.toString(),
    mainPrizeLamports: mainPrize.toString(),
    prizePayouts: prizePayouts.map(String),
    winningTickets: winnerTickets.map(String),
    jackpotPayoutLamports: jackpotPayout.toString(),
  });
}

async function fetchSettledRoundForArchive(round, expected, attempts = 8) {
  let latest = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    latest = await program.account.round.fetch(round);
    const actualWinners = [latest.winner, latest.winnerSecond, latest.winnerThird]
      .filter((winner) => winner && !winner.equals(SystemProgram.programId));
    const winnersMatch = expected.winners.every((winner, index) =>
      actualWinners[index]?.equals(winner));
    const randomnessMatches = Buffer.from(latest.randomness).equals(Buffer.from(expected.randomness));
    if (latest.settled && winnersMatch && randomnessMatches) {
      return latest;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(
    `Settled Round ${round.toBase58()} did not converge before archive write`,
  );
}

async function executeCloseEmptyRound(poolSpec, pool, round, roundId) {
  const configAccount = await program.account.config.fetch(config);
  const summary = {
    pool: poolSpec.slug,
    action: "close_empty_round",
    roundId,
    round: round.toBase58(),
  };
  planned.push(summary);
  if (DRY_RUN || !canExecute()) {
    return;
  }

  const method = program.methods
    .closeEmptyRoundAfterTimeout()
    .accounts({
      keeper,
      config,
      keeperConfig,
      pool,
      round,
      treasury: configAccount.treasury,
    });
  const signature = await simulateAndSend(method, summary);
  executed.push({ ...summary, signature });
}

async function cleanupHistoricalRounds(poolSpec, pool, currentRound) {
  if (!SETTLEMENT_ARCHIVE_PATH || executed.length >= MAX_ACTIONS) {
    if (!SETTLEMENT_ARCHIVE_PATH) {
      planned.push({ pool: poolSpec.slug, action: "cleanup_waits_for_archive_path" });
    }
    return;
  }

  const firstRound = Math.max(1, currentRound - CLEANUP_SCAN_ROUNDS);
  for (let roundId = currentRound - 1; roundId >= firstRound; roundId -= 1) {
    if (executed.length >= MAX_ACTIONS) {
      return;
    }
    const round = deriveRound(pool, roundId);
    if (!(await accountExists(connection, round))) {
      continue;
    }
    const roundAccount = await program.account.round.fetch(round);
    if (!roundAccount.settled) {
      continue;
    }
    await cleanupSettledRound(poolSpec, pool, round, roundAccount);
  }
}

async function cleanupSettledRound(poolSpec, pool, round, roundAccount) {
  const roundId = Number(roundAccount.roundId.toString());
  if (roundIsRefundMode(roundAccount) && BigInt(roundAccount.totalLamports.toString()) > 0n) {
    await executeNextRefund(poolSpec, pool, round, roundAccount);
    return;
  }
  const archived = await archiveSettledRound(poolSpec, pool, round, roundAccount);
  if (!archived) {
    planned.push({ pool: poolSpec.slug, action: "skip_cleanup_archive_missing", roundId });
    return;
  }

  const roundRandomness = deriveRoundRandomnessAccount(round);
  if (await accountExists(connection, roundRandomness)) {
    const configAccount = await program.account.config.fetch(config);
    const summary = {
      pool: poolSpec.slug,
      action: "close_settled_randomness",
      roundId,
      roundRandomness: roundRandomness.toBase58(),
      rentRecipient: keeper.toBase58(),
    };
    planned.push(summary);
    if (!DRY_RUN && canExecute()) {
      const method = program.methods
        .closeSettledRandomness()
        .accounts({
          keeper,
          config,
          keeperConfig,
          round,
          roundRandomness,
          treasury: configAccount.treasury,
        });
      const signature = await simulateAndSend(method, summary);
      executed.push({ ...summary, signature });
    }
    return;
  }

  const entries = await fetchEntriesForRound(round);
  if (entries.length) {
    const batch = entries.slice(0, ENTRY_CLEANUP_BATCH_SIZE);
    const summary = {
      pool: poolSpec.slug,
      action: "close_settled_entry_batch",
      roundId,
      entryCount: batch.length,
      remainingBefore: entries.length,
      entries: batch.map((entry) => ({
        entry: entry.address.toBase58(),
        player: entry.player.toBase58(),
      })),
    };
    planned.push(summary);
    if (!DRY_RUN && canExecute()) {
      const transaction = new Transaction();
      for (const entry of batch) {
        transaction.add(await program.methods
          .closeSettledEntry()
          .accounts({
            keeper,
            config,
            keeperConfig,
            player: entry.player,
            round,
            entry: entry.address,
          })
          .instruction());
      }
      const signature = await simulateAndSendTransaction(transaction, summary);
      executed.push({ ...summary, signature });
    }
    return;
  }

  const configAccount = await program.account.config.fetch(config);
  const summary = {
    pool: poolSpec.slug,
    action: "close_settled_round",
    roundId,
    round: round.toBase58(),
    rentRecipient: keeper.toBase58(),
    treasury: configAccount.treasury.toBase58(),
  };
  planned.push(summary);
  if (!DRY_RUN && canExecute()) {
    const method = program.methods
      .closeSettledRound()
      .accounts({
        keeper,
        config,
        keeperConfig,
        pool,
        round,
        roundRandomness: deriveRoundRandomnessAccount(round),
        treasury: configAccount.treasury,
      });
    const signature = await simulateAndSend(method, summary);
    executed.push({ ...summary, signature });
  }
}

async function executeNextRefund(poolSpec, pool, round, roundAccount, details = {}) {
  const roundId = Number(roundAccount.roundId.toString());
  const refundAfterTs = Number(roundAccount.endTs.toString()) + REFUND_DELAY_SECONDS;
  const now = Math.floor(Date.now() / 1000);
  if (now < refundAfterTs) {
    planned.push({
      pool: poolSpec.slug,
      action: "wait_refund_timeout",
      roundId,
      refundAfterTs,
      ...details,
    });
    return;
  }

  if (!SETTLEMENT_ARCHIVE_PATH) {
    planned.push({
      pool: poolSpec.slug,
      action: "refund_waits_for_archive_path",
      roundId,
      ...details,
    });
    return;
  }

  const entries = await fetchEntriesForRound(round);
  if (!entries.length) {
    planned.push({ pool: poolSpec.slug, action: "error_refund_entries_missing", roundId, ...details });
    return;
  }

  const identity = refundIdentity(poolSpec, round, roundId);
  let progress = refundProgressForRound(SETTLEMENT_ARCHIVE_PATH, identity);
  if (!progress && roundAccount.settled) {
    planned.push({
      pool: poolSpec.slug,
      action: "error_refund_journal_missing_for_active_refund",
      roundId,
      ...details,
    });
    return;
  }
  if (!progress && !DRY_RUN) {
    const minimums = poolMinimums(poolSpec);
    appendRefundJournalEvent(SETTLEMENT_ARCHIVE_PATH, {
      eventId: refundEventId("initialized", identity),
      kind: "refund_initialized",
      ...identity,
      roundOutcome: "cancelled_below_minimum",
      refundStatus: "pending",
      startTs: Number(roundAccount.startTs.toString()),
      endTs: Number(roundAccount.endTs.toString()),
      ticketPriceLamports: roundAccount.ticketPriceLamports.toString(),
      originalTotalTickets: roundAccount.totalTickets.toString(),
      originalTotalLamports: roundAccount.totalLamports.toString(),
      originalEntrantCount: Number(roundAccount.entrantCount),
      ...minimums,
      entries: entries.map(refundEntryRecord),
    });
    progress = refundProgressForRound(SETTLEMENT_ARCHIVE_PATH, identity);
  }

  if (progress && !DRY_RUN) {
    const activeEntries = new Set(entries.map((candidate) => candidate.address.toBase58()));
    const confirmedEntries = new Set(progress.confirmed.map((event) => event.entry));
    for (const intent of progress.intents) {
      if (confirmedEntries.has(intent.entry) || activeEntries.has(intent.entry)) {
        continue;
      }
      const signature = await recoverConfirmedRefundSignature(intent);
      if (!signature) {
        planned.push({
          pool: poolSpec.slug,
          action: "error_refund_intent_unconfirmed",
          roundId,
          entry: intent.entry,
        });
        return;
      }
      appendRefundJournalEvent(SETTLEMENT_ARCHIVE_PATH, {
        eventId: refundEventId("confirmed", identity, intent.entry),
        kind: "refund_confirmed",
        ...identity,
        entry: intent.entry,
        player: intent.player,
        ticketCount: intent.ticketCount,
        lamports: intent.lamports,
        signature,
        recoveredAfterRestart: true,
      });
    }
    progress = refundProgressForRound(SETTLEMENT_ARCHIVE_PATH, identity);
  }

  const confirmedEntries = new Set(progress?.confirmed.map((event) => event.entry) ?? []);
  const entry = entries.find((candidate) => candidate.lamports > 0n);
  if (!entry) {
    planned.push({ pool: poolSpec.slug, action: "error_refund_entries_zeroed", roundId, ...details });
    return;
  }
  if (confirmedEntries.has(entry.address.toBase58())) {
    planned.push({
      pool: poolSpec.slug,
      action: "error_refund_journal_onchain_mismatch",
      roundId,
      entry: entry.address.toBase58(),
    });
    return;
  }
  const poolVault = derivePoolVault(pool);
  const summary = {
    pool: poolSpec.slug,
    action: "refund_cancelled_below_minimum_entry",
    roundId,
    entry: entry.address.toBase58(),
    player: entry.player.toBase58(),
    lamports: entry.lamports.toString(),
    refundsCompleted: progress?.refundsCompleted ?? 0,
    refundsPending: progress?.refundsPending ?? entries.length,
    ...details,
  };
  planned.push(summary);
  if (!DRY_RUN && canExecute()) {
    appendRefundJournalEvent(SETTLEMENT_ARCHIVE_PATH, {
      eventId: refundEventId("intent", identity, entry.address.toBase58()),
      kind: "refund_intent",
      ...identity,
      entry: entry.address.toBase58(),
      player: entry.player.toBase58(),
      ticketCount: entry.ticketCount.toString(),
      lamports: entry.lamports.toString(),
    });
    const method = program.methods
      .refundEntryAfterTimeout()
      .accounts({
        keeper,
        player: entry.player,
        config,
        keeperConfig,
        pool,
        round,
        entry: entry.address,
        poolVault,
        systemProgram: SystemProgram.programId,
      });
    const signature = await simulateAndSend(method, summary);
    appendRefundJournalEvent(SETTLEMENT_ARCHIVE_PATH, {
      eventId: refundEventId("confirmed", identity, entry.address.toBase58()),
      kind: "refund_confirmed",
      ...identity,
      entry: entry.address.toBase58(),
      player: entry.player.toBase58(),
      ticketCount: entry.ticketCount.toString(),
      lamports: entry.lamports.toString(),
      signature,
      recoveredAfterRestart: false,
    });
    const updatedProgress = refundProgressForRound(SETTLEMENT_ARCHIVE_PATH, identity);
    executed.push({
      ...summary,
      signature,
      refundsCompleted: updatedProgress.refundsCompleted,
      refundsPending: updatedProgress.refundsPending,
    });
  }
}

async function archiveSettledRound(
  poolSpec,
  pool,
  round,
  roundAccount,
  settlementSignature = null,
  settlementEconomics = null,
) {
  const roundId = Number(roundAccount.roundId.toString());
  if (!SETTLEMENT_ARCHIVE_PATH) {
    planned.push({ pool: poolSpec.slug, action: "archive_path_missing", roundId });
    return false;
  }
  const roundInfo = await connection.getAccountInfo(round, "confirmed");
  if (!roundInfo || !roundInfo.owner.equals(PROGRAM_ID)) {
    planned.push({ pool: poolSpec.slug, action: "archive_round_account_invalid", roundId });
    return false;
  }
  const accountDataHash = crypto.createHash("sha256").update(roundInfo.data).digest("hex");
  const archiveIdentity = {
    genesisHash,
    programId: PROGRAM_ID.toBase58(),
    poolAddress: pool.toBase58(),
    address: round.toBase58(),
  };
  const latestArchive = latestArchivedSettlement(
    SETTLEMENT_ARCHIVE_PATH,
    poolSpec.slug,
    roundId,
    archiveIdentity,
  );
  if (latestArchive && archiveMatchesSettledState(latestArchive, roundAccount)) {
    return true;
  }

  const refundMode = roundIsRefundMode(roundAccount);
  const refundProgress = refundMode
    ? refundProgressForRound(
      SETTLEMENT_ARCHIVE_PATH,
      refundIdentity(poolSpec, round, roundId),
    )
    : null;
  if (refundMode && !refundProgress) {
    planned.push({
      pool: poolSpec.slug,
      action: "skip_cancelled_archive_refund_journal_missing",
      roundId,
    });
    return false;
  }
  if (refundMode && refundProgress.refundsPending !== 0) {
    planned.push({
      pool: poolSpec.slug,
      action: "skip_cancelled_archive_refunds_pending",
      roundId,
      refundsPending: refundProgress.refundsPending,
      refundsCompleted: refundProgress.refundsCompleted,
    });
    return false;
  }

  const economics = settlementEconomics ?? await settlementEconomicsForRound(
    poolSpec,
    pool,
    roundAccount,
  );
  const winners = [roundAccount.winner, roundAccount.winnerSecond, roundAccount.winnerThird]
    .filter((winner) => winner && !winner.equals(SystemProgram.programId))
    .map((winner, index) => ({
      rank: index + 1,
      winner: winner.toBase58(),
      prizeLamports: economics.prizePayouts[index] ?? "0",
    }));
  const entries = await fetchEntriesForRound(round);
  const archivedEntries = refundMode
    ? refundProgress.originalEntries
    : entries.map(refundEntryRecord);
  const totalTickets = refundMode
    ? refundProgress.originalTotalTickets
    : roundAccount.totalTickets.toString();
  const totalLamports = refundMode
    ? refundProgress.originalTotalLamports
    : roundAccount.totalLamports.toString();
  const entrantCount = refundMode
    ? refundProgress.originalEntrantCount
    : Number(roundAccount.entrantCount);
  const refundSignatures = refundMode ? refundProgress.refundSignatures : [];
  const record = {
    genesisHash,
    programId: PROGRAM_ID.toBase58(),
    pool: poolSpec.slug,
    poolAddress: pool.toBase58(),
    address: round.toBase58(),
    accountDataHash,
    roundId,
    startTs: Number(roundAccount.startTs.toString()),
    endTs: Number(roundAccount.endTs.toString()),
    ticketPriceLamports: roundAccount.ticketPriceLamports.toString(),
    totalTickets,
    totalLamports,
    entrantCount,
    remainingTotalTickets: roundAccount.totalTickets.toString(),
    remainingTotalLamports: roundAccount.totalLamports.toString(),
    remainingEntrantCount: Number(roundAccount.entrantCount),
    settled: true,
    roundOutcome: refundMode ? "cancelled_below_minimum" : "settled",
    refundStatus: refundMode ? "completed" : "none",
    refundsPending: refundMode ? refundProgress.refundsPending : 0,
    refundsCompleted: refundMode ? refundProgress.refundsCompleted : 0,
    refundSignatures,
    minimumTickets: poolSpec.minimumTickets,
    minimumDistinctEntrants: poolSpec.minimumDistinctEntrants,
    winnerCount: Number(roundAccount.winnerCount),
    winner: roundAccount.winner.toBase58(),
    winnerSecond: roundAccount.winnerSecond.toBase58(),
    winnerThird: roundAccount.winnerThird.toBase58(),
    winners,
    houseFeeBps: economics.houseFeeBps,
    jackpotBps: economics.jackpotBps,
    houseFeeLamports: economics.houseFeeLamports,
    jackpotAddLamports: economics.jackpotAddLamports,
    mainPrizeLamports: economics.mainPrizeLamports,
    prizePayouts: economics.prizePayouts,
    winningTickets: economics.winningTickets,
    jackpotPayoutLamports: economics.jackpotPayoutLamports,
    jackpotTriggered: roundAccount.jackpotTriggered,
    jackpotWinner: roundAccount.jackpotWinner.toBase58(),
    randomnessCommitment: Buffer.from(roundAccount.randomnessCommitment).toString("hex"),
    randomness: Buffer.from(roundAccount.randomness).toString("hex"),
    randomnessMode: refundMode ? "not_requested_below_minimum" : "orao_vrf",
    oraoRequested: !refundMode,
    settlementSignature: refundMode
      ? refundSignatures.at(-1) ?? null
      : settlementSignature,
    entries: archivedEntries,
  };
  if (DRY_RUN) {
    planned.push({ pool: poolSpec.slug, action: "would_archive_settled_round", roundId });
    return false;
  }
  appendSettlementArchive(SETTLEMENT_ARCHIVE_PATH, record);
  planned.push({ pool: poolSpec.slug, action: "archive_settled_round", roundId });
  return true;
}

async function settlementEconomicsForRound(poolSpec, pool, roundAccount) {
  const [configAccount, poolAccount] = await Promise.all([
    program.account.config.fetch(config),
    program.account.pool.fetch(pool),
  ]);
  const totalLamports = BigInt(roundAccount.totalLamports.toString());
  const houseFee = bpsAmount(totalLamports, configAccount.houseFeeBps);
  const jackpotAdd = bpsAmount(totalLamports, configAccount.jackpotBps);
  const mainPrize = totalLamports - houseFee - jackpotAdd;
  const payouts = mainPrizePayouts(mainPrize, poolSettlementConfig(poolAccount, poolSpec));
  return {
    houseFeeBps: Number(configAccount.houseFeeBps),
    jackpotBps: Number(configAccount.jackpotBps),
    houseFeeLamports: houseFee.toString(),
    jackpotAddLamports: jackpotAdd.toString(),
    mainPrizeLamports: mainPrize.toString(),
    prizePayouts: payouts.map(String),
    winningTickets: [],
    jackpotPayoutLamports: "0",
  };
}

function archiveMatchesSettledState(record, roundAccount) {
  const winners = [roundAccount.winner, roundAccount.winnerSecond, roundAccount.winnerThird]
    .filter((winner) => winner && !winner.equals(SystemProgram.programId))
    .map((winner, index) => ({ rank: index + 1, winner: winner.toBase58() }));
  const archivedWinners = (record.winners ?? []).map(({ rank, winner }) => ({
    rank,
    winner,
  }));
  return Boolean(
    record?.settled === true &&
    Number(record.winnerCount) === Number(roundAccount.winnerCount) &&
    record.winner === roundAccount.winner.toBase58() &&
    record.winnerSecond === roundAccount.winnerSecond.toBase58() &&
    record.winnerThird === roundAccount.winnerThird.toBase58() &&
    JSON.stringify(archivedWinners) === JSON.stringify(winners) &&
    record.randomness === Buffer.from(roundAccount.randomness).toString("hex")
  );
}

async function executeOpenRound(poolSpec, pool, roundId) {
  if (
    ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE &&
    APPROVED_OPEN_ROUNDS.get(poolSpec.slug) !== roundId
  ) {
    throw new Error(`${poolSpec.slug} round ${roundId} is outside the approved open-round allowlist`);
  }
  const round = deriveRound(pool, roundId);
  if (await accountExists(connection, round)) {
    planned.push({
      pool: poolSpec.slug,
      action: "skip_open_round_exists",
      roundId,
      round: round.toBase58(),
    });
    return;
  }

  const commitment = crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(crypto.randomBytes(32))
    .digest();
  const summary = {
    pool: poolSpec.slug,
    action: "open_round",
    roundId,
    round: round.toBase58(),
    commitment: commitment.toString("hex"),
  };
  planned.push(summary);
  if (DRY_RUN || !canExecute()) {
    return;
  }

  const method = program.methods
    .openRound([...commitment])
    .accounts({
      keeper,
      config,
      keeperConfig,
      pool,
      previousRound: deriveRound(pool, roundId - 1),
      round,
      systemProgram: SystemProgram.programId,
    });
  const signature = await simulateAndSend(method, summary);
  executed.push({ ...summary, signature });
}

async function executeOpenRoundAfterSettlement(poolSpec, pool, previousRound, roundId) {
  const round = deriveRound(pool, roundId);
  if (await accountExists(connection, round)) {
    planned.push({
      pool: poolSpec.slug,
      action: "skip_rotated_round_exists",
      roundId,
      round: round.toBase58(),
    });
    return;
  }
  const commitment = crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(crypto.randomBytes(32))
    .digest();
  const summary = {
    pool: poolSpec.slug,
    action: "open_round_after_settlement",
    roundId,
    previousRound: previousRound.toBase58(),
    round: round.toBase58(),
    commitment: commitment.toString("hex"),
  };
  planned.push(summary);
  if (DRY_RUN || !canExecute()) {
    return;
  }
  const method = program.methods
    .openRoundAfterSettlement([...commitment])
    .accounts({
      keeper,
      config,
      keeperConfig,
      pool,
      previousRound,
      round,
      systemProgram: SystemProgram.programId,
    });
  const signature = await simulateAndSend(method, summary);
  executed.push({ ...summary, signature });
}

async function fetchEntriesForRound(round) {
  const accounts = await program.account.entry.all([
    {
      memcmp: {
        offset: 8,
        bytes: round.toBase58(),
      },
    },
  ]);

  return accounts
    .map(({ publicKey, account }) => {
      const ticketStart = BigInt(account.ticketStart.toString());
      const ticketCount = BigInt(account.ticketCount.toString());
      return {
        address: publicKey,
        player: account.player,
        ticketStart,
        ticketCount,
        lamports: BigInt(account.lamports.toString()),
        ticketEndExclusive: ticketStart + ticketCount,
      };
    })
    .sort((left, right) =>
      left.ticketStart < right.ticketStart ? -1 : left.ticketStart > right.ticketStart ? 1 : 0,
    );
}

function refundIdentity(poolSpec, round, roundId) {
  return {
    genesisHash,
    programId: PROGRAM_ID.toBase58(),
    pool: poolSpec.slug,
    roundId,
    address: round.toBase58(),
  };
}

function refundEventId(kind, identity, entry = "") {
  return [
    "refund",
    kind,
    identity.programId,
    identity.genesisHash,
    identity.pool,
    identity.roundId,
    identity.address,
    entry,
  ].join(":");
}

function refundEntryRecord(entry) {
  return {
    address: entry.address.toBase58(),
    player: entry.player.toBase58(),
    ticketStart: entry.ticketStart.toString(),
    ticketCount: entry.ticketCount.toString(),
    lamports: entry.lamports.toString(),
  };
}

async function recoverConfirmedRefundSignature(intent) {
  const entry = new PublicKey(intent.entry);
  const earliestBlockTime = Math.floor(Date.parse(intent.recordedAt) / 1_000) - 5;
  const signatures = await connection.getSignaturesForAddress(entry, { limit: 25 }, "confirmed");
  for (const candidate of signatures) {
    if (candidate.err || (candidate.blockTime ?? 0) < earliestBlockTime) {
      continue;
    }
    const transaction = await connection.getTransaction(candidate.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (isConfirmedRefundTransaction(transaction, intent)) {
      return candidate.signature;
    }
  }
  return null;
}

function roundIsRefundMode(round) {
  return round.settled &&
    !round.jackpotTriggered &&
    Number(round.winnerCount) === 0 &&
    round.winner.equals(SystemProgram.programId) &&
    round.winnerSecond.equals(SystemProgram.programId) &&
    round.winnerThird.equals(SystemProgram.programId) &&
    round.jackpotWinner.equals(SystemProgram.programId) &&
    Array.from(round.randomness).every((byte) => byte === 0);
}

function findEntryByTicket(entries, ticket, label) {
  const entry = entries.find((item) =>
    ticket >= item.ticketStart && ticket < item.ticketEndExclusive,
  );
  if (!entry) {
    throw new Error(`No ${label} entry contains ticket ${ticket.toString()}`);
  }
  return entry;
}

function poolSettlementConfig(poolAccount, poolSpec) {
  return {
    winnerCount: Number((poolAccount.winnerCount ?? poolSpec.winnerCount).toString()),
    prizeSplitBps: Array.from(
      poolAccount.prizeSplitBps ?? poolSpec.prizeSplitBps,
      (value) => Number(value.toString()),
    ),
  };
}

function remainingWinnerAccounts(winnerEntries) {
  if (winnerEntries.length < 3) {
    return [];
  }

  return [
    { pubkey: winnerEntries[1].player, isWritable: true, isSigner: false },
    { pubkey: winnerEntries[1].address, isWritable: false, isSigner: false },
    { pubkey: winnerEntries[2].player, isWritable: true, isSigner: false },
    { pubkey: winnerEntries[2].address, isWritable: false, isSigner: false },
  ];
}

function bpsAmount(totalLamports, bps) {
  return (BigInt(totalLamports.toString()) * BigInt(bps.toString())) / 10_000n;
}

function canExecute() {
  return !DRY_RUN && keeper;
}

async function simulateAndSend(method, summary, preSendCheck = null) {
  await assertKeeperReadyForWrite();
  if (preSendCheck) {
    await preSendCheck();
  }
  const simulation = await method.simulate();
  summary.simulation = {
    ok: true,
    logCount: Array.isArray(simulation?.raw) ? simulation.raw.length : null,
  };
  await assertKeeperReadyForWrite();
  if (preSendCheck) {
    await preSendCheck();
  }
  return method.rpc();
}

async function simulateAndSendTransaction(transaction, summary, preSendCheck = null) {
  await assertKeeperReadyForWrite();
  if (preSendCheck) await preSendCheck();
  const simulation = await provider.simulate(transaction, [], "confirmed");
  summary.simulation = {
    ok: true,
    logCount: Array.isArray(simulation?.logs) ? simulation.logs.length : null,
    unitsConsumed: simulation?.unitsConsumed ?? null,
  };
  await assertKeeperReadyForWrite();
  if (preSendCheck) await preSendCheck();
  return provider.sendAndConfirm(transaction, [], provider.opts);
}

async function assertRoundEligibleForProviderSpend(poolSpec, round, roundId) {
  const latestRound = await program.account.round.fetch(round);
  const totalTickets = BigInt(latestRound.totalTickets.toString());
  const entrantCount = Number(latestRound.entrantCount);
  if (
    latestRound.settled ||
    !roundMeetsMinimums(poolSpec, totalTickets, entrantCount)
  ) {
    throw new Error(
      `Refusing ORAO spend for ${poolSpec.slug} round ${roundId}: ` +
      `tickets=${totalTickets.toString()} entrants=${entrantCount}`,
    );
  }
}

async function assertKeeperReadyForWrite() {
  if (!keeper || !payer?.publicKey.equals(keeper)) {
    throw new Error("Settlement write requires the configured keeper signer");
  }
  const latestKeeperConfig = await program.account.keeperConfig.fetch(keeperConfig);
  if (!latestKeeperConfig.keeper.equals(keeper)) {
    throw new Error(`On-chain keeper changed to ${latestKeeperConfig.keeper.toBase58()}`);
  }
  const balanceLamports = await connection.getBalance(keeper, "confirmed");
  if (balanceLamports < MIN_KEEPER_BALANCE_LAMPORTS) {
    throw new Error(
      `Keeper ${keeper.toBase58()} needs funding: ${balanceLamports} < ${MIN_KEEPER_BALANCE_LAMPORTS} lamports`,
    );
  }
}

function requireOraoMode() {
  if (RANDOMNESS_MODE !== "orao_vrf") {
    throw new Error("Set LUCKYME_RANDOMNESS_MODE=orao_vrf before running settlement keeper");
  }
}

function requireMainnetWriteConfirmation(url, mainnetByGenesis) {
  const mainnet = mainnetByGenesis || /mainnet|api\.mainnet-beta\.solana\.com|helius-rpc/i.test(url);
  if (mainnet && !DRY_RUN && process.env.CONFIRM_MAINNET_SETTLEMENT_KEEPER !== "true") {
    throw new Error("Refusing mainnet settlement keeper writes without CONFIRM_MAINNET_SETTLEMENT_KEEPER=true");
  }
  if (
    mainnet &&
    !DRY_RUN &&
    ACTION_SCOPE === OPEN_ROUND_ONLY_SCOPE &&
    process.env.CONFIRM_MAINNET_OPEN_ROUNDS !== "true"
  ) {
    throw new Error(
      "Refusing mainnet open-round-only writes without CONFIRM_MAINNET_OPEN_ROUNDS=true",
    );
  }
}

function printStart() {
  console.log(JSON.stringify({
    event: "settlement_keeper_start",
    cluster: redactRpcUrl(url),
    genesisHash,
    mainnet,
    dryRun: DRY_RUN,
    maxActions: MAX_ACTIONS,
    minKeeperBalanceLamports: MIN_KEEPER_BALANCE_LAMPORTS,
    actionScope: ACTION_SCOPE,
    approvedOpenRounds: Object.fromEntries(APPROVED_OPEN_ROUNDS),
    pools: pools.map((pool) => pool.slug),
    keeperConfig: keeperConfig.toBase58(),
    keeper: keeper?.toBase58() ?? null,
  }, null, 2));
}

function printDone() {
  console.log(JSON.stringify({
    event: "settlement_keeper_done",
    dryRun: DRY_RUN,
    planned,
    executed,
  }, null, 2));
}

function parseApprovedOpenRounds(value) {
  const approved = new Map();
  const normalized = String(value).trim();
  if (!normalized) {
    return approved;
  }
  for (const item of normalized.split(",")) {
    const match = /^([a-z]+):([1-9][0-9]*)$/.exec(item.trim());
    if (!match) {
      throw new Error(`Invalid approved open-round target: ${item}`);
    }
    const [, pool, roundIdText] = match;
    if (!POOL_BY_SLUG.has(pool)) {
      throw new Error(`Unknown approved open-round pool: ${pool}`);
    }
    if (approved.has(pool)) {
      throw new Error(`Duplicate approved open-round pool: ${pool}`);
    }
    approved.set(pool, positiveInteger(roundIdText, `${pool} approved round ID`));
  }
  return approved;
}

function redactRpcUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.search) {
      parsed.search = "?redacted=true";
    }
    return parsed.toString();
  } catch {
    return String(value).replace(/([?&](?:api-key|apikey|token|key)=)[^&]+/gi, "$1<redacted>");
  }
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}
