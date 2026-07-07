export type StitchScreenId =
  | "home"
  | "pools"
  | "activity"
  | "wallet"
  | "settings"
  | "review"
  | "syncing"
  | "success"
  | "unavailable"
  | "welcome";

type PoolTone = "green" | "cyan" | "gold" | "violet";

type PoolSpec = {
  id: string;
  name: string;
  marker: string;
  entry: string;
  prize: string;
  winners: string;
  limits: string;
  note: string;
  tone: PoolTone;
};

const POOLS: PoolSpec[] = [
  {
    id: "mini",
    name: "Mini",
    marker: "M",
    entry: "0.005 SOL",
    prize: "95% main prize",
    winners: "1 winner",
    limits: "1,000 tickets max",
    note: "Low entry, same settlement rules.",
    tone: "green",
  },
  {
    id: "normal",
    name: "Normal",
    marker: "N",
    entry: "0.01 SOL",
    prize: "95% main prize",
    winners: "1 winner",
    limits: "1,000 tickets max",
    note: "Balanced public pool.",
    tone: "cyan",
  },
  {
    id: "high",
    name: "High",
    marker: "H",
    entry: "0.05 SOL",
    prize: "95% main prize",
    winners: "1 winner",
    limits: "1,000 tickets max",
    note: "Higher entry, single winner.",
    tone: "violet",
  },
  {
    id: "premium",
    name: "Premium",
    marker: "P",
    entry: "0.1 SOL",
    prize: "70 / 20 / 10 split",
    winners: "3 winners",
    limits: "1 ticket per wallet",
    note: "Minimum 3 wallets required.",
    tone: "gold",
  },
];

const ECONOMICS = [
  ["Main prize", "95%"],
  ["Treasury", "2%"],
  ["Jackpot", "3%"],
  ["Round", "1 hour"],
];

const PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
const API_HOST = "api.lucky-me.app";

