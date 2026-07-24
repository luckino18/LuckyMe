import { createHash, randomBytes } from "node:crypto";
import http from "node:http";
import { URL } from "node:url";
import anchor from "@coral-xyz/anchor";
import oraoVrf from "@orao-network/solana-vrf";
import { Transaction } from "@solana/web3.js";
import { readSettlementArchive } from "../../scripts/settlement-archive.mjs";
import {
  registerPushToken,
  unregisterPushToken,
} from "./push-notifications.mjs";
import {
  DEFAULT_HOUSE_FEE_BPS,
  DEFAULT_JACKPOT_BPS,
  DEFAULT_MAIN_PRIZE_BPS,
  DEFAULT_ROUND_DURATION_SECONDS,
  FIXED_POOLS,
  lamportsToSol,
  settleRound,
} from "../../sim/luckyme.mjs";
import {
  BN,
  ORAO_VRF_PROGRAM_ID,
  POOLS as ONCHAIN_POOLS,
  PROGRAM_ID,
  PublicKey,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveEntry,
  deriveKeeperConfig,
  deriveOraoRandomnessAccount,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveProviderRoundRandomness,
  deriveRound,
  deriveRoundRandomnessAccount,
  mainPrizePayouts,
  parseOraoRandomnessV2,
  randomModDomain,
  selectWinnerTickets,
  u64Le,
} from "../../scripts/anchor-client.mjs";

const { AnchorProvider } = anchor;
const { Orao } = oraoVrf;
const REFUND_DELAY_SECONDS = 600;
const REFUND_SCAN_ROUNDS = Number(process.env.REFUND_SCAN_ROUNDS ?? 20);
const MAX_JSON_BYTES = Number(process.env.MAX_JSON_BYTES ?? 100_000);
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX ?? 120);
const PROGRAM_STATE_CACHE_TTL_MS = Number(process.env.PROGRAM_STATE_CACHE_TTL_MS ?? 10_000);
const PLAYER_STATE_CACHE_MAX_ENTRIES = Number(
  process.env.PLAYER_STATE_CACHE_MAX_ENTRIES ?? 2_000,
);
const SETTLEMENT_ARCHIVE_PATH = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH ?? "";
const ENABLE_TRANSACTION_SUBMIT = process.env.ENABLE_TRANSACTION_SUBMIT === "true";
const RELEASE_MODE = process.env.LUCKYME_RELEASE_MODE ?? "MAINNET_RELEASE";
const IS_LOCAL_DEVELOPMENT = RELEASE_MODE === "LOCAL_DEVELOPMENT";
const IS_NODE_PRODUCTION = process.env.NODE_ENV === "production";
const IS_STORE_BUILD = process.env.LUCKYME_STORE_BUILD === "true";
const IS_RELEASE_SURFACE = RELEASE_MODE === "MAINNET_RELEASE" || IS_NODE_PRODUCTION || IS_STORE_BUILD;
const PORT = Number(process.env.PORT ?? 8788);
const HOST = process.env.HOST ?? (IS_LOCAL_DEVELOPMENT ? "127.0.0.1" : "0.0.0.0");
const ALLOW_WILDCARD_CORS =
  process.env.LUCKYME_ALLOW_WILDCARD_CORS === "true" &&
  IS_LOCAL_DEVELOPMENT &&
  !IS_NODE_PRODUCTION;
const CORS_ORIGIN = process.env.CORS_ORIGIN ?? (ALLOW_WILDCARD_CORS ? "*" : "");
const CORS_ORIGINS = parseCorsOrigins(CORS_ORIGIN);
const ANCHOR_PROVIDER_URL =
  process.env.ANCHOR_PROVIDER_URL ?? (IS_LOCAL_DEVELOPMENT ? "http://127.0.0.1:8899" : "");
const PUBLIC_WALLET_RPC_URL =
  process.env.LUCKYME_PUBLIC_WALLET_RPC_URL ??
  (IS_LOCAL_DEVELOPMENT ? ANCHOR_PROVIDER_URL : "https://api.mainnet-beta.solana.com");
const DEV_CLUSTER_NAME = ["dev", "net"].join("");
const TEST_CLUSTER_NAME = ["test", "net"].join("");
const LOCAL_CLUSTER_NAME = ["local", "net"].join("");
const RANDOMNESS_MODE =
  process.env.LUCKYME_RANDOMNESS_MODE ?? (IS_LOCAL_DEVELOPMENT ? "commit_reveal_demo" : "orao_vrf");
const SOLANA_CLUSTER =
  process.env.LUCKYME_SOLANA_CLUSTER ?? inferClusterName(ANCHOR_PROVIDER_URL);
const PRODUCTION_RANDOMNESS_ENABLED = process.env.LUCKYME_PRODUCTION_RANDOMNESS === "true";
const ORAO_PROGRAM_ID = parsePublicKeyConfig(
  process.env.LUCKYME_ORAO_PROGRAM_ID ?? ORAO_VRF_PROGRAM_ID.toBase58(),
  "LUCKYME_ORAO_PROGRAM_ID",
);
const STRICT_ONCHAIN =
  RELEASE_MODE === "MAINNET_RELEASE" ||
  process.env.LUCKYME_STRICT_ONCHAIN === "true" ||
  IS_STORE_BUILD ||
  IS_NODE_PRODUCTION;
const DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111";
const NON_MAINNET_RPC_RE = new RegExp(
  `${DEV_CLUSTER_NAME}|${TEST_CLUSTER_NAME}|localhost|127\\.0\\.0\\.1|0\\.0\\.0\\.0|192\\.168\\.|10\\.`,
  "i",
);
const STATIC_POOL_BY_SLUG = new Map(FIXED_POOLS.map((pool) => [pool.id, pool]));
const ONCHAIN_POOL_BY_SLUG = new Map(
  ONCHAIN_POOLS.map((pool) => [pool.slug, pool]),
);
const MINIMUM_POLICY_BY_POOL_ID = Object.freeze({
  1: Object.freeze({ minimumTickets: 25, minimumDistinctEntrants: 1 }),
  2: Object.freeze({ minimumTickets: 13, minimumDistinctEntrants: 1 }),
  3: Object.freeze({ minimumTickets: 3, minimumDistinctEntrants: 1 }),
  4: Object.freeze({ minimumTickets: 3, minimumDistinctEntrants: 3 }),
});
const ROUND_OUTCOMES = new Set([
  "waiting",
  "open",
  "eligible_for_draw",
  "cancelled_below_minimum",
  "settling",
  "settled",
]);
const REFUND_STATUSES = new Set(["none", "pending", "completed"]);
const rateBuckets = new Map();
const programStateCache = new Map();
const programStateInflight = new Map();
let programStateVersion = 0;

class ReadonlyPublicKeyWallet {
  constructor(publicKey) {
    this.publicKey = publicKey;
  }

  async signTransaction() {
    throw new Error("Readonly wallet cannot sign transactions");
  }

  async signAllTransactions() {
    throw new Error("Readonly wallet cannot sign transactions");
  }
}

validateRuntimeConfig();

