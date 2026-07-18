import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "artifacts", "home-redesign-preview");
const modulePath = path.join(outputDir, "stitch-preview.mjs");
mkdirSync(outputDir, { recursive: true });

execFileSync(path.join(root, "node_modules", ".bin", "esbuild"), [
  path.join(root, "app-seeker", "src", "stitchScreens.ts"),
  "--bundle",
  "--platform=node",
  "--format=esm",
  `--outfile=${modulePath}`,
], { stdio: "inherit" });

const {
  renderNftHoldersPreview,
  renderReferralLeaguePreview,
  renderStitchScreen,
  renderWalletAuthPreview,
} = await import(`${pathToFileURL(modulePath).href}?t=${Date.now()}`);
const response = await fetch("https://api.lucky-me.app/pools");
if (!response.ok) throw new Error(`LuckyMe pools request failed: ${response.status}`);
const payload = await response.json();
const livePools = Array.isArray(payload.pools) ? payload.pools : [];
const seekerPassResponse = await fetch("https://api.lucky-me.app/api/seeker-pass/status");
if (!seekerPassResponse.ok) throw new Error(`LuckyMe Seeker Pass request failed: ${seekerPassResponse.status}`);
const seekerPassCampaign = await seekerPassResponse.json();
const parkingDir = "/Users/victor/Desktop/PARKING";
const pngDataUri = (name) => `data:image/png;base64,${readFileSync(path.join(parkingDir, name)).toString("base64")}`;
const projectPngDataUri = (relativePath) => `data:image/png;base64,${readFileSync(path.join(root, relativePath)).toString("base64")}`;
const options = {
  activeTab: "home",
  livePools,
  seekerPassCampaign,
  onchainAvailable: true,
  homeBackground: projectPngDataUri("app-seeker/assets/home/luckyme-home-background-v2.png"),
  homeLogo: projectPngDataUri("app-seeker/assets/home/luckyme-wordmark-v2.png"),
  homeIcons: {
    pools: projectPngDataUri("app-seeker/assets/home/pools-rocket-v1.png"),
    referral: projectPngDataUri("app-seeker/assets/home/referral-handshake-v1.png"),
    nft: projectPngDataUri("app-seeker/assets/home/nft-medallion-v1.png"),
    winners: projectPngDataUri("app-seeker/assets/home/winner-trophy-v1.png"),
  },
  navigationIcons: {
    home: projectPngDataUri("app-seeker/assets/navigation/home-v1.png"),
    pools: projectPngDataUri("app-seeker/assets/navigation/pools-v1.png"),
    activity: projectPngDataUri("app-seeker/assets/navigation/activity-v1.png"),
    howTo: projectPngDataUri("app-seeker/assets/navigation/how-to-v1.png"),
    social: projectPngDataUri("app-seeker/assets/navigation/social-v1.png"),
  },
  socialIcons: {
    x: projectPngDataUri("app-seeker/assets/social/x-v2.png"),
    discord: projectPngDataUri("app-seeker/assets/social/discord-v2.png"),
    website: projectPngDataUri("app-seeker/assets/social/website-card-v2.png"),
    support: projectPngDataUri("app-seeker/assets/social/support-v2.png"),
  },
  poolIcons: {
    mini: projectPngDataUri("app-seeker/assets/pools/mini-watermark-v1.png"),
    normal: projectPngDataUri("app-seeker/assets/pools/normal-watermark-v1.png"),
    high: projectPngDataUri("app-seeker/assets/pools/high-watermark-v1.png"),
    premium: projectPngDataUri("app-seeker/assets/pools/premium-watermark-v1.png"),
  },
};

