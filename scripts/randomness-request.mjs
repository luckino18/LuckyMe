import oraoVrf from "@orao-network/solana-vrf";
import {
  ORAO_VRF_PROGRAM_ID,
  POOLS,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveOraoRandomnessAccount,
  derivePool,
  deriveRound,
  deriveRoundRandomnessAccount,
} from "./anchor-client.mjs";

const { Orao, networkStateAccountAddress } = oraoVrf;

const DRY_RUN = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const ROUND_ID = parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID");
const RANDOMNESS_MODE = process.env.LUCKYME_RANDOMNESS_MODE ?? "commit_reveal_demo";
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.label.toLowerCase(), pool]));

requireOraoMode();
if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const { connection, payer, program, provider, url } = createClient();
requireMainnetConfirmation(url);

const config = deriveConfig();
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(config, poolSpec.id);
const round = deriveRound(pool, ROUND_ID);
const roundRandomness = deriveRoundRandomnessAccount(round);
const vrf = new Orao(provider, ORAO_VRF_PROGRAM_ID);

if (!(await accountExists(connection, config))) {
  throw new Error(`Config account does not exist: ${config.toBase58()}`);
}
if (!(await accountExists(connection, pool))) {
  throw new Error(`${poolSpec.label} pool does not exist: ${pool.toBase58()}`);
}
if (!(await accountExists(connection, round))) {
  throw new Error(`${poolSpec.label} round ${ROUND_ID} does not exist: ${round.toBase58()}`);
}

const roundAccount = await program.account.round.fetch(round);
assertRoundClosedWithEntries(roundAccount);

console.log(`Cluster: ${url}`);
console.log(`Release mode: ${process.env.LUCKYME_RELEASE_MODE ?? "MAINNET_RELEASE"}`);
console.log(`Randomness mode: ${RANDOMNESS_MODE}`);
console.log(`Keeper fee payer: ${payer.publicKey.toBase58()}`);
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
  const signature = await program.methods
    .requestRandomness()
    .accounts({
      keeper: payer.publicKey,
      config,
      pool,
      round,
      roundRandomness,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
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
  const builder = await vrf.request(seed);
  builder.withComputeUnitPrice(0n);
  const [_seed, signature] = await builder.rpc();
  console.log(`Requested ORAO randomness: ${signature}`);
}

function assertRoundClosedWithEntries(roundAccount) {
  if (roundAccount.settled) {
    throw new Error("Round is already settled");
  }
  const now = Math.floor(Date.now() / 1000);
  const endTs = Number(roundAccount.endTs.toString());
  if (now < endTs) {
    throw new Error(`Round is still open until ${endTs}`);
  }
  if (BigInt(roundAccount.totalTickets.toString()) === 0n) {
    throw new Error("Round has no tickets");
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

function requireMainnetConfirmation(url) {
  if (/mainnet|api\.mainnet-beta\.solana\.com/i.test(url) && process.env.CONFIRM_MAINNET !== "true") {
    throw new Error("Refusing mainnet randomness request without CONFIRM_MAINNET=true");
  }
}
