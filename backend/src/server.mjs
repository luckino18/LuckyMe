import { createHash } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import { FIXED_POOLS, lamportsToSol, settleRound } from "../../sim/luckyme.mjs";
import {
  BN,
  POOLS as ONCHAIN_POOLS,
  PROGRAM_ID,
  PublicKey,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveEntry,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveRound,
  u64Le,
} from "../../scripts/anchor-client.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? "127.0.0.1";
const DEFAULT_ROUND_DURATION_SECONDS = 300;
const REFUND_DELAY_SECONDS = 600;
const REFUND_SCAN_ROUNDS = Number(process.env.REFUND_SCAN_ROUNDS ?? 20);
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES ?? 100_000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 120);
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? "*";
const ENABLE_TRANSACTION_SUBMIT = process.env.ENABLE_TRANSACTION_SUBMIT === "true";
const ANCHOR_PROVIDER_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111";
const STATIC_POOL_BY_SLUG = new Map(FIXED_POOLS.map((pool) => [pool.id, pool]));
const ONCHAIN_POOL_BY_SLUG = new Map(
  ONCHAIN_POOLS.map((pool) => [pool.label.toLowerCase(), pool]),
);
const rateBuckets = new Map();

validateRuntimeConfig();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    return empty(res, 204);
  }

  if (!rateLimitAllows(req)) {
    return json(res, 429, {
      error: "rate_limited",
      message: "Too many requests",
    });
  }

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "luckyme-dev-api" });
  }

  if (req.method === "GET" && url.pathname === "/program") {
    return json(res, 200, await getProgramState());
  }

  if (req.method === "GET" && url.pathname === "/pools") {
    try {
      const playerParam = url.searchParams.get("player");
      const player = playerParam ? parsePublicKey(playerParam, "player") : null;
      const state = await getProgramState({ player });
      return json(res, 200, {
        source: state.onchain.available ? "onchain" : "static",
        onchain: state.onchain,
        config: state.config,
        pools: state.pools,
      });
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "pools_fetch_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/refunds") {
    try {
      return json(res, 200, await getRefundableEntries(url));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "refunds_fetch_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/simulate") {
    const poolId = url.searchParams.get("pool") ?? "normal";
    const pool = FIXED_POOLS.find((item) => item.id === poolId);
    if (!pool) {
      return json(res, 404, { error: "unknown pool" });
    }

    const result = settleRound({
      ticketPriceLamports: pool.ticketPriceLamports,
      jackpotBalanceLamports: 1_250_000_000n,
      randomSeed: url.searchParams.get("seed") ?? "dev",
      entries: [
        { player: "alice", tickets: 3n },
        { player: "ana", tickets: 8n },
        { player: "marius", tickets: 1n },
      ],
    });

    return json(res, 200, serializeBigInts({
      pool: pool.id,
      totalPoolSol: lamportsToSol(result.totalLamports),
      mainPrizeSol: lamportsToSol(result.mainPrize),
      houseFeeSol: lamportsToSol(result.houseFee),
      jackpotAddSol: lamportsToSol(result.jackpotAdd),
      winner: result.winner,
      jackpotTriggered: result.jackpotTriggered,
      jackpotWinner: result.jackpotWinner,
      jackpotPayoutSol: lamportsToSol(result.jackpotPayout),
      jackpotBalanceAfterSol: lamportsToSol(result.jackpotBalanceAfter),
    }));
  }

  if (req.method === "POST" && url.pathname === "/transactions/buy-tickets") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await buildBuyTicketsTransaction(payload));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "transaction_build_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/transactions/refund-entry") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await buildRefundEntryTransaction(payload));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "transaction_build_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/transactions/settle-round") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await buildSettleRoundTransaction(payload));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "transaction_build_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/transactions/submit") {
    if (!ENABLE_TRANSACTION_SUBMIT) {
      return json(res, 403, {
        error: "transaction_submit_disabled",
        message: "Transaction relay is disabled",
      });
    }

    try {
      const payload = await readJson(req);
      return json(res, 200, await submitSignedTransaction(payload));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "transaction_submit_failed",
        message: error.message,
      });
    }
  }

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`LuckyMe dev API listening on http://${HOST}:${PORT}`);
});

