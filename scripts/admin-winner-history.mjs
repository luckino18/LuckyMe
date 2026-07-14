const SYSTEM_PROGRAM = "11111111111111111111111111111111";

function archiveKey(record) {
  return [
    record.genesisHash,
    record.programId,
    record.poolAddress,
    record.address,
    record.pool,
    record.roundId,
  ].join(":");
}

function integerString(value, fallback = "0") {
  try {
    const result = BigInt(value ?? fallback);
    return result >= 0n ? result.toString() : fallback;
  } catch {
    return fallback;
  }
}

function bpsAmount(total, bps) {
  return (total * BigInt(bps)) / 10_000n;
}

function derivedPrizePayouts(record, poolConfig) {
  const total = BigInt(integerString(record.totalLamports));
  const houseFeeBps = Number(record.houseFeeBps ?? poolConfig?.houseFeeBps ?? 0);
  const jackpotBps = Number(record.jackpotBps ?? poolConfig?.jackpotBps ?? 0);
  const mainPrize = total - bpsAmount(total, houseFeeBps) - bpsAmount(total, jackpotBps);
  const splits = Array.isArray(poolConfig?.prizeSplitBps)
    ? poolConfig.prizeSplitBps.map(Number)
    : [10_000, 0, 0];
  const winnerCount = Math.max(0, Math.min(3, Number(record.winnerCount ?? 0)));
  if (winnerCount === 0) return [];
  const payouts = Array.from({ length: winnerCount }, (_, index) =>
    bpsAmount(mainPrize, splits[index] ?? 0));
  const assigned = payouts.reduce((sum, amount) => sum + amount, 0n);
  payouts[0] += mainPrize - assigned;
  return payouts.map(String);
}

function normalizeWinners(record, poolConfig) {
  const addresses = Array.isArray(record.winners) && record.winners.length
    ? record.winners.map((winner) => winner?.winner)
    : [record.winner, record.winnerSecond, record.winnerThird];
  const payouts = Array.isArray(record.prizePayouts) && record.prizePayouts.length
    ? record.prizePayouts.map((amount) => integerString(amount))
    : derivedPrizePayouts(record, poolConfig);
  return addresses
    .filter((wallet) => typeof wallet === "string" && wallet !== SYSTEM_PROGRAM)
    .slice(0, 3)
    .map((wallet, index) => ({
      rank: index + 1,
      wallet,
      prizeLamports: integerString(
        record.winners?.[index]?.prizeLamports ?? payouts[index] ?? "0",
      ),
    }));
}

export function resolveSettlementArchive(records) {
  const latest = new Map();
  for (const record of records) {
    if (!record || typeof record !== "object" || !record.pool || !record.roundId) continue;
    latest.set(archiveKey(record), record);
  }
  return [...latest.values()];
}

export function buildWinnerHistory(records, poolConfigs = []) {
  const configs = new Map(poolConfigs.map((pool) => [String(pool.id ?? pool.pool), pool]));
  return resolveSettlementArchive(records)
    .filter((record) => record.settled === true)
    .map((record) => {
      const pool = String(record.pool);
      const winners = normalizeWinners(record, configs.get(pool));
      const jackpotWallet = record.jackpotTriggered === true &&
        typeof record.jackpotWinner === "string" &&
        record.jackpotWinner !== SYSTEM_PROGRAM
        ? record.jackpotWinner
        : null;
      return {
        pool,
        roundId: Number(record.roundId),
        roundAddress: record.address ?? null,
        archivedAt: record.archivedAt ?? null,
        outcome: record.roundOutcome ?? (winners.length ? "settled" : "cancelled_below_minimum"),
        totalTickets: integerString(record.totalTickets),
        totalLamports: integerString(record.totalLamports),
        winners,
        jackpot: jackpotWallet ? {
          wallet: jackpotWallet,
          prizeLamports: integerString(record.jackpotPayoutLamports),
        } : null,
        settlementSignature: record.settlementSignature ?? null,
      };
    })
    .sort((left, right) =>
      right.roundId - left.roundId || left.pool.localeCompare(right.pool));
}
