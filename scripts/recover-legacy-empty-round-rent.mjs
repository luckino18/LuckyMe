import fs from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Transaction } from "@solana/web3.js";
import {
  POOLS,
  PROGRAM_ID,
  PublicKey,
  SystemProgram,
  anchorAccountDiscriminator,
  createClient,
  deriveConfig,
  deriveEntry,
  deriveKeeperConfig,
  derivePool,
  deriveRound,
  deriveRoundRandomnessAccount,
} from "./anchor-client.mjs";
import {
  appendSettlementArchive,
  hasArchivedSettlement,
} from "./settlement-archive.mjs";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const ACTIVE_KEEPER = "6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N";
const DEFAULT_RPC_URL = "http://127.0.0.1:8899";
const ACCOUNT_NAMES = Object.freeze({
  config: { discriminatorName: "Config", coderName: "config" },
  keeperConfig: { discriminatorName: "KeeperConfig", coderName: "keeperConfig" },
  pool: { discriminatorName: "Pool", coderName: "pool" },
  round: { discriminatorName: "Round", coderName: "round" },
  entry: { discriminatorName: "Entry", coderName: "entry" },
  roundRandomness: { discriminatorName: "RoundRandomness", coderName: "roundRandomness" },
});

export async function main(env = process.env) {
  const rpcUrl = env.ANCHOR_PROVIDER_URL ?? DEFAULT_RPC_URL;
  const dryRun = env.DRY_RUN !== "false";
  const maxActions = positiveInteger(
    env.RENT_RECOVERY_MAX_ACTIONS ?? "1",
    "RENT_RECOVERY_MAX_ACTIONS",
  );
  if (maxActions > 4) {
    throw new Error("RENT_RECOVERY_MAX_ACTIONS cannot exceed 4");
  }
  const reportPath = env.LUCKYME_RENT_RECOVERY_REPORT_PATH ?? "";
  const archivePath = env.LUCKYME_SETTLEMENT_ARCHIVE_PATH ?? "";
  const expectedKeeper = new PublicKey(
    env.LUCKYME_EXPECTED_KEEPER_PUBKEY ?? ACTIVE_KEEPER,
  );

  // Reject the common mainnet URL before touching a signer file. A genesis-hash
  // check below also protects custom/private mainnet RPC URLs.
  requireExecutionConfirmation({
    dryRun,
    mainnet: looksLikeMainnetUrl(rpcUrl),
    confirmed: env.CONFIRM_MAINNET_RENT_RECOVERY === "true",
  });

  const readonlyClient = createClient({ requireSigner: false, url: rpcUrl });
  const genesisHash = await readonlyClient.connection.getGenesisHash();
  const mainnet = genesisHash === MAINNET_GENESIS_HASH;
  requireExecutionConfirmation({
    dryRun,
    mainnet,
    confirmed: env.CONFIRM_MAINNET_RENT_RECOVERY === "true",
  });

  const client = dryRun
    ? readonlyClient
    : createClient({ requireSigner: true, url: rpcUrl });
  const { connection, payer, program, url } = client;
  const keeper = payer?.publicKey ?? expectedKeeper;

  if (!dryRun && mainnet && !keeper.equals(expectedKeeper)) {
    throw new Error(
      `Configured signer ${keeper.toBase58()} does not match expected keeper ${expectedKeeper.toBase58()}`,
    );
  }
  if (!dryRun && !archivePath) {
    throw new Error("LUCKYME_SETTLEMENT_ARCHIVE_PATH is required before legacy rent recovery writes");
  }

  const inventory = await buildInventory({
    connection,
    program,
    keeper,
    url,
    genesisHash,
    mainnet,
  });
  inventory.dryRun = dryRun;
  inventory.maxActions = maxActions;
  inventory.executed = [];
  inventory.planHash = recoveryPlanHash(inventory);

  const latestBlockhash = inventory.eligible.length
    ? await connection.getLatestBlockhash("confirmed")
    : null;
  for (const row of inventory.eligible) {
    const instruction = await closeInstruction({ program, keeper, inventory, row });
    const transaction = new Transaction().add(instruction);
    transaction.feePayer = keeper;
    if (latestBlockhash) {
      transaction.recentBlockhash = latestBlockhash.blockhash;
      try {
        const feeResponse = await connection.getFeeForMessage(
          transaction.compileMessage(),
          "confirmed",
        );
        row.estimatedFeeLamports = feeResponse?.value ?? feeResponse ?? null;
      } catch (error) {
        row.estimatedFeeError = errorMessage(error);
      }
    }

    if (!inventory.keeperConfigExists) {
      row.simulation = {
        status: "blocked_before_upgrade",
        reason: "KeeperConfig does not exist on this deployment yet",
      };
    } else if (inventory.configuredKeeper !== keeper.toBase58()) {
      row.simulation = {
        status: "blocked_keeper_mismatch",
        reason: `KeeperConfig authorizes ${inventory.configuredKeeper}, not ${keeper.toBase58()}`,
      };
    } else {
      try {
        const simulation = await connection.simulateTransaction(transaction);
        row.simulation = {
          status: simulation.value.err ? "failed" : "succeeded",
          error: simulation.value.err ?? null,
          unitsConsumed: simulation.value.unitsConsumed ?? null,
          logs: simulation.value.logs ?? [],
        };
      } catch (error) {
        row.simulation = {
          status: "failed",
          error: errorMessage(error),
          unitsConsumed: null,
          logs: [],
        };
      }
    }
  }
  inventory.totals.estimatedFeeLamports = inventory.eligible.reduce(
    (sum, row) => sum + (Number(row.estimatedFeeLamports) || 0),
    0,
  );

  printInventory(inventory);
  writeReport(reportPath, inventory);

  if (dryRun || inventory.eligible.length === 0) {
    return inventory;
  }
  if (inventory.invalidAccounts.length) {
    throw new Error("Refusing execution because one or more program accounts failed validation");
  }
  if (!inventory.keeperConfigExists || inventory.configuredKeeper !== keeper.toBase58()) {
    throw new Error(
      `KeeperConfig must exist and authorize ${keeper.toBase58()} before recovery execution`,
    );
  }
  if (env.LUCKYME_RENT_RECOVERY_PLAN_HASH !== inventory.planHash) {
    throw new Error(
      `Refusing execution without LUCKYME_RENT_RECOVERY_PLAN_HASH=${inventory.planHash}`,
    );
  }

  const selected = inventory.eligible.slice(0, maxActions);
  for (const row of selected) {
    const result = await executeRecovery({
      connection,
      program,
      payer,
      keeper,
      inventory,
      row,
      archivePath,
    });
    inventory.executed.push(result);
    writeReport(reportPath, inventory);
  }

  inventory.treasuryLamportsAfter = await connection.getBalance(
    new PublicKey(inventory.treasury),
    "confirmed",
  );
  inventory.totalTreasuryDeltaLamports =
    inventory.treasuryLamportsAfter - inventory.treasuryLamportsBefore;
  writeReport(reportPath, inventory);
  console.log(JSON.stringify({
    event: "legacy_empty_round_rent_recovery_done",
    executed: inventory.executed,
    treasury: inventory.treasury,
    treasuryLamportsBefore: inventory.treasuryLamportsBefore,
    treasuryLamportsAfter: inventory.treasuryLamportsAfter,
    totalTreasuryDeltaLamports: inventory.totalTreasuryDeltaLamports,
  }, null, 2));
  return inventory;
}