async function getProgramState({ player } = {}) {
  const staticPools = buildStaticPools();

  try {
    const { connection, program, url } = createClient({ requireSigner: false });
    const configAddress = deriveConfig();
    const programAccount = await connection.getAccountInfo(PROGRAM_ID, "confirmed");
    const hasConfig = await accountExists(connection, configAddress);

    if (!programAccount || !hasConfig) {
      return {
        onchain: {
          available: false,
          clusterUrl: url,
          programId: PROGRAM_ID.toBase58(),
          reason: !programAccount ? "program_not_deployed" : "config_not_initialized",
        },
        config: {
          address: configAddress.toBase58(),
          initialized: hasConfig,
        },
        pools: staticPools,
      };
    }

    const config = await program.account.config.fetch(configAddress);
    const pools = [];

    for (const poolSpec of ONCHAIN_POOLS) {
      const slug = poolSpec.label.toLowerCase();
      const poolAddress = derivePool(configAddress, poolSpec.id);
      const poolVault = derivePoolVault(poolAddress);
      const jackpotVault = deriveJackpotVault(poolAddress);
      const staticPool = STATIC_POOL_BY_SLUG.get(slug);

      const poolExists = await accountExists(connection, poolAddress);
      if (!poolExists) {
        pools.push({
          ...poolPayloadFromStatic(staticPool, poolSpec),
          source: "static",
          initialized: false,
          poolId: poolSpec.id,
          addresses: {
            pool: poolAddress.toBase58(),
            poolVault: poolVault.toBase58(),
            jackpotVault: jackpotVault.toBase58(),
          },
        });
        continue;
      }

      const pool = await program.account.pool.fetch(poolAddress);
      const currentRound = numberFromAnchor(pool.currentRound);
      const activeRound = currentRound > 0
        ? await fetchRound(program, poolAddress, currentRound, player)
        : null;
      const recentRounds = await fetchRecentRounds(
        program,
        poolAddress,
        currentRound,
        player,
      );

      pools.push({
        id: slug,
        label: poolSpec.label,
        source: "onchain",
        initialized: true,
        poolId: pool.poolId,
        ticketPriceLamports: stringFromAnchor(pool.ticketPriceLamports),
        ticketPriceSol: lamportsToSol(bigintFromAnchor(pool.ticketPriceLamports)),
        roundDurationSeconds: numberFromAnchor(config.roundDurationSecs),
        mainPrizeBps: 10_000 - config.houseFeeBps - config.jackpotBps,
        houseFeeBps: config.houseFeeBps,
        jackpotBps: config.jackpotBps,
        currentRound,
        jackpotLamports: stringFromAnchor(pool.jackpotLamports),
        jackpotSol: lamportsToSol(bigintFromAnchor(pool.jackpotLamports)),
        addresses: {
          pool: poolAddress.toBase58(),
          poolVault: poolVault.toBase58(),
          jackpotVault: jackpotVault.toBase58(),
        },
        activeRound,
        recentRounds,
      });
    }

    return {
      onchain: {
        available: true,
        clusterUrl: url,
        programId: PROGRAM_ID.toBase58(),
      },
      config: {
        initialized: true,
        address: configAddress.toBase58(),
        authority: config.authority.toBase58(),
        treasury: config.treasury.toBase58(),
        paused: config.paused,
        jackpotOddsDenominator: config.jackpotOddsDenominator,
        roundDurationSeconds: numberFromAnchor(config.roundDurationSecs),
        houseFeeBps: config.houseFeeBps,
        jackpotBps: config.jackpotBps,
      },
      pools,
    };
  } catch (error) {
    return {
      onchain: {
        available: false,
        programId: PROGRAM_ID.toBase58(),
        reason: "rpc_error",
        error: error instanceof Error ? error.message : String(error),
      },
      config: null,
      pools: staticPools,
    };
  }
}

