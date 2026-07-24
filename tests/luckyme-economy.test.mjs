import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  ECONOMY_VERSION,
  MIN_RELIABLE_AUDIENCE,
  calculatePromotionEconomy,
  levelState,
  missionRewardPreset,
  totalXpForLevel,
} from "../backend/src/luckyme-economy.mjs";
import {
  WRAPPED_SOL_MINT,
  createPromotionPriceService,
} from "../backend/src/promotion-price-service.mjs";
import {
  OFFICIAL_SKR_MINT,
  createPromotionalPoolsService,
} from "../backend/src/promotional-pools-service.mjs";
import { createLuckyMePlatformService } from "../backend/src/luckyme-platform-service.mjs";

function fixture() {
  let now = Date.parse("2026-07-23T12:00:00.000Z");
  const clock = () => now++;
  const points = createPromotionalPoolsService({ dbPath: ":memory:", clock, chain: {} });
  const platform = createLuckyMePlatformService({ db: points.db, pointsService: points, clock });
  return { points, platform, clock };
}

test("XP levels become progressively harder and stop at level 100", () => {
  assert.equal(levelState(0).level, 1);
  assert.equal(levelState(totalXpForLevel(10)).level, 10);
  assert.ok(totalXpForLevel(20) - totalXpForLevel(10) > totalXpForLevel(10));
  assert.equal(levelState(Number.MAX_SAFE_INTEGER).level, 100);
  assert.equal(levelState(Number.MAX_SAFE_INTEGER).progressPercent, 100);
});

test("mission rewards are fixed by action and gameplay requirement", () => {
  assert.deepEqual(
    missionRewardPreset({ platform: "x", xAction: "like" }),
    { points: 5, xp: 10, presetKey: "x_like", label: "Fixed LIKE reward" },
  );
  const gameplay = missionRewardPreset({
    platform: "community",
    gameplayPoolType: "mini",
    gameplayRequiredCount: 5,
  });
  assert.equal(gameplay.points, 10);
  assert.equal(gameplay.xp, 40);
});

test("promotion calculator derives live USD value, participants and LP cost", () => {
  const result = calculatePromotionEconomy({
    prizeAsset: "SKR",
    prizeAmount: 500,
    usdPrice: 0.04,
    priceSource: "test",
    priceFetchedAt: "2026-07-23T12:00:00.000Z",
  });
  assert.equal(result.calculatorVersion, ECONOMY_VERSION);
  assert.equal(result.prizeUsd, 20);
  assert.equal(result.requiredLpBurn, 9600);
  assert.equal(result.recommendedCapacity, 96);
  assert.equal(result.recommendedEntryCostPoints, 100);
  assert.match(result.terminal.join("\n"), /Valid draw threshold: 96\/96/);
});

test("promotion terminal reports the same warning status as the calculator", () => {
  const result = calculatePromotionEconomy({
    prizeAsset: "SKR",
    prizeAmount: 500,
    usdPrice: 0.008195545628236524,
    priceSource: "test",
    priceFetchedAt: "2026-07-23T12:00:00.000Z",
  });
  assert.equal(result.economicStatus, "warning");
  assert.match(result.terminal.join("\n"), /Coverage target: 120\.0% of prize market value/);
  assert.match(result.terminal.join("\n"), /House safety buffer: 20\.0% above prize value/);
  assert.match(result.terminal.join("\n"), /Economic status: WARNING/);
  assert.doesNotMatch(result.terminal.join("\n"), /Economic status: SAFE/);
});

test("small live audiences are ignored while reliable audiences affect capacity", () => {
  const base = {
    prizeAsset: "SOL",
    prizeAmount: 1,
    usdPrice: 100,
    priceSource: "test",
    priceFetchedAt: "2026-07-23T12:00:00.000Z",
    useLiveAudience: true,
  };
  const insufficient = calculatePromotionEconomy({
    ...base,
    eligibleActiveUsers: MIN_RELIABLE_AUDIENCE - 1,
  });
  assert.equal(insufficient.audienceReliable, false);
  assert.match(insufficient.audienceReason, /Insufficient reliable audience sample/);
  const reliable = calculatePromotionEconomy({
    ...base,
    eligibleActiveUsers: 1_000,
    historicalConversionRate: 0.2,
  });
  assert.equal(reliable.audienceReliable, true);
  assert.equal(reliable.recommendedCapacity, 160);
});

