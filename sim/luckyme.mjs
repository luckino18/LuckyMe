import { createHash } from "node:crypto";

export const LAMPORTS_PER_SOL = 1_000_000_000n;
export const BPS_DENOMINATOR = 10_000n;
export const REFUND_DELAY_SECONDS = 600;
export const DEFAULT_ROUND_DURATION_SECONDS = 3_600;
export const DEFAULT_HOUSE_FEE_BPS = 200n;
export const DEFAULT_JACKPOT_BPS = 300n;
export const DEFAULT_MAIN_PRIZE_BPS = BPS_DENOMINATOR - DEFAULT_HOUSE_FEE_BPS - DEFAULT_JACKPOT_BPS;
export const MAX_WINNERS = 3;

export const DEFAULT_CONFIG = Object.freeze({
  houseFeeBps: DEFAULT_HOUSE_FEE_BPS,
  jackpotBps: DEFAULT_JACKPOT_BPS,
  jackpotOddsDenominator: 288n,
});

export const FIXED_POOLS = Object.freeze([
  {
    id: "mini",
    label: "Mini",
    ticketPriceLamports: 5_000_000n,
    winnerCount: 1,
    minimumTickets: 25n,
    minimumDistinctEntrants: 1,
    prizeSplitBps: Object.freeze([10_000n, 0n, 0n]),
    maxTicketsPerEntry: 1_000n,
  },
  {
    id: "normal",
    label: "Normal",
    ticketPriceLamports: 10_000_000n,
    winnerCount: 1,
    minimumTickets: 13n,
    minimumDistinctEntrants: 1,
    prizeSplitBps: Object.freeze([10_000n, 0n, 0n]),
    maxTicketsPerEntry: 1_000n,
  },
  {
    id: "high",
    label: "High",
    ticketPriceLamports: 50_000_000n,
    winnerCount: 1,
    minimumTickets: 3n,
    minimumDistinctEntrants: 1,
    prizeSplitBps: Object.freeze([10_000n, 0n, 0n]),
    maxTicketsPerEntry: 1_000n,
  },
  {
    id: "premium",
    label: "Premium",
    ticketPriceLamports: 100_000_000n,
    winnerCount: 3,
    minimumTickets: 3n,
    minimumDistinctEntrants: 3,
    prizeSplitBps: Object.freeze([7_000n, 2_000n, 1_000n]),
    maxTicketsPerEntry: 1n,
  },
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

export function buildEntries(rawEntries, ticketPriceLamports, maxTicketsPerEntry = 1_000n) {
  let nextTicket = 0n;
  const enteredPlayers = new Set();

  return rawEntries.map((entry) => {
    const tickets = BigInt(entry.tickets);
    if (tickets <= 0n) {
      throw new Error("tickets must be positive");
    }
    if (tickets > BigInt(maxTicketsPerEntry)) {
      throw new Error(`tickets exceed per-entry maximum of ${maxTicketsPerEntry}`);
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
  pool,
  jackpotBalanceLamports = 0n,
  randomSeed,
  config = DEFAULT_CONFIG,
}) {
  const poolSpec = resolvePoolSpec({ pool, ticketPriceLamports });
  const resolvedTicketPriceLamports = BigInt(ticketPriceLamports ?? poolSpec.ticketPriceLamports);
  const builtEntries = buildEntries(
    entries,
    resolvedTicketPriceLamports,
    poolSpec.maxTicketsPerEntry,
  );
  const totalTickets = builtEntries.reduce((sum, entry) => sum + entry.tickets, 0n);
  if (totalTickets === 0n) {
    throw new Error("cannot settle empty round");
  }
  requireValidDrawMinimum(poolSpec, totalTickets, builtEntries.length);

  const totalLamports = totalTickets * resolvedTicketPriceLamports;
  const houseFee = bpsAmount(totalLamports, config.houseFeeBps);
  const jackpotAdd = bpsAmount(totalLamports, config.jackpotBps);
  const mainPrize = totalLamports - houseFee - jackpotAdd;

  const randomness = randomnessFromSeed(randomSeed);
  const winnerTickets = selectWinnerTickets(randomness, totalTickets, poolSpec.winnerCount);
  const winnerEntries = winnerTickets
    .slice(0, poolSpec.winnerCount)
    .map((winnerTicket) => pickEntryByTicket(builtEntries, winnerTicket));
  const prizePayouts = mainPrizePayouts(mainPrize, poolSpec);

  const jackpotRoll = randomModDomain(
    randomness,
    "jackpot-roll",
    0,
    BigInt(config.jackpotOddsDenominator),
  );
  const jackpotTriggered = jackpotRoll === 0n;
  const jackpotTicket = randomModDomain(randomness, "jackpot-winner", 0, totalTickets);
  const jackpotEntry = jackpotTriggered ? pickEntryByTicket(builtEntries, jackpotTicket) : null;
  const jackpotPotAfterAdd = BigInt(jackpotBalanceLamports) + jackpotAdd;

  return {
    totalTickets,
    totalLamports,
    houseFee,
    jackpotAdd,
    mainPrize,
    winnerCount: poolSpec.winnerCount,
    winnerTicket: winnerTickets[0],
    winnerTickets,
    winner: winnerEntries[0].player,
    winners: winnerEntries.map((entry, index) => ({
      player: entry.player,
      ticket: winnerTickets[index],
      prizeLamports: prizePayouts[index],
    })),
    firstPrizeLamports: prizePayouts[0],
    secondPrizeLamports: prizePayouts[1],
    thirdPrizeLamports: prizePayouts[2],
    jackpotTriggered,
    jackpotTicket: jackpotTriggered ? jackpotTicket : null,
    jackpotWinner: jackpotEntry?.player ?? null,
    jackpotPayout: jackpotTriggered ? jackpotPotAfterAdd : 0n,
    jackpotBalanceAfter: jackpotTriggered ? 0n : jackpotPotAfterAdd,
    entries: builtEntries,
  };
}

export function refundEntryAfterTimeout({
  entries,
  ticketPriceLamports,
  pool,
  player,
  roundEndTs,
  nowTs,
  refundDelaySeconds = REFUND_DELAY_SECONDS,
}) {
  if (BigInt(nowTs) < BigInt(roundEndTs) + BigInt(refundDelaySeconds)) {
    throw new Error("refund is not available yet");
  }

  const poolSpec = resolvePoolSpec({ pool, ticketPriceLamports });
  const resolvedTicketPriceLamports = BigInt(ticketPriceLamports ?? poolSpec.ticketPriceLamports);
  const builtEntries = buildEntries(
    entries,
    resolvedTicketPriceLamports,
    poolSpec.maxTicketsPerEntry,
  );
  const totalTickets = builtEntries.reduce((sum, entry) => sum + entry.tickets, 0n);
  if (roundMeetsMinimums(poolSpec, totalTickets, builtEntries.length)) {
    throw new Error("round reached the minimum and must use the draw path");
  }
  const entry = builtEntries.find((item) => item.player === player);
  if (!entry || entry.lamports === 0n) {
    throw new Error("entry has nothing to refund");
  }

  return {
    player,
    refundLamports: entry.lamports,
    refundTickets: entry.tickets,
    remainingLamports:
      builtEntries.reduce((sum, item) => sum + item.lamports, 0n) - entry.lamports,
    remainingTickets:
      builtEntries.reduce((sum, item) => sum + item.tickets, 0n) - entry.tickets,
  };
}

export function roundMeetsMinimums(pool, totalTickets, entrantCount) {
  return BigInt(totalTickets) >= BigInt(pool.minimumTickets) &&
    Number(entrantCount) >= Number(pool.minimumDistinctEntrants);
}

export function classifyExpiredRound({
  pool,
  ticketPriceLamports,
  entries,
  expired = true,
  settled = false,
  oraoRequestExists = false,
}) {
  const poolSpec = resolvePoolSpec({ pool, ticketPriceLamports });
  const resolvedTicketPriceLamports = BigInt(ticketPriceLamports ?? poolSpec.ticketPriceLamports);
  const builtEntries = buildEntries(
    entries,
    resolvedTicketPriceLamports,
    poolSpec.maxTicketsPerEntry,
  );
  const totalTickets = builtEntries.reduce((sum, entry) => sum + entry.tickets, 0n);
  if (settled) {
    return { action: "cleanup", roundOutcome: "settled", requestOrao: false };
  }
  if (!expired) {
    return { action: "wait", roundOutcome: "open", requestOrao: false };
  }
  if (totalTickets === 0n) {
    return { action: "close_empty", roundOutcome: "cancelled_empty", requestOrao: false };
  }
  if (!roundMeetsMinimums(poolSpec, totalTickets, builtEntries.length)) {
    return {
      action: "refund",
      roundOutcome: "cancelled_below_minimum",
      requestOrao: false,
      refundLamports: builtEntries.reduce((sum, entry) => sum + entry.lamports, 0n),
      refundsPending: builtEntries.length,
      refundsCompleted: 0,
    };
  }
  return {
    action: oraoRequestExists ? "settle_or_wait_provider" : "request_orao",
    roundOutcome: "eligible_for_draw",
    requestOrao: !oraoRequestExists,
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

export function mainPrizePayouts(mainPrize, pool) {
  const winnerCount = Number(pool.winnerCount);
  if (winnerCount !== 1 && winnerCount !== MAX_WINNERS) {
    throw new Error("invalid winner count");
  }

  const split = pool.prizeSplitBps.map(BigInt);
  const splitTotal = split.slice(0, winnerCount).reduce((sum, bps) => sum + bps, 0n);
  if (splitTotal !== BPS_DENOMINATOR) {
    throw new Error("invalid prize split");
  }

  const payouts = [0n, 0n, 0n];
  let allocated = 0n;
  for (let index = 1; index < winnerCount; index += 1) {
    payouts[index] = bpsAmount(mainPrize, split[index]);
    allocated += payouts[index];
  }
  payouts[0] = BigInt(mainPrize) - allocated;
  return payouts;
}

export function selectWinnerTickets(randomness, totalTickets, winnerCount) {
  const resolvedWinnerCount = Number(winnerCount);
  if (resolvedWinnerCount !== 1 && resolvedWinnerCount !== MAX_WINNERS) {
    throw new Error("invalid winner count");
  }
  if (BigInt(totalTickets) < BigInt(resolvedWinnerCount)) {
    throw new Error(`pool requires at least ${resolvedWinnerCount} tickets`);
  }

  const first = randomModDomain(randomness, "main-winner", 0, totalTickets);
  if (resolvedWinnerCount === 1) {
    return [first, 0n, 0n];
  }

  const secondRaw = randomModDomain(randomness, "main-winner", 1, BigInt(totalTickets) - 1n);
  const second = ticketFromAvailableIndex(secondRaw, [first]);
  const thirdRaw = randomModDomain(randomness, "main-winner", 2, BigInt(totalTickets) - 2n);
  const third = ticketFromAvailableIndex(thirdRaw, [first, second]);
  return [first, second, third];
}

export function randomModDomain(randomness, domain, nonce, modulo) {
  const digest = createHash("sha256")
    .update(Buffer.from("luckyme-random-mod-v2"))
    .update(Buffer.from(randomness))
    .update(Buffer.from(domain))
    .update(Buffer.from([Number(nonce)]))
    .digest();
  return digest.readBigUInt64LE(0) % BigInt(modulo);
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

function randomnessFromSeed(seed) {
  return createHash("sha256")
    .update(Buffer.from("luckyme-sim-randomness"))
    .update(String(seed))
    .digest();
}

function ticketFromAvailableIndex(index, excluded) {
  let ticket = BigInt(index);
  for (const excludedTicket of [...excluded].map(BigInt).sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )) {
    if (ticket >= excludedTicket) {
      ticket += 1n;
    }
  }
  return ticket;
}

function resolvePoolSpec({ pool, ticketPriceLamports }) {
  if (pool) {
    return pool;
  }

  const resolvedTicketPriceLamports = BigInt(ticketPriceLamports);
  return (
    FIXED_POOLS.find((item) => item.ticketPriceLamports === resolvedTicketPriceLamports) ?? {
      id: "custom",
      label: "Custom",
      ticketPriceLamports: resolvedTicketPriceLamports,
      winnerCount: 1,
      minimumTickets: 1n,
      minimumDistinctEntrants: 1,
      prizeSplitBps: Object.freeze([10_000n, 0n, 0n]),
      maxTicketsPerEntry: 1_000n,
    }
  );
}

function requireValidDrawMinimum(poolSpec, totalTickets, entrantCount) {
  if (BigInt(totalTickets) < BigInt(poolSpec.minimumTickets)) {
    throw new Error(`pool requires at least ${poolSpec.minimumTickets} total tickets`);
  }
  if (Number(entrantCount) < Number(poolSpec.minimumDistinctEntrants)) {
    throw new Error(
      `pool requires at least ${poolSpec.minimumDistinctEntrants} distinct entrants`,
    );
  }
}