async function buildBuyTicketsTransaction(payload) {
  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const ticketCount = parseTicketCount(payload.ticketCount);
  const player = parsePublicKey(payload.player, "player");
  enforceSubjectRateLimit(player.toBase58());
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
  const { connection, program, url } = createClient({ requireSigner: false });
  const config = deriveConfig();
  const pool = derivePool(config, poolSpec.id);
  const poolVault = derivePoolVault(pool);
  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = numberFromAnchor(poolAccount.currentRound);

  if (currentRound <= 0) {
    throw httpError(409, "no_open_round", "Pool has no open round");
  }

  const round = deriveRound(pool, currentRound);
  const roundAccount = await program.account.round.fetch(round);

  if (roundAccount.settled) {
    throw httpError(409, "round_settled", "Round is already settled");
  }

  const endTs = numberFromAnchor(roundAccount.endTs);
  if (Math.floor(Date.now() / 1000) >= endTs) {
    throw httpError(409, "round_closed", "Round is closed");
  }

  const entry = deriveEntry(round, player);
  const existingEntry = await fetchUserEntry(
    program,
    round,
    player,
    bigintFromAnchor(roundAccount.totalTickets),
  );
  if (existingEntry && BigInt(existingEntry.ticketCount) > 0n) {
    throw httpError(
      409,
      "already_entered_round",
      "Wallet already entered this round",
    );
  }

  const ticketPriceLamports = bigintFromAnchor(roundAccount.ticketPriceLamports);
  const amountLamports = ticketPriceLamports * BigInt(ticketCount);
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = await program.methods
    .buyTickets(new BN(ticketCount))
    .accounts({
      player,
      config,
      pool,
      round,
      entry,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.feePayer = player;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: url,
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "buy_tickets",
      pool: poolSlug,
      roundId: currentRound,
      ticketCount,
      ticketPriceLamports: ticketPriceLamports.toString(),
      amountLamports: amountLamports.toString(),
      amountSol: lamportsToSol(amountLamports),
      player: player.toBase58(),
      accounts: {
        config: config.toBase58(),
        pool: pool.toBase58(),
        round: round.toBase58(),
        entry: entry.toBase58(),
        poolVault: poolVault.toBase58(),
      },
    },
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    simulation,
  };
}

