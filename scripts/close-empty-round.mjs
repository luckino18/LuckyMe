import {
  POOLS,
  accountExists,
  createClient,
  deriveConfig,
  derivePool,
  deriveRound,
} from "./anchor-client.mjs";

const DRY_RUN = process.env.DRY_RUN === "true";
const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const ROUND_ID = parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID");
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.label.toLowerCase(), pool]));

if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const { connection, payer, program, url } = createClient();
requireMainnetConfirmation(url);

const config = deriveConfig();
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(config, poolSpec.id);
const round = deriveRound(pool, ROUND_ID);

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}
if (!(await accountExists(connection, pool))) {
  throw new Error(`${poolSpec.label} pool does not exist: ${pool.toBase58()}`);
}
if (!(await accountExists(connection, round))) {
  throw new Error(`Round does not exist: ${round.toBase58()}`);
}

const roundAccount = await program.account.round.fetch(round);
console.log(`Cluster: ${url}`);
console.log(`Keeper: ${payer.publicKey.toBase58()}`);
console.log(`Pool: ${poolSpec.label} (${pool.toBase58()})`);
console.log(`Round: ${ROUND_ID} (${round.toBase58()})`);
console.log(`End timestamp: ${roundAccount.endTs.toString()}`);
console.log(`Total tickets: ${roundAccount.totalTickets.toString()}`);
console.log(`Total lamports: ${roundAccount.totalLamports.toString()}`);
console.log(`Entrants: ${roundAccount.entrantCount}`);
console.log(`Settled: ${roundAccount.settled ? "yes" : "no"}`);
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

if (DRY_RUN) {
  process.exit(0);
}

const signature = await program.methods
  .closeEmptyRoundAfterTimeout()
  .accounts({
    keeper: payer.publicKey,
    config,
    pool,
    round,
  })
  .rpc();

console.log(`Closed empty round: ${signature}`);

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function requireMainnetConfirmation(url) {
  if (/mainnet|api\.mainnet-beta\.solana\.com/i.test(url) && process.env.CONFIRM_MAINNET !== "true") {
    throw new Error("Refusing mainnet empty-round close without CONFIRM_MAINNET=true");
  }
}