function page(title: string, active: StitchScreenId, body: string) {
  return String.raw`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${title}</title>
  <style>
    :root {
      color-scheme: dark;
      --bg: #030604;
      --bg-2: #07100c;
      --panel: #101513;
      --panel-2: #151b18;
      --line: rgba(255, 255, 255, 0.11);
      --line-strong: rgba(255, 255, 255, 0.18);
      --text: #f2f6f3;
      --muted: #a8b7af;
      --soft: #728078;
      --green: #43f09a;
      --cyan: #6dd7ff;
      --gold: #ffd166;
      --violet: #d7b9ff;
      --red: #ffb4ab;
      --button: #43f09a;
      --button-text: #032015;
    }

    * { box-sizing: border-box; }

    html, body {
      margin: 0;
      width: 100%;
      max-width: 100%;
      min-height: 100%;
      background:
        radial-gradient(circle at 20% 0%, rgba(67, 240, 154, 0.13), transparent 32rem),
        radial-gradient(circle at 92% 18%, rgba(255, 209, 102, 0.12), transparent 26rem),
        linear-gradient(180deg, var(--bg-2), var(--bg));
      color: var(--text);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 16px;
      letter-spacing: 0;
      -webkit-font-smoothing: antialiased;
      overflow-x: hidden;
    }

    button, a {
      -webkit-tap-highlight-color: transparent;
      color: inherit;
      font: inherit;
    }

    button { cursor: pointer; }

    .app {
      width: 100%;
      max-width: 760px;
      min-height: 100dvh;
      margin: 0 auto;
      padding: calc(env(safe-area-inset-top) + 14px) 16px calc(env(safe-area-inset-bottom) + 100px);
      overflow-x: hidden;
    }

    .topbar {
      position: sticky;
      top: 0;
      z-index: 10;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 56px;
      margin: -14px -16px 18px;
      padding: calc(env(safe-area-inset-top) + 14px) 16px 10px;
      background: rgba(3, 6, 4, 0.82);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      backdrop-filter: blur(18px);
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
      font-size: 22px;
      font-weight: 800;
    }

    .brand-mark, .icon {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      background: rgba(67, 240, 154, 0.12);
      border: 1px solid rgba(67, 240, 154, 0.28);
      color: var(--green);
      font-size: 13px;
      font-weight: 900;
    }

    .top-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
    }

    .pill, .ghost-button {
      min-height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 11px;
      border-radius: 8px;
      border: 1px solid var(--line);
      background: rgba(255, 255, 255, 0.05);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      text-decoration: none;
      white-space: nowrap;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--green);
      box-shadow: 0 0 16px rgba(67, 240, 154, 0.72);
    }

    .stack { display: grid; gap: 16px; }
    .compact-stack { display: grid; gap: 10px; }

    .hero {
      display: grid;
      gap: 14px;
      padding: 10px 0 4px;
    }

    .eyebrow {
      color: var(--green);
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    h1, h2, h3, p { margin: 0; }

    h1 {
      max-width: 11ch;
      color: #ffffff;
      font-size: 42px;
      line-height: 1.04;
      font-weight: 900;
    }

    h2 {
      color: #ffffff;
      font-size: 24px;
      line-height: 1.16;
      font-weight: 850;
    }

    h3 {
      color: #ffffff;
      font-size: 16px;
      line-height: 1.25;
      font-weight: 850;
    }

    p {
      color: var(--muted);
      line-height: 1.48;
      max-width: 100%;
      overflow-wrap: anywhere;
    }

    .muted { color: var(--muted); }
    .soft { color: var(--soft); }
    .success { color: var(--green); }
    .warning { color: var(--gold); }
    .danger { color: var(--red); }
    .mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      overflow-wrap: anywhere;
      word-break: break-word;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .metric, .panel, .pool-card, .list-row {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: rgba(16, 21, 19, 0.84);
      box-shadow: 0 20px 52px rgba(0, 0, 0, 0.26);
    }

    .metric {
      min-height: 82px;
      padding: 14px;
      display: grid;
      align-content: space-between;
      gap: 12px;
    }

    .metric span:first-child, .label {
      color: var(--soft);
      font-size: 11px;
      font-weight: 850;
      text-transform: uppercase;
    }

    .metric strong {
      color: #ffffff;
      font-size: 22px;
      line-height: 1;
    }

    .panel { padding: 16px; }

    .section-header {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 12px;
      margin: 4px 0 -4px;
    }

    .pool-grid {
      display: grid;
      gap: 12px;
    }

    .pool-card {
      position: relative;
      overflow: hidden;
      padding: 14px;
      display: grid;
      gap: 14px;
    }

    .pool-card:before {
      content: "";
      position: absolute;
      inset: 0 auto 0 0;
      width: 4px;
      background: var(--accent);
    }

    .tone-green { --accent: var(--green); }
    .tone-cyan { --accent: var(--cyan); }
    .tone-gold { --accent: var(--gold); }
    .tone-violet { --accent: var(--violet); }

    .pool-head, .row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
      min-width: 0;
    }

    .row > *, .list-row > * {
      min-width: 0;
    }

    .row-left {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .pool-title {
      display: grid;
      gap: 3px;
      min-width: 0;
    }

    .entry {
      color: #ffffff;
      font-size: 20px;
      font-weight: 900;
      white-space: nowrap;
    }

    .status-code {
      flex: 0 1 32%;
      color: #ffffff;
      font-size: 18px;
      font-weight: 900;
      line-height: 1.1;
      text-align: right;
      text-transform: uppercase;
      overflow-wrap: anywhere;
    }

    .pool-facts {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .fact {
      min-height: 60px;
      padding: 10px;
      border-radius: 8px;
      background: rgba(255, 255, 255, 0.045);
      border: 1px solid rgba(255, 255, 255, 0.07);
    }

    .fact .label {
      display: block;
      margin-bottom: 6px;
    }

    .fact strong {
      display: block;
      color: #ffffff;
      font-size: 13px;
      line-height: 1.18;
      overflow-wrap: anywhere;
    }

    .action-row {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: 12px;
      padding-top: 12px;
      border-top: 1px solid rgba(255, 255, 255, 0.08);
    }

    .primary-button, .secondary-button, .nav-item {
      border: 0;
      text-decoration: none;
      transition: opacity 150ms ease, transform 150ms ease;
    }

    .primary-button, .secondary-button {
      min-height: 48px;
      border-radius: 8px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 0 16px;
      font-size: 15px;
      font-weight: 900;
      white-space: nowrap;
    }

    .primary-button {
      color: var(--button-text);
      background: var(--button);
      box-shadow: 0 12px 30px rgba(67, 240, 154, 0.2);
    }

    .secondary-button {
      color: var(--text);
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--line);
    }

    .primary-button:active, .secondary-button:active, .nav-item:active {
      transform: scale(0.98);
      opacity: 0.78;
    }

    .list {
      display: grid;
      gap: 10px;
    }

    .list-row {
      padding: 13px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .list-row strong {
      flex: 0 0 auto;
      max-width: 38%;
      color: #ffffff;
      font-size: 15px;
      text-align: right;
      overflow-wrap: anywhere;
    }

    .bottom-nav {
      position: fixed;
      z-index: 30;
      left: max(12px, env(safe-area-inset-left));
      right: max(12px, env(safe-area-inset-right));
      bottom: max(12px, env(safe-area-inset-bottom));
      max-width: 728px;
      height: 72px;
      margin: 0 auto;
      display: grid;
      grid-template-columns: repeat(5, minmax(0, 1fr));
      gap: 4px;
      padding: 7px;
      border-radius: 8px;
      border: 1px solid var(--line-strong);
      background: rgba(10, 14, 12, 0.92);
      backdrop-filter: blur(22px);
      box-shadow: 0 -18px 48px rgba(0, 0, 0, 0.32);
    }

    .nav-item {
      min-width: 0;
      min-height: 58px;
      display: grid;
      place-items: center;
      gap: 2px;
      border-radius: 8px;
      background: transparent;
      color: var(--soft);
      font-size: 11px;
      font-weight: 850;
    }

    .nav-item .nav-icon {
      display: grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 7px;
      color: currentColor;
      font-size: 12px;
      font-weight: 900;
    }

    .nav-item.active {
      color: var(--green);
      background: rgba(67, 240, 154, 0.1);
      box-shadow: inset 0 0 0 1px rgba(67, 240, 154, 0.16);
    }

    .notice {
      border-color: rgba(255, 209, 102, 0.26);
      background: rgba(255, 209, 102, 0.08);
    }

    .wallet-native-space {
      min-height: 250px;
    }

    .danger-panel {
      border-color: rgba(255, 180, 171, 0.28);
      background: rgba(255, 180, 171, 0.07);
    }

    @media (min-width: 640px) {
      .pool-grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      h1 { font-size: 48px; }
    }

    @media (max-width: 390px) {
      .app { padding-left: 12px; padding-right: 12px; }
      .topbar { margin-left: -12px; margin-right: -12px; padding-left: 12px; padding-right: 12px; }
      .pill { display: none; }
      .pool-facts { grid-template-columns: 1fr; }
      .action-row { grid-template-columns: 1fr; }
      .primary-button, .secondary-button { width: 100%; }
      h1 { font-size: 36px; }
    }

    @media (max-width: 430px) {
      .hero p { max-width: 34ch; }
      .list-row { align-items: flex-start; }
      .list-row strong { max-width: 34%; }
    }
  </style>
</head>
<body>
  <div class="app">
    ${topbar()}
    ${body}
  </div>
  ${bottomNav(active)}
</body>
</html>`;
}