async function buildRefundEntryTransaction(payload) {
  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const player = parsePublicKey(payload.player, "player");
  const feePayer = payload.feePayer
    ? parsePublicKey(payload.feePayer, "feePayer")
    : player;
  enforceSubjectRateLimit(player.toBase58());
  enforceSubjectRateLimit(feePayer.toBase58());
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
  const { connection, program, url } = createClient({ requireSigner: false });
  const config = deriveConfig();
  const pool = derivePool(config, poolSpec.id);
  const poolVault = derivePoolVault(pool);
  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = numberFromAnchor(poolAccount.currentRound);
  const roundId = parseRoundId(payload.roundId, currentRound);
  const round = deriveRound(pool, roundId);
  const roundAccount = await program.account.round.fetch(round);
  const refundState = getRefundState(roundAccount);

  if (!refundState.refundAvailable) {
    throw httpError(
      409,
      "refund_not_available",
      "Refund is not available for this round",
    );
  }

  const entry = deriveEntry(round, player);
  const userEntry = await fetchUserEntry(
    program,
    round,
    player,
    bigintFromAnchor(roundAccount.totalTickets),
  );
  if (!userEntry || BigInt(userEntry.lamports) === 0n) {
    throw httpError(409, "nothing_to_refund", "Wallet has nothing to refund");
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = await program.methods
    .refundEntryAfterTimeout()
    .accounts({
      player,
      config,
      pool,
      round,
      entry,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.feePayer = feePayer;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: url,
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "refund_entry_after_timeout",
      pool: poolSlug,
      roundId,
      refundDelaySeconds: REFUND_DELAY_SECONDS,
      refundAfterTs: refundState.refundAfterTs,
      amountLamports: userEntry.lamports,
      amountSol: lamportsToSol(BigInt(userEntry.lamports)),
      player: player.toBase58(),
      feePayer: feePayer.toBase58(),
      accounts: {
        config: config.toBase58(),
        pool: pool.toBase58(),
        round: round.toBase58(),
        entry: entry.toBase58(),
        poolVault: poolVault.toBase58(),
      },
    },
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    simulation,
  };
}

async function buildSettleRoundTransaction(payload) {
  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const roundId = parseRoundId(payload.roundId);
  const settler = parsePublicKey(payload.settler ?? payload.keeper, "settler");
  enforceSubjectRateLimit(settler.toBase58());
  const reveal = parseRevealHex(payload.randomnessReveal ?? payload.reveal);
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
  const { connection, program, url } = createClient({ requireSigner: false });
  const configAddress = deriveConfig();
  const config = await program.account.config.fetch(configAddress);
  const pool = derivePool(configAddress, poolSpec.id);
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);
  const poolAccount = await program.account.pool.fetch(pool);
  const round = deriveRound(pool, roundId);
  const roundAccount = await program.account.round.fetch(round);

  if (roundAccount.settled) {
    throw httpError(409, "round_settled", "Round is already settled");
  }

  const endTs = numberFromAnchor(roundAccount.endTs);
  if (Math.floor(Date.now() / 1000) < endTs) {
    throw httpError(409, "round_still_open", "Round is still open");
  }

  const totalTickets = bigintFromAnchor(roundAccount.totalTickets);
  if (totalTickets === 0n) {
    throw httpError(409, "empty_round", "Round has no tickets");
  }

  const expectedCommitment = commitmentForReveal(reveal);
  const onchainCommitment = Buffer.from(roundAccount.randomnessCommitment);
  if (!onchainCommitment.equals(expectedCommitment)) {
    throw httpError(
      400,
      "invalid_randomness_reveal",
      "Reveal does not match the round commitment",
    );
  }

  const entries = await fetchEntriesForRound(program, round);
  const randomness = deriveRoundRandomness(round, totalTickets, reveal);
  const winningTicket = randomMod(randomness, 0, totalTickets);
  const winnerEntry = findEntryByTicket(entries, winningTicket, "winner");
  const jackpotRoll = randomMod(
    randomness,
    8,
    bigintFromAnchor(config.jackpotOddsDenominator),
  );
  const jackpotTriggered = jackpotRoll === 0n;
  const jackpotTicket = randomMod(randomness, 16, totalTickets);
  const jackpotEntry = findEntryByTicket(entries, jackpotTicket, "jackpot");

  const totalLamports = bigintFromAnchor(roundAccount.totalLamports);
  const houseFee = bpsAmount(totalLamports, bigintFromAnchor(config.houseFeeBps));
  const jackpotAdd = bpsAmount(totalLamports, bigintFromAnchor(config.jackpotBps));
  const mainPrize = totalLamports - houseFee - jackpotAdd;
  const jackpotPayout = jackpotTriggered
    ? bigintFromAnchor(poolAccount.jackpotLamports) + jackpotAdd
    : 0n;

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = await program.methods
    .settleRound([...reveal])
    .accounts({
      keeper: settler,
      config: configAddress,
      pool,
      round,
      poolVault,
      jackpotVault,
      winner: winnerEntry.player,
      winnerEntry: winnerEntry.address,
      jackpotWinner: jackpotEntry.player,
      jackpotEntry: jackpotEntry.address,
      treasury: config.treasury,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.feePayer = settler;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: url,
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "settle_round",
      pool: poolSlug,
      roundId,
      settler: settler.toBase58(),
      reveal: reveal.toString("hex"),
      randomness: randomness.toString("hex"),
      totalTickets: totalTickets.toString(),
      totalLamports: totalLamports.toString(),
      totalSol: lamportsToSol(totalLamports),
      winnerTicket: winningTicket.toString(),
      winner: winnerEntry.player.toBase58(),
      jackpotRoll: jackpotRoll.toString(),
      jackpotTriggered,
      jackpotTicket: jackpotTicket.toString(),
      jackpotWinner: jackpotTriggered ? jackpotEntry.player.toBase58() : null,
      mainPrizeLamports: mainPrize.toString(),
      mainPrizeSol: lamportsToSol(mainPrize),
      houseFeeLamports: houseFee.toString(),
      houseFeeSol: lamportsToSol(houseFee),
      jackpotAddLamports: jackpotAdd.toString(),
      jackpotAddSol: lamportsToSol(jackpotAdd),
      jackpotPayoutLamports: jackpotPayout.toString(),
      jackpotPayoutSol: lamportsToSol(jackpotPayout),
      accounts: {
        config: configAddress.toBase58(),
        pool: pool.toBase58(),
        round: round.toBase58(),
        poolVault: poolVault.toBase58(),
        jackpotVault: jackpotVault.toBase58(),
        winner: winnerEntry.player.toBase58(),
        winnerEntry: winnerEntry.address.toBase58(),
        jackpotWinner: jackpotEntry.player.toBase58(),
        jackpotEntry: jackpotEntry.address.toBase58(),
        treasury: config.treasury.toBase58(),
      },
      entriesScanned: entries.length,
    },
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    simulation,
  };
}

