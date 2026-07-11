import {
  POOLS,
  PROGRAM_ID,
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
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}
if (!DRY_RUN && looksLikeMainnetUrl(RPC_URL)) {
  throw new Error(
    "Direct mainnet close-empty is disabled. Use npm run rent:recover:legacy-empty with its reviewed plan hash and approval flags.",
  );
}
const ROUND_ID = parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID");

const readonly = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await readonly.connection.getGenesisHash();
const mainnet = genesisHash === MAINNET_GENESIS_HASH;
if (!DRY_RUN && mainnet) {
  throw new Error(
    "Direct mainnet close-empty is disabled. Use npm run rent:recover:legacy-empty with its reviewed plan hash and approval flags.",
  );
}
const { connection, payer, program, url } = DRY_RUN
  ? readonly
  : createClient({ requireSigner: true, url: RPC_URL });

const config = deriveConfig();
const keeperConfig = deriveKeeperConfig(config);
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(config, poolSpec.id);
const round = deriveRound(pool, ROUND_ID);

for (const [label, address] of [
  ["Config", config],
  ["KeeperConfig", keeperConfig],
  [`${poolSpec.label} pool`, pool],
  ["Round", round],
]) {
  if (!(await accountExists(connection, address))) {
    throw new Error(`${label} account does not exist: ${address.toBase58()}`);
  }
}

const configAccount = await program.account.config.fetch(config);
const configuredKeeper = (await program.account.keeperConfig.fetch(keeperConfig)).keeper;
const roundAccount = await program.account.round.fetch(round);
console.log(JSON.stringify({
  event: "close_empty_round_plan",
  cluster: redactRpcUrl(url),
  genesisHash,
  mainnet,
  programId: PROGRAM_ID.toBase58(),
  keeper: configuredKeeper.toBase58(),
  keeperConfig: keeperConfig.toBase58(),
  pool: poolSpec.slug,
  poolAddress: pool.toBase58(),
  roundId: ROUND_ID,
  round: round.toBase58(),
  endTs: roundAccount.endTs.toString(),
  totalTickets: roundAccount.totalTickets.toString(),
  totalLamports: roundAccount.totalLamports.toString(),
  entrantCount: Number(roundAccount.entrantCount),
  settled: roundAccount.settled,
  rentDestination: configAccount.treasury.toBase58(),
  dryRun: DRY_RUN,
}, null, 2));

if (DRY_RUN) {
  process.exit(0);
}
assertConfiguredKeeper(payer, configuredKeeper);

const method = program.methods
  .closeEmptyRoundAfterTimeout()
  .accounts({
    keeper: payer.publicKey,
    config,
    keeperConfig,
    pool,
    round,
    treasury: configAccount.treasury,
  });
const simulation = await method.simulate();
console.log(JSON.stringify({ event: "close_empty_round_simulation", ok: true, logCount: simulation?.raw?.length ?? null }));
await recheckConfiguredKeeper(program, keeperConfig, payer.publicKey);
const signature = await method.rpc();
console.log(JSON.stringify({ event: "close_empty_round_submitted", signature }));

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
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