function topbar() {
  return String.raw`<header class="topbar">
  <div class="brand"><span class="brand-mark">L</span><span>LuckyMe</span></div>
  <div class="top-actions">
    <div class="pill"><span class="status-dot"></span><span>Mainnet</span></div>
    <button class="ghost-button">Wallet</button>
  </div>
</header>`;
}

function bottomNav(active: StitchScreenId) {
  const items: Array<[StitchScreenId, string, string]> = [
    ["home", "H", "Home"],
    ["pools", "P", "Pools"],
    ["activity", "A", "Activity"],
    ["wallet", "W", "Wallet"],
    ["settings", "S", "Settings"],
  ];

  return String.raw`<nav class="bottom-nav" aria-label="Primary">
  ${items.map(([screen, icon, label]) => String.raw`<button class="nav-item ${active === screen ? "active" : ""}">
    <span class="nav-icon">${icon}</span>
    <span>${label}</span>
  </button>`).join("\n  ")}
</nav>`;
}

function metrics() {
  return String.raw`<section class="metric-grid">
  ${ECONOMICS.map(([label, value]) => String.raw`<div class="metric">
    <span>${label}</span>
    <strong>${value}</strong>
  </div>`).join("\n  ")}
</section>`;
}

function poolCard(pool: PoolSpec) {
  return String.raw`<article class="pool-card tone-${pool.tone}">
  <div class="pool-head">
    <div class="row-left">
      <span class="icon">${pool.marker}</span>
      <div class="pool-title">
        <h3>${pool.name}</h3>
        <p class="soft">${pool.note}</p>
      </div>
    </div>
    <div class="entry mono">${pool.entry}</div>
  </div>
  <div class="pool-facts">
    <div class="fact"><span class="label">Prize</span><strong>${pool.prize}</strong></div>
    <div class="fact"><span class="label">Winners</span><strong>${pool.winners}</strong></div>
    <div class="fact"><span class="label">Limit</span><strong>${pool.limits}</strong></div>
  </div>
  <div class="action-row">
    <p class="soft">Round, ticket count, and vault amount load from verified chain state.</p>
    <button class="primary-button">Join ${pool.name}</button>
  </div>
</article>`;
}