test("Jupiter price service maps SOL and official SKR and marks old cache stale", async () => {
  let now = Date.parse("2026-07-23T12:00:00.000Z");
  let fail = false;
  const service = createPromotionPriceService({
    clock: () => now,
    cacheMs: 0,
    maxAgeMs: 1_000,
    fetchImpl: async () => {
      if (fail) throw new Error("offline");
      return {
        ok: true,
        json: async () => ({
          [WRAPPED_SOL_MINT]: { usdPrice: 150, blockId: 1, decimals: 9 },
          [OFFICIAL_SKR_MINT]: { usdPrice: 0.04, blockId: 2, decimals: 6 },
        }),
      };
    },
  });
  assert.equal((await service.quote("SKR")).usdPrice, 0.04);
  fail = true;
  now += 2_000;
  const stale = await service.quote("SKR", { force: true });
  assert.equal(stale.stale, true);
  assert.match(stale.fallbackReason, /offline/);
});

test("valid pool events reward once and gameplay tasks ignore older rounds", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  platform.profile(wallet);
  platform.recordValidPoolParticipation({ wallet, poolType: "mini", roundId: 1 });
  const task = platform.createTask({
    actor: "admin-test",
    title: "Play two new Mini pools",
    description: "Participate in two valid Mini pool settlements after this mission starts.",
    platform: "community",
    gameplayPoolType: "mini",
    gameplayRequiredCount: 2,
  });
  platform.recordValidPoolParticipation({ wallet, poolType: "mini", roundId: 2 });
  let state = platform.listTasks(wallet).find((entry) => entry.id === task.id);
  assert.equal(state.progress.count, 1);
  assert.equal(state.submission, null);
  platform.recordValidPoolParticipation({ wallet, poolType: "mini", roundId: 3 });
  state = platform.listTasks(wallet).find((entry) => entry.id === task.id);
  assert.equal(state.progress.status, "rewarded");
  assert.equal(state.submission.status, "approved");
  const beforeReplay = platform.profile(wallet);
  const replay = platform.recordValidPoolParticipation({ wallet, poolType: "mini", roundId: 3 });
  assert.equal(replay.replayed, true);
  assert.equal(replay.profile.luckyPoints, beforeReplay.luckyPoints);
  assert.equal(replay.profile.xp.total, beforeReplay.xp.total);
});

test("five-pool mission completes in simulation and the next mission starts from zero", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  platform.profile(wallet);
  const firstTask = platform.createTask({
    actor: "admin-simulation",
    title: "Play five Mini pools",
    description: "Simulation of five valid Mini pool settlements.",
    platform: "community",
    gameplayPoolType: "mini",
    gameplayRequiredCount: 5,
  });

  for (let roundId = 101; roundId <= 105; roundId += 1) {
    platform.recordValidPoolParticipation({ wallet, poolType: "mini", roundId });
    const progress = platform.listTasks(wallet).find((entry) => entry.id === firstTask.id);
    assert.equal(progress.progress.count, roundId - 100);
  }

  const completed = platform.listTasks(wallet).find((entry) => entry.id === firstTask.id);
  assert.equal(completed.progress.status, "rewarded");
  assert.equal(completed.submission.status, "approved");
  assert.equal(platform.profile(wallet).luckyPoints, 20);
  assert.equal(platform.profile(wallet).xp.total, 80);

  const secondTask = platform.createTask({
    actor: "admin-simulation",
    title: "Play three new Mini pools",
    description: "Only rounds settled after this second mission starts may count.",
    platform: "community",
    gameplayPoolType: "mini",
    gameplayRequiredCount: 3,
  });
  const initialSecondState = platform.listTasks(wallet).find((entry) => entry.id === secondTask.id);
  assert.equal(initialSecondState.progress, null);

  const replay = platform.recordValidPoolParticipation({ wallet, poolType: "mini", roundId: 105 });
  assert.equal(replay.replayed, true);
  assert.equal(platform.listTasks(wallet).find((entry) => entry.id === secondTask.id).progress, null);

  platform.recordValidPoolParticipation({ wallet, poolType: "mini", roundId: 106 });
  const nextRoundState = platform.listTasks(wallet).find((entry) => entry.id === secondTask.id);
  assert.equal(nextRoundState.progress.count, 1);
  assert.equal(nextRoundState.submission, null);
});

test("settlement archive sync rewards only wallets in valid settled pool rounds", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  const otherWallet = Keypair.generate().publicKey.toBase58();
  platform.profile(wallet);
  const directory = mkdtempSync(join(tmpdir(), "luckyme-settlements-"));
  const archivePath = join(directory, "settlements.jsonl");
  writeFileSync(archivePath, [
    JSON.stringify({
      pool: "mini",
      roundId: 42,
      settled: true,
      roundOutcome: "settled",
      settlementSignature: "settlement-signature",
      archivedAt: "2026-07-23T12:00:00.000Z",
      entries: [{ player: wallet, ticketCount: "1" }],
    }),
    JSON.stringify({
      pool: "normal",
      roundId: 43,
      settled: true,
      roundOutcome: "cancelled_below_minimum",
      entries: [{ player: wallet, ticketCount: "1" }],
    }),
    JSON.stringify({
      pool: "high",
      roundId: 44,
      settled: true,
      roundOutcome: "settled",
      entries: [{ player: otherWallet, ticketCount: "1" }],
    }),
  ].join("\n") + "\n");
  const first = platform.syncValidPoolParticipations(wallet, archivePath);
  assert.deepEqual(first, { scanned: 3, matched: 1, recorded: 1 });
  assert.equal(platform.profile(wallet).luckyPoints, 2);
  assert.equal(platform.profile(wallet).xp.total, 8);
  const replay = platform.syncValidPoolParticipations(wallet, archivePath);
  assert.deepEqual(replay, { scanned: 3, matched: 1, recorded: 0 });
});