if (process.env.LUCKYME_VALIDATE_CONFIG_ONLY === "true") {
  console.log("LuckyMe backend production config is valid");
  process.exit(0);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  applyCorsHeaders(req, res);

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
    return json(res, 200, {
      ok: true,
      service: "luckyme-api",
      mode: RELEASE_MODE,
      cluster: clusterName(ANCHOR_PROVIDER_URL),
    });
  }

  if (req.method === "GET" && url.pathname === "/config") {
    return json(res, 200, await getPublicConfig());
  }

  if (req.method === "GET" && url.pathname === "/program") {
    return json(res, 200, await getProgramState());
  }

  if (req.method === "GET" && url.pathname === "/pools") {
    try {
      const playerParam = url.searchParams.get("player");
      const player = playerParam ? parsePublicKey(playerParam, "player") : null;
      const state = await getCachedProgramState({ player });
      if (STRICT_ONCHAIN && !state.onchain.available) {
        return json(res, 503, {
          error: "onchain_state_unavailable",
          message: "On-chain state is required in store/production mode",
          onchain: state.onchain,
        });
      }
      const source = state.onchain.available
        ? "onchain"
        : !IS_RELEASE_SURFACE && IS_LOCAL_DEVELOPMENT
          ? "static"
          : "unavailable";
      return json(res, 200, {
        source,
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

  if (req.method === "POST" && url.pathname === "/notifications/register") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await registerPushToken(payload));
    } catch (error) {
      return json(res, error.status ?? 400, {
        error: error.code ?? "notification_registration_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/notifications/unregister") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await unregisterPushToken(payload));
    } catch (error) {
      return json(res, error.status ?? 400, {
        error: error.code ?? "notification_unregister_failed",
        message: error.message,
      });
    }
  }

  const roundRandomnessMatch = url.pathname.match(/^\/rounds\/([^/]+)\/randomness$/);
  const poolRoundRandomnessMatch = url.pathname.match(/^\/rounds\/([^/]+)\/([^/]+)\/randomness$/);
  if (req.method === "GET" && (roundRandomnessMatch || poolRoundRandomnessMatch)) {
    try {
      const pool = poolRoundRandomnessMatch?.[1] ?? url.searchParams.get("pool") ?? "normal";
      const roundId = poolRoundRandomnessMatch?.[2] ?? roundRandomnessMatch?.[1];
      return json(res, 200, await getRoundRandomness(pool, roundId));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "randomness_fetch_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/simulate") {
    if (!IS_LOCAL_DEVELOPMENT || IS_NODE_PRODUCTION || IS_STORE_BUILD || RELEASE_MODE === "MAINNET_RELEASE") {
      return json(res, 404, { error: "not_found" });
    }

    const poolId = url.searchParams.get("pool") ?? "normal";
    const pool = FIXED_POOLS.find((item) => item.id === poolId);
    if (!pool) {
      return json(res, 404, { error: "unknown pool" });
    }

    const result = buildLocalDevelopmentSimulation(
      pool,
      url.searchParams.get("seed") ?? "local-development",
    );

    return json(res, 200, serializeBigInts({
      pool: pool.id,
      totalPoolSol: lamportsToSol(result.totalLamports),
      mainPrizeSol: lamportsToSol(result.mainPrize),
      houseFeeSol: lamportsToSol(result.houseFee),
      jackpotAddSol: lamportsToSol(result.jackpotAdd),
      winnerCount: result.winnerCount,
      winner: result.winner,
      winners: result.winners.map((winner) => ({
        player: winner.player,
        ticket: winner.ticket.toString(),
        prizeSol: lamportsToSol(winner.prizeLamports),
      })),
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

  if (req.method === "POST" && url.pathname === "/transactions/crank-empty-rounds") {
    return json(res, 410, {
      error: "idle_round_crank_retired",
      message: "Empty rounds now wait for the first ticket and must not be rotated",
    });
  }

  if (req.method === "POST" && url.pathname === "/transactions/refund-entry") {
    return json(res, 410, {
      error: "automatic_refund_only",
      message: "Refunds are processed automatically by the configured keeper; no claim transaction is required",
    });
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

  if (req.method === "POST" && url.pathname === "/transactions/request-randomness") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await buildRequestRandomnessTransaction(payload));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "transaction_build_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/transactions/request-orao-randomness") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await buildRequestOraoRandomnessTransaction(payload));
    } catch (error) {
      return json(res, error.status ?? 500, {
        error: error.code ?? "orao_transaction_build_failed",
        message: error.message,
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/transactions/settle-provider-round") {
    try {
      const payload = await readJson(req);
      return json(res, 200, await buildSettleProviderRoundTransaction(payload));
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

if (process.env.LUCKYME_POLICY_TEST_ONLY !== "true") {
  server.listen(PORT, HOST, () => {
    console.log(`LuckyMe API listening on http://${HOST}:${PORT}`);
  });
}

function buildLocalDevelopmentSimulation(pool, randomSeed) {
  return settleRound({
    pool,
    ticketPriceLamports: pool.ticketPriceLamports,
    jackpotBalanceLamports: 1_250_000_000n,
    randomSeed,
    entries: [
      { player: "local-player-1", tickets: 3n },
      { player: "local-player-2", tickets: 8n },
      { player: "local-player-3", tickets: 1n },
    ],
  });
}

async function getProgramState({ player } = {}) {
  const staticPools = STRICT_ONCHAIN ? [] : buildStaticPools();

  try {
    const { connection, program, url } = createClient({
      requireSigner: false,
      url: ANCHOR_PROVIDER_URL,
    });
    const configAddress = deriveConfig();
    const programAccount = await connection.getAccountInfo(PROGRAM_ID, "confirmed");
    const hasConfig = await accountExists(connection, configAddress);
    const genesisHash = await connection.getGenesisHash();

    if (!programAccount || !hasConfig) {
      return {
        onchain: {
          available: false,
          clusterUrl: publicRpcUrl(url),
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
    const poolAddresses = ONCHAIN_POOLS.map((poolSpec) =>
      derivePool(configAddress, poolSpec.id),
    );
    const poolAccounts = await program.account.pool.fetchMultiple(poolAddresses);

    for (const [poolIndex, poolSpec] of ONCHAIN_POOLS.entries()) {
      const slug = poolSpec.slug;
      const poolAddress = poolAddresses[poolIndex];
      const poolVault = derivePoolVault(poolAddress);
      const jackpotVault = deriveJackpotVault(poolAddress);
      const staticPool = STATIC_POOL_BY_SLUG.get(slug);
      const pool = poolAccounts[poolIndex];

      if (!pool) {
        if (!STRICT_ONCHAIN) {
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
        }
        continue;
      }

      const currentRound = numberFromAnchor(pool.currentRound);
      const onchainRecentRounds = await fetchRecentRounds(
        program,
        poolAddress,
        currentRound,
        player,
        poolSpec,
      );
      const fetchedActiveRound = onchainRecentRounds.find(
        (round) => !round?.missing && Number(round.roundId) === currentRound,
      ) ?? null;
      const activeRound = fetchedActiveRound?.missing ? null : fetchedActiveRound;
      const recentRounds = mergeArchivedRounds(
        onchainRecentRounds,
        slug,
        currentRound,
        player,
        {
          genesisHash,
          programId: PROGRAM_ID.toBase58(),
          poolAddress: poolAddress.toBase58(),
        },
      );

      const minimumPolicy = minimumPolicyForPool(poolSpec);
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
        winnerCount: numberFromAnchor(pool.winnerCount),
        prizeSplitBps: pool.prizeSplitBps.map(numberFromAnchor),
        maxTicketsPerEntry: numberFromAnchor(pool.maxTicketsPerEntry),
        currentRound,
        jackpotLamports: stringFromAnchor(pool.jackpotLamports),
        jackpotSol: lamportsToSol(bigintFromAnchor(pool.jackpotLamports)),
        jackpotMessage: "Random jackpot can trigger after any completed round.",
        ...minimumPolicy,
        totalTickets: activeRound?.totalTickets ?? null,
        ticketsRemaining: activeRound?.ticketsRemaining ?? null,
        minimumReached: activeRound?.minimumReached ?? null,
        refundStatus: activeRound?.refundStatus ?? "none",
        roundOutcome: activeRound?.roundOutcome ?? null,
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
        clusterUrl: publicRpcUrl(url),
        genesisHash,
        programId: PROGRAM_ID.toBase58(),
      },
      config: {
        initialized: true,
        address: configAddress.toBase58(),
        authority: config.authority.toBase58(),
        treasury: config.treasury.toBase58(),
        paused: config.paused,
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

async function getCachedProgramState({ player } = {}) {
  const publicRecord = await getCachedPublicProgramState();
  if (!player || !publicRecord.state?.onchain?.available) {
    return publicRecord.state;
  }

  const cacheKey = `player:${player.toBase58()}:${publicRecord.version}`;
  const now = Date.now();
  const cached = programStateCache.get(cacheKey);

  if (cached && now - cached.storedAt <= PROGRAM_STATE_CACHE_TTL_MS) {
    return cached.state;
  }

  const inflight = programStateInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = enrichProgramStateForPlayer(publicRecord.state, player)
    .then((state) => {
      if (state?.onchain?.available) {
        programStateCache.set(cacheKey, {
          state,
          storedAt: Date.now(),
          version: publicRecord.version,
        });
        prunePlayerStateCache();
      }
      return state;
    })
    .finally(() => {
      programStateInflight.delete(cacheKey);
    });

  programStateInflight.set(cacheKey, promise);
  return promise;
}

async function getCachedPublicProgramState() {
  const cacheKey = "public";
  const now = Date.now();
  const cacheEnabled = Number.isFinite(PROGRAM_STATE_CACHE_TTL_MS) &&
    PROGRAM_STATE_CACHE_TTL_MS > 0;
  const cached = programStateCache.get(cacheKey);

  if (cacheEnabled && cached && now - cached.storedAt <= PROGRAM_STATE_CACHE_TTL_MS) {
    return cached;
  }

  const inflight = programStateInflight.get(cacheKey);
  if (inflight) {
    return inflight;
  }

  const promise = getProgramState()
    .then((state) => {
      const record = {
        state,
        storedAt: Date.now(),
        version: ++programStateVersion,
      };
      if (state?.onchain?.available && cacheEnabled) {
        programStateCache.set(cacheKey, record);
      }
      return record;
    })
    .finally(() => {
      programStateInflight.delete(cacheKey);
    });

  programStateInflight.set(cacheKey, promise);
  return promise;
}

function prunePlayerStateCache() {
  if (!Number.isSafeInteger(PLAYER_STATE_CACHE_MAX_ENTRIES) || PLAYER_STATE_CACHE_MAX_ENTRIES <= 0) {
    return;
  }
  const playerKeys = [...programStateCache.keys()].filter((key) => key.startsWith("player:"));
  const overflow = playerKeys.length - PLAYER_STATE_CACHE_MAX_ENTRIES;
  if (overflow <= 0) {
    return;
  }
  playerKeys
    .sort((left, right) =>
      (programStateCache.get(left)?.storedAt ?? 0) - (programStateCache.get(right)?.storedAt ?? 0)
    )
    .slice(0, overflow)
    .forEach((key) => programStateCache.delete(key));
}

async function enrichProgramStateForPlayer(state, player, options = {}) {
  const playerAddress = player.toBase58();
  const roundAddresses = collectPlayerRoundAddresses(state);
  const entryByRound = new Map();

  if (roundAddresses.length > 0) {
    const program = options.program ?? createClient({
      requireSigner: false,
      url: ANCHOR_PROVIDER_URL,
    }).program;
    const entryAddresses = roundAddresses.map((round) => deriveEntry(round, player));
    const accounts = await program.account.entry.fetchMultiple(entryAddresses);

    for (let index = 0; index < roundAddresses.length; index += 1) {
      const round = roundAddresses[index];
      const account = accounts[index] ?? null;
      if (!account) {
        entryByRound.set(round.toBase58(), null);
        continue;
      }
      if (!account.round.equals(round) || !account.player.equals(player)) {
        throw new Error(`Player Entry identity mismatch for round ${round.toBase58()}`);
      }
      const ticketCount = bigintFromAnchor(account.ticketCount);
      entryByRound.set(round.toBase58(), {
        address: entryAddresses[index].toBase58(),
        player: playerAddress,
        ticketStart: stringFromAnchor(account.ticketStart),
        ticketCount: ticketCount.toString(),
        lamports: stringFromAnchor(account.lamports),
        chancePercent: null,
      });
    }
  }

  const enrichRound = (round) => {
    if (!round || round.missing) {
      return round;
    }
    const totalTickets = BigInt(round.totalTickets ?? 0);
    if (round.archived) {
      const archivedEntry = (round.entries ?? []).find((entry) => entry.player === playerAddress);
      return {
        ...round,
        userEntry: archivedEntry
          ? {
              ...archivedEntry,
              chancePercent: formatPercentRatio(BigInt(archivedEntry.ticketCount ?? 0), totalTickets),
            }
          : undefined,
      };
    }
    const entry = entryByRound.get(round.address) ?? null;
    return {
      ...round,
      userEntry: entry
        ? {
            ...entry,
            chancePercent: formatPercentRatio(BigInt(entry.ticketCount), totalTickets),
          }
        : null,
    };
  };

  return {
    ...state,
    pools: (state.pools ?? []).map((pool) => ({
      ...pool,
      activeRound: enrichRound(pool.activeRound),
      recentRounds: (pool.recentRounds ?? []).map(enrichRound),
    })),
  };
}

function collectPlayerRoundAddresses(state) {
  const rounds = new Map();
  for (const pool of state.pools ?? []) {
    for (const round of [pool.activeRound, ...(pool.recentRounds ?? [])]) {
      if (!round || round.missing || round.archived || !round.address) {
        continue;
      }
      try {
        const address = new PublicKey(round.address);
        rounds.set(address.toBase58(), address);
      } catch {
        throw new Error(`Invalid Round address in cached program state: ${round.address}`);
      }
    }
  }
  return [...rounds.values()];
}

async function getPublicConfig() {
  const state = await getCachedProgramState();
  const config = state.config ?? {};
  const onchainPools = state.pools ?? [];
  const firstPool = onchainPools.find((pool) => pool.initialized) ?? onchainPools[0] ?? {};
  const houseFeeBps = Number(config.houseFeeBps ?? DEFAULT_HOUSE_FEE_BPS);
  const jackpotBps = Number(config.jackpotBps ?? DEFAULT_JACKPOT_BPS);
  const roundDurationSeconds = Number(
    config.roundDurationSeconds ?? DEFAULT_ROUND_DURATION_SECONDS,
  );
  const supportedRandomnessModes = RELEASE_MODE === "MAINNET_RELEASE"
    ? ["orao_vrf"]
    : ["commit_reveal_demo", "orao_vrf"];
  const randomnessProviderName = RELEASE_MODE === "MAINNET_RELEASE"
    ? "orao_vrf"
    : RANDOMNESS_MODE === "orao_vrf"
      ? "orao_vrf"
      : "commit_reveal_demo";

  return {
    service: "luckyme-api",
    mode: RELEASE_MODE,
    releaseMode: RELEASE_MODE,
    supportedModes: ["MAINNET_RELEASE", "LOCAL_DEVELOPMENT"],
    cluster: clusterName(ANCHOR_PROVIDER_URL),
    clusterUrl: publicRpcUrl(ANCHOR_PROVIDER_URL),
    programId: PROGRAM_ID.toBase58(),
    onchainAvailable: state.onchain.available,
    onchain: state.onchain,
    randomnessMode: RANDOMNESS_MODE,
    supportedRandomnessModes,
    productionRandomnessEnabled: PRODUCTION_RANDOMNESS_ENABLED,
    randomnessProvider: {
      mode: RANDOMNESS_MODE,
      provider: randomnessProviderName,
      oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
      failover: "none",
      commitRevealAllowed: RELEASE_MODE !== "MAINNET_RELEASE" && RANDOMNESS_MODE === "commit_reveal_demo",
    },
    mainnet: RELEASE_MODE === "MAINNET_RELEASE",
    realFundsEnabled: RELEASE_MODE === "MAINNET_RELEASE",
    economics: {
      mainPrizeBps: 10_000 - houseFeeBps - jackpotBps,
      houseFeeBps,
      jackpotBps,
      roundDurationSeconds,
      refundDelaySeconds: REFUND_DELAY_SECONDS,
      poolMinimums: ONCHAIN_POOLS.map((poolSpec) => ({
        pool: poolSpec.slug,
        ...minimumPolicyForPool(poolSpec),
      })),
    },
    treasury: config.treasury ?? null,
    authority: config.authority ?? null,
    poolVaultExample: firstPool.addresses?.poolVault ?? null,
    jackpotVaultExample: firstPool.addresses?.jackpotVault ?? null,
    releaseChecks: {
      strictOnchain: STRICT_ONCHAIN,
      transactionSubmitRelayEnabled: ENABLE_TRANSACTION_SUBMIT,
      backendSignsPlayerTransactions: false,
    },
    notifications: {
      provider: "expo",
      registrationEndpoint: "/notifications/register",
      maxRoundAlertsPerRound: 2,
    },
  };
}

async function buildBuyTicketsTransaction(payload) {
  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const ticketCount = parseTicketCount(payload.ticketCount);
  const expectedRoundId = parseRoundId(payload.expectedRoundId);
  const expectedTotalTickets = parseExpectedTotalTickets(payload.expectedTotalTickets);
  const player = parsePublicKey(payload.player, "player");
  enforceSubjectRateLimit(player.toBase58());
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
  const { connection, program, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const config = deriveConfig();
  const pool = derivePool(config, poolSpec.id);
  const poolVault = derivePoolVault(pool);
  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = numberFromAnchor(poolAccount.currentRound);
  const maxTicketsPerEntry = numberFromAnchor(poolAccount.maxTicketsPerEntry ?? poolSpec.maxTicketsPerEntry);

  if (ticketCount > maxTicketsPerEntry) {
    throw httpError(
      400,
      "invalid_ticket_count",
      `${poolSpec.label} allows at most ${maxTicketsPerEntry} ticket${maxTicketsPerEntry === 1 ? "" : "s"} per wallet per round`,
    );
  }

  if (currentRound <= 0) {
    throw httpError(409, "no_open_round", "Pool has no open round");
  }
  if (currentRound !== expectedRoundId) {
    throw httpError(
      409,
      "reviewed_round_changed",
      "The pool advanced to another round. Refresh and review the purchase again.",
    );
  }

  const round = deriveRound(pool, currentRound);
  const roundAccount = await program.account.round.fetch(round);

  if (roundAccount.settled) {
    throw httpError(409, "round_settled", "Round is already settled");
  }

  const endTs = numberFromAnchor(roundAccount.endTs);
  if (endTs > 0 && Math.floor(Date.now() / 1000) >= endTs) {
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
  const minimumPolicy = minimumPolicyForPool(poolSpec);
  const totalTicketsBefore = bigintFromAnchor(roundAccount.totalTickets);
  if (totalTicketsBefore !== expectedTotalTickets) {
    throw httpError(
      409,
      "reviewed_ticket_total_changed",
      "Tickets sold changed after the review opened. Refresh and review the purchase again.",
    );
  }
  const totalTicketsAfter = totalTicketsBefore + BigInt(ticketCount);
  const distinctEntrantsAfter = numberFromAnchor(roundAccount.entrantCount) + 1;
  const ticketsRemainingAfter = Math.max(
    minimumPolicy.minimumTickets - Number(totalTicketsAfter),
    0,
  );
  const minimumReachedAfter = (
    totalTicketsAfter >= BigInt(minimumPolicy.minimumTickets) &&
    distinctEntrantsAfter >= minimumPolicy.minimumDistinctEntrants
  );
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = await program.methods
    .buyTickets(new BN(ticketCount), new BN(expectedTotalTickets.toString()))
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
    clusterUrl: publicRpcUrl(url),
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "buy_tickets",
      pool: poolSlug,
      roundId: currentRound,
      ticketCount,
      maxTicketsPerEntry,
      ticketPriceLamports: ticketPriceLamports.toString(),
      amountLamports: amountLamports.toString(),
      amountSol: lamportsToSol(amountLamports),
      ...minimumPolicy,
      totalTicketsBefore: totalTicketsBefore.toString(),
      totalTicketsAfter: totalTicketsAfter.toString(),
      ticketsRemainingAfter,
      minimumReachedAfter,
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

async function buildCrankEmptyRoundsTransaction(payload) {
  throw httpError(
    410,
    "idle_round_crank_retired",
    "Empty rounds wait for the first ticket; the legacy rotation builder is permanently disabled",
  );

  // Retained temporarily below only to keep this migration diff reviewable.
  // The unconditional error above makes the old builder non-executable, while
  // the public route is independently retired with the same HTTP 410 response.
  const keeper = parsePublicKey(payload.keeper, "keeper");
  enforceSubjectRateLimit(keeper.toBase58());
  const requestedPool = payload.pool ? parsePoolSlug(payload.pool) : null;
  const pools = requestedPool
    ? [ONCHAIN_POOL_BY_SLUG.get(requestedPool)]
    : ONCHAIN_POOLS;
  const { connection, program, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const config = deriveConfig();
  const configAccount = await program.account.config.fetch(config);
  const transaction = new Transaction();
  const now = Math.floor(Date.now() / 1000);
  const actions = [];

  for (const poolSpec of pools) {
    const pool = derivePool(config, poolSpec.id);
    const poolAccount = await program.account.pool.fetch(pool);
    const currentRound = numberFromAnchor(poolAccount.currentRound);

    if (currentRound <= 0) {
      await addOpenRoundInstruction({
        program,
        transaction,
        actions,
        keeper,
        config,
        pool,
        poolSpec,
        roundId: 1,
      });
      continue;
    }

    const round = deriveRound(pool, currentRound);
    const roundAccount = await program.account.round.fetch(round);
    const endTs = numberFromAnchor(roundAccount.endTs);
    const empty = bigintFromAnchor(roundAccount.totalTickets) === 0n &&
      bigintFromAnchor(roundAccount.totalLamports) === 0n &&
      Number(roundAccount.entrantCount) === 0;
    const expired = endTs > 0 && now >= endTs;

    if (endTs === 0) {
      actions.push({
        action: "skip_waiting_first_ticket",
        pool: poolSpec.slug,
        roundId: currentRound,
        round: round.toBase58(),
      });
      continue;
    }

    if (roundAccount.settled) {
      actions.push({
        action: "open_next_after_settlement",
        pool: poolSpec.slug,
        roundId: currentRound + 1,
        previousRoundId: currentRound,
        previousRound: round.toBase58(),
      });
      await addOpenRoundInstruction({
        program,
        transaction,
        actions,
        keeper,
        config,
        pool,
        poolSpec,
        roundId: currentRound + 1,
      });
      continue;
    }

    if (!expired) {
      actions.push({
        action: "skip_active_round",
        pool: poolSpec.slug,
        roundId: currentRound,
        round: round.toBase58(),
        endTs,
      });
      continue;
    }

    if (!empty) {
      actions.push({
        action: "skip_non_empty_expired_round_needs_settlement",
        pool: poolSpec.slug,
        roundId: currentRound,
        round: round.toBase58(),
        totalTickets: stringFromAnchor(roundAccount.totalTickets),
      });
      continue;
    }

    if (!roundAccount.settled) {
      const closeInstruction = await program.methods
        .closeEmptyRoundAfterTimeout()
        .accounts({
          keeper,
          config,
          pool,
          round,
          treasury: configAccount.treasury,
        })
        .instruction();
      transaction.add(closeInstruction);
      actions.push({
        action: "close_empty_round",
        pool: poolSpec.slug,
        roundId: currentRound,
        round: round.toBase58(),
      });
    }

    await addOpenRoundInstruction({
      program,
      transaction,
      actions,
      keeper,
      config,
      pool,
      poolSpec,
      roundId: currentRound + 1,
    });
  }

  if (transaction.instructions.length === 0) {
    return {
      clusterUrl: publicRpcUrl(url),
      programId: PROGRAM_ID.toBase58(),
      transactionBase64: null,
      summary: {
        action: "crank_empty_rounds",
        keeper: keeper.toBase58(),
        actions,
        executableInstructions: 0,
      },
      simulation: {
        ok: true,
        err: null,
        logs: [],
        unitsConsumed: null,
      },
    };
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = keeper;
  transaction.recentBlockhash = latestBlockhash.blockhash;
  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: publicRpcUrl(url),
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "crank_empty_rounds",
      keeper: keeper.toBase58(),
      actions,
      executableInstructions: transaction.instructions.length,
      estimatedNewRoundRentLamports: String(2_811_840n * BigInt(
        actions.filter((item) => item.action === "open_round").length,
      )),
    },
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    simulation,
  };
}

async function addOpenRoundInstruction({
  program,
  transaction,
  actions,
  keeper,
  config,
  pool,
  poolSpec,
  roundId,
}) {
  const round = deriveRound(pool, roundId);
  const reveal = randomBytes(32);
  const commitment = createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(reveal)
    .digest();
  const instruction = await program.methods
    .openRound([...commitment])
    .accounts({
      keeper,
      config,
      pool,
      round,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  transaction.add(instruction);
  actions.push({
    action: "open_round",
    pool: poolSpec.slug,
    roundId,
    round: round.toBase58(),
    randomnessCommitment: commitment.toString("hex"),
    randomnessReveal: reveal.toString("hex"),
  });
}

async function buildRefundEntryTransaction(payload) {
  void payload;
  throw httpError(
    410,
    "automatic_refund_only",
    "Refunds are processed automatically by the configured keeper; no claim transaction is required",
  );
}

async function buildSettleRoundTransaction(payload) {
  if (RANDOMNESS_MODE !== "commit_reveal_demo") {
    throw httpError(
      409,
      "commit_reveal_settlement_disabled",
      "Use /transactions/settle-provider-round when LUCKYME_RANDOMNESS_MODE=orao_vrf",
    );
  }

  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const roundId = parseRoundId(payload.roundId);
  const settler = parsePublicKey(payload.settler ?? payload.keeper, "settler");
  enforceSubjectRateLimit(settler.toBase58());
  const reveal = parseRevealHex(payload.randomnessReveal ?? payload.reveal);
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
  const { connection, program, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const configAddress = deriveConfig();
  const config = await program.account.config.fetch(configAddress);
  const keeperConfig = await assertConfiguredKeeper(program, configAddress, settler);
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
  if (endTs <= 0) {
    throw httpError(409, "round_not_started", "Round is waiting for its first ticket");
  }
  if (Math.floor(Date.now() / 1000) < endTs) {
    throw httpError(409, "round_still_open", "Round is still open");
  }

  const totalTickets = bigintFromAnchor(roundAccount.totalTickets);
  if (totalTickets === 0n) {
    throw httpError(409, "empty_round", "Round has no tickets");
  }
  assertRoundMinimumReached(poolSpec, roundAccount);

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
  const settlement = buildSettlementPreview({
    config,
    poolAccount,
    poolSpec,
    roundAccount,
    poolJackpotLamports: bigintFromAnchor(poolAccount.jackpotLamports),
    entries,
    randomness,
  });
  const {
    totalLamports,
    poolConfig,
    winnerTickets,
    winnerEntries,
    jackpotRoll,
    jackpotTriggered,
    jackpotTicket,
    jackpotEntry,
    houseFee,
    jackpotAdd,
    mainPrize,
    prizePayouts,
    jackpotPayout,
  } = settlement;
  const winnerEntry = winnerEntries[0];

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = await program.methods
    .settleRound([...reveal])
    .accounts({
      keeper: settler,
      config: configAddress,
      keeperConfig,
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
    .remainingAccounts(remainingWinnerAccounts(winnerEntries))
    .transaction();

  transaction.feePayer = settler;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: publicRpcUrl(url),
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
      winnerCount: poolConfig.winnerCount,
      winnerTicket: winnerTickets[0].toString(),
      winner: winnerEntry.player.toBase58(),
      winners: winnerSummaries(winnerEntries, winnerTickets, prizePayouts),
      jackpotRoll: jackpotRoll.toString(),
      jackpotTriggered,
      jackpotTicket: jackpotTicket.toString(),
      jackpotWinner: jackpotTriggered ? jackpotEntry.player.toBase58() : null,
      mainPrizeLamports: mainPrize.toString(),
      mainPrizeSol: lamportsToSol(mainPrize),
      firstPrizeLamports: prizePayouts[0].toString(),
      firstPrizeSol: lamportsToSol(prizePayouts[0]),
      secondPrizeLamports: prizePayouts[1].toString(),
      secondPrizeSol: lamportsToSol(prizePayouts[1]),
      thirdPrizeLamports: prizePayouts[2].toString(),
      thirdPrizeSol: lamportsToSol(prizePayouts[2]),
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
        ...(winnerEntries[1]
          ? {
              winnerSecond: winnerEntries[1].player.toBase58(),
              winnerSecondEntry: winnerEntries[1].address.toBase58(),
            }
          : {}),
        ...(winnerEntries[2]
          ? {
              winnerThird: winnerEntries[2].player.toBase58(),
              winnerThirdEntry: winnerEntries[2].address.toBase58(),
            }
          : {}),
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

async function buildRequestRandomnessTransaction(payload) {
  requireOraoMode();
  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const roundId = parseRoundId(payload.roundId);
  const keeper = parsePublicKey(payload.keeper ?? payload.feePayer, "keeper");
  enforceSubjectRateLimit(keeper.toBase58());

  const { connection, program, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const { config, pool, round, roundAccount, poolSpec } = await fetchRoundContext(
    program,
    poolSlug,
    roundId,
  );
  const sidecar = deriveRoundRandomnessAccount(round);
  const keeperConfig = await assertConfiguredKeeper(program, config, keeper);

  assertRoundReadyForProviderRequest(roundAccount, poolSpec);
  if (await accountExists(connection, sidecar)) {
    throw httpError(
      409,
      "randomness_already_requested",
      "RoundRandomness sidecar already exists for this round",
    );
  }

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = await program.methods
    .requestRandomness()
    .accounts({
      keeper,
      config,
      keeperConfig,
      pool,
      round,
      roundRandomness: sidecar,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  transaction.feePayer = keeper;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: publicRpcUrl(url),
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "request_randomness",
      randomnessMode: RANDOMNESS_MODE,
      provider: "orao_vrf",
      pool: poolSlug,
      poolLabel: poolSpec.label,
      roundId,
      keeper: keeper.toBase58(),
      seedDerivation: "recorded on-chain at execution using final round state and request slot",
      accounts: {
        config: config.toBase58(),
        pool: pool.toBase58(),
        round: round.toBase58(),
        roundRandomness: sidecar.toBase58(),
        oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
      },
    },
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    simulation,
  };
}

async function buildRequestOraoRandomnessTransaction(payload) {
  requireOraoMode();
  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const roundId = parseRoundId(payload.roundId);
  const keeper = parsePublicKey(payload.keeper ?? payload.feePayer, "keeper");
  enforceSubjectRateLimit(keeper.toBase58());

  const { connection, program, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const { config, pool, round, roundAccount, poolSpec } = await fetchRoundContext(
    program,
    poolSlug,
    roundId,
  );
  assertRoundReadyForProviderRequest(roundAccount, poolSpec);

  const sidecar = deriveRoundRandomnessAccount(round);
  const sidecarAccount = await fetchRoundRandomnessSidecar(program, sidecar);
  if (!sidecarAccount) {
    throw httpError(
      409,
      "randomness_not_requested",
      "Run /transactions/request-randomness first to create the LuckyMe sidecar",
    );
  }

  const seed = Buffer.from(sidecarAccount.randomnessSeed);
  const expectedRequest = deriveOraoRandomnessAccount(seed, ORAO_PROGRAM_ID);
  if (!sidecarAccount.request.equals(expectedRequest)) {
    throw httpError(
      409,
      "orao_request_mismatch",
      "LuckyMe sidecar ORAO request does not match the derived ORAO PDA",
    );
  }

  const existingRequest = await connection.getAccountInfo(sidecarAccount.request, "confirmed");
  if (existingRequest) {
    return {
      clusterUrl: publicRpcUrl(url),
      programId: PROGRAM_ID.toBase58(),
      transactionBase64: null,
      summary: {
        action: "request_orao_randomness",
        pool: poolSlug,
        poolLabel: poolSpec.label,
        roundId,
        keeper: keeper.toBase58(),
        request: sidecarAccount.request.toBase58(),
        providerStatus: "already_exists",
      },
      simulation: {
        ok: true,
        err: null,
        logs: [],
        unitsConsumed: null,
      },
    };
  }

  const provider = new AnchorProvider(
    connection,
    new ReadonlyPublicKeyWallet(keeper),
    {
      commitment: "confirmed",
      preflightCommitment: "confirmed",
    },
  );
  const vrf = new Orao(provider, ORAO_PROGRAM_ID);
  const networkState = await vrf.getNetworkState("confirmed");
  const builder = await vrf.request(seed);
  builder.withComputeUnitPrice(0n);
  const methodBuilder = await builder.build();
  const transaction = await methodBuilder.transaction();
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = keeper;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: publicRpcUrl(url),
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "request_orao_randomness",
      randomnessMode: RANDOMNESS_MODE,
      provider: "orao_vrf",
      pool: poolSlug,
      poolLabel: poolSpec.label,
      roundId,
      keeper: keeper.toBase58(),
      seed: seed.toString("hex"),
      request: sidecarAccount.request.toBase58(),
      requestFeeLamports: networkState.config.requestFee.toString(),
      accounts: {
        config: config.toBase58(),
        pool: pool.toBase58(),
        round: round.toBase58(),
        roundRandomness: sidecar.toBase58(),
        oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
        oraoTreasury: networkState.config.treasury.toBase58(),
      },
    },
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    simulation,
  };
}

async function buildSettleProviderRoundTransaction(payload) {
  requireOraoMode();
  const poolSlug = parsePoolSlug(payload.pool ?? payload.poolId);
  const roundId = parseRoundId(payload.roundId);
  const settler = parsePublicKey(payload.settler ?? payload.keeper, "settler");
  enforceSubjectRateLimit(settler.toBase58());

  const { connection, program, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const { config, configAccount, pool, poolAccount, round, roundAccount, poolSpec } =
    await fetchRoundContext(program, poolSlug, roundId);
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);
  const sidecar = deriveRoundRandomnessAccount(round);

  if (roundAccount.settled) {
    throw httpError(409, "round_settled", "Round is already settled");
  }

  const endTs = numberFromAnchor(roundAccount.endTs);
  if (endTs <= 0) {
    throw httpError(409, "round_not_started", "Round is waiting for its first ticket");
  }
  if (Math.floor(Date.now() / 1000) < endTs) {
    throw httpError(409, "round_still_open", "Round is still open");
  }

  const totalTickets = bigintFromAnchor(roundAccount.totalTickets);
  if (totalTickets === 0n) {
    throw httpError(409, "empty_round", "Round has no tickets");
  }
  assertRoundMinimumReached(poolSpec, roundAccount);

  const sidecarAccount = await fetchRoundRandomnessSidecar(program, sidecar);
  if (!sidecarAccount) {
    throw httpError(
      409,
      "randomness_not_requested",
      "Run /transactions/request-randomness and the ORAO keeper request first",
    );
  }

  const request = sidecarAccount.request;
  const providerAccount = await connection.getAccountInfo(request, "confirmed");
  if (!providerAccount) {
    throw httpError(
      409,
      "provider_randomness_missing",
      "ORAO randomness request account does not exist yet",
    );
  }
  if (!providerAccount.owner.equals(ORAO_PROGRAM_ID)) {
    throw httpError(
      409,
      "invalid_provider_randomness_owner",
      "ORAO randomness account is not owned by the configured ORAO program",
    );
  }

  const parsedRandomness = parseOraoRandomnessV2(providerAccount.data);
  if (parsedRandomness.status !== "fulfilled") {
    throw httpError(
      409,
      "provider_randomness_not_fulfilled",
      parsedRandomness.error ?? "ORAO randomness is not fulfilled",
    );
  }
  if (!parsedRandomness.seed.equals(Buffer.from(sidecarAccount.randomnessSeed))) {
    throw httpError(
      409,
      "provider_randomness_seed_mismatch",
      "ORAO randomness seed does not match LuckyMe sidecar",
    );
  }

  const entries = await fetchEntriesForRound(program, round);
  const randomness = deriveProviderRoundRandomness(
    round,
    totalTickets,
    parsedRandomness.randomness,
  );
  const settlement = buildSettlementPreview({
    config: configAccount,
    poolAccount,
    poolSpec,
    roundAccount,
    poolJackpotLamports: bigintFromAnchor(poolAccount.jackpotLamports),
    entries,
    randomness,
  });
  const {
    totalLamports,
    poolConfig,
    winnerTickets,
    winnerEntries,
    jackpotRoll,
    jackpotTriggered,
    jackpotTicket,
    jackpotEntry,
    houseFee,
    jackpotAdd,
    mainPrize,
    prizePayouts,
    jackpotPayout,
  } = settlement;
  const winnerEntry = winnerEntries[0];
  const keeperConfig = await assertConfiguredKeeper(program, config, settler);

  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = await program.methods
    .settleRoundWithProviderRandomness()
    .accounts({
      keeper: settler,
      config,
      keeperConfig,
      pool,
      round,
      roundRandomness: sidecar,
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
    .remainingAccounts(remainingWinnerAccounts(winnerEntries))
    .transaction();

  transaction.feePayer = settler;
  transaction.recentBlockhash = latestBlockhash.blockhash;

  const transactionBase64 = transaction
    .serialize({ requireAllSignatures: false, verifySignatures: false })
    .toString("base64");
  const simulation = await simulateUnsignedTransaction(connection, transactionBase64);

  return {
    clusterUrl: publicRpcUrl(url),
    programId: PROGRAM_ID.toBase58(),
    transactionBase64,
    summary: {
      action: "settle_round_with_provider_randomness",
      randomnessMode: RANDOMNESS_MODE,
      provider: "orao_vrf",
      pool: poolSlug,
      poolLabel: poolSpec.label,
      roundId,
      settler: settler.toBase58(),
      request: request.toBase58(),
      seed: Buffer.from(sidecarAccount.randomnessSeed).toString("hex"),
      providerRandomnessHash: parsedRandomness.randomnessHash.toString("hex"),
      derivedRandomness: randomness.toString("hex"),
      totalTickets: totalTickets.toString(),
      totalLamports: totalLamports.toString(),
      totalSol: lamportsToSol(totalLamports),
      winnerCount: poolConfig.winnerCount,
      winnerTicket: winnerTickets[0].toString(),
      winner: winnerEntry.player.toBase58(),
      winners: winnerSummaries(winnerEntries, winnerTickets, prizePayouts),
      jackpotRoll: jackpotRoll.toString(),
      jackpotTriggered,
      jackpotTicket: jackpotTicket.toString(),
      jackpotWinner: jackpotTriggered ? jackpotEntry.player.toBase58() : null,
      mainPrizeLamports: mainPrize.toString(),
      mainPrizeSol: lamportsToSol(mainPrize),
      firstPrizeLamports: prizePayouts[0].toString(),
      firstPrizeSol: lamportsToSol(prizePayouts[0]),
      secondPrizeLamports: prizePayouts[1].toString(),
      secondPrizeSol: lamportsToSol(prizePayouts[1]),
      thirdPrizeLamports: prizePayouts[2].toString(),
      thirdPrizeSol: lamportsToSol(prizePayouts[2]),
      houseFeeLamports: houseFee.toString(),
      houseFeeSol: lamportsToSol(houseFee),
      jackpotAddLamports: jackpotAdd.toString(),
      jackpotAddSol: lamportsToSol(jackpotAdd),
      jackpotPayoutLamports: jackpotPayout.toString(),
      jackpotPayoutSol: lamportsToSol(jackpotPayout),
      accounts: {
        config: config.toBase58(),
        pool: pool.toBase58(),
        round: round.toBase58(),
        roundRandomness: sidecar.toBase58(),
        providerRandomness: request.toBase58(),
        poolVault: poolVault.toBase58(),
        jackpotVault: jackpotVault.toBase58(),
        winner: winnerEntry.player.toBase58(),
        winnerEntry: winnerEntry.address.toBase58(),
        ...(winnerEntries[1]
          ? {
              winnerSecond: winnerEntries[1].player.toBase58(),
              winnerSecondEntry: winnerEntries[1].address.toBase58(),
            }
          : {}),
        ...(winnerEntries[2]
          ? {
              winnerThird: winnerEntries[2].player.toBase58(),
              winnerThirdEntry: winnerEntries[2].address.toBase58(),
            }
          : {}),
        jackpotWinner: jackpotEntry.player.toBase58(),
        jackpotEntry: jackpotEntry.address.toBase58(),
        treasury: configAccount.treasury.toBase58(),
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
  const { connection, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
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
    clusterUrl: publicRpcUrl(url),
    signature,
    confirmation: {
      err: confirmation.value.err,
    },
  };
}

async function fetchRound(program, poolAddress, roundId, player = null, poolSpec = null) {
  const roundAddress = deriveRound(poolAddress, roundId);
  try {
    const round = await program.account.round.fetch(roundAddress);
    return roundPayloadFromAccount(
      program,
      poolAddress,
      roundAddress,
      roundId,
      round,
      player,
      poolSpec,
    );
  } catch {
    return {
      address: roundAddress.toBase58(),
      roundId,
      missing: true,
    };
  }
}

async function roundPayloadFromAccount(
  program,
  poolAddress,
  roundAddress,
  roundId,
  round,
  player = null,
  poolSpec = null,
) {
  const totalTickets = bigintFromAnchor(round.totalTickets);
  const refundState = getRefundState(round, poolSpec);
  const providerRandomness = await getRoundRandomnessState(
    program.provider.connection,
    program,
    poolAddress,
    roundAddress,
    roundId,
    totalTickets,
    round,
  );
  const minimumFields = poolSpec
    ? roundPolicyFields(poolSpec, round, {
        refundState,
        providerRandomness,
      })
    : {};
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
    winnerCount: numberFromAnchor(round.winnerCount ?? 0),
    winner: round.winner.toBase58(),
    winnerSecond: round.winnerSecond?.toBase58?.() ?? DEFAULT_PUBLIC_KEY,
    winnerThird: round.winnerThird?.toBase58?.() ?? DEFAULT_PUBLIC_KEY,
    winners: [
      round.winner,
      round.winnerSecond,
      round.winnerThird,
    ]
      .filter((winner) => winner && winner.toBase58() !== DEFAULT_PUBLIC_KEY)
      .map((winner, index) => ({
        rank: index + 1,
        winner: winner.toBase58(),
      })),
    jackpotWinner: round.jackpotWinner.toBase58(),
    randomnessCommitment: Buffer.from(round.randomnessCommitment).toString("hex"),
    randomness: Buffer.from(round.randomness).toString("hex"),
    randomnessMode: RANDOMNESS_MODE,
    randomnessProofStatus: randomnessProofStatus(round),
    providerRandomness,
    ...minimumFields,
    refundDelaySeconds: REFUND_DELAY_SECONDS,
    refundAfterTs: refundState.refundAfterTs,
    refundAvailable: refundState.refundAvailable,
    refundMode: refundState.refundMode,
    userEntry: player
      ? await fetchUserEntry(program, roundAddress, player, totalTickets)
      : undefined,
  };
}

async function getRoundRandomness(poolInput, roundIdInput) {
  const poolSlug = parsePoolSlug(poolInput);
  const roundId = parseRoundId(roundIdInput);
  const { connection, program, url } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const { pool, round, roundAccount, poolSpec } = await fetchRoundContext(program, poolSlug, roundId);
  const status = await getRoundRandomnessState(
    connection,
    program,
    pool,
    round,
    roundId,
    bigintFromAnchor(roundAccount.totalTickets),
    roundAccount,
  );
  const refundState = getRefundState(roundAccount, poolSpec);
  const policyFields = roundPolicyFields(poolSpec, roundAccount, {
    refundState,
    providerRandomness: status,
  });

  return {
    clusterUrl: publicRpcUrl(url),
    programId: PROGRAM_ID.toBase58(),
    randomnessMode: RANDOMNESS_MODE,
    provider: IS_RELEASE_SURFACE
      ? "orao_vrf"
      : RANDOMNESS_MODE === "orao_vrf"
        ? "orao_vrf"
        : "commit_reveal_demo",
    pool: poolSlug,
    roundId,
    round: round.toBase58(),
    roundClosed: numberFromAnchor(roundAccount.endTs) > 0 &&
      Math.floor(Date.now() / 1000) >= numberFromAnchor(roundAccount.endTs),
    roundSettled: roundAccount.settled,
    totalTickets: stringFromAnchor(roundAccount.totalTickets),
    ...policyFields,
    refundAvailable: refundState.refundAvailable,
    refundMode: refundState.refundMode,
    providerRandomness: status,
  };
}

async function fetchRoundContext(program, poolSlug, roundId) {
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(poolSlug);
  const config = deriveConfig();
  const configAccount = await program.account.config.fetch(config);
  const pool = derivePool(config, poolSpec.id);
  const poolAccount = await program.account.pool.fetch(pool);
  const round = deriveRound(pool, roundId);
  const roundAccount = await program.account.round.fetch(round);

  return {
    config,
    configAccount,
    poolSpec,
    pool,
    poolAccount,
    round,
    roundAccount,
  };
}

async function assertConfiguredKeeper(program, config, candidate) {
  const keeperConfig = deriveKeeperConfig(config);
  let account;
  try {
    account = await program.account.keeperConfig.fetch(keeperConfig);
  } catch {
    throw httpError(
      503,
      "keeper_config_missing",
      "On-chain KeeperConfig must be initialized before operator transactions",
    );
  }
  if (!account.config.equals(config) || !account.keeper.equals(candidate)) {
    throw httpError(
      403,
      "unauthorized_keeper",
      `Operator wallet must be the configured keeper ${account.keeper.toBase58()}`,
    );
  }
  return keeperConfig;
}

async function getRoundRandomnessState(connection, program, pool, round, roundId, totalTickets, roundAccount = null) {
  const sidecar = deriveRoundRandomnessAccount(round);
  const sidecarAccount = await fetchRoundRandomnessSidecar(program, sidecar);

  if (!sidecarAccount) {
    if (roundAccount && isRefundMode(roundAccount)) {
      return {
        status: "not_requested",
        provider: "orao_vrf",
        roundRandomness: sidecar.toBase58(),
        refundMode: true,
        oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
      };
    }
    const settledSeed = roundAccount?.settled
      ? Buffer.from(roundAccount.randomnessCommitment ?? [])
      : null;
    if (settledSeed?.length === 32 && settledSeed.some((byte) => byte !== 0)) {
      const request = deriveOraoRandomnessAccount(settledSeed, ORAO_PROGRAM_ID);
      const providerAccount = await connection.getAccountInfo(request, "confirmed");
      if (providerAccount?.owner.equals(ORAO_PROGRAM_ID)) {
        const parsed = parseOraoRandomnessV2(providerAccount.data);
        if (parsed.status === "fulfilled" && parsed.seed.equals(settledSeed)) {
          return {
            status: "settled",
            provider: "orao_vrf",
            roundRandomness: sidecar.toBase58(),
            sidecarClosed: true,
            request: request.toBase58(),
            expectedRequest: request.toBase58(),
            requestMatchesExpected: true,
            seed: settledSeed.toString("hex"),
            randomnessValue: Buffer.from(roundAccount.randomness).toString("hex"),
            oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
            providerStatus: "fulfilled",
            providerOwner: providerAccount.owner.toBase58(),
            providerOwnerValid: true,
            providerClient: parsed.client.toBase58(),
            providerSeed: parsed.seed.toString("hex"),
            providerSeedMatches: true,
            providerRandomnessHash: parsed.randomnessHash.toString("hex"),
            derivedRoundRandomness: deriveProviderRoundRandomness(
              round,
              totalTickets,
              parsed.randomness,
            ).toString("hex"),
          };
        }
      }
    }
    return {
      status: "not_requested",
      provider: "orao_vrf",
      roundRandomness: sidecar.toBase58(),
      seedDerivation: "recorded on-chain at request_randomness execution",
      oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
    };
  }

  const seed = Buffer.from(sidecarAccount.randomnessSeed);
  const request = sidecarAccount.request;
  const expectedRequest = deriveOraoRandomnessAccount(seed, ORAO_PROGRAM_ID);
  const providerAccount = await connection.getAccountInfo(request, "confirmed");
  const base = {
    status: anchorEnumToSnake(sidecarAccount.status),
    provider: anchorEnumToSnake(sidecarAccount.provider),
    roundRandomness: sidecar.toBase58(),
    request: request.toBase58(),
    expectedRequest: expectedRequest.toBase58(),
    requestMatchesExpected: request.equals(expectedRequest),
    seed: seed.toString("hex"),
    randomnessValue: Buffer.from(sidecarAccount.randomnessValue).toString("hex"),
    requestedAt: numberFromAnchor(sidecarAccount.randomnessRequestedAt),
    fulfilledAt: numberFromAnchor(sidecarAccount.randomnessFulfilledAt),
    oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
  };

  if (!providerAccount) {
    return {
      ...base,
      providerStatus: "missing",
    };
  }

  const parsed = parseOraoRandomnessV2(providerAccount.data);
  const response = {
    ...base,
    providerStatus: parsed.status,
    providerOwner: providerAccount.owner.toBase58(),
    providerOwnerValid: providerAccount.owner.equals(ORAO_PROGRAM_ID),
  };

  if (parsed.status === "pending") {
    return {
      ...response,
      providerClient: parsed.client.toBase58(),
      providerSeed: parsed.seed.toString("hex"),
      providerSeedMatches: parsed.seed.equals(seed),
    };
  }

  if (parsed.status === "fulfilled") {
    return {
      ...response,
      providerClient: parsed.client.toBase58(),
      providerSeed: parsed.seed.toString("hex"),
      providerSeedMatches: parsed.seed.equals(seed),
      providerRandomnessHash: parsed.randomnessHash.toString("hex"),
      derivedRoundRandomness: deriveProviderRoundRandomness(
        round,
        totalTickets,
        parsed.randomness,
      ).toString("hex"),
    };
  }

  return {
    ...response,
    providerError: parsed.error,
  };
}

async function fetchRoundRandomnessSidecar(program, sidecar) {
  try {
    return await program.account.roundRandomness.fetch(sidecar);
  } catch {
    return null;
  }
}

function assertRoundReadyForProviderRequest(roundAccount, poolSpec) {
  if (roundAccount.settled) {
    throw httpError(409, "round_settled", "Round is already settled");
  }

  const endTs = numberFromAnchor(roundAccount.endTs);
  if (endTs <= 0) {
    throw httpError(409, "round_not_started", "Round is waiting for its first ticket");
  }
  if (Math.floor(Date.now() / 1000) < endTs) {
    throw httpError(409, "round_still_open", "Round is still open");
  }

  if (bigintFromAnchor(roundAccount.totalTickets) === 0n) {
    throw httpError(409, "empty_round", "Round has no tickets");
  }
  assertRoundMinimumReached(poolSpec, roundAccount);
}

async function getRefundableEntries(url) {
  const poolFilter = url.searchParams.get("pool");
  const roundIdFilter = url.searchParams.get("roundId");
  const poolSlugs = poolFilter
    ? [parsePoolSlug(poolFilter)]
    : [...ONCHAIN_POOL_BY_SLUG.keys()];
  const { connection, program, url: clusterUrl } = createClient({
    requireSigner: false,
    url: ANCHOR_PROVIDER_URL,
  });
  const configAddress = deriveConfig();
  const hasConfig = await accountExists(connection, configAddress);

  if (!hasConfig) {
    return {
      clusterUrl: publicRpcUrl(clusterUrl),
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
        const refundState = getRefundState(round, poolSpec);
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
    clusterUrl: publicRpcUrl(clusterUrl),
    programId: PROGRAM_ID.toBase58(),
    scanRounds: REFUND_SCAN_ROUNDS,
    refunds,
  };
}

async function fetchRecentRounds(program, poolAddress, currentRound, player = null, poolSpec = null) {
  if (currentRound <= 0) {
    return [];
  }

  const roundIds = [];
  const firstRound = Math.max(1, currentRound - 4);
  for (let roundId = currentRound; roundId >= firstRound; roundId -= 1) {
    roundIds.push(roundId);
  }

  const roundAddresses = roundIds.map((roundId) => deriveRound(poolAddress, roundId));
  let accounts;
  try {
    accounts = await program.account.round.fetchMultiple(roundAddresses);
  } catch {
    return Promise.all(
      roundIds.map((roundId) => fetchRound(program, poolAddress, roundId, player, poolSpec)),
    );
  }

  return Promise.all(roundIds.map(async (roundId, index) => {
    const roundAddress = roundAddresses[index];
    const round = accounts[index] ?? null;
    if (!round) {
      return {
        address: roundAddress.toBase58(),
        roundId,
        missing: true,
      };
    }
    try {
      return await roundPayloadFromAccount(
        program,
        poolAddress,
        roundAddress,
        roundId,
        round,
        player,
        poolSpec,
      );
    } catch {
      return {
        address: roundAddress.toBase58(),
        roundId,
        missing: true,
      };
    }
  }));
}

function mergeArchivedRounds(
  onchainRounds,
  poolSlug,
  currentRound,
  player = null,
  expectedIdentity = {},
) {
  const byRoundId = new Map();
  for (const round of onchainRounds) {
    if (!round?.missing) {
      byRoundId.set(Number(round.roundId), round);
    }
  }

  const playerAddress = player?.toBase58?.() ?? null;
  for (const archived of readSettlementArchive(SETTLEMENT_ARCHIVE_PATH)) {
    if (archived.pool !== poolSlug || !archiveIdentityMatches(archived, expectedIdentity)) {
      continue;
    }
    const roundId = Number(archived.roundId);
    if (!Number.isSafeInteger(roundId) || roundId > currentRound || roundId < Math.max(1, currentRound - 4)) {
      continue;
    }
    const onchainRound = byRoundId.get(roundId);
    if (!onchainRound || onchainRound.settled) {
      byRoundId.set(roundId, archivedRoundPayload(archived, playerAddress));
    }
  }

  return [...byRoundId.values()]
    .sort((left, right) => Number(right.roundId) - Number(left.roundId))
    .slice(0, 5);
}

function archiveIdentityMatches(record, expectedIdentity) {
  return Boolean(
    expectedIdentity?.genesisHash &&
    expectedIdentity?.programId &&
    expectedIdentity?.poolAddress &&
    record?.genesisHash === expectedIdentity.genesisHash &&
    record?.programId === expectedIdentity.programId &&
    record?.poolAddress === expectedIdentity.poolAddress
  );
}

function archivedRoundPayload(record, playerAddress) {
  const totalTickets = BigInt(record.totalTickets ?? 0);
  const poolSpec = ONCHAIN_POOL_BY_SLUG.get(record.pool);
  const cancelledBelowMinimum = record.roundOutcome === "cancelled_below_minimum" ||
    record.oraoRequested === false;
  const userArchiveEntry = playerAddress
    ? (record.entries ?? []).find((entry) => entry.player === playerAddress)
    : null;
  const seedHex = String(record.randomnessCommitment ?? "");
  let request = null;
  if (!cancelledBelowMinimum && /^[0-9a-f]{64}$/i.test(seedHex) && !/^0+$/.test(seedHex)) {
    request = deriveOraoRandomnessAccount(Buffer.from(seedHex, "hex"), ORAO_PROGRAM_ID).toBase58();
  }
  const providerRandomness = request
    ? {
        status: "settled",
        provider: "orao_vrf",
        request,
        seed: seedHex,
        oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
      }
    : {
        status: "not_requested",
        provider: "orao_vrf",
        oraoProgramId: ORAO_PROGRAM_ID.toBase58(),
      };
  const payload = {
    ...record,
    archived: true,
    totalSol: lamportsToSol(BigInt(record.totalLamports ?? 0)),
    winners: Array.isArray(record.winners) ? record.winners : [],
    randomnessProofStatus: cancelledBelowMinimum
      ? "refund_mode"
      : totalTickets > 0n
        ? "revealed"
        : "empty_closed",
    providerRandomness,
    refundDelaySeconds: REFUND_DELAY_SECONDS,
    refundAfterTs: Number(record.endTs ?? 0) + REFUND_DELAY_SECONDS,
    refundAvailable: false,
    refundMode: cancelledBelowMinimum,
    userEntry: userArchiveEntry
      ? {
          ...userArchiveEntry,
          chancePercent: formatPercentRatio(BigInt(userArchiveEntry.ticketCount ?? 0), totalTickets),
        }
      : undefined,
  };
  return poolSpec
    ? {
        ...payload,
        ...roundPolicyFields(poolSpec, payload, {
          archived: true,
          providerRandomness,
        }),
      }
    : payload;
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
    const slug = poolSpec.slug;
    return poolPayloadFromStatic(STATIC_POOL_BY_SLUG.get(slug), poolSpec);
  });
}

function poolPayloadFromStatic(staticPool, poolSpec) {
  const ticketPriceLamports = staticPool?.ticketPriceLamports ?? BigInt(poolSpec.ticketPriceLamports.toString());
  const minimumPolicy = minimumPolicyForPool(poolSpec);
  return {
    id: staticPool?.id ?? poolSpec.slug,
    label: staticPool?.label ?? poolSpec.label,
    source: "static",
    ticketPriceLamports: ticketPriceLamports.toString(),
    ticketPriceSol: lamportsToSol(ticketPriceLamports),
    roundDurationSeconds: DEFAULT_ROUND_DURATION_SECONDS,
    mainPrizeBps: Number(DEFAULT_MAIN_PRIZE_BPS),
    houseFeeBps: Number(DEFAULT_HOUSE_FEE_BPS),
    jackpotBps: Number(DEFAULT_JACKPOT_BPS),
    winnerCount: Number(staticPool?.winnerCount ?? poolSpec.winnerCount),
    prizeSplitBps: Array.from(staticPool?.prizeSplitBps ?? poolSpec.prizeSplitBps, Number),
    maxTicketsPerEntry: Number(staticPool?.maxTicketsPerEntry ?? poolSpec.maxTicketsPerEntry),
    ...minimumPolicy,
    totalTickets: null,
    ticketsRemaining: null,
    minimumReached: null,
    refundStatus: "none",
    roundOutcome: null,
    jackpotMessage: "Random jackpot can trigger after any completed round.",
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

function parseExpectedTotalTickets(value) {
  const normalized = String(value ?? "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw httpError(
      400,
      "invalid_expected_total_tickets",
      "expectedTotalTickets must be a non-negative integer from the reviewed round",
    );
  }

  const total = BigInt(normalized);
  if (total > 18_446_744_073_709_551_615n) {
    throw httpError(
      400,
      "invalid_expected_total_tickets",
      "expectedTotalTickets exceeds the on-chain u64 range",
    );
  }
  return total;
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

function parsePublicKeyConfig(value, field) {
  try {
    return new PublicKey(String(value ?? ""));
  } catch {
    throw new Error(`${field} must be a Solana public key`);
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
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end(JSON.stringify(body, null, 2));
}

function empty(res, status) {
  res.writeHead(status, {
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET, POST, OPTIONS",
  });
  res.end();
}

function applyCorsHeaders(req, res) {
  if (CORS_ORIGINS.includes("*")) {
    res.setHeader("access-control-allow-origin", "*");
    return;
  }

  const requestOrigin = req.headers.origin;
  if (!requestOrigin) {
    return;
  }

  if (CORS_ORIGINS.includes(requestOrigin)) {
    res.setHeader("access-control-allow-origin", requestOrigin);
    res.setHeader("vary", "Origin");
  }
}

function parseCorsOrigins(value) {
  return String(value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
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

function buildSettlementPreview({
  config,
  poolAccount,
  poolSpec,
  roundAccount,
  poolJackpotLamports,
  entries,
  randomness,
}) {
  const totalTickets = bigintFromAnchor(roundAccount.totalTickets);
  const totalLamports = bigintFromAnchor(roundAccount.totalLamports);
  const poolConfig = poolSettlementConfig(poolAccount, poolSpec);
  assertRoundMinimumReached(poolSpec, roundAccount);

  if (Number(roundAccount.entrantCount) < poolConfig.winnerCount) {
    throw httpError(
      409,
      "not_enough_entrants",
      `${poolSpec.label} requires at least ${poolConfig.winnerCount} entrants before settlement`,
    );
  }

  const winnerTickets = selectWinnerTickets(randomness, totalTickets, poolConfig.winnerCount);
  const winnerEntries = winnerTickets
    .slice(0, poolConfig.winnerCount)
    .map((winnerTicket, index) => findEntryByTicket(entries, winnerTicket, `winner_${index + 1}`));
  const distinctWinners = new Set(winnerEntries.map((entry) => entry.player.toBase58()));
  if (distinctWinners.size !== winnerEntries.length) {
    throw httpError(
      409,
      "winner_entries_not_distinct",
      "Selected Premium winner tickets resolve to duplicate wallets",
    );
  }

  const jackpotRoll = randomModDomain(
    randomness,
    "jackpot-roll",
    0,
    bigintFromAnchor(config.jackpotOddsDenominator),
  );
  const jackpotTriggered = jackpotRoll === 0n;
  const jackpotTicket = randomModDomain(randomness, "jackpot-winner", 0, totalTickets);
  const jackpotEntry = findEntryByTicket(entries, jackpotTicket, "jackpot");

  const houseFee = bpsAmount(totalLamports, bigintFromAnchor(config.houseFeeBps));
  const jackpotAdd = bpsAmount(totalLamports, bigintFromAnchor(config.jackpotBps));
  const mainPrize = totalLamports - houseFee - jackpotAdd;
  const prizePayouts = mainPrizePayouts(mainPrize, poolConfig);
  const jackpotPayout = jackpotTriggered ? BigInt(poolJackpotLamports) + jackpotAdd : 0n;

  return {
    totalTickets,
    totalLamports,
    poolConfig,
    winnerTickets,
    winnerEntries,
    jackpotRoll,
    jackpotTriggered,
    jackpotTicket,
    jackpotEntry,
    houseFee,
    jackpotAdd,
    mainPrize,
    prizePayouts,
    jackpotPayout,
  };
}

function poolSettlementConfig(poolAccount, poolSpec) {
  return {
    winnerCount: numberFromAnchor(poolAccount.winnerCount ?? poolSpec.winnerCount),
    prizeSplitBps: Array.from(
      poolAccount.prizeSplitBps ?? poolSpec.prizeSplitBps,
      numberFromAnchor,
    ),
    maxTicketsPerEntry: numberFromAnchor(
      poolAccount.maxTicketsPerEntry ?? poolSpec.maxTicketsPerEntry,
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

function winnerSummaries(winnerEntries, winnerTickets, prizePayouts) {
  return winnerEntries.map((entry, index) => ({
    rank: index + 1,
    winner: entry.player.toBase58(),
    winnerEntry: entry.address.toBase58(),
    winningTicket: winnerTickets[index].toString(),
    prizeLamports: prizePayouts[index].toString(),
    prizeSol: lamportsToSol(prizePayouts[index]),
  }));
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

function requireOraoMode() {
  if (RANDOMNESS_MODE !== "orao_vrf") {
    throw httpError(
      409,
      "orao_randomness_disabled",
      "Set LUCKYME_RANDOMNESS_MODE=orao_vrf to use provider randomness endpoints",
    );
  }

  if (!ORAO_PROGRAM_ID.equals(ORAO_VRF_PROGRAM_ID)) {
    throw httpError(
      500,
      "unsupported_orao_program",
      "Configured ORAO program id does not match the LuckyMe on-chain verifier",
    );
  }
}

function minimumPolicyForPool(poolInput) {
  let poolId;
  if (typeof poolInput === "string") {
    poolId = ONCHAIN_POOL_BY_SLUG.get(poolInput)?.id;
  } else if (typeof poolInput === "number") {
    poolId = poolInput;
  } else {
    poolId = poolInput?.id ?? poolInput?.poolId;
  }

  const policy = MINIMUM_POLICY_BY_POOL_ID[Number(poolId)];
  if (!policy) {
    throw httpError(500, "minimum_policy_missing", "Pool minimum policy is not configured");
  }
  return policy;
}

function roundMinimumState(poolInput, round) {
  const policy = minimumPolicyForPool(poolInput);
  const totalTickets = bigintFromAnchor(round.totalTickets);
  const distinctEntrants = numberFromAnchor(round.entrantCount);
  const ticketTargetReached = totalTickets >= BigInt(policy.minimumTickets);
  const minimumDistinctEntrantsReached = distinctEntrants >= policy.minimumDistinctEntrants;

  return {
    ...policy,
    ticketsRemaining: Math.max(policy.minimumTickets - Number(totalTickets), 0),
    minimumReached: ticketTargetReached && minimumDistinctEntrantsReached,
    ticketTargetReached,
    minimumDistinctEntrantsReached,
  };
}

function assertRoundMinimumReached(poolInput, round) {
  const state = roundMinimumState(poolInput, round);
  if (state.minimumReached) {
    return state;
  }
  if (!state.ticketTargetReached) {
    throw httpError(
      409,
      "minimum_tickets_not_reached",
      `Round requires at least ${state.minimumTickets} total tickets before randomness or settlement`,
    );
  }
  throw httpError(
    409,
    "minimum_distinct_entrants_not_reached",
    `Round requires at least ${state.minimumDistinctEntrants} distinct wallets before randomness or settlement`,
  );
}

function roundPolicyFields(poolInput, round, {
  archived = false,
  refundState = null,
  providerRandomness = null,
  now = Math.floor(Date.now() / 1000),
} = {}) {
  const minimumState = roundMinimumState(poolInput, round);
  const roundOutcome = deriveRoundOutcome(
    round,
    minimumState,
    providerRandomness,
    now,
  );
  const refundStatus = deriveRefundStatus(round, roundOutcome, {
    archived,
    refundState,
  });
  return {
    ...minimumState,
    refundStatus,
    roundOutcome,
  };
}

function deriveRoundOutcome(round, minimumState, providerRandomness, now) {
  const explicitOutcome = normalizeRoundOutcome(round.roundOutcome ?? round.outcome);
  if (explicitOutcome) {
    return explicitOutcome;
  }

  if (round.settled) {
    return isRefundMode(round) ? "cancelled_below_minimum" : "settled";
  }

  const startTs = numberFromAnchor(round.startTs);
  const endTs = numberFromAnchor(round.endTs);
  if (startTs === 0 && endTs === 0) {
    return "waiting";
  }
  if (endTs > now) {
    return "open";
  }
  if (!minimumState.minimumReached) {
    return "cancelled_below_minimum";
  }

  const providerStatus = String(providerRandomness?.status ?? "not_requested");
  const providerRequestStatus = String(providerRandomness?.providerStatus ?? "missing");
  if (
    providerStatus !== "not_requested" ||
    !["missing", "not_requested"].includes(providerRequestStatus)
  ) {
    return "settling";
  }
  return "eligible_for_draw";
}

function deriveRefundStatus(round, roundOutcome, { archived, refundState }) {
  const explicitStatus = normalizeRefundStatus(round.refundStatus);
  if (explicitStatus) {
    return explicitStatus;
  }
  if (roundOutcome !== "cancelled_below_minimum") {
    return "none";
  }

  const refundsPending = Number(round.refundsPending ?? 0);
  const refundsCompleted = Number(round.refundsCompleted ?? 0);
  if (refundsPending > 0) {
    return "pending";
  }
  if (archived && (refundsCompleted > 0 || bigintFromAnchor(round.totalLamports) === 0n)) {
    return "completed";
  }
  if (refundState?.refundAvailable || bigintFromAnchor(round.totalLamports) > 0n || isRefundMode(round)) {
    return "pending";
  }
  return "none";
}

function normalizeRoundOutcome(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return ROUND_OUTCOMES.has(normalized) ? normalized : null;
}

function normalizeRefundStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return REFUND_STATUSES.has(normalized) ? normalized : null;
}

function getRefundState(round, poolInput = null) {
  const endTs = numberFromAnchor(round.endTs);
  const refundAfterTs = endTs + REFUND_DELAY_SECONDS;
  const refundMode = isRefundMode(round);
  const belowMinimum = poolInput
    ? !roundMinimumState(poolInput, round).minimumReached
    : false;
  const refundAvailable = (
    (refundMode || (!round.settled && belowMinimum)) &&
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
  const winner = publicKeyText(round.winner);
  const winnerSecond = publicKeyText(round.winnerSecond);
  const winnerThird = publicKeyText(round.winnerThird);
  const jackpotWinner = publicKeyText(round.jackpotWinner);
  return round.settled &&
    !round.jackpotTriggered &&
    numberFromAnchor(round.winnerCount ?? 0) === 0 &&
    winner === DEFAULT_PUBLIC_KEY &&
    winnerSecond === DEFAULT_PUBLIC_KEY &&
    winnerThird === DEFAULT_PUBLIC_KEY &&
    jackpotWinner === DEFAULT_PUBLIC_KEY &&
    Array.from(round.randomness ?? []).every((byte) => byte === 0);
}

function publicKeyText(value) {
  return value?.toBase58?.() ?? String(value ?? DEFAULT_PUBLIC_KEY);
}

function isEmptyClosedRound(round) {
  return isRefundMode(round) &&
    bigintFromAnchor(round.totalTickets) === 0n &&
    bigintFromAnchor(round.totalLamports) === 0n &&
    Number(round.entrantCount) === 0;
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
  if (!["MAINNET_RELEASE", "LOCAL_DEVELOPMENT"].includes(RELEASE_MODE)) {
    throw new Error("LUCKYME_RELEASE_MODE must be MAINNET_RELEASE or LOCAL_DEVELOPMENT");
  }

  if (!Number.isSafeInteger(PORT) || PORT < 1 || PORT > 65_535) {
    throw new Error("PORT must be an integer between 1 and 65535");
  }

  if (!HOST || typeof HOST !== "string") {
    throw new Error("HOST must be configured");
  }

  if (isLoopbackHost(HOST) && !IS_LOCAL_DEVELOPMENT) {
    throw new Error("Loopback HOST values are allowed only in LOCAL_DEVELOPMENT");
  }

  if (IS_NODE_PRODUCTION && RELEASE_MODE !== "MAINNET_RELEASE") {
    throw new Error("NODE_ENV=production requires LUCKYME_RELEASE_MODE=MAINNET_RELEASE");
  }

  if (!["commit_reveal_demo", "orao_vrf"].includes(RANDOMNESS_MODE)) {
    throw new Error("LUCKYME_RANDOMNESS_MODE must be commit_reveal_demo or orao_vrf");
  }

  if (!ORAO_PROGRAM_ID.equals(ORAO_VRF_PROGRAM_ID)) {
    throw new Error(
      "LUCKYME_ORAO_PROGRAM_ID must match the ORAO program id compiled into LuckyMe",
    );
  }

  if (RELEASE_MODE === "MAINNET_RELEASE") {
    if (!ANCHOR_PROVIDER_URL) {
      throw new Error("ANCHOR_PROVIDER_URL is required for MAINNET_RELEASE");
    }

    if (!isHttpsUrl(ANCHOR_PROVIDER_URL)) {
      throw new Error("MAINNET_RELEASE requires an HTTPS Solana RPC URL");
    }

    if (isKnownNonMainnetRpcUrl(ANCHOR_PROVIDER_URL)) {
      throw new Error("MAINNET_RELEASE requires a mainnet-beta Solana RPC URL");
    }

    if (SOLANA_CLUSTER !== "mainnet-beta") {
      throw new Error("MAINNET_RELEASE requires LUCKYME_SOLANA_CLUSTER=mainnet-beta");
    }

    if (!PRODUCTION_RANDOMNESS_ENABLED || RANDOMNESS_MODE !== "orao_vrf") {
      throw new Error(
        "MAINNET_RELEASE requires LUCKYME_RANDOMNESS_MODE=orao_vrf and LUCKYME_PRODUCTION_RANDOMNESS=true",
      );
    }

    if (CORS_ORIGINS.length === 0) {
      throw new Error("CORS_ORIGIN is required for MAINNET_RELEASE");
    }

    if (CORS_ORIGINS.includes("*")) {
      throw new Error("CORS_ORIGIN must be strict for MAINNET_RELEASE");
    }

    if (!CORS_ORIGINS.every(isHttpsOrigin)) {
      throw new Error("CORS_ORIGIN must contain HTTPS origins for MAINNET_RELEASE");
    }

    if (ENABLE_TRANSACTION_SUBMIT) {
      throw new Error("ENABLE_TRANSACTION_SUBMIT must stay false for MAINNET_RELEASE");
    }
  } else if (RANDOMNESS_MODE !== "commit_reveal_demo" && RANDOMNESS_MODE !== "orao_vrf") {
    throw new Error("LOCAL_DEVELOPMENT randomness mode is invalid");
  }

  if (IS_NODE_PRODUCTION) {
    if (CORS_ORIGINS.length === 0 || CORS_ORIGINS.includes("*")) {
      throw new Error("CORS_ORIGIN must be strict in production");
    }

    if (!CORS_ORIGINS.every(isHttpsOrigin)) {
      throw new Error("CORS_ORIGIN must contain HTTPS origins in production");
    }

    if (ENABLE_TRANSACTION_SUBMIT) {
      throw new Error("ENABLE_TRANSACTION_SUBMIT must stay false in production");
    }
  }

  if (CORS_ORIGINS.includes("*") && !ALLOW_WILDCARD_CORS) {
    throw new Error(
      "Wildcard CORS requires LOCAL_DEVELOPMENT and LUCKYME_ALLOW_WILDCARD_CORS=true",
    );
  }
}

function isHttpsUrl(url) {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

function publicRpcUrl(url) {
  try {
    const parsed = new URL(IS_RELEASE_SURFACE ? PUBLIC_WALLET_RPC_URL : url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function isMainnetUrl(url) {
  return /mainnet|api\.mainnet-beta\.solana\.com/i.test(url);
}

function isKnownNonMainnetRpcUrl(url) {
  return NON_MAINNET_RPC_RE.test(url);
}

function isLoopbackHost(host) {
  return /^(localhost|127(?:\.\d{1,3}){3}|\[?::1\]?)$/i.test(host);
}

function isHttpsOrigin(origin) {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === "https:" && parsed.origin === origin.replace(/\/$/, "");
  } catch {
    return false;
  }
}

function clusterName(url) {
  if (SOLANA_CLUSTER) {
    return SOLANA_CLUSTER;
  }
  return inferClusterName(url);
}

function inferClusterName(url) {
  if (isMainnetUrl(url)) {
    return "mainnet-beta";
  }
  if (new RegExp(DEV_CLUSTER_NAME, "i").test(url)) {
    return DEV_CLUSTER_NAME;
  }
  if (new RegExp(TEST_CLUSTER_NAME, "i").test(url)) {
    return TEST_CLUSTER_NAME;
  }
  return LOCAL_CLUSTER_NAME;
}

function randomnessProofStatus(round) {
  if (round.settled && Array.from(round.randomness).some((byte) => byte !== 0)) {
    return "revealed";
  }
  if (isEmptyClosedRound(round)) {
    return "empty_closed";
  }
  if (isRefundMode(round)) {
    return "refund_mode";
  }
  if (Array.from(round.randomnessCommitment).some((byte) => byte !== 0)) {
    return "committed";
  }
  return "missing";
}

function anchorEnumToSnake(value) {
  const key = typeof value === "string"
    ? value
    : value && typeof value === "object"
      ? Object.keys(value)[0]
      : String(value ?? "unknown");
  return key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`).replace(/^_/, "");
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

export {
  archiveIdentityMatches,
  archivedRoundPayload,
  assertRoundMinimumReached,
  collectPlayerRoundAddresses,
  enrichProgramStateForPlayer,
  getRefundState,
  minimumPolicyForPool,
  roundMinimumState,
  roundPolicyFields,
};