async function simulateUnsignedTransaction(connection, transactionBase64) {
  try {
    const result = await connection._rpcRequest("simulateTransaction", [
      transactionBase64,
      {
        commitment: "confirmed",
        encoding: "base64",
        sigVerify: false,
      },
    ]);

    if (result.error) {
      throw new Error(result.error.message);
    }

    const value = result.result.value;
    return {
      ok: value.err === null,
      err: value.err,
      logs: value.logs ?? [],
      unitsConsumed: value.unitsConsumed ?? null,
    };
  } catch (error) {
    return {
      ok: false,
      err: error instanceof Error ? error.message : String(error),
      logs: [],
      unitsConsumed: null,
    };
  }
}

async function submitSignedTransaction(payload) {
  const signedTransactionBase64 = parseBase64(
    payload.signedTransactionBase64,
    "signedTransactionBase64",
  );
  const { connection, url } = createClient({ requireSigner: false });
  const rawTransaction = Buffer.from(signedTransactionBase64, "base64");
  const signature = await connection.sendRawTransaction(rawTransaction, {
    maxRetries: 3,
    preflightCommitment: "confirmed",
    skipPreflight: false,
  });
  const confirmation = await connection.confirmTransaction(signature, "confirmed");

  if (confirmation.value.err) {
    throw httpError(
      502,
      "transaction_confirmation_failed",
      JSON.stringify(confirmation.value.err),
    );
  }

  return {
    clusterUrl: url,
    signature,
    confirmation: {
      err: confirmation.value.err,
    },
  };
}

async function fetchRound(program, poolAddress, roundId, player = null) {
  const roundAddress = deriveRound(poolAddress, roundId);
  try {
    const round = await program.account.round.fetch(roundAddress);
    const totalTickets = bigintFromAnchor(round.totalTickets);
    const refundState = getRefundState(round);
    return {
      address: roundAddress.toBase58(),
      roundId: numberFromAnchor(round.roundId),
      startTs: numberFromAnchor(round.startTs),
      endTs: numberFromAnchor(round.endTs),
      ticketPriceLamports: stringFromAnchor(round.ticketPriceLamports),
      totalTickets: totalTickets.toString(),
      totalLamports: stringFromAnchor(round.totalLamports),
      totalSol: lamportsToSol(bigintFromAnchor(round.totalLamports)),
      entrantCount: round.entrantCount,
      settled: round.settled,
      jackpotTriggered: round.jackpotTriggered,
      winner: round.winner.toBase58(),
      jackpotWinner: round.jackpotWinner.toBase58(),
      refundDelaySeconds: REFUND_DELAY_SECONDS,
      refundAfterTs: refundState.refundAfterTs,
      refundAvailable: refundState.refundAvailable,
      refundMode: refundState.refundMode,
      userEntry: player
        ? await fetchUserEntry(program, roundAddress, player, totalTickets)
        : undefined,
    };
  } catch {
    return {
      address: roundAddress.toBase58(),
      roundId,
      missing: true,
    };
  }
}