const seekerFrameHtml = (label, source) => String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LuckyMe · ${label}</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #090d0c; color: #f7faf8; font-family: Inter, system-ui, sans-serif; }
    body { display: grid; justify-items: center; gap: 14px; padding: 18px; }
    .label { margin: 0; color: #a9bbb2; font-size: 13px; font-weight: 750; letter-spacing: .04em; }
    .device { width: 412px; height: 915px; max-width: calc(100vw - 24px); overflow: hidden; border: 2px solid #43544c; border-radius: 28px; background: #031b14; box-shadow: 0 24px 70px rgba(0,0,0,.62), 0 0 30px rgba(112,255,81,.16); }
    iframe { display: block; width: 412px; height: 915px; border: 0; background: #031b14; }
    @media (max-width: 435px) {
      body { padding: 0; display: block; }
      .label { display: none; }
      .device { width: 100vw; height: 100vh; max-width: none; border: 0; border-radius: 0; }
      iframe { width: 100vw; height: 100vh; }
    }
  </style>
</head>
<body>
  <p class="label">${label} · 412 × 915</p>
  <div class="device"><iframe src="${source}" title="${label}"></iframe></div>
</body>
</html>`;

const prototypeRouteScript = String.raw`<script>
(() => {
  const destinations = {
    home: "interactive-home.html",
    pools: "interactive-pools.html",
    activity: "interactive-activity.html",
    "how-to-play": "interactive-how-to.html",
    social: "interactive-social.html",
    "latest-winners": "interactive-winners.html",
    wallet: "interactive-wallet.html",
    referral: "interactive-referral.html",
    "seeker-pass": "interactive-nft.html",
    "wallet-auth": "interactive-wallet-auth.html",
    "referral-auth": "interactive-referral-auth.html",
    "nft-auth": "interactive-nft-auth.html"
  };
  const openRoute = (route, element) => {
    if (route === "external") {
      const url = element.getAttribute("data-url");
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      return;
    }
    if (route === "review") {
      const pool = element.getAttribute("data-pool") || "mini";
      window.location.href = "interactive-" + pool + "-entry.html";
      return;
    }
    const destination = destinations[route];
    if (destination) window.location.href = destination;
  };
  document.addEventListener("click", (event) => {
    const element = event.target.closest("[data-route], [data-action], [data-ticket-count]");
    if (!element) return;
    const route = element.getAttribute("data-route");
    if (route) {
      event.preventDefault();
      openRoute(route, element);
      return;
    }
    const action = element.getAttribute("data-action");
    if (action === "buy-entry") {
      event.preventDefault();
      const pool = element.getAttribute("data-pool") || "mini";
      window.location.href = "interactive-" + pool + "-wallet.html";
      return;
    }
  });
  const picker = document.querySelector("[data-ticket-picker-root]");
  if (picker) {
    const input = picker.querySelector("[data-ticket-input]");
    const price = Number(picker.getAttribute("data-ticket-price") || 0);
    const limit = Number(picker.getAttribute("data-ticket-limit") || 1000);
    const sold = Number(picker.getAttribute("data-ticket-sold") || 0);
    const minimum = Number(picker.getAttribute("data-ticket-minimum") || 0);
    const update = (next) => {
      if (!input) return;
      const count = Math.max(1, Math.min(limit, Math.trunc(Number(next) || 1)));
      input.value = String(count);
      const total = picker.querySelector("[data-ticket-total]");
      if (total) total.textContent = String(Number((price * count).toFixed(3))) + " SOL total";
      const after = picker.querySelector("[data-ticket-after]");
      if (after) after.textContent = String(sold + count) + " / " + String(minimum);
      const remaining = picker.querySelector("[data-ticket-remaining]");
      if (remaining) remaining.textContent = String(Math.max(minimum - sold - count, 0)) + " tickets";
      picker.querySelectorAll("[data-ticket-count]").forEach((button) => button.classList.toggle("selected", Number(button.getAttribute("data-ticket-count")) === count));
    };
    picker.addEventListener("click", (event) => {
      const button = event.target.closest("[data-action], [data-ticket-count]");
      if (!button || !input) return;
      const preset = button.getAttribute("data-ticket-count");
      if (preset) update(preset);
      else if (button.getAttribute("data-action") === "ticket-inc") update(Number(input.value) + 1);
      else if (button.getAttribute("data-action") === "ticket-dec") update(Number(input.value) - 1);
    });
    input?.addEventListener("input", () => update(input.value));
  }
  const requestedTab = new URLSearchParams(window.location.search).get("tab");
  if (requestedTab) document.querySelector('[data-how-tab="' + requestedTab + '"]')?.click();
})();
</script>`;

const withPrototypeRouting = (html) => html.replace("</body>", `${prototypeRouteScript}</body>`);

const homePreview = renderStitchScreen("home", options);
writeFileSync(path.join(outputDir, "home.html"), homePreview);
writeFileSync(path.join(outputDir, "home-transparent-icons-v5.html"), homePreview);
writeFileSync(path.join(outputDir, "home-aligned-icons-v7.html"), homePreview);
writeFileSync(path.join(outputDir, "home-navigation-icon-v8.html"), homePreview);
writeFileSync(path.join(outputDir, "home-navigation-complete-v9.html"), homePreview);
writeFileSync(path.join(outputDir, "home-navigation-matched-v10.html"), homePreview);
writeFileSync(path.join(outputDir, "home-navigation-corrected-v11.html"), homePreview);
writeFileSync(path.join(outputDir, "seeker-screen-v6.html"), String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LuckyMe · Seeker 412 × 915 Preview</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #090d0c; color: #f7faf8; font-family: Inter, system-ui, sans-serif; }
    body { display: grid; justify-items: center; gap: 14px; padding: 18px; }
    .label { margin: 0; color: #a9bbb2; font-size: 13px; font-weight: 750; letter-spacing: .04em; }
    .device { width: 412px; height: 915px; max-width: calc(100vw - 24px); overflow: hidden; border: 2px solid #43544c; border-radius: 28px; background: #031b14; box-shadow: 0 24px 70px rgba(0,0,0,.62), 0 0 30px rgba(112,255,81,.16); }
    iframe { display: block; width: 412px; height: 915px; border: 0; background: #031b14; transform-origin: top left; }
    @media (max-width: 435px) {
      body { padding: 0; display: block; }
      .label { display: none; }
      .device { width: 100vw; height: 100vh; max-width: none; border: 0; border-radius: 0; }
      iframe { width: 100vw; height: 100vh; }
    }
  </style>
</head>
<body>
  <p class="label">SOLANA SEEKER PREVIEW · 412 × 915</p>
  <div class="device"><iframe src="home-transparent-icons-v5.html" title="LuckyMe Home on Solana Seeker"></iframe></div>
</body>
</html>`);
writeFileSync(path.join(outputDir, "seeker-screen-v7.html"), String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LuckyMe · Seeker 412 × 915 Preview V7</title>
  <style>
    * { box-sizing: border-box; }
    html, body { margin: 0; min-height: 100%; background: #090d0c; color: #f7faf8; font-family: Inter, system-ui, sans-serif; }
    body { display: grid; justify-items: center; gap: 14px; padding: 18px; }
    .label { margin: 0; color: #a9bbb2; font-size: 13px; font-weight: 750; letter-spacing: .04em; }
    .device { width: 412px; height: 915px; max-width: calc(100vw - 24px); overflow: hidden; border: 2px solid #43544c; border-radius: 28px; background: #031b14; box-shadow: 0 24px 70px rgba(0,0,0,.62), 0 0 30px rgba(112,255,81,.16); }
    iframe { display: block; width: 412px; height: 915px; border: 0; background: #031b14; }
    @media (max-width: 435px) {
      body { padding: 0; display: block; }
      .label { display: none; }
      .device { width: 100vw; height: 100vh; max-width: none; border: 0; border-radius: 0; }
      iframe { width: 100vw; height: 100vh; }
    }
  </style>
</head>
<body>
  <p class="label">SOLANA SEEKER PREVIEW V7 · 412 × 915</p>
  <div class="device"><iframe src="home-aligned-icons-v7.html" title="LuckyMe Home on Solana Seeker"></iframe></div>
</body>
</html>`);
writeFileSync(
  path.join(outputDir, "seeker-screen-v8.html"),
  readFileSync(path.join(outputDir, "seeker-screen-v7.html"), "utf8")
    .replaceAll("V7", "V8")
    .replace("home-aligned-icons-v7.html", "home-navigation-icon-v8.html"),
);
writeFileSync(
  path.join(outputDir, "seeker-screen-v9.html"),
  readFileSync(path.join(outputDir, "seeker-screen-v8.html"), "utf8")
    .replaceAll("V8", "V9")
    .replace("home-navigation-icon-v8.html", "home-navigation-complete-v9.html"),
);
writeFileSync(
  path.join(outputDir, "seeker-screen-v10.html"),
  readFileSync(path.join(outputDir, "seeker-screen-v9.html"), "utf8")
    .replaceAll("V9", "V10")
    .replace("home-navigation-complete-v9.html", "home-navigation-matched-v10.html"),
);
writeFileSync(
  path.join(outputDir, "seeker-screen-v11.html"),
  readFileSync(path.join(outputDir, "seeker-screen-v10.html"), "utf8")
    .replaceAll("V10", "V11")
    .replace("home-navigation-matched-v10.html", "home-navigation-corrected-v11.html"),
);
const poolsPreview = renderStitchScreen("pools", { ...options, activeTab: "pools" });
writeFileSync(path.join(outputDir, "pools-lucky-theme-v1.html"), poolsPreview);
writeFileSync(path.join(outputDir, "pools-compact-grid-v2.html"), poolsPreview);
writeFileSync(
  path.join(outputDir, "seeker-pools-v1.html"),
  seekerFrameHtml("SOLANA SEEKER POOLS PREVIEW V1", "pools-lucky-theme-v1.html"),
);
writeFileSync(
  path.join(outputDir, "seeker-pools-v2.html"),
  seekerFrameHtml("SOLANA SEEKER POOLS PREVIEW V2", "pools-compact-grid-v2.html"),
);
writeFileSync(path.join(outputDir, "pools-watermark-grid-v3.html"), poolsPreview);
writeFileSync(
  path.join(outputDir, "seeker-pools-v3.html"),
  seekerFrameHtml("SOLANA SEEKER POOLS PREVIEW V3", "pools-watermark-grid-v3.html"),
);
writeFileSync(path.join(outputDir, "pools-centered-icons-v4.html"), poolsPreview);
writeFileSync(
  path.join(outputDir, "seeker-pools-v4.html"),
  seekerFrameHtml("SOLANA SEEKER POOLS PREVIEW V4", "pools-centered-icons-v4.html"),
);
writeFileSync(path.join(outputDir, "pools-strong-art-v5.html"), poolsPreview);
writeFileSync(
  path.join(outputDir, "seeker-pools-v5.html"),
  seekerFrameHtml("SOLANA SEEKER POOLS PREVIEW V5", "pools-strong-art-v5.html"),
);
writeFileSync(path.join(outputDir, "pools-centered-art-v6.html"), poolsPreview);
writeFileSync(
  path.join(outputDir, "seeker-pools-v6.html"),
  seekerFrameHtml("SOLANA SEEKER POOLS PREVIEW V6", "pools-centered-art-v6.html"),
);
const miniPoolPreview = renderStitchScreen("review", {
  ...options,
  activeTab: "pools",
  selectedPool: "mini",
  ticketCount: 1,
});
writeFileSync(path.join(outputDir, "mini-pool-entry-v1.html"), miniPoolPreview);
writeFileSync(
  path.join(outputDir, "seeker-mini-pool-v1.html"),
  seekerFrameHtml("SOLANA SEEKER MINI POOL PREVIEW V1", "mini-pool-entry-v1.html"),
);
const miniWalletCurrentPreview = renderStitchScreen("syncing", {
  ...options,
  activeTab: "pools",
  selectedPool: "mini",
  ticketCount: 1,
  transaction: {
    state: "wallet",
    message: "Approve the LuckyMe ticket transaction in your wallet.",
  },
});
writeFileSync(path.join(outputDir, "mini-wallet-current.html"), miniWalletCurrentPreview);
writeFileSync(
  path.join(outputDir, "seeker-mini-wallet-current.html"),
  seekerFrameHtml("CURRENT SCREEN AFTER SIGN IN WALLET", "mini-wallet-current.html"),
);
const miniWalletRedesignPreview = renderStitchScreen("syncing", {
  ...options,
  activeTab: "pools",
  selectedPool: "mini",
  ticketCount: 1,
  transaction: {
    state: "wallet",
    message: "Approve the LuckyMe ticket transaction in your wallet.",
  },
});
writeFileSync(path.join(outputDir, "mini-wallet-redesign-v1.html"), miniWalletRedesignPreview);
writeFileSync(
  path.join(outputDir, "seeker-mini-wallet-v1.html"),
  seekerFrameHtml("SOLANA SEEKER MINI WALLET FLOW V1", "mini-wallet-redesign-v1.html"),
);
for (const poolId of ["normal", "high", "premium"]) {
  const entryPreview = renderStitchScreen("review", {
    ...options,
    activeTab: "pools",
    selectedPool: poolId,
    ticketCount: 1,
  });
  const walletPreview = renderStitchScreen("syncing", {
    ...options,
    activeTab: "pools",
    selectedPool: poolId,
    ticketCount: 1,
    transaction: {
      state: "wallet",
      message: "Approve the LuckyMe ticket transaction in your wallet.",
    },
  });
  writeFileSync(path.join(outputDir, `${poolId}-pool-entry-v1.html`), entryPreview);
  writeFileSync(
    path.join(outputDir, `seeker-${poolId}-pool-v1.html`),
    seekerFrameHtml(`SOLANA SEEKER ${poolId.toUpperCase()} POOL PREVIEW V1`, `${poolId}-pool-entry-v1.html`),
  );
  writeFileSync(path.join(outputDir, `${poolId}-wallet-v1.html`), walletPreview);
  writeFileSync(
    path.join(outputDir, `seeker-${poolId}-wallet-v1.html`),
    seekerFrameHtml(`SOLANA SEEKER ${poolId.toUpperCase()} WALLET FLOW V1`, `${poolId}-wallet-v1.html`),
  );
}
const activityPreview = renderStitchScreen("activity", { ...options, activeTab: "activity" });
writeFileSync(path.join(outputDir, "activity-dashboard-v1.html"), activityPreview);
writeFileSync(
  path.join(outputDir, "seeker-activity-v1.html"),
  seekerFrameHtml("SOLANA SEEKER ACTIVITY PREVIEW V1", "activity-dashboard-v1.html"),
);
const activityDemoWallet = "9qhvSugqzuExBpoo2j4iiMzpHCfwSTwELEuxpGG3W2vQ";
const activityDemoPools = structuredClone(livePools);
const activityDemoNow = Math.floor(Date.now() / 1000);
const demoPool = (id) => activityDemoPools.find((pool) => pool.id === id);
const demoMini = demoPool("mini");
if (demoMini) {
  demoMini.activeRound = {
    ...(demoMini.activeRound ?? {}),
    roundId: demoMini.activeRound?.roundId ?? demoMini.currentRound ?? 11,
    status: "open",
    settled: false,
    totalTickets: 8,
    entrantCount: 3,
    startTs: activityDemoNow - 600,
    endTs: activityDemoNow + 3000,
    minimumTickets: 25,
    ticketsRemaining: 17,
    minimumReached: false,
    minimumDistinctEntrants: 1,
    refundStatus: "none",
    roundOutcome: "open",
    userEntry: { ticketCount: 3, lamports: 15_000_000, chancePercent: "37.5" },
  };
}
const demoNormal = demoPool("normal");
if (demoNormal) {
  demoNormal.recentRounds = [{
    roundId: 6,
    status: "settled",
    settled: true,
    endTs: activityDemoNow - 86_400,
    archivedAt: new Date((activityDemoNow - 86_400) * 1000).toISOString(),
    refundStatus: "completed",
    roundOutcome: "cancelled_below_minimum",
    userEntry: { ticketCount: 2, lamports: 20_000_000 },
    winners: [],
  }, ...(demoNormal.recentRounds ?? [])];
}
const demoHigh = demoPool("high");
if (demoHigh) {
  demoHigh.recentRounds = [{
    roundId: 5,
    status: "settled",
    settled: true,
    totalLamports: 150_000_000,
    endTs: activityDemoNow - 172_800,
    archivedAt: new Date((activityDemoNow - 172_800) * 1000).toISOString(),
    refundStatus: "none",
    roundOutcome: "settled",
    userEntry: { ticketCount: 1, lamports: 50_000_000 },
    winners: [{ rank: 1, wallet: activityDemoWallet, prizeSol: 0.1425 }],
  }, ...(demoHigh.recentRounds ?? [])];
}
const demoPremium = demoPool("premium");
if (demoPremium) {
  demoPremium.recentRounds = [{
    roundId: 6,
    status: "settled",
    settled: true,
    endTs: activityDemoNow - 259_200,
    archivedAt: new Date((activityDemoNow - 259_200) * 1000).toISOString(),
    refundStatus: "none",
    roundOutcome: "settled",
    userEntry: { ticketCount: 1, lamports: 100_000_000 },
    winners: [],
  }, ...(demoPremium.recentRounds ?? [])];
}
const activityPreviewV2 = renderStitchScreen("activity", {
  ...options,
  activeTab: "activity",
  walletAddress: activityDemoWallet,
  livePools: activityDemoPools,
});
writeFileSync(path.join(outputDir, "activity-compact-v2.html"), activityPreviewV2);
writeFileSync(
  path.join(outputDir, "seeker-activity-v2.html"),
  seekerFrameHtml("SAMPLE DATA · ACTIVITY UI V2", "activity-compact-v2.html"),
);
const activityEmptyPreviewV2 = renderStitchScreen("activity", { ...options, activeTab: "activity" });
writeFileSync(path.join(outputDir, "activity-empty-v2.html"), activityEmptyPreviewV2);
writeFileSync(
  path.join(outputDir, "seeker-activity-empty-v2.html"),
  seekerFrameHtml("REAL EMPTY STATE · ACTIVITY UI V2", "activity-empty-v2.html"),
);
const howToPreviewV1 = renderStitchScreen("how-to-play", { ...options, activeTab: "how-to-play" });
writeFileSync(path.join(outputDir, "how-to-wiki-v1.html"), howToPreviewV1);
writeFileSync(
  path.join(outputDir, "seeker-how-to-v1.html"),
  seekerFrameHtml("SOLANA SEEKER HOW TO WIKI V1", "how-to-wiki-v1.html"),
);
const socialPreviewV1 = renderStitchScreen("social", { ...options, activeTab: "social", socialVariant: "v2" });
writeFileSync(path.join(outputDir, "social-hub-v1.html"), socialPreviewV1);
writeFileSync(
  path.join(outputDir, "seeker-social-v1.html"),
  seekerFrameHtml("SOLANA SEEKER SOCIAL HUB V1", "social-hub-v1.html"),
);
writeFileSync(path.join(outputDir, "social-hub-v2.html"), socialPreviewV1);
writeFileSync(
  path.join(outputDir, "seeker-social-v2.html"),
  seekerFrameHtml("SOLANA SEEKER SOCIAL HUB V2", "social-hub-v2.html"),
);
const socialPreviewV3 = renderStitchScreen("social", {
  ...options,
  activeTab: "social",
  socialVariant: "v3",
  socialIcons: {
    x: projectPngDataUri("app-seeker/assets/social/x-medallion-v3.png"),
    discord: projectPngDataUri("app-seeker/assets/social/discord-medallion-v3.png"),
    website: projectPngDataUri("app-seeker/assets/social/website-card-v2.png"),
    support: projectPngDataUri("app-seeker/assets/social/support-medallion-v3.png"),
  },
});
writeFileSync(path.join(outputDir, "social-hub-v3.html"), socialPreviewV3);
writeFileSync(
  path.join(outputDir, "seeker-social-v3.html"),
  seekerFrameHtml("SOLANA SEEKER SOCIAL HUB V3", "social-hub-v3.html"),
);
const socialPreviewV4 = renderStitchScreen("social", {
  ...options,
  activeTab: "social",
  socialVariant: "v4",
  socialIcons: {
    x: projectPngDataUri("app-seeker/assets/social/x-medallion-v3.png"),
    discord: projectPngDataUri("app-seeker/assets/social/discord-medallion-v3.png"),
    website: projectPngDataUri("app-seeker/assets/social/website-card-v2.png"),
    support: projectPngDataUri("app-seeker/assets/social/support-medallion-v3.png"),
  },
});
writeFileSync(path.join(outputDir, "social-hub-v4.html"), socialPreviewV4);
writeFileSync(
  path.join(outputDir, "seeker-social-v4.html"),
  seekerFrameHtml("SOLANA SEEKER SOCIAL HUB V4", "social-hub-v4.html"),
);
writeFileSync(path.join(outputDir, "latest-winners.html"), renderStitchScreen("latest-winners", options));

const interactivePages = {
  "interactive-home.html": homePreview,
  "interactive-pools.html": poolsPreview,
  "interactive-activity.html": activityPreviewV2,
  "interactive-how-to.html": howToPreviewV1,
  "interactive-social.html": socialPreviewV4,
  "interactive-winners.html": renderStitchScreen("latest-winners", { ...options, activeTab: "home" }),
  "interactive-wallet.html": renderStitchScreen("wallet", { ...options, activeTab: "home" }),
  "interactive-referral.html": renderReferralLeaguePreview(options),
  "interactive-nft.html": renderNftHoldersPreview(options),
  "interactive-wallet-auth.html": renderWalletAuthPreview("wallet", options),
  "interactive-referral-auth.html": renderWalletAuthPreview("referral", options),
  "interactive-nft-auth.html": renderWalletAuthPreview("nft", options),
};
for (const [fileName, html] of Object.entries(interactivePages)) {
  writeFileSync(path.join(outputDir, fileName), withPrototypeRouting(html));
}
for (const poolId of ["mini", "normal", "high", "premium"]) {
  const entryFile = poolId === "mini" ? "mini-pool-entry-v1.html" : `${poolId}-pool-entry-v1.html`;
  const walletFile = poolId === "mini" ? "mini-wallet-redesign-v1.html" : `${poolId}-wallet-v1.html`;
  writeFileSync(
    path.join(outputDir, `interactive-${poolId}-entry.html`),
    withPrototypeRouting(readFileSync(path.join(outputDir, entryFile), "utf8")),
  );
  writeFileSync(
    path.join(outputDir, `interactive-${poolId}-wallet.html`),
    withPrototypeRouting(readFileSync(path.join(outputDir, walletFile), "utf8")),
  );
}
writeFileSync(
  path.join(outputDir, "seeker-interactive-v1.html"),
  seekerFrameHtml("LUCKYME INTERACTIVE SEEKER PROTOTYPE V1", "interactive-home.html"),
);
writeFileSync(path.join(outputDir, "referral-league-v1.html"), renderReferralLeaguePreview(options));
writeFileSync(path.join(outputDir, "nft-holders-v1.html"), renderNftHoldersPreview(options));
writeFileSync(path.join(outputDir, "wallet-hub-v1.html"), renderStitchScreen("wallet", { ...options, activeTab: "home" }));
writeFileSync(path.join(outputDir, "seeker-referral-v1.html"), seekerFrameHtml("REFERRAL LEAGUE V1", "referral-league-v1.html"));
writeFileSync(path.join(outputDir, "seeker-nft-holders-v1.html"), seekerFrameHtml("NFT HOLDERS V1", "nft-holders-v1.html"));
writeFileSync(path.join(outputDir, "seeker-wallet-v1.html"), seekerFrameHtml("WALLET HUB V1", "wallet-hub-v1.html"));

console.log(outputDir);
