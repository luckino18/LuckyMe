import crypto from "node:crypto";
import {
  POOLS,
  PROGRAM_ID,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveKeeperConfig,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveRound,
  mainPrizePayouts,
  poolMinimums,
  randomModDomain,
  roundMeetsMinimums,
  selectWinnerTickets,
  u64Le,
} from "./anchor-client.mjs";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const DRY_RUN = process.env.DRY_RUN !== "false" || process.argv.includes("--dry-run");
const POOL = process.env.POOL?.toLowerCase() ?? "normal";
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

if (!POOL_BY_SLUG.has(POOL)) {
  throw new Error(`Unknown POOL=${POOL}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}
if (looksLikeMainnetUrl(RPC_URL)) {
  throw new Error(
    "Commit-reveal settlement is disabled on mainnet. Use ORAO provider settlement through settlement:keeper.",
  );
}
const ROUND_ID = parsePositiveInteger(process.env.ROUND_ID, "ROUND_ID");
const REVEAL = parseReveal(process.env.RANDOMNESS_REVEAL);

const readonly = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await readonly.connection.getGenesisHash();
if (genesisHash === MAINNET_GENESIS_HASH) {
  throw new Error(
    "Commit-reveal settlement is disabled on mainnet. Use ORAO provider settlement through settlement:keeper.",
  );
}
const { connection, payer, program, url } = DRY_RUN
  ? readonly
  : createClient({ requireSigner: true, url: RPC_URL });

const configAddress = deriveConfig();
const keeperConfig = deriveKeeperConfig(configAddress);
if (!(await accountExists(connection, keeperConfig))) {
  throw new Error(`KeeperConfig account does not exist: ${keeperConfig.toBase58()}`);
}
const config = await program.account.config.fetch(configAddress);
const configuredKeeper = (await program.account.keeperConfig.fetch(keeperConfig)).keeper;
if (!DRY_RUN) {
  assertConfiguredKeeper(payer, configuredKeeper);
}
const poolSpec = POOL_BY_SLUG.get(POOL);
const pool = derivePool(configAddress, poolSpec.id);
const poolVault = derivePoolVault(pool);
const jackpotVault = deriveJackpotVault(pool);
const round = deriveRound(pool, ROUND_ID);
const roundAccount = await program.account.round.fetch(round);
const poolAccount = await program.account.pool.fetch(pool);

if (roundAccount.settled) {
  throw new Error("Round is already settled");
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

const expectedCommitment = commitmentForReveal(REVEAL);
if (!Buffer.from(roundAccount.randomnessCommitment).equals(expectedCommitment)) {
  throw new Error("Reveal does not match the on-chain commitment");
}

const entries = await fetchEntriesForRound(program, round);
const randomness = deriveRoundRandomness(round, totalTickets, REVEAL);
const poolConfig = poolSettlementConfig(poolAccount, poolSpec);
if (Number(roundAccount.entrantCount) < poolConfig.winnerCount) {
  throw new Error(`${poolSpec.label} requires at least ${poolConfig.winnerCount} entrants`);
}
const winnerTickets = selectWinnerTickets(randomness, totalTickets, poolConfig.winnerCount);
const winnerEntries = winnerTickets
  .slice(0, poolConfig.winnerCount)
  .map((ticket, index) => findEntryByTicket(entries, ticket, `winner ${index + 1}`));
const jackpotRoll = randomModDomain(
  randomness,
  "jackpot-roll",
  0,
  BigInt(config.jackpotOddsDenominator.toString()),
);
const jackpotTriggered = jackpotRoll === 0n;
const jackpotTicket = randomModDomain(randomness, "jackpot-winner", 0, totalTickets);
const jackpotEntry = findEntryByTicket(entries, jackpotTicket, "jackpot");
const mainPrize = BigInt(roundAccount.totalLamports.toString())
  - bpsAmount(roundAccount.totalLamports, config.houseFeeBps)
  - bpsAmount(roundAccount.totalLamports, config.jackpotBps);
const prizePayouts = mainPrizePayouts(mainPrize, poolConfig);
const winnerEntry = winnerEntries[0];

console.log(`Cluster: ${url}`);
console.log(`Genesis hash: ${genesisHash}`);
console.log(`Program: ${PROGRAM_ID.toBase58()}`);
console.log(`Settler: ${configuredKeeper.toBase58()}`);
console.log(`KeeperConfig: ${keeperConfig.toBase58()}`);
console.log(`Pool: ${poolSpec.label} (${pool.toBase58()})`);
console.log(`Round: ${ROUND_ID} (${round.toBase58()})`);
console.log(`Total tickets: ${totalTickets.toString()}`);
console.log(`Winner count: ${poolConfig.winnerCount}`);
for (const [index, entry] of winnerEntries.entries()) {
  console.log(
    `Winner ${index + 1}: ${entry.player.toBase58()} ticket ${winnerTickets[index].toString()} prize ${prizePayouts[index].toString()} lamports`,
  );
}
console.log(`Jackpot roll: ${jackpotRoll.toString()}`);
console.log(`Jackpot triggered: ${jackpotTriggered ? "yes" : "no"}`);
console.log(`Jackpot ticket: ${jackpotTicket.toString()}`);
console.log(`Jackpot winner: ${jackpotEntry.player.toBase58()}`);
console.log(`Pool jackpot before settle: ${poolAccount.jackpotLamports.toString()} lamports`);
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

if (DRY_RUN) {
  process.exit(0);
}

const method = program.methods
  .settleRound([...REVEAL])
  .accounts({
    keeper: payer.publicKey,
    config: configAddress,
    keeperConfig,
    pool,
    round,
    poolVault,
    jackpotVault,
    winner: winnerEntry.player,
    winnerEntry: winnerEntry.address,
    jackpotWinner: jackpotEntry.player,
    jackpotEntry: jackpotEntry.address,
    treasury: config.treasury,
    systemProgram: SystemProgram.programId,
  })
  .remainingAccounts(remainingWinnerAccounts(winnerEntries));

const simulation = await method.simulate();
console.log(`Commit-reveal settlement simulation: ok (${simulation?.raw?.length ?? "unknown"} logs)`);
await recheckConfiguredKeeper(program, keeperConfig, payer.publicKey);
const latestRound = await program.account.round.fetch(round);
if (
  latestRound.settled ||
  !roundMeetsMinimums(
    poolSpec,
    BigInt(latestRound.totalTickets.toString()),
    Number(latestRound.entrantCount),
  )
) {
  throw new Error("Round became ineligible before commit-reveal settlement submission");
}
const signature = await method.rpc();

console.log(`Settled round: ${signature}`);

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
    .filter((entry) => entry.ticketStart < entry.ticketEndExclusive);
}

function commitmentForReveal(reveal) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(reveal)
    .digest();
}

function deriveRoundRandomness(round, totalTickets, reveal) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-round-randomness"))
    .update(round.toBuffer())
    .update(u64Le(totalTickets))
    .update(reveal)
    .digest();
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

function poolSettlementConfig(poolAccount, poolSpec) {
  return {
    winnerCount: Number((poolAccount.winnerCount ?? poolSpec.winnerCount).toString()),
    prizeSplitBps: Array.from(
      poolAccount.prizeSplitBps ?? poolSpec.prizeSplitBps,
      (value) => Number(value.toString()),
    ),
  };
}

function remainingWinnerAccounts(winnerEntries) {
  if (winnerEntries.length < 3) {
    return [];
  }

  return [
    { pubkey: winnerEntries[1].player, isWritable: true, isSigner: false },
    { pubkey: winnerEntries[1].address, isWritable: false, isSigner: false },
    { pubkey: winnerEntries[2].player, isWritable: true, isSigner: false },
    { pubkey: winnerEntries[2].address, isWritable: false, isSigner: false },
  ];
}

function bpsAmount(totalLamports, bps) {
  return (BigInt(totalLamports.toString()) * BigInt(bps.toString())) / 10_000n;
}

function parseReveal(value) {
  const normalized = String(value ?? "").trim().replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("RANDOMNESS_REVEAL must be a 32-byte hex string");
  }
  return Buffer.from(normalized, "hex");
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

function looksLikeMainnetUrl(value) {
  return /mainnet|api\.mainnet-beta\.solana\.com|helius-rpc/i.test(value);
}