async function getRefundableEntries(url) {
  const poolFilter = url.searchParams.get("pool");
  const roundIdFilter = url.searchParams.get("roundId");
  const poolSlugs = poolFilter
    ? [parsePoolSlug(poolFilter)]
    : [...ONCHAIN_POOL_BY_SLUG.keys()];
  const { connection, program, url: clusterUrl } = createClient({ requireSigner: false });
  const configAddress = deriveConfig();
  const hasConfig = await accountExists(connection, configAddress);

  if (!hasConfig) {
    return {
      clusterUrl,
      programId: PROGRAM_ID.toBase58(),
      refunds: [],
    };
  }

  const refunds = [];

  for (const poolSlug of poolSlugs) {
    const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
    const pool = derivePool(configAddress, poolSpec.id);
    if (!(await accountExists(connection, pool))) {
      continue;
    }

    const poolAccount = await program.account.pool.fetch(pool);
    const currentRound = numberFromAnchor(poolAccount.currentRound);
    const roundIds = roundIdFilter
      ? [parseRoundId(roundIdFilter)]
      : recentRoundIds(currentRound, REFUND_SCAN_ROUNDS);

    for (const roundId of roundIds) {
      const roundAddress = deriveRound(pool, roundId);
      try {
        const round = await program.account.round.fetch(roundAddress);
        const refundState = getRefundState(round);
        if (!refundState.refundAvailable) {
          continue;
        }

        const entries = (await fetchEntriesForRound(program, roundAddress))
          .filter((entry) => entry.lamports > 0n)
          .map((entry) => ({
            address: entry.address.toBase58(),
            player: entry.player.toBase58(),
            ticketStart: entry.ticketStart.toString(),
            ticketCount: entry.ticketCount.toString(),
            lamports: entry.lamports.toString(),
            sol: lamportsToSol(entry.lamports),
          }));

        refunds.push({
          pool: poolSlug,
          roundId,
          round: roundAddress.toBase58(),
          refundAfterTs: refundState.refundAfterTs,
          refundMode: refundState.refundMode,
          entries,
        });
      } catch {
        // Ignore missing recent round accounts.
      }
    }
  }

  return {
    clusterUrl,
    programId: PROGRAM_ID.toBase58(),
    scanRounds: REFUND_SCAN_ROUNDS,
    refunds,
  };
}

async function fetchRecentRounds(program, poolAddress, currentRound, player = null) {
  if (currentRound <= 0) {
    return [];
  }

  const roundIds = [];
  const firstRound = Math.max(1, currentRound - 4);
  for (let roundId = currentRound; roundId >= firstRound; roundId -= 1) {
    roundIds.push(roundId);
  }

  return Promise.all(
    roundIds.map((roundId) => fetchRound(program, poolAddress, roundId, player)),
  );
}

function recentRoundIds(currentRound, count) {
  if (currentRound <= 0) {
    return [];
  }

  const firstRound = Math.max(1, currentRound - Math.max(1, count) + 1);
  const roundIds = [];
  for (let roundId = currentRound; roundId >= firstRound; roundId -= 1) {
    roundIds.push(roundId);
  }
  return roundIds;
}

async function fetchUserEntry(program, roundAddress, player, totalTickets) {
  const entryAddress = deriveEntry(roundAddress, player);

  try {
    const entry = await program.account.entry.fetch(entryAddress);
    const ticketCount = bigintFromAnchor(entry.ticketCount);

    return {
      address: entryAddress.toBase58(),
      player: entry.player.toBase58(),
      ticketStart: stringFromAnchor(entry.ticketStart),
      ticketCount: ticketCount.toString(),
      lamports: stringFromAnchor(entry.lamports),
      chancePercent: formatPercentRatio(ticketCount, totalTickets),
    };
  } catch {
    return null;
  }
}