export async function buildInventory({
  connection,
  program,
  keeper,
  url,
  genesisHash,
  mainnet,
}) {
  const config = deriveConfig();
  const configInfo = await connection.getAccountInfo(config, "confirmed");
  const configState = validateAndDecodeAccount({
    address: config,
    info: configInfo,
    program,
    kind: "config",
  });
  const configDerivation = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID,
  );
  requireDerivedAccount(config, configDerivation, configState.bump, "config");

  const treasury = configState.treasury;
  const keeperConfig = deriveKeeperConfig(config);
  const keeperConfigInfo = await connection.getAccountInfo(keeperConfig, "confirmed");
  let configuredKeeper = null;
  let keeperConfigExists = false;
  if (keeperConfigInfo) {
    const keeperConfigState = validateAndDecodeAccount({
      address: keeperConfig,
      info: keeperConfigInfo,
      program,
      kind: "keeperConfig",
    });
    const keeperConfigDerivation = PublicKey.findProgramAddressSync(
      [Buffer.from("keeper_config"), config.toBuffer()],
      PROGRAM_ID,
    );
    requireDerivedAccount(
      keeperConfig,
      keeperConfigDerivation,
      keeperConfigState.bump,
      "keeper config",
    );
    if (!keeperConfigState.config.equals(config)) {
      throw new Error("Keeper config points to an unexpected Config account");
    }
    configuredKeeper = keeperConfigState.keeper;
    keeperConfigExists = true;
  }
  const treasuryLamportsBefore = await connection.getBalance(treasury, "confirmed");
  const keeperLamports = await connection.getBalance(keeper, "confirmed");
  const poolStates = [];

  for (const poolSpec of POOLS) {
    const pool = derivePool(config, poolSpec.id);
    const poolInfo = await connection.getAccountInfo(pool, "confirmed");
    const poolState = validateAndDecodeAccount({
      address: pool,
      info: poolInfo,
      program,
      kind: "pool",
    });
    const poolDerivation = PublicKey.findProgramAddressSync(
      [Buffer.from("pool"), config.toBuffer(), Buffer.from([poolSpec.id])],
      PROGRAM_ID,
    );
    requireDerivedAccount(pool, poolDerivation, poolState.bump, `${poolSpec.slug} pool`);
    if (!poolState.config.equals(config) || Number(poolState.poolId) !== poolSpec.id) {
      throw new Error(`${poolSpec.slug} pool data does not match its canonical PDA`);
    }
    const currentRound = safeAnchorInteger(poolState.currentRound, `${poolSpec.slug}.currentRound`);
    poolStates.push({ poolSpec, pool, poolState, currentRound });
  }

  const expectedRounds = [];
  for (const state of poolStates) {
    for (let roundId = 1; roundId <= state.currentRound; roundId += 1) {
      expectedRounds.push({
        ...state,
        roundId,
        round: deriveRound(state.pool, roundId),
      });
    }
  }

  const expectedRoundInfos = await getMultipleAccountsInfoChunked(
    connection,
    expectedRounds.map((item) => item.round),
  );
  const entryAccounts = await fetchValidatedProgramAccounts({ connection, program, kind: "entry" });
  const sidecarAccounts = await fetchValidatedProgramAccounts({
    connection,
    program,
    kind: "roundRandomness",
  });
  const roundProgramAccounts = await fetchValidatedProgramAccounts({
    connection,
    program,
    kind: "round",
  });

  const invalidAccounts = [
    ...entryAccounts.invalid,
    ...sidecarAccounts.invalid,
    ...roundProgramAccounts.invalid,
  ];
  const entriesByRound = new Map();
  for (const entry of entryAccounts.valid) {
    const expectedEntry = deriveEntry(entry.state.round, entry.state.player);
    if (!entry.address.equals(expectedEntry)) {
      invalidAccounts.push(invalidRecord(entry.address, "entry PDA mismatch"));
      continue;
    }
    addToMapList(entriesByRound, entry.state.round.toBase58(), entry);
  }

  const sidecarsByRound = new Map();
  for (const sidecar of sidecarAccounts.valid) {
    const expectedSidecar = deriveRoundRandomnessAccount(sidecar.state.round);
    if (!sidecar.address.equals(expectedSidecar)) {
      invalidAccounts.push(invalidRecord(sidecar.address, "round randomness PDA mismatch"));
      continue;
    }
    addToMapList(sidecarsByRound, sidecar.state.round.toBase58(), sidecar);
  }

  const canonicalRoundAddresses = new Set(expectedRounds.map((item) => item.round.toBase58()));
  for (const account of roundProgramAccounts.valid) {
    if (!canonicalRoundAddresses.has(account.address.toBase58())) {
      invalidAccounts.push(invalidRecord(
        account.address,
        "Round account is not in the canonical 1..current_round range",
      ));
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const slot = await connection.getSlot("confirmed");
  const rows = expectedRounds.map((item, index) => {
    const info = expectedRoundInfos[index];
    if (!info) {
      return {
        pool: item.poolSpec.slug,
        poolAddress: item.pool.toBase58(),
        roundId: item.roundId,
        round: item.round.toBase58(),
        current: item.roundId === item.currentRound,
        lamports: 0,
        classification: "already_closed_or_missing",
        eligible: false,
        action: "none",
        destination: treasury.toBase58(),
      };
    }

    let roundState;
    try {
      roundState = validateAndDecodeAccount({
        address: item.round,
        info,
        program,
        kind: "round",
      });
      const derivation = PublicKey.findProgramAddressSync(
        [Buffer.from("round"), item.pool.toBuffer(), u64Le(item.roundId)],
        PROGRAM_ID,
      );
      requireDerivedAccount(item.round, derivation, roundState.bump, `${item.poolSpec.slug} round ${item.roundId}`);
      if (!roundState.pool.equals(item.pool) || safeAnchorInteger(roundState.roundId, "round.roundId") !== item.roundId) {
        throw new Error("Round data does not match its canonical pool/round id");
      }
    } catch (error) {
      invalidAccounts.push(invalidRecord(item.round, errorMessage(error)));
      return {
        pool: item.poolSpec.slug,
        poolAddress: item.pool.toBase58(),
        roundId: item.roundId,
        round: item.round.toBase58(),
        current: item.roundId === item.currentRound,
        lamports: info.lamports,
        classification: "invalid_account",
        eligible: false,
        action: "none",
        destination: treasury.toBase58(),
        validationError: errorMessage(error),
      };
    }

    const roundAddress = item.round.toBase58();
    const entries = entriesByRound.get(roundAddress) ?? [];
    const sidecars = sidecarsByRound.get(roundAddress) ?? [];
    const state = plainRoundState(roundState);
    const decision = classifyLegacyEmptyRound({
      ...state,
      current: item.roundId === item.currentRound,
      now,
      entryAccountCount: entries.length,
      sidecarAccountCount: sidecars.length,
    });
    return {
      pool: item.poolSpec.slug,
      poolAddress: item.pool.toBase58(),
      roundId: item.roundId,
      round: roundAddress,
      current: item.roundId === item.currentRound,
      lamports: info.lamports,
      accountDataHash: dataHash(info.data),
      ...state,
      entryAccountCount: entries.length,
      sidecarAccountCount: sidecars.length,
      ...decision,
      destination: treasury.toBase58(),
    };
  });

  const eligible = rows.filter((row) => row.eligible);
  return {
    event: "legacy_empty_round_rent_inventory",
    checkedAt: new Date().toISOString(),
    slot,
    clusterUrl: redactRpcUrl(url),
    genesisHash,
    mainnet,
    programId: PROGRAM_ID.toBase58(),
    config: config.toBase58(),
    keeperConfig: keeperConfig.toBase58(),
    keeperConfigExists,
    configuredKeeper: configuredKeeper?.toBase58() ?? null,
    authority: configState.authority.toBase58(),
    treasury: treasury.toBase58(),
    treasuryLamportsBefore,
    keeper: keeper.toBase58(),
    keeperLamports,
    poolCurrentRounds: Object.fromEntries(
      poolStates.map((item) => [item.poolSpec.slug, item.currentRound]),
    ),
    invalidAccounts,
    rows,
    eligible,
    totals: {
      expectedRoundAccounts: rows.length,
      existingRoundAccounts: rows.filter((row) => row.classification !== "already_closed_or_missing").length,
      missingOrClosedRoundAccounts: rows.filter((row) => row.classification === "already_closed_or_missing").length,
      eligibleRoundAccounts: eligible.length,
      estimatedRecoverableLamports: eligible.reduce((sum, row) => sum + row.lamports, 0),
    },
  };
}

export function classifyLegacyEmptyRound({
  startTs,
  endTs,
  settled,
  totalTickets,
  totalLamports,
  entrantCount,
  current,
  now,
  entryAccountCount,
  sidecarAccountCount,
}) {
  if (totalTickets !== 0n || totalLamports !== 0n || entrantCount !== 0) {
    return decision("contains_tickets_or_funds", false, "none");
  }
  if (entryAccountCount !== 0) {
    return decision("entry_accounts_present", false, "none");
  }
  if (sidecarAccountCount !== 0) {
    return decision("randomness_sidecar_present", false, "none");
  }
  if (startTs === 0 && endTs === 0) {
    return decision(
      current && !settled ? "waiting_for_first_ticket" : "invalid_waiting_legacy_round",
      false,
      "none",
    );
  }
  if (endTs <= 0 || endTs > now) {
    return decision("empty_but_not_expired", false, "none");
  }
  if (settled) {
    return decision("eligible_settled_legacy_empty", true, "close_settled_round");
  }
  return decision("eligible_expired_legacy_empty", true, "close_empty_round_after_timeout");
}

export function validateAndDecodeAccount({ address, info, program, kind }) {
  if (!info) {
    throw new Error(`${kind} account ${address.toBase58()} is missing`);
  }
  if (!info.owner.equals(PROGRAM_ID)) {
    throw new Error(`${kind} account ${address.toBase58()} has unexpected owner ${info.owner.toBase58()}`);
  }
  const accountClient = program.account[kind];
  const names = ACCOUNT_NAMES[kind];
  if (!accountClient || !names) {
    throw new Error(`Unknown account kind ${kind}`);
  }
  if (info.data.length !== accountClient.size) {
    throw new Error(
      `${kind} account ${address.toBase58()} has length ${info.data.length}; expected ${accountClient.size}`,
    );
  }
  const discriminator = anchorAccountDiscriminator(`account:${names.discriminatorName}`);
  if (!Buffer.from(info.data).subarray(0, 8).equals(discriminator)) {
    throw new Error(`${kind} account ${address.toBase58()} has an invalid discriminator`);
  }
  return program.coder.accounts.decode(names.coderName, info.data);
}

export function requireExecutionConfirmation({ dryRun, mainnet, confirmed }) {
  if (!dryRun && mainnet && !confirmed) {
    throw new Error(
      "Refusing mainnet legacy rent recovery without DRY_RUN=false and CONFIRM_MAINNET_RENT_RECOVERY=true",
    );
  }
}

async function fetchValidatedProgramAccounts({ connection, program, kind }) {
  const accountClient = program.account[kind];
  const memcmp = program.coder.accounts.memcmp(ACCOUNT_NAMES[kind].coderName);
  const accounts = await rpcWithRetry(() => connection.getProgramAccounts(PROGRAM_ID, {
      commitment: "confirmed",
      filters: [
        { dataSize: accountClient.size },
        { memcmp },
      ],
    }));
  const valid = [];
  const invalid = [];
  for (const account of accounts) {
    try {
      valid.push({
        address: account.pubkey,
        info: account.account,
        state: validateAndDecodeAccount({
          address: account.pubkey,
          info: account.account,
          program,
          kind,
        }),
      });
    } catch (error) {
      invalid.push(invalidRecord(account.pubkey, errorMessage(error)));
    }
  }
  return { valid, invalid };
}

async function closeInstruction({ program, keeper, inventory, row }) {
  const accounts = {
    keeper,
    config: new PublicKey(inventory.config),
    keeperConfig: new PublicKey(inventory.keeperConfig),
    pool: new PublicKey(row.poolAddress),
    round: new PublicKey(row.round),
    treasury: new PublicKey(inventory.treasury),
  };
  if (row.action === "close_empty_round_after_timeout") {
    return program.methods.closeEmptyRoundAfterTimeout().accounts(accounts).instruction();
  }
  if (row.action === "close_settled_round") {
    return program.methods.closeSettledRound().accounts({
      ...accounts,
      roundRandomness: deriveRoundRandomnessAccount(new PublicKey(row.round)),
    }).instruction();
  }
  throw new Error(`Unsupported recovery action ${row.action}`);
}

async function executeRecovery({
  connection,
  program,
  payer,
  keeper,
  inventory,
  row,
  archivePath,
}) {
  await assertRowStillEligible({ connection, program, keeper, inventory, row });
  const instruction = await closeInstruction({ program, keeper, inventory, row });
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: keeper,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);
  transaction.sign(payer);

  const simulation = await connection.simulateTransaction(transaction);
  if (simulation.value.err) {
    throw new Error(
      `Simulation failed for ${row.pool} round ${row.roundId}: ${JSON.stringify(simulation.value.err)}`,
    );
  }

  await assertRowStillEligible({ connection, program, keeper, inventory, row });

  if (row.action === "close_settled_round") {
    archiveLegacyEmptyRound(archivePath, row);
    if (!hasArchivedSettlement(archivePath, row.pool, row.roundId, {
      programId: PROGRAM_ID.toBase58(),
      poolAddress: row.poolAddress,
      address: row.round,
      accountDataHash: row.accountDataHash,
    })) {
      throw new Error(`Archive verification failed for ${row.pool} round ${row.roundId}`);
    }
  }

  const treasury = new PublicKey(inventory.treasury);
  const treasuryBefore = await connection.getBalance(treasury, "confirmed");
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`Recovery transaction ${signature} failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  const { treasuryAfter } = await waitForRecoveryState({
    connection,
    round: new PublicKey(row.round),
    treasury,
    treasuryBefore,
    expectedRecoveryLamports: row.lamports,
    signature,
  });
  return {
    pool: row.pool,
    roundId: row.roundId,
    round: row.round,
    action: row.action,
    recoveredLamports: row.lamports,
    treasury: inventory.treasury,
    treasuryBefore,
    treasuryAfter,
    treasuryDeltaLamports: treasuryAfter - treasuryBefore,
    signature,
    simulationUnitsConsumed: simulation.value.unitsConsumed ?? null,
    simulationLogs: simulation.value.logs ?? [],
  };
}

async function waitForRecoveryState({
  connection,
  round,
  treasury,
  treasuryBefore,
  expectedRecoveryLamports,
  signature,
}) {
  let lastAccount = null;
  let treasuryAfter = treasuryBefore;
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    [lastAccount, treasuryAfter] = await Promise.all([
      connection.getAccountInfo(round, "confirmed"),
      connection.getBalance(treasury, "confirmed"),
    ]);
    const effectivelyClosed = !lastAccount || lastAccount.lamports === 0;
    const rentObserved = treasuryAfter - treasuryBefore >= expectedRecoveryLamports;
    if (effectivelyClosed && rentObserved) {
      return { treasuryAfter };
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
  }
  throw new Error(
    `Confirmed recovery ${signature} did not converge in RPC state: roundLamports=${lastAccount?.lamports ?? 0}, treasuryDelta=${treasuryAfter - treasuryBefore}`,
  );
}

async function assertRowStillEligible({ connection, program, keeper, inventory, row }) {
  if ((await connection.getGenesisHash()) !== inventory.genesisHash) {
    throw new Error("Cluster genesis hash changed after inventory");
  }

  const configAddress = new PublicKey(inventory.config);
  const configInfo = await connection.getAccountInfo(configAddress, "confirmed");
  const configState = validateAndDecodeAccount({
    address: configAddress,
    info: configInfo,
    program,
    kind: "config",
  });
  if (configState.treasury.toBase58() !== inventory.treasury) {
    throw new Error("Treasury changed after inventory");
  }

  const keeperConfigAddress = new PublicKey(inventory.keeperConfig);
  const keeperConfigInfo = await connection.getAccountInfo(keeperConfigAddress, "confirmed");
  const keeperConfigState = validateAndDecodeAccount({
    address: keeperConfigAddress,
    info: keeperConfigInfo,
    program,
    kind: "keeperConfig",
  });
  if (!keeperConfigState.keeper.equals(keeper)) {
    throw new Error("Configured keeper changed after inventory");
  }

  const roundAddress = new PublicKey(row.round);
  const roundInfo = await connection.getAccountInfo(roundAddress, "confirmed");
  const roundState = validateAndDecodeAccount({
    address: roundAddress,
    info: roundInfo,
    program,
    kind: "round",
  });
  if (dataHash(roundInfo.data) !== row.accountDataHash) {
    throw new Error(`${row.pool} round ${row.roundId} state changed after inventory`);
  }
  if (!roundState.pool.equals(new PublicKey(row.poolAddress)) ||
      safeAnchorInteger(roundState.roundId, "round.roundId") !== row.roundId) {
    throw new Error(`${row.pool} round ${row.roundId} no longer matches its canonical identity`);
  }

  const entryMemcmp = program.coder.accounts.memcmp(ACCOUNT_NAMES.entry.coderName);
  const entries = await rpcWithRetry(() => connection.getProgramAccounts(PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { dataSize: program.account.entry.size },
      { memcmp: entryMemcmp },
      { memcmp: { offset: 8, bytes: roundAddress.toBase58() } },
    ],
  }));
  const sidecar = await connection.getAccountInfo(
    deriveRoundRandomnessAccount(roundAddress),
    "confirmed",
  );
  const decision = classifyLegacyEmptyRound({
    ...plainRoundState(roundState),
    current: row.current,
    now: Math.floor(Date.now() / 1000),
    entryAccountCount: entries.length,
    sidecarAccountCount: sidecar ? 1 : 0,
  });
  if (!decision.eligible || decision.action !== row.action) {
    throw new Error(
      `${row.pool} round ${row.roundId} is no longer eligible: ${decision.classification}`,
    );
  }
}

function archiveLegacyEmptyRound(filePath, row) {
  appendSettlementArchive(filePath, {
    recordType: "legacy_empty_round_rent_recovery",
    programId: PROGRAM_ID.toBase58(),
    pool: row.pool,
    poolAddress: row.poolAddress,
    address: row.round,
    accountDataHash: row.accountDataHash,
    roundId: row.roundId,
    startTs: row.startTs,
    endTs: row.endTs,
    ticketPriceLamports: row.ticketPriceLamports.toString(),
    totalTickets: "0",
    totalLamports: "0",
    entrantCount: 0,
    settled: true,
    winnerCount: 0,
    winner: SystemProgram.programId.toBase58(),
    winnerSecond: SystemProgram.programId.toBase58(),
    winnerThird: SystemProgram.programId.toBase58(),
    winners: [],
    jackpotTriggered: false,
    jackpotWinner: SystemProgram.programId.toBase58(),
    randomnessCommitment: row.randomnessCommitment,
    randomness: row.randomness,
    randomnessMode: "none",
    settlementSignature: null,
    entries: [],
    rentLamports: row.lamports,
  });
}

function plainRoundState(round) {
  return {
    startTs: safeAnchorInteger(round.startTs, "round.startTs", { allowNegative: true }),
    endTs: safeAnchorInteger(round.endTs, "round.endTs", { allowNegative: true }),
    ticketPriceLamports: BigInt(round.ticketPriceLamports.toString()),
    totalTickets: BigInt(round.totalTickets.toString()),
    totalLamports: BigInt(round.totalLamports.toString()),
    entrantCount: Number(round.entrantCount),
    settled: Boolean(round.settled),
    winnerCount: Number(round.winnerCount),
    randomnessCommitment: Buffer.from(round.randomnessCommitment).toString("hex"),
    randomness: Buffer.from(round.randomness).toString("hex"),
  };
}

function requireDerivedAccount(address, [expectedAddress, expectedBump], storedBump, label) {
  if (!address.equals(expectedAddress)) {
    throw new Error(`${label} address is not the canonical PDA`);
  }
  if (Number(storedBump) !== expectedBump) {
    throw new Error(`${label} stores non-canonical bump ${storedBump}; expected ${expectedBump}`);
  }
}

async function getMultipleAccountsInfoChunked(connection, addresses) {
  const output = [];
  for (let offset = 0; offset < addresses.length; offset += 100) {
    const chunk = addresses.slice(offset, offset + 100);
    output.push(...await rpcWithRetry(() => connection.getMultipleAccountsInfo(chunk, "confirmed")));
  }
  return output;
}

function safeAnchorInteger(value, label, { allowNegative = false } = {}) {
  const bigint = BigInt(value.toString());
  if ((!allowNegative && bigint < 0n) || bigint > BigInt(Number.MAX_SAFE_INTEGER) || bigint < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new Error(`${label} is outside the safe integer range`);
  }
  return Number(bigint);
}

function decision(classification, eligible, action) {
  return { classification, eligible, action };
}

function invalidRecord(address, reason) {
  return { address: address.toBase58(), reason };
}

function dataHash(data) {
  return createHash("sha256").update(Buffer.from(data)).digest("hex");
}

export function recoveryPlanHash(inventory) {
  const plan = {
    genesisHash: inventory.genesisHash,
    programId: inventory.programId,
    config: inventory.config,
    treasury: inventory.treasury,
    keeper: inventory.keeper,
    eligible: inventory.eligible.map((row) => ({
      pool: row.pool,
      poolAddress: row.poolAddress,
      roundId: row.roundId,
      round: row.round,
      lamports: row.lamports,
      accountDataHash: row.accountDataHash,
      action: row.action,
      destination: row.destination,
    })),
  };
  return createHash("sha256").update(JSON.stringify(plan)).digest("hex");
}

async function rpcWithRetry(operation, attempts = 5) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = errorMessage(error);
      if (!/429|rate limit|too many requests/i.test(message) || attempt === attempts - 1) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt)));
    }
  }
  throw lastError;
}

function addToMapList(map, key, value) {
  const existing = map.get(key) ?? [];
  existing.push(value);
  map.set(key, existing);
}

function u64Le(value) {
  const output = Buffer.alloc(8);
  output.writeBigUInt64LE(BigInt(value));
  return output;
}

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function looksLikeMainnetUrl(value) {
  return /mainnet|api\.mainnet-beta\.solana\.com|helius-rpc/i.test(value);
}

function redactRpcUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.search = parsed.search ? "?redacted=true" : "";
    return parsed.toString();
  } catch {
    return String(value).replace(/([?&](?:api-key|apikey|token|key)=)[^&]+/gi, "$1<redacted>");
  }
}

function printInventory(inventory) {
  console.log(JSON.stringify({
    event: inventory.event,
    checkedAt: inventory.checkedAt,
    clusterUrl: inventory.clusterUrl,
    genesisHash: inventory.genesisHash,
    mainnet: inventory.mainnet,
    programId: inventory.programId,
    config: inventory.config,
    authority: inventory.authority,
    treasury: inventory.treasury,
    treasuryLamportsBefore: inventory.treasuryLamportsBefore,
    keeper: inventory.keeper,
    keeperConfig: inventory.keeperConfig,
    keeperConfigExists: inventory.keeperConfigExists,
    configuredKeeper: inventory.configuredKeeper,
    keeperLamports: inventory.keeperLamports,
    dryRun: inventory.dryRun,
    poolCurrentRounds: inventory.poolCurrentRounds,
    totals: inventory.totals,
    planHash: inventory.planHash,
    invalidAccounts: inventory.invalidAccounts,
  }, null, 2));
  console.table(inventory.rows.map((row) => ({
    pool: row.pool,
    round: row.roundId,
    current: row.current,
    lamports: row.lamports,
    tickets: row.totalTickets?.toString?.() ?? "-",
    entrants: row.entrantCount ?? "-",
    settled: row.settled ?? "-",
    classification: row.classification,
    action: row.action,
  })));
}

function writeReport(filePath, inventory) {
  if (!filePath) {
    return;
  }
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const serializable = JSON.stringify(inventory, (_key, value) =>
    typeof value === "bigint" ? value.toString() : value, 2);
  const temporary = `${absolute}.tmp`;
  fs.writeFileSync(temporary, `${serializable}\n`, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, absolute);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (invokedPath === import.meta.url) {
  await main();
}
