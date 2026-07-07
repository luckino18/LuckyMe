import crypto from "node:crypto";
import {
  POOLS,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  derivePool,
  deriveRound,
} from "./anchor-client.mjs";

const DRY_RUN = process.env.DRY_RUN === "true";
const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const REVEAL_HEX = process.env.RANDOMNESS_REVEAL;
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const { connection, payer, program, url } = createClient();
requireMainnetConfirmation(url);

const config = deriveConfig();
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(config, poolSpec.id);

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}
if (!(await accountExists(connection, pool))) {
  throw new Error(`${poolSpec.label} pool does not exist: ${pool.toBase58()}`);
}

const poolAccount = await program.account.pool.fetch(pool);
const roundId = Number(poolAccount.currentRound.toString()) + 1;
const round = deriveRound(pool, roundId);
const reveal = REVEAL_HEX ? parseReveal(REVEAL_HEX) : crypto.randomBytes(32);
const commitment = commitmentForReveal(reveal);

console.log(`Cluster: ${url}`);
console.log(`Keeper: ${payer.publicKey.toBase58()}`);
console.log(`Pool: ${poolSpec.label} (${pool.toBase58()})`);
console.log(`Round: ${roundId} (${round.toBase58()})`);
console.log(`Commitment: ${commitment.toString("hex")}`);
console.log(`Reveal: ${reveal.toString("hex")}`);
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

if (DRY_RUN) {
  process.exit(0);
}

const signature = await program.methods
  .openRound([...commitment])
  .accounts({
    keeper: payer.publicKey,
    config,
    pool,
    round,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log(`Opened round: ${signature}`);

function commitmentForReveal(reveal) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(reveal)
    .digest();
}

function parseReveal(value) {
  const normalized = String(value).trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("RANDOMNESS_REVEAL must be a 32-byte hex string");
  }
  return Buffer.from(normalized, "hex");
}

function requireMainnetConfirmation(url) {
  if (/mainnet|api\.mainnet-beta\.solana\.com/i.test(url) && process.env.CONFIRM_MAINNET !== "true") {
    throw new Error("Refusing mainnet open-round without CONFIRM_MAINNET=true");
  }
}