async function fetchEntriesForRound(program, roundAddress) {
  const accounts = await program.account.entry.all([
    {
      memcmp: {
        offset: 8,
        bytes: roundAddress.toBase58(),
      },
    },
  ]);

  return accounts
    .map(({ publicKey, account }) => {
      const ticketStart = bigintFromAnchor(account.ticketStart);
      const ticketCount = bigintFromAnchor(account.ticketCount);
      return {
        address: publicKey,
        player: account.player,
        ticketStart,
        ticketCount,
        ticketEndExclusive: ticketStart + ticketCount,
        lamports: bigintFromAnchor(account.lamports),
      };
    })
    .filter((entry) => entry.ticketCount > 0n)
    .sort((left, right) =>
      left.ticketStart < right.ticketStart ? -1 : left.ticketStart > right.ticketStart ? 1 : 0,
    );
}

function buildStaticPools() {
  return ONCHAIN_POOLS.map((poolSpec) => {
    const slug = poolSpec.label.toLowerCase();
    return poolPayloadFromStatic(STATIC_POOL_BY_SLUG.get(slug), poolSpec);
  });
}

function poolPayloadFromStatic(staticPool, poolSpec) {
  const ticketPriceLamports = staticPool?.ticketPriceLamports ?? BigInt(poolSpec.ticketPriceLamports.toString());
  return {
    id: staticPool?.id ?? poolSpec.label.toLowerCase(),
    label: staticPool?.label ?? poolSpec.label,
    source: "static",
    ticketPriceLamports: ticketPriceLamports.toString(),
    ticketPriceSol: lamportsToSol(ticketPriceLamports),
    roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
    mainPrizeBps: 9500,
    houseFeeBps: 300,
    jackpotBps: 200,
    recentRounds: [],
  };
}

async function readJson(req) {
  const chunks = [];
  let totalLength = 0;

  for await (const chunk of req) {
    totalLength += chunk.length;
    if (totalLength > MAX_JSON_BYTES) {
      throw httpError(413, "payload_too_large", "Payload is too large");
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw httpError(400, "invalid_json", "Request body must be valid JSON");
  }
}

function parsePoolSlug(value) {
  const poolSlug = String(value ?? "").toLowerCase();

  if (!ONCHAIN_POOL_BY_SLUG.has(poolSlug)) {
    throw httpError(400, "unknown_pool", "Unknown pool");
  }

  return poolSlug;
}

function parseTicketCount(value) {
  const ticketCount = Number(value);

  if (!Number.isSafeInteger(ticketCount) || ticketCount < 1 || ticketCount > 1_000) {
    throw httpError(400, "invalid_ticket_count", "Ticket count must be 1-1000");
  }

  return ticketCount;
}

function parseRoundId(value, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback === undefined) {
      throw httpError(400, "invalid_round_id", "roundId must be a positive integer");
    }
    return fallback;
  }

  const roundId = Number(value);
  if (!Number.isSafeInteger(roundId) || roundId < 1) {
    throw httpError(400, "invalid_round_id", "roundId must be a positive integer");
  }

  return roundId;
}

function parseRevealHex(value) {
  const normalized = String(value ?? "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw httpError(
      400,
      "invalid_randomness_reveal",
      "randomnessReveal must be a 32-byte hex string",
    );
  }
  return Buffer.from(normalized, "hex");
}

function parsePublicKey(value, field) {
  try {
    return new PublicKey(String(value ?? ""));
  } catch {
    throw httpError(400, `invalid_${field}`, `${field} must be a Solana public key`);
  }
}

function parseBase64(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.length > 100_000) {
    throw httpError(400, `invalid_${field}`, `${field} must be base64`);
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw httpError(400, `invalid_${field}`, `${field} must be base64`);
  }

  return value;
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": CORS_ORIGIN,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
}

function empty(res, status) {
  res.writeHead(status, {
    "access-control-allow-origin": CORS_ORIGIN,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end();
}

function httpError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function serializeBigInts(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? inner.toString() : inner,
    ),
  );
}

function commitmentForReveal(reveal) {
  return createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(reveal)
    .digest();
}

function deriveRoundRandomness(roundAddress, totalTickets, reveal) {
  return createHash("sha256")
    .update(Buffer.from("luckyme-round-randomness"))
    .update(roundAddress.toBuffer())
    .update(u64Le(totalTickets))
    .update(reveal)
    .digest();
}