test("approved avatars enforce level and LP cost before selection", () => {
  const { points, platform, clock } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  platform.profile(wallet);
  const timestamp = new Date(clock()).toISOString();
  points.db.prepare(`
    INSERT INTO luckyme_avatar_catalog
      (id, name, asset_key, min_level, price_points, rank_key, status, sort_order, created_at, updated_at)
    VALUES ('avatar-approved-1', 'Approved Test Avatar', 'approved/test-avatar', 1, 20, 'junior', 'active', 1, ?, ?)
  `).run(timestamp, timestamp);
  points.creditPoints({
    wallet,
    amount: 25,
    idempotencyKey: "avatar-test-credit",
  });
  const acquired = platform.acquireAvatar({ wallet, avatarId: "avatar-approved-1" });
  assert.equal(acquired.profile.avatar.id, "avatar-approved-1");
  assert.equal(acquired.profile.availablePoints, 5);
  assert.equal(acquired.profile.avatars.find((avatar) => avatar.id === "avatar-approved-1").owned, true);
  const replay = platform.acquireAvatar({ wallet, avatarId: "avatar-approved-1" });
  assert.equal(replay.replayed, true);
  assert.equal(replay.profile.availablePoints, 5);
  assert.equal(platform.selectAvatar({ wallet, avatarId: "avatar-approved-1" }).avatar.id, "avatar-approved-1");
});

test("Fortune Explorer unlocks at level 10, costs exactly 60 LP, and never charges twice", () => {
  const { points, platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  const starter = platform.profile(wallet);
  assert.equal(starter.xp.level, 1);
  assert.equal(starter.avatar.id, "avatar-clover-scout");

  assert.throws(
    () => platform.acquireAvatar({ wallet, avatarId: "avatar-fortune-explorer" }),
    (error) => error.code === "avatar_level_locked",
  );

  points.db.prepare("UPDATE luckyme_users SET xp_total = ? WHERE wallet = ?")
    .run(totalXpForLevel(10), wallet);
  assert.equal(platform.profile(wallet).xp.level, 10);
  assert.throws(
    () => platform.acquireAvatar({ wallet, avatarId: "avatar-fortune-explorer" }),
    (error) => error.code === "insufficient_lucky_points",
  );

  points.creditPoints({
    wallet,
    amount: 60,
    idempotencyKey: "fortune-explorer-test-credit",
  });
  const acquired = platform.acquireAvatar({
    wallet,
    avatarId: "avatar-fortune-explorer",
  });
  assert.equal(acquired.replayed, false);
  assert.equal(acquired.profile.avatar.id, "avatar-fortune-explorer");
  assert.equal(acquired.profile.availablePoints, 0);

  const starterSelected = platform.selectAvatar({
    wallet,
    avatarId: "avatar-clover-scout",
  });
  assert.equal(starterSelected.avatar.id, "avatar-clover-scout");
  assert.equal(starterSelected.availablePoints, 0);
  const premiumSelectedAgain = platform.selectAvatar({
    wallet,
    avatarId: "avatar-fortune-explorer",
  });
  assert.equal(premiumSelectedAgain.avatar.id, "avatar-fortune-explorer");
  assert.equal(premiumSelectedAgain.availablePoints, 0);

  const replay = platform.acquireAvatar({
    wallet,
    avatarId: "avatar-fortune-explorer",
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.profile.availablePoints, 0);
});

test("profile seeds the progressive LuckyMe avatar collection and starter frame", () => {
  const { platform } = fixture();
  const wallet = Keypair.generate().publicKey.toBase58();
  const profile = platform.profile(wallet);
  assert.equal(profile.avatars.length, 9);
  assert.equal(profile.avatar.id, "avatar-clover-scout");
  assert.equal(profile.avatar.assetKey, "avatars/clover-scout");
  assert.equal(profile.avatars[0].owned, true);
  assert.equal(profile.xp.rankTitle, "Junior");
  assert.equal(profile.xp.frameTitle, "Bronze Clover");
  assert.equal(profile.avatars.at(-1).id, "avatar-luckyme-icon");
  assert.equal(profile.avatars.at(-1).minLevel, 100);
  assert.equal(profile.avatars.at(-1).pricePoints, 5_000);
});
