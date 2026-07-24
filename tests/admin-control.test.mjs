import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildWinnerHistory, resolveSettlementArchive } from "../scripts/admin-winner-history.mjs";

const server = readFileSync("scripts/admin-control-server.mjs", "utf8");
const nginx = readFileSync("deploy/nginx/luckyme-admin-location.conf", "utf8");
const preview = readFileSync(
  "deploy/systemd/luckyme-settlement-keeper-preview.service",
  "utf8",
);
const monitor = readFileSync("scripts/operations-monitor.mjs", "utf8");
const adminHtml = readFileSync("site/lucky-me.app/admin/index.html", "utf8");
const adminJs = readFileSync("site/lucky-me.app/admin/admin.js", "utf8");
const referralSnapshot = readFileSync("scripts/admin-referral-snapshot.mjs", "utf8");

test("admin control API trusts only the protected local Nginx proxy", () => {
  assert.match(server, /x-luckyme-admin-proxy/);
  assert.match(server, /trusted_proxy_required/);
  assert.match(nginx, /auth_basic_user_file \/etc\/nginx\/luckyme-admin\.htpasswd/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:8791\//);
  assert.match(nginx, /X-LuckyMe-Admin-Proxy 1/);
});

test("admin actions are fixed, confirmed, nonce-protected systemd operations", () => {
  assert.match(server, /const ACTIONS = Object\.freeze/);
  assert.match(server, /unknown_action/);
  assert.match(server, /stale_nonce/);
  assert.match(server, /confirmation_mismatch/);
  assert.match(server, /execFileAsync/);
  assert.doesNotMatch(server, /\bexec\s*\(/);
});

test("admin settlement preview cannot write mainnet transactions", () => {
  assert.match(preview, /Environment=DRY_RUN=true/);
  assert.match(preview, /Environment=CONFIRM_MAINNET_SETTLEMENT_KEEPER=false/);
  assert.match(preview, /Environment=SETTLEMENT_KEEPER_MAX_ACTIONS=1/);
});

test("winner archive resolves a later append-only correction for the same round", () => {
  const base = {
    genesisHash: "mainnet",
    programId: "program",
    poolAddress: "pool",
    address: "round",
    pool: "mini",
    roundId: 7,
    settled: true,
    totalTickets: "32",
    totalLamports: "160000000",
  };
  const corrected = {
    ...base,
    accountDataHash: "confirmed",
    winnerCount: 1,
    winner: "winner-wallet",
    winners: [{ rank: 1, winner: "winner-wallet", prizeLamports: "152000000" }],
    prizePayouts: ["152000000"],
  };
  const resolved = resolveSettlementArchive([
    { ...base, accountDataHash: "stale", winnerCount: 0, winners: [] },
    corrected,
  ]);
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].accountDataHash, "confirmed");
  assert.deepEqual(buildWinnerHistory(resolved)[0].winners, [
    { rank: 1, wallet: "winner-wallet", prizeLamports: "152000000" },
  ]);
});

test("winner archive derives exact Premium payouts for legacy records", () => {
  const history = buildWinnerHistory([{
    genesisHash: "mainnet",
    programId: "program",
    poolAddress: "premium-pool",
    address: "premium-round",
    pool: "premium",
    roundId: 6,
    settled: true,
    totalTickets: "10",
    totalLamports: "1000000000",
    winnerCount: 3,
    winner: "winner-1",
    winnerSecond: "winner-2",
    winnerThird: "winner-3",
    houseFeeBps: 200,
    jackpotBps: 300,
  }], [{ id: "premium", prizeSplitBps: [7000, 2000, 1000] }]);
  assert.deepEqual(history[0].winners.map((winner) => winner.prizeLamports), [
    "665000000",
    "190000000",
    "95000000",
  ]);
});

test("protected Admin exposes read-only pool and round winner filters", () => {
  assert.match(monitor, /buildWinnerHistory/);
  assert.match(monitor, /readSettlementArchive/);
  assert.match(adminHtml, /id="history-pool"/);
  assert.match(adminHtml, /id="history-round"/);
  assert.match(adminHtml, /Winner archive/);
});

test("protected Admin separates operations, downloads, and promotions", () => {
  for (const tab of ["status", "treasury", "winners", "referrals", "downloads", "promotions"]) {
    assert.match(adminHtml, new RegExp(`data-admin-tab="${tab}"`));
    assert.match(adminHtml, new RegExp(`data-admin-panel="${tab}"`));
  }
  assert.match(adminHtml, /id="referral-status"/);
  assert.match(adminHtml, /id="referral-search"/);
  assert.match(adminJs, /renderReferrals/);
  assert.match(adminJs, /renderPromotions/);
  assert.match(adminHtml, /unique LuckyMe app activations/i);
  assert.match(adminHtml, /Launch a promotion/);
  assert.match(adminHtml, /id="promotion-entry-cost"/);
  assert.match(adminHtml, /id="promotion-capacity"/);
  assert.match(adminHtml, /value="SKR"/);
  assert.match(adminHtml, /No time limit — draw at capacity/);
  assert.match(adminJs, /\/admin\/api\/promotions\//);
  assert.match(adminJs, /FINAL MAINNET REVIEW/);
  assert.match(adminJs, /signedTransactionBase64/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:8793\//);
  assert.match(adminJs, /Completed rounds/);
  assert.match(referralSnapshot, /referrer_wallet/);
  assert.match(referralSnapshot, /referred_wallet/);
  assert.match(referralSnapshot, /referralQualificationProgress/);
  assert.match(referralSnapshot, /readPromotions/);
  assert.match(referralSnapshot, /promotion_winners/);
  assert.doesNotMatch(referralSnapshot, /sendTransaction|signTransaction/);
});

test("mission creation keeps the form reference across the async request", () => {
  assert.match(adminJs, /const formElement = event\.currentTarget;/);
  assert.match(adminJs, /formElement\.reset\(\);/);
  assert.doesNotMatch(adminJs, /event\.currentTarget\.reset\(\);/);
});

test("mission Admin exposes X action intents and closed-task deletion", () => {
  for (const action of ["like", "follow", "repost", "comment"]) {
    assert.match(adminHtml, new RegExp(`<option value="${action}">`, "i"));
  }
  assert.match(adminHtml, /name="targetUrl"/);
  assert.match(adminJs, /data-platform-task-close/);
  assert.match(adminJs, /data-platform-task-delete/);
  assert.match(adminJs, /platform\/tasks\/\$\{encodeURIComponent\(taskId\)\}\/delete/);
});
