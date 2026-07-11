import oraoVrf from "@orao-network/solana-vrf";
import {
  ORAO_VRF_PROGRAM_ID,
  POOLS,
  PROGRAM_ID,
  PublicKey,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveKeeperConfig,
  deriveOraoRandomnessAccount,
  derivePool,
  deriveRound,
  deriveRoundRandomnessAccount,
  poolMinimums,
  roundMeetsMinimums,
} from "./anchor-client.mjs";

const { Orao, networkStateAccountAddress } = oraoVrf;

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const ACTIVE_KEEPER = "6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N";
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const DRY_RUN = process.env.DRY_RUN !== "false" || process.argv.includes("--dry-run");
const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const RANDOMNESS_MODE = process.env.LUCKYME_RANDOMNESS_MODE ?? "orao_vrf";
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

requireOraoMode();
if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

requireMainnetConfirmation(RPC_URL, false);
const ROUND_ID = parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID");
const readonly = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await readonly.connection.getGenesisHash();
const mainnet = genesisHash === MAINNET_GENESIS_HASH;
requireMainnetConfirmation(RPC_URL, mainnet);
const { connection, payer, program, provider, url } = DRY_RUN
  ? readonly
  : createClient({ requireSigner: true, url: RPC_URL });

const config = deriveConfig();
const keeperConfig = deriveKeeperConfig(config);
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(config, poolSpec.id);
const round = deriveRound(pool, ROUND_ID);
const roundRandomness = deriveRoundRandomnessAccount(round);
const vrf = new Orao(provider, ORAO_VRF_PROGRAM_ID);

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}
if (!(await accountExists(connection, keeperConfig))) {
  throw new Error(`KeeperConfig account does not exist: ${keeperConfig.toBase58()}`);
}
if (!(await accountExists(connection, pool))) {
  throw new Error(`${poolSpec.label} pool does not exist: ${pool.toBase58()}`);
}
if (!(await accountExists(connection, round))) {
  throw new Error(`${poolSpec.label} round ${ROUND_ID} does not exist: ${round.toBase58()}`);
}

const roundAccount = await program.account.round.fetch(round);
assertRoundClosedAndEligible(roundAccount, poolSpec);
const configuredKeeper = (await program.account.keeperConfig.fetch(keeperConfig)).keeper;
const expectedKeeper = new PublicKey(process.env.LUCKYME_EXPECTED_KEEPER_PUBKEY ?? ACTIVE_KEEPER);
if (mainnet && !configuredKeeper.equals(expectedKeeper)) {
  throw new Error(
    `On-chain keeper ${configuredKeeper.toBase58()} does not match expected keeper ${expectedKeeper.toBase58()}`,
  );
}
if (!DRY_RUN) {
  assertConfiguredKeeper(payer, configuredKeeper);
}

console.log(`Cluster: ${url}`);
console.log(`Genesis hash: ${genesisHash}`);
console.log(`Program: ${PROGRAM_ID.toBase58()}`);
console.log(`Release mode: ${process.env.LUCKYME_RELEASE_MODE ?? "MAINNET_RELEASE"}`);
console.log(`Randomness mode: ${RANDOMNESS_MODE}`);
console.log(`Keeper fee payer: ${configuredKeeper.toBase58()}`);
console.log(`KeeperConfig: ${keeperConfig.toBase58()}`);
console.log(`Pool: ${poolSpec.label} (${pool.toBase58()})`);
console.log(`Round: ${ROUND_ID} (${round.toBase58()})`);
console.log(`LuckyMe sidecar: ${roundRandomness.toBase58()}`);
console.log(`ORAO program: ${ORAO_VRF_PROGRAM_ID.toBase58()}`);
console.log(`ORAO network state: ${networkStateAccountAddress(ORAO_VRF_PROGRAM_ID).toBase58()}`);
console.log("ORAO seed/request: recorded in LuckyMe sidecar when request_randomness lands");
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

const networkState = await getNetworkState(vrf, DRY_RUN);
if (networkState) {
  console.log(`ORAO treasury: ${networkState.config.treasury.toBase58()}`);
  console.log(`ORAO request fee: ${networkState.config.requestFee.toString()} lamports`);
}

