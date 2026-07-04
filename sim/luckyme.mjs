import { createHash } from "node:crypto";

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BPS_DENOMINATOR = 10_000n;

export const DEFAULT_CONFIG = Object.freeze({
  houseFeeBps: 300n,
  jackpotBps: 200n,
  jackpotOddsDenominator: 288n,
});

export const FIXED_POOLS = Object.freeze([
  { id: "mini", label: "Mini", ticketPriceLamports: 5_000_000n },
  { id: "normal", label: "Normal", ticketPriceLamports: 10_000_000n },
  { id: "high", label: "High", ticketPriceLamports: 100_000_000n },
]);

export function solToLamports(sol) {
  const [whole, fraction = ""] = String(sol).split(".");
  const frac = `${fraction}000000000`.slice(0, 9);
  return BigInt(whole) * LAMPORTS_PER_SOL + BigInt(frac);
}

export function lamportsToSol(lamports) {
  const value = BigInt(lamports);
  const whole = value / LAMPORTS_PER_SOL;
  const fraction = String(value % LAMPORTS_PER_SOL).padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

export function buildEntries(rawEntries, ticketPriceLamports) {
  let nextTicket = 0n;
  const enteredPlayers = new Set();

  return rawEntries.map((entry) => {
    const tickets = BigInt(entry.tickets);
    if (tickets <= 0n) {
      throw new Error("tickets must be positive");
    }
    if (enteredPlayers.has(entry.player)) {
      throw new Error("player already entered round");
    }
    enteredPlayers.add(entry.player);

    const built = {
      player: entry.player,
      tickets,
      ticketStart: nextTicket,
      ticketEndExclusive: nextTicket + tickets,
      lamports: tickets * BigInt(ticketPriceLamports),
    };
    nextTicket += tickets;
    return built;
  });
}

export function settleRound({
  entries,
  ticketPriceLamports,
  jackpotBalanceLamports = 0n,
  randomSeed,
  config = DEFAULT_CONFIG,
}) {
  const builtEntries = buildEntries(entries, ticketPriceLamports);
  const totalTickets = builtEntries.reduce((sum, entry) => sum + entry.tickets, 0n);
  if (totalTickets === 0n) {
    throw new Error("cannot settle empty round");
  }

  const totalLamports = totalTickets * BigInt(ticketPriceLamports);
  const houseFee = bpsAmount(totalLamports, config.houseFeeBps);
  const jackpotAdd = bpsAmount(totalLamports, config.jackpotBps);
  const mainPrize = totalLamports - houseFee - jackpotAdd;

  const winnerTicket = randomBigInt(randomSeed, "main-winner") % totalTickets;
  const winnerEntry = pickEntryByTicket(builtEntries, winnerTicket);

  const jackpotRoll = randomBigInt(randomSeed, "jackpot-roll") % BigInt(config.jackpotOddsDenominator);
  const jackpotTriggered = jackpotRoll === 0n;
  const jackpotTicket = randomBigInt(randomSeed, "jackpot-winner") % totalTickets;
  const jackpotEntry = jackpotTriggered ? pickEntryByTicket(builtEntries, jackpotTicket) : null;
  const jackpotPotAfterAdd = BigInt(jackpotBalanceLamports) + jackpotAdd;

  return {
    totalTickets,
    totalLamports,
    houseFee,
    jackpotAdd,
    mainPrize,
    winnerTicket,
    winner: winnerEntry.player,
    jackpotTriggered,
    jackpotTicket: jackpotTriggered ? jackpotTicket : null,
    jackpotWinner: jackpotEntry?.player ?? null,
    jackpotPayout: jackpotTriggered ? jackpotPotAfterAdd : 0n,
    jackpotBalanceAfter: jackpotTriggered ? 0n : jackpotPotAfterAdd,
    entries: builtEntries,
  };
}

export function commitmentForReveal(reveal) {
  return createHash("sha256").update("luckyme-commit").update(String(reveal)).digest("hex");
}

export function verifyReveal(commitment, reveal) {
  return commitmentForReveal(reveal) === commitment;
}

export function chanceForPlayer(entries, player) {
  const totalTickets = entries.reduce((sum, entry) => sum + BigInt(entry.tickets), 0n);
  const playerTickets = entries
    .filter((entry) => entry.player === player)
    .reduce((sum, entry) => sum + BigInt(entry.tickets), 0n);
  if (totalTickets === 0n) {
    return 0;
  }
  return Number(playerTickets * 1_000_000n / totalTickets) / 10_000;
}

function bpsAmount(totalLamports, bps) {
  return (BigInt(totalLamports) * BigInt(bps)) / BPS_DENOMINATOR;
}

function pickEntryByTicket(entries, ticket) {
  const match = entries.find(
    (entry) => ticket >= entry.ticketStart && ticket < entry.ticketEndExclusive,
  );
  if (!match) {
    throw new Error(`ticket ${ticket} is outside the entry range`);
  }
  return match;
}

function randomBigInt(seed, label) {
  const digest = createHash("sha256").update(`${seed}:${label}`).digest();
  return BigInt(`0x${digest.toString("hex")}`);
}
