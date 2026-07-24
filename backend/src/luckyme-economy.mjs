export const ECONOMY_VERSION = "luckyme-economy-v1";
export const MAX_LEVEL = 100;
export const MIN_RELIABLE_AUDIENCE = 50;
export const LP_ACCOUNTING_VALUE_USD = 0.0025;

export const RANKS = Object.freeze([
  { key: "junior", title: "Junior", frameTitle: "Bronze Clover", minLevel: 1, maxLevel: 9 },
  { key: "explorer", title: "Explorer", frameTitle: "Silver Orbit", minLevel: 10, maxLevel: 19 },
  { key: "challenger", title: "Challenger", frameTitle: "Emerald Circuit", minLevel: 20, maxLevel: 34 },
  { key: "vanguard", title: "Vanguard", frameTitle: "Vanguard Sapphire", minLevel: 35, maxLevel: 49 },
  { key: "elite", title: "Elite", frameTitle: "Royal Amethyst", minLevel: 50, maxLevel: 64 },
  { key: "master", title: "Master", frameTitle: "Master Gold", minLevel: 65, maxLevel: 79 },
  { key: "legend", title: "Legend", frameTitle: "Legendary Flame", minLevel: 80, maxLevel: 89 },
  { key: "mythic", title: "Mythic", frameTitle: "Mythic Prism", minLevel: 90, maxLevel: 99 },
  { key: "luckyme_icon", title: "LuckyMe Icon", frameTitle: "Crowned Icon", minLevel: 100, maxLevel: 100 },
]);

export const AVATAR_CATALOG = Object.freeze([
  { id: "avatar-clover-scout", name: "Clover Scout", assetKey: "avatars/clover-scout", minLevel: 1, pricePoints: 0, rankKey: "junior" },
  { id: "avatar-fortune-explorer", name: "Fortune Explorer", assetKey: "avatars/fortune-explorer", minLevel: 10, pricePoints: 60, rankKey: "explorer" },
  { id: "avatar-emerald-challenger", name: "Emerald Challenger", assetKey: "avatars/emerald-challenger", minLevel: 20, pricePoints: 150, rankKey: "challenger" },
  { id: "avatar-vanguard-keeper", name: "Vanguard Keeper", assetKey: "avatars/vanguard-keeper", minLevel: 35, pricePoints: 350, rankKey: "vanguard" },
  { id: "avatar-royal-elite", name: "Royal Elite", assetKey: "avatars/royal-elite", minLevel: 50, pricePoints: 700, rankKey: "elite" },
  { id: "avatar-fortune-master", name: "Fortune Master", assetKey: "avatars/fortune-master", minLevel: 65, pricePoints: 1_200, rankKey: "master" },
  { id: "avatar-clover-legend", name: "Clover Legend", assetKey: "avatars/clover-legend", minLevel: 80, pricePoints: 2_000, rankKey: "legend" },
  { id: "avatar-mythic-oracle", name: "Mythic Oracle", assetKey: "avatars/mythic-oracle", minLevel: 90, pricePoints: 3_200, rankKey: "mythic" },
  { id: "avatar-luckyme-icon", name: "LuckyMe Icon", assetKey: "avatars/luckyme-icon", minLevel: 100, pricePoints: 5_000, rankKey: "luckyme_icon" },
]);

export const POOL_PARTICIPATION_REWARDS = Object.freeze({
  mini: { points: 2, xp: 8 },
  normal: { points: 5, xp: 18 },
  high: { points: 12, xp: 40 },
  premium: { points: 25, xp: 80 },
});

const X_REWARDS = Object.freeze({
  like: { points: 5, xp: 10, presetKey: "x_like" },
  follow: { points: 8, xp: 16, presetKey: "x_follow" },
  repost: { points: 10, xp: 20, presetKey: "x_repost" },
  comment: { points: 12, xp: 24, presetKey: "x_comment" },
});

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function roundUp(value, step = 1) {
  return Math.ceil(value / step) * step;
}

export function xpForNextLevel(level) {
  const current = clampInteger(level, 1, MAX_LEVEL);
  if (current >= MAX_LEVEL) return 0;
  const offset = current - 1;
  return 100 + (30 * offset) + (8 * offset * offset);
}

export function totalXpForLevel(level) {
  const target = clampInteger(level, 1, MAX_LEVEL);
  let total = 0;
  for (let current = 1; current < target; current += 1) total += xpForNextLevel(current);
  return total;
}