function homeBody() {
  return String.raw`<main class="stack">
  <section class="hero">
    <p class="eyebrow">Solana mainnet pools</p>
    <h1>LuckyMe rounds</h1>
    <p>Four entry levels, external wallet custody, ORAO VRF settlement, and no visible fallback pools while chain state is unavailable.</p>
  </section>
  ${metrics()}
  <section class="panel">
    <div class="row">
      <div>
        <span class="label">On-chain pool status</span>
        <h2>Pending</h2>
        <p class="muted">Live values appear only after backend state confirms the deployed program.</p>
      </div>
      <span class="status-code mono">MAINNET</span>
    </div>
  </section>
  <section class="pool-grid">
    ${POOLS.map(poolCard).join("\n    ")}
  </section>
  <section class="panel notice">
    <div class="row">
      <div>
        <span class="label">Jackpot reserve</span>
        <h2>Pending</h2>
        <p>Random jackpot can trigger after any completed round.</p>
      </div>
      <span class="entry mono">3%</span>
    </div>
  </section>
</main>`;
}

function poolsBody() {
  return String.raw`<main class="stack">
  <section class="section-header">
    <div>
      <span class="label">Pool board</span>
      <h2>Entries and payout rules</h2>
    </div>
    <span class="pill">Mainnet</span>
  </section>
  <section class="pool-grid two">
    ${POOLS.map(poolCard).join("\n    ")}
  </section>
</main>`;
}

function activityBody() {
  return String.raw`<main class="stack">
  <section class="hero">
    <p class="eyebrow">Activity</p>
    <h1>Round ledger</h1>
    <p>Settlement rows stay pending until the backend reads confirmed program state.</p>
  </section>
  <section class="list">
    ${[
      ["Latest settlement", "Pending"],
      ["Open rounds", "Pending"],
      ["Jackpot reserve", "Pending"],
      ["Randomness provider", "ORAO VRF"],
    ].map(([label, value]) => String.raw`<div class="list-row">
      <div><span class="label">${label}</span><p class="soft">Loaded from verified state</p></div>
      <strong class="mono">${value}</strong>
    </div>`).join("\n    ")}
  </section>
</main>`;
}

function walletBody() {
  return String.raw`<main class="stack">
  <section class="hero">
    <p class="eyebrow">Wallet</p>
    <h1>External custody</h1>
    <p>LuckyMe never stores seed phrases or private keys. The wallet signs player actions.</p>
  </section>
  <section class="panel">
    <div class="compact-stack">
      <div class="row"><span class="label">Connection</span><strong class="mono">Mobile Wallet Adapter</strong></div>
      <div class="row"><span class="label">Network</span><strong class="mono">solana:mainnet</strong></div>
      <div class="row"><span class="label">App custody</span><strong class="mono success">None</strong></div>
    </div>
  </section>
  <div class="wallet-native-space" aria-hidden="true"></div>
</main>`;
}

function settingsBody() {
  return String.raw`<main class="stack">
  <section class="hero">
    <p class="eyebrow">Settings</p>
    <h1>Release config</h1>
    <p>Mainnet release values are embedded at build time and checked before store submission.</p>
  </section>
  <section class="list">
    <div class="list-row"><div><span class="label">Program</span><p class="mono soft">${PROGRAM_ID}</p></div><strong class="success">Set</strong></div>
    <div class="list-row"><div><span class="label">Backend</span><p class="mono soft">${API_HOST}</p></div><strong class="success">HTTPS</strong></div>
    <div class="list-row"><div><span class="label">Randomness</span><p class="soft">ORAO VRF</p></div><strong class="success">Set</strong></div>
  </section>
  <section class="panel">
    <div class="compact-stack">
      <button class="secondary-button">Terms</button>
      <button class="secondary-button">Privacy</button>
      <button class="secondary-button">Support</button>
    </div>
  </section>
</main>`;
}

