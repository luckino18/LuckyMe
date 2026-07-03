import http from "node:http";
import { URL } from "node:url";
import { FIXED_POOLS, lamportsToSol, settleRound } from "../../sim/luckyme.mjs";
import {
  POOLS as ONCHAIN_POOLS,
  PROGRAM_ID,
  accountExists,
  createClient,
  deriveConfig,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveRound,
} from "../../scripts/anchor-client.mjs";

const PORT = Number(process.env.PORT ?? 8788);
const DEFAULT_ROUND_DURATION_SECONDS = 300;
const STATIC_POOL_BY_SLUG = new Map(FIXED_POOLS.map((pool) => [pool.id, pool]));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "luckyme-dev-api" });
  }

  if (req.method === "GET" && url.pathname === "/program") {
    return json(res, 200, await getProgramState());
  }

  if (req.method === "GET" && url.pathname === "/pools") {
    const state = await getProgramState();
    return json(res, 200, {
      source: state.onchain.available ? "onchain" : "static",
      onchain: state.onchain,
      config: state.config,
      pools: state.pools,
    });
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

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`LuckyMe dev API listening on http://localhost:${PORT}`);
});

async function getProgramState() {
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
        ? await fetchRound(program, poolAddress, currentRound)
        : null;

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

async function fetchRound(program, poolAddress, roundId) {
  const roundAddress = deriveRound(poolAddress, roundId);
  try {
    const round = await program.account.round.fetch(roundAddress);
    return {
      address: roundAddress.toBase58(),
      roundId: numberFromAnchor(round.roundId),
      startTs: numberFromAnchor(round.startTs),
      endTs: numberFromAnchor(round.endTs),
      ticketPriceLamports: stringFromAnchor(round.ticketPriceLamports),
      totalTickets: stringFromAnchor(round.totalTickets),
      totalLamports: stringFromAnchor(round.totalLamports),
      totalSol: lamportsToSol(bigintFromAnchor(round.totalLamports)),
      entrantCount: round.entrantCount,
      settled: round.settled,
      jackpotTriggered: round.jackpotTriggered,
      winner: round.winner.toBase58(),
      jackpotWinner: round.jackpotWinner.toBase58(),
    };
  } catch {
    return {
      address: roundAddress.toBase58(),
      roundId,
      missing: true,
    };
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
  };
}

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body, null, 2));
}

function serializeBigInts(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? inner.toString() : inner,
    ),
  );
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