export function levelState(totalXp) {
  const xp = Math.max(0, Math.floor(Number(totalXp) || 0));
  let level = 1;
  while (level < MAX_LEVEL && xp >= totalXpForLevel(level + 1)) level += 1;
  const levelFloor = totalXpForLevel(level);
  const nextCost = xpForNextLevel(level);
  const progressXp = xp - levelFloor;
  const rank = RANKS.find((entry) => level >= entry.minLevel && level <= entry.maxLevel) ?? RANKS[0];
  return {
    totalXp: xp,
    level,
    rankKey: rank.key,
    rankTitle: rank.title,
    frameTitle: rank.frameTitle,
    progressXp,
    nextLevelXp: nextCost,
    progressPercent: level >= MAX_LEVEL ? 100 : Math.min(100, Math.floor((progressXp / nextCost) * 100)),
  };
}

export function missionRewardPreset({
  platform,
  xAction,
  gameplayPoolType,
  gameplayRequiredCount = 1,
} = {}) {
  const normalizedPlatform = String(platform ?? "").toLowerCase();
  if (normalizedPlatform === "x") {
    const reward = X_REWARDS[String(xAction ?? "").toLowerCase()];
    if (!reward) throw new Error("Unsupported X reward preset");
    return { ...reward, label: `Fixed ${String(xAction).toUpperCase()} reward` };
  }
  if (normalizedPlatform === "discord") {
    return { points: 5, xp: 20, presetKey: "discord_join", label: "Fixed Discord membership reward" };
  }
  if (gameplayPoolType) {
    const pool = String(gameplayPoolType).toLowerCase();
    const count = clampInteger(gameplayRequiredCount, 1, 100);
    const unit = pool === "any"
      ? { points: 4, xp: 15 }
      : POOL_PARTICIPATION_REWARDS[pool];
    if (!unit) throw new Error("Unsupported gameplay pool reward preset");
    return {
      points: Math.min(1_000, unit.points * count),
      xp: Math.min(5_000, unit.xp * count),
      presetKey: `gameplay_${pool}`,
      label: `Fixed ${count} valid ${pool} pool${count === 1 ? "" : "s"} reward`,
    };
  }
  return { points: 5, xp: 10, presetKey: "community_manual", label: "Fixed community reward" };
}

function targetEntryPoints(prizeUsd) {
  if (prizeUsd <= 25) return 100;
  if (prizeUsd <= 100) return 250;
  if (prizeUsd <= 500) return 500;
  return 1_000;
}

export function calculatePromotionEconomy({
  prizeAsset,
  prizeAmount,
  usdPrice,
  priceSource,
  priceFetchedAt,
  priceBlockId = null,
  mode = "standard",
  useLiveAudience = false,
  eligibleActiveUsers = 0,
  historicalConversionRate = 0.25,
  requestedCapacity,
  requestedEntryCostPoints,
  minLevel = 1,
  maxLevel = MAX_LEVEL,
} = {}) {
  const asset = String(prizeAsset ?? "").toUpperCase();
  if (!["SOL", "SKR"].includes(asset)) throw new Error("Prize asset must be SOL or SKR");
  const amount = Number(prizeAmount);
  const price = Number(usdPrice);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Prize amount must be positive");
  if (!Number.isFinite(price) || price <= 0) throw new Error("A fresh positive USD price is required");
  const normalizedMode = mode === "ultra" ? "ultra" : "standard";
  const bufferBps = normalizedMode === "ultra" ? 10_000 : 12_000;
  const prizeUsd = amount * price;
  const adjustedBudgetUsd = prizeUsd * bufferBps / 10_000;
  const requiredLpBurn = Math.max(1, Math.ceil(adjustedBudgetUsd / LP_ACCOUNTING_VALUE_USD));
  const audienceCount = clampInteger(eligibleActiveUsers, 0, 100_000_000);
  const audienceReliable = useLiveAudience && audienceCount >= MIN_RELIABLE_AUDIENCE;
  const conversionRate = Math.min(1, Math.max(0.01, Number(historicalConversionRate) || 0.25));
  const audienceCapacity = audienceReliable
    ? Math.max(2, Math.floor(audienceCount * conversionRate * 0.8))
    : null;
  const baselineCapacity = clampInteger(
    Math.ceil(requiredLpBurn / targetEntryPoints(prizeUsd)),
    20,
    10_000,
  );
  const recommendedCapacity = clampInteger(audienceCapacity ?? baselineCapacity, 2, 10_000);
  const recommendedEntryCostPoints = roundUp(requiredLpBurn / recommendedCapacity, 5);
  const capacity = requestedCapacity == null
    ? recommendedCapacity
    : clampInteger(requestedCapacity, 2, 10_000);
  const entryCostPoints = requestedEntryCostPoints == null
    ? roundUp(requiredLpBurn / capacity, 5)
    : clampInteger(requestedEntryCostPoints, 1, 1_000_000);
  const totalLpAtCapacity = capacity * entryCostPoints;
  const coverageRatio = totalLpAtCapacity / requiredLpBurn;
  const intentionalSubsidy = totalLpAtCapacity < requiredLpBurn;
  const houseSubsidyUsd = intentionalSubsidy
    ? (requiredLpBurn - totalLpAtCapacity) * LP_ACCOUNTING_VALUE_USD
    : 0;
  const audienceReason = !useLiveAudience
    ? "Live audience OFF — Premium economic baseline used."
    : audienceReliable
      ? `${audienceCount} eligible active users × ${(conversionRate * 100).toFixed(1)}% historical conversion × 80% fill confidence.`
      : `Insufficient reliable audience sample (${audienceCount}/${MIN_RELIABLE_AUDIENCE}) — Premium economic baseline used.`;
  const snapshot = {
    calculatorVersion: ECONOMY_VERSION,
    mode: normalizedMode,
    prizeAsset: asset,
    prizeAmount: amount,
    usdPrice: price,
    priceSource: String(priceSource ?? "unknown"),
    priceFetchedAt: String(priceFetchedAt ?? new Date().toISOString()),
    priceBlockId: priceBlockId == null ? null : Number(priceBlockId),
    prizeUsd,
    bufferBps,
    adjustedBudgetUsd,
    lpAccountingValueUsd: LP_ACCOUNTING_VALUE_USD,
    requiredLpBurn,
    useLiveAudience: Boolean(useLiveAudience),
    audienceReliable,
    eligibleActiveUsers: audienceCount,
    historicalConversionRate: conversionRate,
    minimumReliableAudience: MIN_RELIABLE_AUDIENCE,
    audienceReason,
    recommendedCapacity,
    recommendedEntryCostPoints,
    capacity,
    entryCostPoints,
    totalLpAtCapacity,
    coverageRatio,
    intentionalSubsidy,
    houseSubsidyUsd,
    minLevel: clampInteger(minLevel, 1, MAX_LEVEL),
    maxLevel: clampInteger(maxLevel, 1, MAX_LEVEL),
  };
  if (snapshot.minLevel > snapshot.maxLevel) throw new Error("Minimum level cannot exceed maximum level");
  return {
    ...snapshot,
    economicStatus: intentionalSubsidy ? "intentional_subsidy" : coverageRatio < 1.05 ? "warning" : "safe",
    terminal: promotionEconomyTerminal(snapshot),
  };
}