const sidecarExists = await accountExists(connection, roundRandomness);
console.log(`LuckyMe sidecar exists: ${sidecarExists ? "yes" : "no"}`);

if (DRY_RUN) {
  process.exit(0);
}

if (!sidecarExists) {
  const method = program.methods
    .requestRandomness()
    .accounts({
      keeper: payer.publicKey,
      config,
      keeperConfig,
      pool,
      round,
      roundRandomness,
      systemProgram: SystemProgram.programId,
    });
  const simulation = await method.simulate();
  console.log(`LuckyMe request simulation: ok (${simulation?.raw?.length ?? "unknown"} logs)`);
  await recheckConfiguredKeeper(program, keeperConfig, payer.publicKey);
  assertRoundClosedAndEligible(await program.account.round.fetch(round), poolSpec);
  const signature = await method.rpc();
  console.log(`Recorded LuckyMe randomness request: ${signature}`);
}

const sidecar = await program.account.roundRandomness.fetch(roundRandomness);
const seed = Buffer.from(sidecar.randomnessSeed);
const request = deriveOraoRandomnessAccount(seed);
const requestExists = await accountExists(connection, request);

if (!sidecar.request.equals(request)) {
  throw new Error("LuckyMe sidecar ORAO request does not match derived ORAO PDA");
}

console.log(`ORAO seed: ${seed.toString("hex")}`);
console.log(`ORAO request: ${request.toBase58()}`);
console.log(`ORAO request exists: ${requestExists ? "yes" : "no"}`);

if (!requestExists) {
  assertRoundClosedAndEligible(await program.account.round.fetch(round), poolSpec);
  const builder = await vrf.request(seed);
  builder.withComputeUnitPrice(0n);
  const method = await builder.build();
  const simulation = await method.simulate();
  console.log(`ORAO request simulation: ok (${simulation?.raw?.length ?? "unknown"} logs)`);
  await recheckConfiguredKeeper(program, keeperConfig, payer.publicKey);
  assertRoundClosedAndEligible(await program.account.round.fetch(round), poolSpec);
  const signature = await method.rpc();
  console.log(`Requested ORAO randomness: ${signature}`);
}

function assertRoundClosedAndEligible(roundAccount, poolSpec) {
  if (roundAccount.settled) {
    throw new Error("Round is already settled");
  }
  const now = Math.floor(Date.now() / 1000);
  const endTs = Number(roundAccount.endTs.toString());
  if (now < endTs) {
    throw new Error(`Round is still open until ${endTs}`);
  }
  const totalTickets = BigInt(roundAccount.totalTickets.toString());
  const entrantCount = Number(roundAccount.entrantCount);
  if (!roundMeetsMinimums(poolSpec, totalTickets, entrantCount)) {
    const { minimumTickets, minimumDistinctEntrants } = poolMinimums(poolSpec);
    throw new Error(
      `Round is below the valid-draw minimum: tickets=${totalTickets.toString()}/${minimumTickets} ` +
      `entrants=${entrantCount}/${minimumDistinctEntrants}`,
    );
  }
}

async function getNetworkState(vrf, dryRun) {
  try {
    return await vrf.getNetworkState("confirmed");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!dryRun) {
      throw new Error(`ORAO network state is unavailable: ${message}`);
    }
    console.log(`ORAO network state unavailable in dry run: ${message}`);
    return null;
  }
}

function requireOraoMode() {
  if (RANDOMNESS_MODE !== "orao_vrf") {
    throw new Error("Set LUCKYME_RANDOMNESS_MODE=orao_vrf before requesting provider randomness");
  }
}

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

function requireMainnetConfirmation(url, mainnetByGenesis) {
  const mainnet = mainnetByGenesis || /mainnet|api\.mainnet-beta\.solana\.com|helius-rpc/i.test(url);
  if (mainnet && !DRY_RUN && process.env.CONFIRM_MAINNET_RANDOMNESS_REQUEST !== "true") {
    throw new Error(
      "Refusing mainnet randomness request without CONFIRM_MAINNET_RANDOMNESS_REQUEST=true",
    );
  }
}
