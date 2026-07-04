import {
  POOLS,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  derivePool,
  derivePoolVault,
  deriveRound,
} from "./anchor-client.mjs";

const REFUND_DELAY_SECONDS = 600;
const REFUND_SCAN_ROUNDS = Number(process.env.REFUND_SCAN_ROUNDS ?? 20);
const DRY_RUN = process.env.DRY_RUN === "true";
const POOL_FILTER = process.env.POOL?.toLowerCase();
const ROUND_ID = process.env.ROUND_ID ? parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID") : null;
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.label.toLowerCase(), pool]));

if (POOL_FILTER && !POOL_BY_SLUG.has(POOL_FILTER)) {
  throw new Error(`Unknown POOL=${POOL_FILTER}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const { connection, payer, program, url } = createClient();
requireMainnetConfirmation(url);
const config = deriveConfig();
const pools = POOL_FILTER ? [POOL_BY_SLUG.get(POOL_FILTER)] : POOLS;

console.log(`Cluster: ${url}`);
console.log(`Cranker fee payer: ${payer.publicKey.toBase58()}`);
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}

let refundableCount = 0;

for (const poolSpec of pools) {
  const pool = derivePool(config, poolSpec.id);
  const poolVault = derivePoolVault(pool);

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
    if (!isRefundAvailable(roundAccount)) {
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

      if (DRY_RUN) {
        continue;
      }

      const signature = await program.methods
        .refundEntryAfterTimeout()
        .accounts({
          player,
          config,
          pool,
          round,
          entry: entry.publicKey,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log(`  tx: ${signature}`);
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

function isRefundAvailable(round) {
  const now = Math.floor(Date.now() / 1000);
  const refundAfter = Number(round.endTs.toString()) + REFUND_DELAY_SECONDS;
  return (
    now >= refundAfter &&
    BigInt(round.totalLamports.toString()) > 0n &&
    (!round.settled || isRefundMode(round))
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

function requireMainnetConfirmation(url) {
  if (/mainnet|api\.mainnet-beta\.solana\.com/i.test(url) && process.env.CONFIRM_MAINNET !== "true") {
    throw new Error("Refusing mainnet refund cranking without CONFIRM_MAINNET=true");
  }
}