export function promotionEconomyTerminal(snapshot) {
  const money = (value) => `$${Number(value).toFixed(2)}`;
  const percent = (value) => `${(Number(value) * 100).toFixed(1)}%`;
  const coverageTarget = Number(snapshot.bufferBps) / 10_000;
  const safetyBuffer = Math.max(0, coverageTarget - 1);
  return [
    `LUCKYME PROMOTION ECONOMY ENGINE · ${snapshot.calculatorVersion}`,
    `Prize selected: ${snapshot.prizeAmount} ${snapshot.prizeAsset}`,
    `Live ${snapshot.prizeAsset}/USD: $${Number(snapshot.usdPrice).toFixed(8)}`,
    `Prize market value: ${money(snapshot.prizeUsd)}`,
    `Price source: ${snapshot.priceSource} · ${snapshot.priceFetchedAt}`,
    `Economic mode: ${String(snapshot.mode).toUpperCase()}`,
    `Coverage target: ${percent(coverageTarget)} of prize market value`,
    `House safety buffer: ${percent(safetyBuffer)} above prize value`,
    `Adjusted promotion budget: ${money(snapshot.adjustedBudgetUsd)}`,
    `LP accounting value: $${Number(snapshot.lpAccountingValueUsd).toFixed(4)} / LP`,
    `Required LP burn: ${snapshot.requiredLpBurn} LP`,
    `Audience: ${snapshot.audienceReason}`,
    `Recommended participants: ${snapshot.recommendedCapacity}`,
    `Recommended LP per entry: ${snapshot.recommendedEntryCostPoints} LP`,
    `Selected participants: ${snapshot.capacity}`,
    `Selected LP per entry: ${snapshot.entryCostPoints} LP`,
    `Valid draw threshold: ${snapshot.capacity}/${snapshot.capacity}`,
    `Total LP burned at capacity: ${snapshot.totalLpAtCapacity} LP`,
    `Economic coverage: ${percent(snapshot.coverageRatio)}`,
    snapshot.intentionalSubsidy
      ? `Economic status: INTENTIONAL SUBSIDY · House contribution ${money(snapshot.houseSubsidyUsd)}`
      : Number(snapshot.coverageRatio) < 1.05
        ? "Economic status: WARNING · Coverage margin is below 5%."
        : "Economic status: SAFE",
    "LP is an internal utility unit, not real House revenue.",
  ];
}
