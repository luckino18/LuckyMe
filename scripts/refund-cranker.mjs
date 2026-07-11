import {
  POOLS,
  PROGRAM_ID,
  PublicKey,
  accountExists,
  createClient,
  deriveConfig,
  deriveKeeperConfig,
  derivePool,
  deriveRound,
  roundMeetsMinimums,
} from "./anchor-client.mjs";

const REFUND_DELAY_SECONDS = 600;
const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const ACTIVE_KEEPER = "6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N";
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const REFUND_SCAN_ROUNDS = Number(process.env.REFUND_SCAN_ROUNDS ?? 20);
const DRY_RUN = process.env.DRY_RUN !== "false" || process.argv.includes("--dry-run");
const POOL_FILTER = process.env.POOL?.toLowerCase();
const ROUND_ID = process.env.ROUND_ID ? parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID") : null;
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

if (!DRY_RUN) {
  throw new Error(
    "Direct refund writes are retired. Use settlement:keeper so every automatic refund is journaled before submission.",
  );
}

if (POOL_FILTER && !POOL_BY_SLUG.has(POOL_FILTER)) {
  throw new Error(`Unknown POOL=${POOL_FILTER}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

requireMainnetConfirmation(RPC_URL, false);
const readonly = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await readonly.connection.getGenesisHash();
const mainnet = genesisHash === MAINNET_GENESIS_HASH;
requireMainnetConfirmation(RPC_URL, mainnet);
const { connection, program, url } = readonly;
const config = deriveConfig();
const keeperConfig = deriveKeeperConfig(config);
const pools = POOL_FILTER ? [POOL_BY_SLUG.get(POOL_FILTER)] : POOLS;

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}
if (!(await accountExists(connection, keeperConfig))) {
  throw new Error(`KeeperConfig account does not exist: ${keeperConfig.toBase58()}`);
}
const configuredKeeper = (await program.account.keeperConfig.fetch(keeperConfig)).keeper;
const expectedKeeper = new PublicKey(process.env.LUCKYME_EXPECTED_KEEPER_PUBKEY ?? ACTIVE_KEEPER);
if (mainnet && !configuredKeeper.equals(expectedKeeper)) {
  throw new Error(
    `On-chain keeper ${configuredKeeper.toBase58()} does not match expected keeper ${expectedKeeper.toBase58()}`,
  );
}
console.log(`Cluster: ${url}`);
console.log(`Genesis hash: ${genesisHash}`);
console.log(`Program: ${PROGRAM_ID.toBase58()}`);
console.log(`Cranker fee payer: ${configuredKeeper.toBase58()}`);
console.log(`KeeperConfig: ${keeperConfig.toBase58()}`);
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

let refundableCount = 0;

for (const poolSpec of pools) {
  const pool = derivePool(config, poolSpec.id);

  if (!(await accountExists(connection, pool))) {
    console.log(`${poolSpec.label}: pool missing, skipping`);
    continue;
  }

  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = Number(poolAccount.currentRound.toString());
  const roundIds = ROUND_ID
    ? [ROUND_ID]
    : recentRoundIds(currentRound, REFUND_SCAN_ROUNDS);

  for (const roundId of roundIds) {
    const round = deriveRound(pool, roundId);

    if (!(await accountExists(connection, round))) {
      continue;
    }

    const roundAccount = await program.account.round.fetch(round);
    if (!isRefundAvailable(roundAccount, poolSpec)) {
      continue;
    }

    const entries = await fetchEntriesForRound(program, round);
    for (const entry of entries) {
      if (BigInt(entry.account.lamports.toString()) === 0n) {
        continue;
      }

      refundableCount += 1;
      const player = entry.account.player;
      const lamports = entry.account.lamports.toString();
      console.log(
        `${poolSpec.label} round ${roundId}: refund ${lamports} lamports to ${player.toBase58()} via entry ${entry.publicKey.toBase58()}`,
      );

    }
  }
}

if (refundableCount === 0) {
  console.log("No refundable entries found.");
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

async function fetchEntriesForRound(program, round) {
  return program.account.entry.all([
    {
      memcmp: {
        offset: 8,
        bytes: round.toBase58(),
      },
    },
  ]);
}

function isRefundAvailable(round, poolSpec) {
  const now = Math.floor(Date.now() / 1000);
  const refundAfter = Number(round.endTs.toString()) + REFUND_DELAY_SECONDS;
  const alreadyRefunding = isRefundMode(round);
  const belowMinimum = !roundMeetsMinimums(
    poolSpec,
    BigInt(round.totalTickets.toString()),
    Number(round.entrantCount),
  );
  return (
    Number(round.endTs.toString()) > 0 &&
    now >= refundAfter &&
    BigInt(round.totalLamports.toString()) > 0n &&
    ((!round.settled && belowMinimum) || alreadyRefunding)
  );
}

function isRefundMode(round) {
  return (
    round.settled &&
    !round.jackpotTriggered &&
    round.winner.toBase58() === "11111111111111111111111111111111" &&
    round.jackpotWinner.toBase58() === "11111111111111111111111111111111" &&
    Array.from(round.randomness).every((byte) => byte === 0)
  );
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireMainnetConfirmation(url, mainnetByGenesis) {
  const mainnet = mainnetByGenesis || /mainnet|api\.mainnet-beta\.solana\.com|helius-rpc/i.test(url);
  if (mainnet && !DRY_RUN && process.env.CONFIRM_MAINNET_REFUND_CRANK !== "true") {
    throw new Error(
      "Refusing mainnet refund cranking without CONFIRM_MAINNET_REFUND_CRANK=true",
    );
  }
}
