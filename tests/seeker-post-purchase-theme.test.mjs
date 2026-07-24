import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { buildSync } from "esbuild";

const bundle = buildSync({
  bundle: true,
  entryPoints: ["app-seeker/src/stitchScreens.ts"],
  format: "esm",
  platform: "node",
  write: false,
}).outputFiles[0].text;
const screens = await import(`data:text/javascript;base64,${Buffer.from(bundle).toString("base64")}`);

const sharedTheme = {
  homeBackground: "data:image/png;base64,background",
  homeLogo: "data:image/png;base64,wordmark",
  homeIcons: {
    pools: "data:image/png;base64,home-pools",
  },
  navigationIcons: {
    home: "data:image/png;base64,nav-home",
    pools: "data:image/png;base64,nav-pools",
    activity: "data:image/png;base64,nav-activity",
    howTo: "data:image/png;base64,nav-how-to",
    social: "data:image/png;base64,nav-social",
  },
  poolIcons: {
    mini: "data:image/png;base64,pool-mini",
    normal: "data:image/png;base64,pool-normal",
    high: "data:image/png;base64,pool-high",
    premium: "data:image/png;base64,pool-premium",
  },
};

test("confirmed purchase uses the new pool-specific theme for every pool", () => {
  const expectedTones = {
    mini: "cyan",
    normal: "purple",
    high: "violet",
    premium: "prime",
  };

  for (const [pool, tone] of Object.entries(expectedTones)) {
    const html = screens.renderStitchScreen("success", {
      ...sharedTheme,
      selectedPool: pool,
      transaction: {
        state: "confirmed",
        message: "Ticket entry is confirmed in the round ledger.",
        signature: "US7WYc111111111111111111111111111111XyrgGy",
      },
    });

    assert.match(html, /<body class="home-themed">/);
    assert.match(html, new RegExp(`pool-process-page tone-${tone}`));
    assert.match(html, new RegExp(`data:image/png;base64,pool-${pool}`));
    assert.match(html, new RegExp(`>${pool[0].toUpperCase()}${pool.slice(1)} Pool<`));
    assert.match(html, /Entry confirmed/);
    assert.match(html, /View activity/);
    assert.match(html, /data:image\/png;base64,wordmark/);
    assert.match(html, /data:image\/png;base64,nav-activity/);
    assert.doesNotMatch(html, /Entry sent|LuckyMe<small>Solana pools/);
  }
});

test("startup mainnet sync screen stays inside the new LuckyMe theme", () => {
  const html = screens.renderStitchScreen("unavailable", sharedTheme);

  assert.match(html, /<body class="home-themed">/);
  assert.match(html, /mainnet-loading-page/);
  assert.match(html, /Preparing LuckyMe/);
  assert.match(html, /Syncing verified data/);
  assert.match(html, /data:image\/png;base64,wordmark/);
  assert.match(html, /data:image\/png;base64,nav-home/);
  assert.doesNotMatch(html, /Waiting for verified chain state|Program deploy|LuckyMe<small>Solana pools/);
});

test("notification approval keeps its branded overlay until mainnet refresh finishes", () => {
  const source = fs.readFileSync("app-seeker/src/LuckyMeScreen.tsx", "utf8");
  const start = source.indexOf("const enableNotifications = useCallback");
  const end = source.indexOf("const declineNotifications", start);
  const flow = source.slice(start, end);
  const refresh = flow.indexOf("await refreshFromBackend");
  const dismiss = flow.indexOf("setNotificationPromptVisible(false)");

  assert.ok(start >= 0 && end > start, "notification approval flow must exist");
  assert.ok(refresh >= 0, "notification approval must refresh mainnet state");
  assert.ok(dismiss > refresh, "notification overlay must close only after mainnet refresh");
});

test("Activity exposes public results from all pools without requiring a connected wallet", () => {
  const signature = "1".repeat(88);
  const livePools = ["mini", "normal", "high", "premium"].map((id, poolIndex) => ({
    id,
    recentRounds: [{
      roundId: poolIndex + 11,
      settled: id !== "high",
      roundOutcome: id === "high" ? "cancelled_below_minimum" : "settled",
      refundStatus: id === "high" ? "completed" : "none",
      totalTickets: id === "premium" ? 3 : 25,
      entrantCount: id === "premium" ? 3 : 8,
      archivedAt: `2026-07-1${poolIndex + 1}T10:00:00.000Z`,
      settlementSignature: id === "high" ? null : signature,
      winners: id === "high" ? [] : [{
        rank: 1,
        wallet: `${poolIndex + 2}`.repeat(44),
        prizeSol: id === "premium" ? 0.7 : 0.12,
      }],
    }],
  }));

  const html = screens.renderStitchScreen("activity", {
    ...sharedTheme,
    livePools,
  });

  assert.match(html, /Your entries, mission rewards and public round history/);
  assert.match(html, /data-activity-tab="missions"/);
  assert.match(html, /data-activity-tab="all-rounds"/);
  assert.match(html, />All Rounds</);
  for (const pool of ["Mini", "Normal", "High", "Premium"]) {
    assert.match(html, new RegExp(`>${pool}<`));
  }
  assert.match(html, /0\.7 SOL/);
  assert.match(html, /Automatic refund/);
  assert.match(html, new RegExp(`https://solscan\.io/tx/${signature}`));
  assert.doesNotMatch(html, /Only your entries and results/);
});