function reviewBody() {
  return String.raw`<main class="stack">
  <section class="hero">
    <p class="eyebrow">Review</p>
    <h1>Entry request</h1>
    <p>Pool selection and amount are finalized from live state before wallet approval.</p>
  </section>
  <section class="panel">
    <div class="compact-stack">
      <div class="row"><span class="label">Pool</span><strong class="mono">Pending</strong></div>
      <div class="row"><span class="label">Entry</span><strong class="mono">Pending</strong></div>
      <div class="row"><span class="label">Network</span><strong class="mono">Mainnet</strong></div>
      <div class="row"><span class="label">Signer</span><strong class="mono">External wallet</strong></div>
    </div>
  </section>
  <button class="primary-button">Confirm in Wallet</button>
  <button class="secondary-button">Back to Pools</button>
</main>`;
}

function syncingBody() {
  return String.raw`<main class="stack">
  <section class="hero">
    <p class="eyebrow">Wallet request</p>
    <h1>Pending approval</h1>
    <p>The app waits for wallet approval and backend confirmation before showing final state.</p>
  </section>
  <section class="list">
    <div class="list-row"><div><span class="label">Unsigned transaction</span><p class="soft">Prepared by app client</p></div><strong class="warning">Pending</strong></div>
    <div class="list-row"><div><span class="label">Wallet signature</span><p class="soft">External wallet only</p></div><strong class="warning">Pending</strong></div>
    <div class="list-row"><div><span class="label">Backend confirmation</span><p class="soft">Required before status changes</p></div><strong class="warning">Pending</strong></div>
  </section>
  <button class="secondary-button">Complete</button>
</main>`;
}

function successBody() {
  return String.raw`<main class="stack">
  <section class="hero">
    <p class="eyebrow">Status</p>
    <h1>Entry pending</h1>
    <p>Final entry state appears after confirmed chain data is available.</p>
  </section>
  <section class="panel notice">
    <div class="row">
      <div>
        <span class="label">Confirmation</span>
        <h2>Pending</h2>
        <p class="muted">No final balance or payout state is shown before backend confirmation.</p>
      </div>
      <span class="entry mono">WAIT</span>
    </div>
  </section>
  <button class="primary-button">Done</button>
</main>`;
}

function unavailableBody() {
  return String.raw`<main class="stack" style="min-height: calc(100dvh - 180px); justify-content: center;">
  <section class="panel danger-panel" style="text-align: center;">
    <div class="icon" style="margin: 0 auto 14px; width: 54px; height: 54px;">!</div>
    <span class="label">Solana mainnet status</span>
    <h1 style="max-width: none; margin-top: 8px;">On-chain syncing</h1>
    <p style="margin-top: 12px;">Live pools are unavailable until the production program is deployed and backend state is confirmed.</p>
    <button class="primary-button" style="width: 100%; margin-top: 18px;">Retry Connection</button>
    <button class="secondary-button" style="width: 100%; margin-top: 10px;">Settings</button>
  </section>
  <section class="panel">
    <div class="row">
      <div>
        <span class="label">Safety state</span>
        <h2>No fallback pools</h2>
        <p class="muted">The app does not display playable pool data while chain state is unavailable.</p>
      </div>
      <strong class="warning">Pending</strong>
    </div>
  </section>
</main>`;
}

export const STITCH_SCREENS: Record<StitchScreenId, string> = {
  home: page("LuckyMe | Home", "home", homeBody()),
  pools: page("LuckyMe | Pools", "pools", poolsBody()),
  activity: page("LuckyMe | Activity", "activity", activityBody()),
  wallet: page("LuckyMe | Wallet", "wallet", walletBody()),
  settings: page("LuckyMe | Settings", "settings", settingsBody()),
  review: page("LuckyMe | Review", "pools", reviewBody()),
  syncing: page("LuckyMe | Wallet Request", "pools", syncingBody()),
  success: page("LuckyMe | Status", "activity", successBody()),
  unavailable: page("LuckyMe | On-chain Syncing", "settings", unavailableBody()),
  welcome: page("LuckyMe | Welcome", "home", homeBody()),
};
