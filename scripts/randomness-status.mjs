import oraoVrf from "@orao-network/solana-vrf";
import {
  ORAO_VRF_PROGRAM_ID,
  POOLS,
  accountExists,
  createClient,
  deriveConfig,
  deriveOraoRandomnessAccount,
  derivePool,
  deriveProviderRoundRandomness,
  deriveRound,
  deriveRoundRandomnessAccount,
  parseOraoRandomnessV2,
} from "./anchor-client.mjs";

const { Orao, networkStateAccountAddress } = oraoVrf;

const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const ROUND_ID = parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID");
const RANDOMNESS_MODE = process.env.LUCKYME_RANDOMNESS_MODE ?? "orao_vrf";
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const { connection, program, provider, url } = createClient({ requireSigner: false });
const config = deriveConfig();
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(config, poolSpec.id);
const round = deriveRound(pool, ROUND_ID);
const roundRandomness = deriveRoundRandomnessAccount(round);
const vrf = new Orao(provider, ORAO_VRF_PROGRAM_ID);

console.log(`Cluster: ${url}`);
console.log(`Release mode: ${process.env.LUCKYME_RELEASE_MODE ?? "MAINNET_RELEASE"}`);
console.log(`Randomness mode: ${RANDOMNESS_MODE}`);
console.log("Fee payer: none (read-only status)");
console.log(`Pool: ${poolSpec.label} (${pool.toBase58()})`);
console.log(`Round: ${ROUND_ID} (${round.toBase58()})`);
console.log(`LuckyMe sidecar: ${roundRandomness.toBase58()}`);
console.log(`ORAO program: ${ORAO_VRF_PROGRAM_ID.toBase58()}`);
console.log(`ORAO network state: ${networkStateAccountAddress(ORAO_VRF_PROGRAM_ID).toBase58()}`);
console.log("ORAO seed/request: read from LuckyMe sidecar after request_randomness");

try {
  const networkState = await vrf.getNetworkState("confirmed");
  console.log(`ORAO treasury: ${networkState.config.treasury.toBase58()}`);
  console.log(`ORAO request fee: ${networkState.config.requestFee.toString()} lamports`);
} catch (error) {
  console.log(`ORAO network state unavailable: ${error instanceof Error ? error.message : String(error)}`);
}

if (!(await accountExists(connection, round))) {
  throw new Error(`Round account does not exist: ${round.toBase58()}`);
}

const roundAccount = await program.account.round.fetch(round);
console.log(`Round settled: ${roundAccount.settled ? "yes" : "no"}`);
console.log(`Round total tickets: ${roundAccount.totalTickets.toString()}`);
console.log(`Round end_ts: ${roundAccount.endTs.toString()}`);

let sidecar;
try {
  sidecar = await program.account.roundRandomness.fetch(roundRandomness);
} catch {
  console.log("LuckyMe sidecar status: not_requested");
  process.exit(0);
}

console.log(`LuckyMe sidecar status: ${enumName(sidecar.status)}`);
console.log(`LuckyMe provider: ${enumName(sidecar.provider)}`);
console.log(`LuckyMe request: ${sidecar.request.toBase58()}`);
console.log(`LuckyMe seed: ${Buffer.from(sidecar.randomnessSeed).toString("hex")}`);
const expectedRequest = deriveOraoRandomnessAccount(Buffer.from(sidecar.randomnessSeed));
console.log(`LuckyMe request matches derived ORAO PDA: ${sidecar.request.equals(expectedRequest) ? "yes" : "no"}`);

const providerAccount = await connection.getAccountInfo(sidecar.request, "confirmed");
if (!providerAccount) {
  console.log("ORAO provider status: missing");
  process.exit(0);
}

console.log(`ORAO owner: ${providerAccount.owner.toBase58()}`);
console.log(`ORAO owner valid: ${providerAccount.owner.equals(ORAO_VRF_PROGRAM_ID) ? "yes" : "no"}`);
const parsed = parseOraoRandomnessV2(providerAccount.data);
console.log(`ORAO provider status: ${parsed.status}`);
if (parsed.status === "pending") {
  console.log(`ORAO client: ${parsed.client.toBase58()}`);
  console.log(`ORAO seed: ${parsed.seed.toString("hex")}`);
}
if (parsed.status === "fulfilled") {
  const totalTickets = BigInt(roundAccount.totalTickets.toString());
  console.log(`ORAO client: ${parsed.client.toBase58()}`);
  console.log(`ORAO seed: ${parsed.seed.toString("hex")}`);
  console.log(`ORAO randomness hash: ${parsed.randomnessHash.toString("hex")}`);
  console.log(`LuckyMe derived randomness: ${deriveProviderRoundRandomness(round, totalTickets, parsed.randomness).toString("hex")}`);
}
if (parsed.status === "invalid") {
  console.log(`ORAO parse error: ${parsed.error}`);
}

function enumName(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object") {
    return Object.keys(value)[0] ?? "unknown";
  }
  return String(value ?? "unknown");
}

function parsePositiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}
