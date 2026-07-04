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
} from "../../scripts/anchor-client.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const DEFAULT_ROUND_DURATION_SECONDS = 300;
const STATIC_POOL_BY_SLUG = new Map(FIXED_POOLS.map((pool) => [pool.id, pool]));
const ONCHAIN_POOL_BY_SLUG = new Map(
  ONCHAIN_POOLS.map((pool) => [pool.label.toLowerCase(), pool]),
);

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "OPTIONS") {
    return empty(res, 204);
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

  if (req.method === "POST" && url.pathname === "/transactions/submit") {
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`LuckyMe dev API listening on http://localhost:${PORT}`);
});

async function getProgramState({ player } = {}) {
  const staticPools = buildStaticPools();

  try {
    const { connection, program, url } = createClient();
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
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
  const { connection, program, url } = createClient();
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
  const { connection, url } = createClient();
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
    if (totalLength > 1_000_000) {
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
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
}

function empty(res, status) {
  res.writeHead(status, {
    "access-control-allow-origin": "*",
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