function randomMod(randomness, offset, modulo) {
  return randomness.readBigUInt64LE(offset) % modulo;
}

function findEntryByTicket(entries, ticket, label) {
  const entry = entries.find((item) =>
    ticket >= item.ticketStart && ticket < item.ticketEndExclusive,
  );

  if (!entry) {
    throw httpError(
      409,
      `${label}_entry_not_found`,
      `No ${label} entry contains ticket ${ticket.toString()}`,
    );
  }

  return entry;
}

function bpsAmount(totalLamports, bps) {
  return (totalLamports * bps) / 10_000n;
}

function getRefundState(round) {
  const endTs = numberFromAnchor(round.endTs);
  const refundAfterTs = endTs + REFUND_DELAY_SECONDS;
  const refundMode = isRefundMode(round);
  const refundAvailable = (
    (!round.settled || refundMode) &&
    Math.floor(Date.now() / 1000) >= refundAfterTs &&
    bigintFromAnchor(round.totalLamports) > 0n
  );

  return {
    refundAfterTs,
    refundAvailable,
    refundMode,
  };
}

function isRefundMode(round) {
  return round.settled &&
    !round.jackpotTriggered &&
    round.winner.toBase58() === DEFAULT_PUBLIC_KEY &&
    round.jackpotWinner.toBase58() === DEFAULT_PUBLIC_KEY &&
    Array.from(round.randomness).every((byte) => byte === 0);
}

function rateLimitAllows(req) {
  const now = Date.now();
  const clientId = getClientId(req);
  const existing = rateBuckets.get(clientId);

  if (!existing || now >= existing.resetAt) {
    rateBuckets.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  existing.count += 1;
  return existing.count <= RATE_LIMIT_MAX;
}

function enforceSubjectRateLimit(subject) {
  if (rateLimitAllowsKey(`subject:${subject}`)) {
    return;
  }
  throw httpError(429, "rate_limited", "Too many requests for this wallet");
}

function rateLimitAllowsKey(clientId) {
  const now = Date.now();
  const existing = rateBuckets.get(clientId);

  if (!existing || now >= existing.resetAt) {
    rateBuckets.set(clientId, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  existing.count += 1;
  return existing.count <= RATE_LIMIT_MAX;
}

function getClientId(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  if (typeof forwardedFor === "string" && forwardedFor.length > 0) {
    return forwardedFor.split(",")[0].trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

function validateRuntimeConfig() {
  if (isMainnetUrl(ANCHOR_PROVIDER_URL)) {
    const allowed = (
      process.env.LUCKYME_ENABLE_MAINNET === "true" &&
      process.env.LUCKYME_LEGAL_SIGNOFF === "true" &&
      process.env.LUCKYME_PRODUCTION_RANDOMNESS === "true" &&
      process.env.LUCKYME_MULTISIG_SIGNOFF === "true"
    );

    if (!allowed) {
      throw new Error(
        "Refusing mainnet RPC without LUCKYME_ENABLE_MAINNET, legal, randomness, and multisig signoffs",
      );
    }
  }

  if (process.env.NODE_ENV === "production") {
    if (CORS_ORIGIN === "*") {
      throw new Error("CORS_ORIGIN must be strict in production");
    }

    if (ENABLE_TRANSACTION_SUBMIT) {
      throw new Error("ENABLE_TRANSACTION_SUBMIT must stay false in production");
    }

    if (HOST === "0.0.0.0") {
      throw new Error("HOST=0.0.0.0 is not allowed directly in production; put the API behind a proxy");
    }
  }
}

function isMainnetUrl(url) {
  return /mainnet|api\.mainnet-beta\.solana\.com/i.test(url);
}

function formatPercentRatio(numerator, denominator) {
  if (denominator === 0n) {
    return "0.00";
  }

  return ((Number(numerator) / Number(denominator)) * 100).toFixed(2);
}

function bigintFromAnchor(value) {
  return BigInt(value.toString());
}

function numberFromAnchor(value) {
  return Number(value.toString());
}

function stringFromAnchor(value) {
  return value.toString();
}
