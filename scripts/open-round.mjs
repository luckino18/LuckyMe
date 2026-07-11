import crypto from "node:crypto";
import {
  POOLS,
  PROGRAM_ID,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveKeeperConfig,
  derivePool,
  deriveRound,
} from "./anchor-client.mjs";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const DRY_RUN = process.env.DRY_RUN !== "false" || process.argv.includes("--dry-run");
const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const REVEAL_HEX = process.env.RANDOMNESS_REVEAL;
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

// This manual commit-producing utility is retained only for local/devnet work.
// Production round opening belongs to settlement-keeper.mjs, after archive and
// cleanup checks have succeeded.
if (looksLikeMainnetUrl(RPC_URL)) {
  throw new Error(
    "Manual open-round is disabled on mainnet. Use the reviewed settlement keeper after deployment approval.",
  );
}

const readonly = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await readonly.connection.getGenesisHash();
if (genesisHash === MAINNET_GENESIS_HASH) {
  throw new Error(
    "Manual open-round is disabled on mainnet. Use the reviewed settlement keeper after deployment approval.",
  );
}
const { connection, payer, program, url } = DRY_RUN
  ? readonly
  : createClient({ requireSigner: true, url: RPC_URL });

const config = deriveConfig();
const keeperConfig = deriveKeeperConfig(config);
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(config, poolSpec.id);

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}
if (!(await accountExists(connection, keeperConfig))) {
  throw new Error(`KeeperConfig account does not exist: ${keeperConfig.toBase58()}`);
}
if (!(await accountExists(connection, pool))) {
  throw new Error(`${poolSpec.label} pool does not exist: ${pool.toBase58()}`);
}

const configuredKeeper = (await program.account.keeperConfig.fetch(keeperConfig)).keeper;
const poolAccount = await program.account.pool.fetch(pool);
const roundId = Number(poolAccount.currentRound.toString()) + 1;
const previousRound = deriveRound(pool, roundId - 1);
const round = deriveRound(pool, roundId);
const reveal = REVEAL_HEX ? parseReveal(REVEAL_HEX) : crypto.randomBytes(32);
const commitment = commitmentForReveal(reveal);

console.log(JSON.stringify({
  event: "manual_open_round_plan",
  cluster: redactRpcUrl(url),
  genesisHash,
  programId: PROGRAM_ID.toBase58(),
  keeper: configuredKeeper.toBase58(),
  keeperConfig: keeperConfig.toBase58(),
  pool: poolSpec.slug,
  poolAddress: pool.toBase58(),
  previousRound: previousRound.toBase58(),
  roundId,
  round: round.toBase58(),
  commitment: commitment.toString("hex"),
  dryRun: DRY_RUN,
}, null, 2));

if (DRY_RUN) {
  process.exit(0);
}
assertConfiguredKeeper(payer, configuredKeeper);

const method = program.methods
  .openRound([...commitment])
  .accounts({
    keeper: payer.publicKey,
    config,
    keeperConfig,
    pool,
    previousRound,
    round,
    systemProgram: SystemProgram.programId,
  });
const simulation = await method.simulate();
console.log(JSON.stringify({ event: "manual_open_round_simulation", ok: true, logCount: simulation?.raw?.length ?? null }));
await recheckConfiguredKeeper(program, keeperConfig, payer.publicKey);
const signature = await method.rpc();
console.log(JSON.stringify({ event: "manual_open_round_submitted", signature }));

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

function assertConfiguredKeeper(payer, configuredKeeper) {
  if (!payer?.publicKey.equals(configuredKeeper)) {
    throw new Error(
      `Signer ${payer?.publicKey.toBase58() ?? "missing"} is not configured keeper ${configuredKeeper.toBase58()}`,
    );
  }
}

async function recheckConfiguredKeeper(program, keeperConfig, keeper) {
  const latest = await program.account.keeperConfig.fetch(keeperConfig);
  if (!latest.keeper.equals(keeper)) {
    throw new Error(`On-chain keeper changed to ${latest.keeper.toBase58()} before submission`);
  }
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
    return String(value);
  }
}
