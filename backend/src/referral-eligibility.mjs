const SYSTEM_PROGRAM = "11111111111111111111111111111111";

export const REFERRAL_QUALIFICATION_REQUIREMENTS = Object.freeze({
  winningRounds: 3,
  playDays: 3,
  activeDays: 7,
});

function utcDay(value) {
  const timestamp = typeof value === "number" ? value : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10);
}

function archiveDay(record) {
  const endTs = Number(record?.endTs ?? 0);
  if (endTs > 0) return utcDay(endTs * 1_000);
  return utcDay(record?.archivedAt);
}

function hasWinner(record) {
  if (Array.isArray(record?.winners) && record.winners.some((item) =>
    typeof item?.winner === "string" && item.winner !== SYSTEM_PROGRAM)) return true;
  return typeof record?.winner === "string" && record.winner !== SYSTEM_PROGRAM;
}

export function referralQualificationProgress({ wallet, wallets = [], settlementArchive = [], activityDates = [] } = {}) {
  const eligibleWallets = new Set(
    [wallet, ...wallets].filter((value) => typeof value === "string" && value.length > 0),
  );
  const distinctRounds = new Map();
  for (const record of settlementArchive) {
    if (
      record?.settled !== true ||
      record?.roundOutcome !== "settled" ||
      record?.refundStatus === "completed" ||
      !hasWinner(record) ||
      !Array.isArray(record?.entries) ||
      !record.entries.some((entry) => eligibleWallets.has(entry?.player))
    ) continue;
    const key = `${record.pool}:${Number(record.roundId)}`;
    if (!distinctRounds.has(key)) distinctRounds.set(key, record);
  }

  const playDays = new Set(
    [...distinctRounds.values()].map(archiveDay).filter(Boolean),
  );
  const activeDays = new Set(activityDates.map(utcDay).filter(Boolean));
  const winningRounds = distinctRounds.size;
  const eligible =
    winningRounds >= REFERRAL_QUALIFICATION_REQUIREMENTS.winningRounds &&
    playDays.size >= REFERRAL_QUALIFICATION_REQUIREMENTS.playDays &&
    activeDays.size >= REFERRAL_QUALIFICATION_REQUIREMENTS.activeDays;

  return {
    eligible,
    winningRounds,
    playDays: playDays.size,
    activeDays: activeDays.size,
    requirements: REFERRAL_QUALIFICATION_REQUIREMENTS,
  };
}
