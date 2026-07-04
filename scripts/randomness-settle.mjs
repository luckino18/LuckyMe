import {
  ORAO_VRF_PROGRAM_ID,
  POOLS,
  SystemProgram,
  createClient,
  deriveConfig,
  deriveEntry,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveProviderRoundRandomness,
  deriveRound,
  deriveRoundRandomnessAccount,
  parseOraoRandomnessV2,
} from "./anchor-client.mjs";

const DRY_RUN = process.env.DRY_RUN === "true" || process.argv.includes("--dry-run");
const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const ROUND_ID = parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID");
const RANDOMNESS_MODE = process.env.LUCKYME_RANDOMNESS_MODE ?? "commit_reveal_demo";
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.label.toLowerCase(), pool]));

requireOraoMode();
if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const { connection, payer, program, url } = createClient();
requireMainnetConfirmation(url);

const configAddress = deriveConfig();
const config = await program.account.config.fetch(configAddress);
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(configAddress, poolSpec.id);
const poolVault = derivePoolVault(pool);
const jackpotVault = deriveJackpotVault(pool);
const round = deriveRound(pool, ROUND_ID);
const roundRandomness = deriveRoundRandomnessAccount(round);
const roundAccount = await program.account.round.fetch(round);
const poolAccount = await program.account.pool.fetch(pool);

if (roundAccount.settled) {
  throw new Error("Round is already settled");
}
const now = Math.floor(Date.now() / 1000);
const endTs = Number(roundAccount.endTs.toString());
if (now < endTs) {
  throw new Error(`Round is still open until ${endTs}`);
}
const totalTickets = BigInt(roundAccount.totalTickets.toString());
if (totalTickets === 0n) {
  throw new Error("Round has no tickets");
}

const sidecar = await program.account.roundRandomness.fetch(roundRandomness);
const providerAccount = await connection.getAccountInfo(sidecar.request, "confirmed");
if (!providerAccount) {
  throw new Error(`ORAO request account missing: ${sidecar.request.toBase58()}`);
}
if (!providerAccount.owner.equals(ORAO_VRF_PROGRAM_ID)) {
  throw new Error(`ORAO request owner mismatch: ${providerAccount.owner.toBase58()}`);
}
const parsed = parseOraoRandomnessV2(providerAccount.data);
if (parsed.status !== "fulfilled") {
  throw new Error(`ORAO randomness is not fulfilled: ${parsed.error ?? parsed.status}`);
}
if (!parsed.seed.equals(Buffer.from(sidecar.randomnessSeed))) {
  throw new Error("ORAO fulfilled seed does not match LuckyMe sidecar seed");
}

const entries = await fetchEntriesForRound(program, round);
const randomness = deriveProviderRoundRandomness(round, totalTickets, parsed.randomness);
const winnerTicket = randomMod(randomness, 0, totalTickets);
const jackpotRoll = randomMod(randomness, 8, BigInt(config.jackpotOddsDenominator.toString()));
const jackpotTriggered = jackpotRoll === 0n;
const jackpotTicket = randomMod(randomness, 16, totalTickets);
const winnerEntry = findEntryByTicket(entries, winnerTicket, "winner");
const jackpotEntry = findEntryByTicket(entries, jackpotTicket, "jackpot");

console.log(`Cluster: ${url}`);
console.log(`Release mode: ${process.env.LUCKYME_RELEASE_MODE ?? "MAINNET_RELEASE"}`);
console.log(`Randomness mode: ${RANDOMNESS_MODE}`);
console.log(`Settler fee payer: ${payer.publicKey.toBase58()}`);
console.log(`Pool: ${poolSpec.label} (${pool.toBase58()})`);
console.log(`Round: ${ROUND_ID} (${round.toBase58()})`);
console.log(`LuckyMe sidecar: ${roundRandomness.toBase58()}`);
console.log(`ORAO request: ${sidecar.request.toBase58()}`);
console.log(`ORAO randomness hash: ${parsed.randomnessHash.toString("hex")}`);
console.log(`Derived randomness: ${randomness.toString("hex")}`);
console.log(`Total tickets: ${totalTickets.toString()}`);
console.log(`Winner ticket: ${winnerTicket.toString()}`);
console.log(`Winner: ${winnerEntry.player.toBase58()}`);
console.log(`Jackpot roll: ${jackpotRoll.toString()}`);
console.log(`Jackpot triggered: ${jackpotTriggered ? "yes" : "no"}`);
console.log(`Jackpot ticket: ${jackpotTicket.toString()}`);
console.log(`Jackpot winner: ${jackpotEntry.player.toBase58()}`);
console.log(`Pool jackpot before settle: ${poolAccount.jackpotLamports.toString()} lamports`);
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

if (DRY_RUN) {
  process.exit(0);
}

const signature = await program.methods
  .settleRoundWithProviderRandomness()
  .accounts({
    keeper: payer.publicKey,
    config: configAddress,
    pool,
    round,
    roundRandomness,
    providerRandomness: sidecar.request,
    poolVault,
    jackpotVault,
    winner: winnerEntry.player,
    winnerEntry: winnerEntry.address,
    jackpotWinner: jackpotEntry.player,
    jackpotEntry: jackpotEntry.address,
    treasury: config.treasury,
    systemProgram: SystemProgram.programId,
  })
  .rpc();

console.log(`Settled provider round: ${signature}`);

async function fetchEntriesForRound(program, round) {
  const accounts = await program.account.entry.all([
    {
      memcmp: {
        offset: 8,
        bytes: round.toBase58(),
      },
    },
  ]);

  return accounts
    .map(({ publicKey, account }) => {
      const ticketStart = BigInt(account.ticketStart.toString());
      const ticketCount = BigInt(account.ticketCount.toString());
      return {
        address: publicKey,
        player: account.player,
        ticketStart,
        ticketEndExclusive: ticketStart + ticketCount,
      };
    })
    .filter((entry) => entry.ticketStart < entry.ticketEndExclusive)
    .sort((left, right) =>
      left.ticketStart < right.ticketStart ? -1 : left.ticketStart > right.ticketStart ? 1 : 0,
    );
}

function randomMod(randomness, offset, modulo) {
  return randomness.readBigUInt64LE(offset) % modulo;
}

function findEntryByTicket(entries, ticket, label) {
  const entry = entries.find((item) =>
    ticket >= item.ticketStart && ticket < item.ticketEndExclusive,
  );
  if (!entry) {
    throw new Error(`No ${label} entry contains ticket ${ticket.toString()}`);
  }
  return entry;
}

function requireOraoMode() {
  if (RANDOMNESS_MODE !== "orao_vrf") {
    throw new Error("Set LUCKYME_RANDOMNESS_MODE=orao_vrf before settling provider randomness");
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
    throw new Error("Refusing mainnet provider settlement without CONFIRM_MAINNET=true");
  }
}
