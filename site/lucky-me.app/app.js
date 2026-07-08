import { Connection, Transaction } from "https://esm.sh/@solana/web3.js@1.98.4?bundle";

const API_BASE = "https://api.lucky-me.app";
const PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
const SOLANA_CHAIN = "solana:mainnet";
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const WALLETCONNECT_PROJECT_ID = window.LUCKYME_WALLETCONNECT_PROJECT_ID || "";
const WALLETCONNECT_SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const WALLETCONNECT_SOLANA_CHAINS = [
  WALLETCONNECT_SOLANA_CHAIN,
  "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ",
];
const WALLETCONNECT_SOLANA_METHODS = [
  "solana_signTransaction",
  "solana_signAndSendTransaction",
  "solana_signMessage",
];
const WALLETCONNECT_PROVIDER_URL = "https://unpkg.com/@walletconnect/universal-provider@2.23.9/dist/index.umd.js";
const WALLETCONNECT_MODAL_URL = "https://unpkg.com/@walletconnect/modal@2.7.0/dist/cdn/bundle.js";
const OPERATOR_MODE = new URLSearchParams(window.location.search).has("operator");
const MOBILE_WALLET_BROWSERS = [
  { id: "phantom", name: "Phantom" },
  { id: "solflare", name: "Solflare" },
  { id: "backpack", name: "Backpack" },
];
const scriptLoaders = new Map();

const POOLS = [
  {
    id: "mini",
    name: "Mini",
    chip: "Low entry",
    entrySol: "0.005",
    prize: "95% main prize",
    winners: "1 winner",
    limit: "1,000 tickets max",
    note: "Low entry, same settlement rules.",
  },
  {
    id: "normal",
    name: "Normal",
    chip: "Balanced",
    entrySol: "0.01",
    prize: "95% main prize",
    winners: "1 winner",
    limit: "1,000 tickets max",
    note: "Balanced public pool.",
  },
  {
    id: "high",
    name: "High",
    chip: "Higher entry",
    entrySol: "0.05",
    prize: "95% main prize",
    winners: "1 winner",
    limit: "1,000 tickets max",
    note: "Higher entry, single winner.",
  },
  {
    id: "premium",
    name: "Premium",
    chip: "3 winners",
    entrySol: "0.1",
    prize: "70 / 20 / 10 split",
    winners: "3 winners",
    limit: "1 ticket per wallet",
    note: "Minimum 3 wallets required.",
  },
];

const state = {
  route: "home",
  config: null,
  pools: [],
  poolsLoaded: false,
  onchainAvailable: false,
  wallet: null,
  walletMenuOpen: false,
  walletConnectProvider: null,
  walletConnectModal: null,
  walletConnectUri: "",
  selectedPool: null,
  ticketCount: 1,
  preparedTransaction: null,
  lastError: "",
};

const dom = {
  chainStatus: document.querySelector("#chain-status"),
  homeStatusTitle: document.querySelector("#home-status-title"),
  homeStatusCopy: document.querySelector("#home-status-copy"),
  homeStatusPill: document.querySelector("#home-status-pill"),
  homePools: document.querySelector("#home-pools"),
  poolList: document.querySelector("#pool-list"),
  poolsNote: document.querySelector("#pools-note"),
  activityList: document.querySelector("#activity-list"),
  walletList: document.querySelector("#wallet-list"),
  walletMessage: document.querySelector("#wallet-message"),
  walletPill: document.querySelector("#wallet-pill"),
  reviewPanel: document.querySelector("#review-panel"),
  screens: Array.from(document.querySelectorAll("[data-screen]")),
  navItems: Array.from(document.querySelectorAll(".nav-item")),
};

function setRoute(route) {
  state.route = route;
  dom.screens.forEach((screen) => {
    screen.hidden = screen.dataset.screen !== route;
  });
  dom.navItems.forEach((item) => {
    item.classList.toggle("active", item.dataset.route === route);
  });
  if (route === "wallet") {
    renderWallets();
  }
  if (route === "review") {
    renderReview();
  }
}

function formatAddress(address) {
  if (!address) {
    return "Not connected";
  }
  return address.length > 14 ? `${address.slice(0, 6)}...${address.slice(-6)}` : address;
}

function poolById(poolId) {
  return POOLS.find((pool) => pool.id === poolId) || POOLS[0];
}

function poolFromApi(poolId) {
  return state.pools.find((pool) => pool.id === poolId || pool.slug === poolId);
}

function selectedTicketLimit(poolId = state.selectedPool) {
  const pool = poolFromApi(poolId);
  return Math.max(1, Number(pool?.maxTicketsPerEntry || (poolId === "premium" ? 1 : 1000)));
}

function selectedTicketPriceLamports(poolId = state.selectedPool) {
  const livePool = poolFromApi(poolId);
  const staticPool = poolById(poolId);
  return BigInt(livePool?.ticketPriceLamports || Math.round(Number(staticPool.entrySol) * 1_000_000_000));
}

function formatSolFromLamports(lamports) {
  const value = BigInt(lamports);
  const whole = value / 1_000_000_000n;
  const fraction = String(value % 1_000_000_000n).padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : `${whole}`;
}

function formatDuration(seconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }
  return `${minutes}m ${String(secs).padStart(2, "0")}s`;
}

function roundTiming(poolId = state.selectedPool) {
  const livePool = poolFromApi(poolId);
  const round = livePool?.activeRound;
  const roundId = round?.roundId ?? livePool?.currentRound ?? null;

  if (!round) {
    const syncing = state.onchainAvailable && (!state.poolsLoaded || state.pools.length === 0);
    return {
      isOpen: false,
      canDetermine: !syncing,
      roundId,
      status: syncing ? "Syncing" : state.onchainAvailable ? "No active round" : "Pending",
      timeLeft: syncing ? "Syncing" : state.onchainAvailable ? "Unavailable" : "Pending",
      chipClass: "warning",
    };
  }

  if (round.settled) {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Settled",
      chipClass: "warning",
    };
  }

  const remainingSeconds = Number(round.endTs) - Math.floor(Date.now() / 1000);
  const isOpen = remainingSeconds > 0;
  return {
    isOpen,
    canDetermine: true,
    roundId,
    status: `Round ${roundId}`,
    timeLeft: isOpen ? formatDuration(remainingSeconds) : "Closed",
    chipClass: isOpen ? "success" : "warning",
  };
}

function setTicketCount(value) {
  const limit = selectedTicketLimit();
  const nextValue = Number(value);
  state.ticketCount = Number.isSafeInteger(nextValue)
    ? Math.min(limit, Math.max(1, nextValue))
    : 1;
  state.preparedTransaction = null;
  state.lastError = "";
}

function renderPoolCard(pool, compact = false) {
  const livePool = poolFromApi(pool.id);
  const timing = roundTiming(pool.id);
  const liveStatus = state.onchainAvailable ? timing.status : "Pending";
  const jackpotValue = state.onchainAvailable && livePool?.jackpotSol
    ? `${livePool.jackpotSol} SOL`
    : "Pending";
  const actionLabel = state.onchainAvailable
    ? !timing.canDetermine
      ? "Review setup"
      : timing.isOpen
      ? `Join ${pool.name}`
      : "Round closed"
    : "Review setup";

  return `
    <article class="pool-card">
      <div class="pool-title">
        <div>
          <span class="label">${pool.chip}</span>
          <h3>${pool.name}</h3>
        </div>
        <span class="pool-chip ${timing.chipClass}">${liveStatus}</span>
      </div>
      <div class="entry">${pool.entrySol}<span>SOL</span></div>
      <div class="facts-grid">
        <div class="fact"><span class="label">Prize</span><strong>${pool.prize}</strong></div>
        <div class="fact"><span class="label">Winners</span><strong>${pool.winners}</strong></div>
        <div class="fact"><span class="label">Limit</span><strong>${pool.limit}</strong></div>
        <div class="fact time-fact"><span class="label">Time left</span><strong>${timing.timeLeft}</strong></div>
        <div class="fact jackpot-fact"><span class="label">Jackpot</span><strong>${jackpotValue}</strong></div>
      </div>
      ${compact ? "" : `<p>${pool.note} Live state loads only from verified on-chain data.</p>`}
      <button class="primary-button" data-pool="${pool.id}" ${state.onchainAvailable && timing.canDetermine && !timing.isOpen ? "disabled" : ""}>${actionLabel}</button>
    </article>
  `;
}

function renderPools() {
  const homeCards = POOLS.slice(0, 4).map((pool) => renderPoolCard(pool, true)).join("");
  const poolCards = POOLS.map((pool) => renderPoolCard(pool)).join("");
  dom.homePools.innerHTML = homeCards;
  dom.poolList.innerHTML = poolCards;
}

function renderActivity() {
  const rows = [
    ["Latest settlement", "Pending", "Loaded from verified state"],
    ["Open rounds", state.onchainAvailable ? "Live" : "Pending", "Backend /pools"],
    ["Reserve jackpot", "Pending", "No fake balances shown"],
    ["Randomness provider", "ORAO VRF", "Production randomness"],
  ];

  dom.activityList.innerHTML = rows.map(([label, value, detail]) => `
    <div class="list-row">
      <div>
        <span class="label">${label}</span>
        <p>${detail}</p>
      </div>
      <strong class="mono ${value === "Pending" ? "warning" : "success"}">${value}</strong>
    </div>
  `).join("");
}

function renderStatus() {
  const live = state.onchainAvailable;
  const reason = state.config?.onchain?.reason || normalizeReason(state.lastError) || "";
  const statusText = live ? "Mainnet live" : "Mainnet syncing";
  const dotClass = live ? "dot-live" : "dot-sync";

  dom.chainStatus.innerHTML = `<span class="status-dot ${dotClass}"></span><span>${statusText}</span>`;
  dom.homeStatusTitle.textContent = live ? "Live" : "Pending";
  dom.homeStatusCopy.textContent = live
    ? "Backend and on-chain pool state are available."
    : reason
      ? `Waiting for verified chain state: ${reason}.`
      : "Live pool values appear only after the backend confirms the deployed program.";
  dom.homeStatusPill.textContent = live ? "Live" : "Syncing";
  dom.homeStatusPill.className = `status-pill ${live ? "success" : "warning"}`;
  dom.poolsNote.textContent = live
    ? "Live pool state is available. Review each transaction before signing."
    : "Static rules are shown now. Live rounds load from the backend when on-chain state is available.";
}

function normalizeReason(reason) {
  if (!reason) {
    return "";
  }
  return /failed to fetch|load failed|networkerror/i.test(reason)
    ? "api_unavailable_or_cors"
    : reason;
}

function renderWalletPill() {
  const label = state.wallet ? formatAddress(state.wallet.address) : "Connect wallet";
  dom.walletPill.textContent = label;
}

function isMobileBrowser() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || window.matchMedia("(max-width: 760px)").matches;
}

function hasMobileWalletFallback() {
  return Boolean(WALLETCONNECT_PROJECT_ID) || isMobileBrowser();
}

function mobileWalletBrowserOptions() {
  return isMobileBrowser() ? MOBILE_WALLET_BROWSERS : [];
}

function appUrlForMobileWallet() {
  const url = new URL("/play/", window.location.origin);
  url.searchParams.set("wallet", "1");
  return url.toString();
}

function mobileWalletBrowseUrl(walletId) {
  const target = encodeURIComponent(appUrlForMobileWallet());
  const ref = encodeURIComponent(window.location.origin);

  if (walletId === "phantom") {
    return `https://phantom.app/ul/browse/${target}?ref=${ref}`;
  }
  if (walletId === "solflare") {
    return `https://solflare.com/ul/v1/browse/${target}?ref=${ref}`;
  }
  if (walletId === "backpack") {
    return `https://backpack.app/ul/v1/browse/${target}?ref=${ref}`;
  }
  throw new Error("Unsupported mobile wallet");
}

function openMobileWalletBrowser(walletId) {
  window.location.assign(mobileWalletBrowseUrl(walletId));
}

function renderWallets() {
  const wallets = discoverWallets();

  if (state.wallet) {
    dom.walletList.innerHTML = `
      <article class="wallet-card active">
        <div class="row">
          <div>
            <span class="label">Connected wallet</span>
            <h3>${state.wallet.name}</h3>
          </div>
          <strong class="success">CONNECTED</strong>
        </div>
        <p class="mono">${state.wallet.address}</p>
        <div class="wallet-actions">
          ${OPERATOR_MODE ? `<button class="primary-button" data-action="crank-empty-rounds">Crank rounds</button>` : ""}
          <button class="secondary-button" data-action="disconnect">Disconnect</button>
        </div>
      </article>
    `;
    showWalletMessage(`Connected ${state.wallet.name}: ${state.wallet.address}`, "success");
  } else {
    const hasWalletOption = wallets.length || hasMobileWalletFallback() || Boolean(WALLETCONNECT_PROJECT_ID);
    dom.walletList.innerHTML = `
      <article class="wallet-card wallet-connect-card">
        <div class="row">
          <div>
            <span class="label">Wallet</span>
            <h3>Connect wallet</h3>
          </div>
        </div>
        <p>Choose a detected browser wallet or continue with a mobile wallet app.</p>
        <div class="wallet-actions">
          <button class="primary-button" data-action="toggle-wallet-menu">Connect wallet</button>
        </div>
      </article>
      ${state.walletMenuOpen ? walletMenu(wallets) : ""}
    `;
    showWalletMessage(
      state.walletMenuOpen
        ? hasWalletOption
          ? "Choose a wallet connection to continue."
          : "No compatible Solana wallet was detected in this browser."
        : "Connect a wallet before reviewing a pool entry.",
      state.walletMenuOpen && !hasWalletOption ? "warning" : "soft",
    );
  }
}

function walletMenu(wallets) {
  const canUseWalletConnect = Boolean(WALLETCONNECT_PROJECT_ID);
  const mobileWallets = mobileWalletBrowserOptions();
  const hasOptions = wallets.length || canUseWalletConnect || mobileWallets.length;

  if (!hasOptions) {
    return `
      <article class="wallet-card wallet-menu">
        <span class="label">Detected wallets</span>
        <p>No compatible Solana wallet was detected in this browser.</p>
      </article>
    `;
  }

  return `
    <article class="wallet-card wallet-menu">
      <span class="label">${hasOptions ? "Wallet connection" : "Detected wallets"}</span>
      <div class="wallet-option-list">
        ${wallets.map((wallet) => `
          <button class="wallet-option" data-connect="${wallet.id}">
            <span>${wallet.name}</span>
            <strong>Connect</strong>
          </button>
        `).join("")}
        ${canUseWalletConnect ? `
          <button class="wallet-option" data-connect="mobile-wallet">
            <span>Mobile wallet</span>
            <strong>Connect</strong>
          </button>
        ` : ""}
        ${mobileWallets.map((wallet) => `
          <button class="wallet-option" data-connect="mobile-open:${wallet.id}">
            <span>Open in ${wallet.name}</span>
            <strong>Open</strong>
          </button>
        `).join("")}
      </div>
      ${state.walletConnectUri ? `
        <div class="wallet-uri-box">
          <span class="label">WalletConnect ready</span>
          <p>Open the WalletConnect prompt in your wallet app, or copy the session URI if the prompt is blocked.</p>
          <button class="secondary-button" data-action="copy-walletconnect-uri">Copy session URI</button>
        </div>
      ` : ""}
      ${mobileWallets.length ? `<p class="wallet-menu-note">Chrome mobile cannot read phone wallet apps directly. Open LuckyMe inside your wallet app, then connect from that wallet browser.</p>` : ""}
    </article>
  `;
}

function showWalletMessage(message, tone = "warning") {
  dom.walletMessage.hidden = false;
  dom.walletMessage.textContent = message;
  dom.walletMessage.className = `notice ${tone}`;
}

function injectedWallet(id, name, provider) {
  return {
    id,
    name,
    provider,
    type: "injected",
  };
}

function discoverInjectedWallets() {
  const candidates = [];
  const seen = new Set();
  const add = (wallet) => {
    if (!wallet.provider || seen.has(wallet.provider)) {
      return;
    }
    seen.add(wallet.provider);
    candidates.push(wallet);
  };

  add(injectedWallet("phantom", "Phantom", window.phantom?.solana));
  if (window.solana?.isPhantom) {
    add(injectedWallet("phantom-window", "Phantom", window.solana));
  }
  add(injectedWallet("solflare", "Solflare", window.solflare));
  add(injectedWallet("backpack", "Backpack", window.backpack?.solana || window.backpack));
  add(injectedWallet("brave", "Brave Wallet", window.braveSolana));
  add(injectedWallet("glow", "Glow", window.glowSolana));

  return candidates.filter((wallet) => typeof wallet.provider?.connect === "function");
}

function discoverWallets() {
  return discoverInjectedWallets();
}

function loadScript(src) {
  if (!scriptLoaders.has(src)) {
    const loader = new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(script);
    });
    scriptLoaders.set(src, loader);
  }

  return scriptLoaders.get(src);
}

async function loadWalletConnectProviderClass() {
  await loadScript(WALLETCONNECT_PROVIDER_URL);
  const providerModule = window["@walletconnect/universal-provider"];
  const UniversalProvider = providerModule?.UniversalProvider || providerModule?.default;

  if (typeof UniversalProvider?.init !== "function") {
    throw new Error("WalletConnect provider failed to load");
  }

  return UniversalProvider;
}

async function loadWalletConnectModalClass() {
  try {
    globalThis.process = globalThis.process || { env: {} };
    globalThis.process.env = globalThis.process.env || {};
    const modalModule = await import(WALLETCONNECT_MODAL_URL);
    return modalModule?.WalletConnectModal || null;
  } catch (error) {
    console.warn("WalletConnect modal failed to load", error);
    return null;
  }
}

async function getWalletConnectProvider() {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error("Mobile wallet connection is not configured yet");
  }

  if (state.walletConnectProvider) {
    return state.walletConnectProvider;
  }

  const [UniversalProvider, WalletConnectModal] = await Promise.all([
    loadWalletConnectProviderClass(),
    loadWalletConnectModalClass(),
  ]);

  const provider = await UniversalProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    metadata: {
      name: "LuckyMe",
      description: "LuckyMe Solana pools",
      url: window.location.origin,
      icons: [`${window.location.origin}/assets/brand/apple-touch-icon.png`],
    },
  });

  const modal = typeof WalletConnectModal === "function"
    ? new WalletConnectModal({
        projectId: WALLETCONNECT_PROJECT_ID,
        chains: WALLETCONNECT_SOLANA_CHAINS,
        themeMode: "dark",
      })
    : null;

  provider.on("display_uri", (uri) => {
    state.walletConnectUri = uri;
    modal?.openModal?.({ uri });
    renderWallets();
    showWalletMessage("WalletConnect session ready. Continue in your wallet app.", "soft");
  });

  provider.on("session_delete", () => {
    state.walletConnectUri = "";
    if (state.wallet?.type === "walletconnect") {
      state.wallet = null;
      state.preparedTransaction = null;
      renderWalletPill();
      renderWallets();
    }
  });

  state.walletConnectProvider = provider;
  state.walletConnectModal = modal;
  return provider;
}

function parseWalletConnectAccount(session) {
  const account = session?.namespaces?.solana?.accounts?.find((item) => item.startsWith("solana:"));
  const [, reference, address] = account?.split(":") || [];
  if (!address) {
    throw new Error("Mobile wallet did not return a Solana account");
  }
  return { account, chainId: `solana:${reference}`, address };
}

async function connectWalletConnect() {
  const provider = await getWalletConnectProvider();
  state.walletConnectUri = "";
  const session = provider.session || await provider.connect({
    optionalNamespaces: {
      solana: {
        chains: WALLETCONNECT_SOLANA_CHAINS,
        methods: WALLETCONNECT_SOLANA_METHODS,
        events: [],
      },
    },
  });

  state.walletConnectModal?.closeModal?.();
  state.walletConnectUri = "";

  const account = parseWalletConnectAccount(session || provider.session);
  state.wallet = {
    id: "mobile-wallet",
    name: "Mobile wallet",
    type: "walletconnect",
    provider,
    session: session || provider.session,
    chainId: account.chainId,
    address: account.address,
  };
}

async function connectInjected(wallet) {
  const response = await wallet.provider.connect({ onlyIfTrusted: false });
  const publicKey = response?.publicKey || wallet.provider.publicKey;
  const address = publicKey?.toBase58 ? publicKey.toBase58() : publicKey?.toString?.();

  if (!address) {
    throw new Error(`${wallet.name} did not return a Solana address`);
  }

  state.wallet = {
    id: wallet.id,
    name: wallet.name,
    type: "injected",
    provider: wallet.provider,
    address,
  };
}

async function connectWallet(walletId) {
  if (walletId.startsWith("mobile-open:")) {
    try {
      openMobileWalletBrowser(walletId.replace("mobile-open:", ""));
    } catch (error) {
      showWalletMessage(error instanceof Error ? error.message : String(error), "danger");
    }
    return;
  }

  if (walletId === "mobile-wallet") {
    try {
      await connectWalletConnect();
      state.walletMenuOpen = false;
      renderWalletPill();
      renderWallets();
      await loadPools();
    } catch (error) {
      state.walletConnectModal?.closeModal?.();
      showWalletMessage(error instanceof Error ? error.message : String(error), "danger");
    }
    return;
  }

  const wallet = discoverWallets().find((item) => item.id === walletId);
  if (!wallet) {
    return;
  }

  try {
    await connectInjected(wallet);
    state.walletMenuOpen = false;

    renderWalletPill();
    renderWallets();
    await loadPools();
  } catch (error) {
    showWalletMessage(error instanceof Error ? error.message : String(error), "danger");
  }
}

async function disconnectWallet() {
  try {
    if (state.wallet?.type === "walletconnect") {
      await state.wallet.provider?.disconnect?.();
    } else if (state.wallet?.disconnect) {
      await state.wallet.disconnect();
    } else if (state.wallet?.provider?.disconnect) {
      await state.wallet.provider.disconnect();
    }
  } finally {
    state.wallet = null;
    state.walletConnectUri = "";
    state.preparedTransaction = null;
    renderWalletPill();
    renderWallets();
  }
}

async function copyWalletConnectUri() {
  if (!state.walletConnectUri) {
    showWalletMessage("WalletConnect session is not ready yet.", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(state.walletConnectUri);
    showWalletMessage("WalletConnect session URI copied.", "success");
  } catch (error) {
    showWalletMessage(error instanceof Error ? error.message : "Could not copy WalletConnect URI.", "danger");
  }
}

function renderReview() {
  const pool = state.selectedPool ? poolById(state.selectedPool) : POOLS[0];
  const ticketLimit = selectedTicketLimit(pool.id);
  const ticketCount = Math.min(state.ticketCount, ticketLimit);
  const amountLamports = selectedTicketPriceLamports(pool.id) * BigInt(ticketCount);
  const timing = roundTiming(pool.id);
  const connected = Boolean(state.wallet);
  const canBuy = connected && state.onchainAvailable && timing.isOpen;
  const buyLabel = ticketCount === 1 ? "Buy 1 ticket" : `Buy ${ticketCount} tickets`;

  dom.reviewPanel.innerHTML = `
    <div>
      <span class="label">Pool</span>
      <h2>${pool.name}</h2>
      <p>${pool.entrySol} SOL per ticket. ${pool.prize}. ${pool.winners}.</p>
    </div>
    <div class="ticket-control">
      <div>
        <span class="label">Tickets</span>
        <strong>${ticketCount}</strong>
        <p>${formatSolFromLamports(amountLamports)} SOL total</p>
      </div>
      <div class="stepper" role="group" aria-label="Ticket count">
        <button class="icon-button" data-action="ticket-dec" ${ticketCount <= 1 ? "disabled" : ""}>-</button>
        <input data-ticket-input type="number" min="1" max="${ticketLimit}" step="1" value="${ticketCount}" inputmode="numeric" aria-label="Tickets" />
        <button class="icon-button" data-action="ticket-inc" ${ticketCount >= ticketLimit ? "disabled" : ""}>+</button>
      </div>
    </div>
    <div class="review-summary">
      <div class="list-row">
        <div><span class="label">${timing.status}</span><p>${timing.isOpen ? "Round is open for entries" : "This round is no longer accepting entries"}</p></div>
        <strong class="${timing.isOpen ? "success" : "warning"}">${timing.timeLeft}</strong>
      </div>
      <div class="list-row">
        <div><span class="label">Wallet</span><p class="mono">${state.wallet?.address || "Not connected"}</p></div>
        <strong class="${connected ? "success" : "warning"}">${connected ? "CONNECTED" : "REQUIRED"}</strong>
      </div>
    </div>
    ${state.lastError ? `<div class="notice danger">${state.lastError}</div>` : ""}
    <div class="wallet-actions">
      ${connected ? "" : `<button class="primary-button" data-route="wallet">Connect wallet</button>`}
      <button class="primary-button" data-action="buy" ${canBuy ? "" : "disabled"}>${buyLabel}</button>
      <button class="secondary-button" data-route="pools">Back to pools</button>
    </div>
    ${state.onchainAvailable ? "" : `<div class="notice">Mainnet pool state is not available yet.</div>`}
    ${state.onchainAvailable && timing.canDetermine && !timing.isOpen ? `<div class="notice">This round is closed. Wait for the next round to open.</div>` : ""}
  `;
}

async function prepareTransaction() {
  if (!state.wallet || !state.selectedPool) {
    return null;
  }
  state.lastError = "";
  state.preparedTransaction = null;
  renderReview();

  try {
    const response = await fetch(`${API_BASE}/transactions/buy-tickets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        pool: state.selectedPool,
        ticketCount: state.ticketCount,
        player: state.wallet.address,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Transaction build failed");
    }
    state.preparedTransaction = payload;
    return payload;
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
    return null;
  } finally {
    renderReview();
  }
}

async function signAndSendPreparedTransaction() {
  if (!state.wallet || !state.preparedTransaction?.transactionBase64) {
    return;
  }

  state.lastError = "";
  renderReview();

  try {
    const signature = await signAndSendTransactionPayload(state.preparedTransaction);
    state.preparedTransaction.signature = signature;
    state.lastError = signature ? `Submitted: ${signature}` : "Transaction submitted";
  } catch (error) {
    state.lastError = error instanceof Error ? error.message : String(error);
  }

  renderReview();
}

async function buyWithWallet() {
  const prepared = await prepareTransaction();
  if (!prepared?.transactionBase64) {
    return;
  }
  await signAndSendPreparedTransaction();
}

async function signAndSendTransactionPayload(preparedTransaction) {
  if (!state.wallet || !preparedTransaction?.transactionBase64) {
    return null;
  }

  const transaction = Transaction.from(base64ToBytes(preparedTransaction.transactionBase64));
  const provider = state.wallet.provider;

  if (state.wallet.type === "walletconnect") {
    return signAndSendWalletConnectTransaction(preparedTransaction.transactionBase64, preparedTransaction.clusterUrl);
  }

  if (typeof provider.signAndSendTransaction === "function") {
    const result = await provider.signAndSendTransaction(transaction);
    return typeof result === "string" ? result : result?.signature;
  }

  if (typeof provider.signTransaction === "function") {
    const signed = await provider.signTransaction(transaction);
    const connection = new Connection(preparedTransaction.clusterUrl || state.config?.clusterUrl || DEFAULT_RPC, "confirmed");
    const signature = await connection.sendRawTransaction(signed.serialize(), {
      maxRetries: 3,
      skipPreflight: false,
    });
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  throw new Error(`${state.wallet.name} does not expose a Solana transaction signing method`);
}

async function crankEmptyRounds() {
  if (!state.wallet?.address) {
    showWalletMessage("Connect a funded Solana wallet first.", "warning");
    return;
  }

  showWalletMessage("Preparing round crank transaction...", "soft");

  try {
    const response = await fetch(`${API_BASE}/transactions/crank-empty-rounds`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        keeper: state.wallet.address,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Crank transaction build failed");
    }
    if (!payload.transactionBase64) {
      showWalletMessage("No expired empty rounds need cranking.", "success");
      return;
    }
    if (payload.simulation && payload.simulation.ok === false) {
      throw new Error(`Crank simulation failed: ${JSON.stringify(payload.simulation.err)}`);
    }

    const signature = await signAndSendTransactionPayload(payload);
    showWalletMessage(signature ? `Crank submitted: ${signature}` : "Crank transaction submitted.", "success");
    await loadPools();
    renderWallets();
  } catch (error) {
    showWalletMessage(error instanceof Error ? error.message : String(error), "danger");
  }
}

async function signAndSendWalletConnectTransaction(transactionBase64, clusterUrl) {
  const provider = state.wallet?.provider;
  const chainId = state.wallet?.chainId || WALLETCONNECT_SOLANA_CHAIN;
  const methods = state.wallet?.session?.namespaces?.solana?.methods || [];
  const connection = new Connection(clusterUrl || state.config?.clusterUrl || DEFAULT_RPC, "confirmed");

  if (methods.includes("solana_signAndSendTransaction")) {
    const result = await provider.request({
      method: "solana_signAndSendTransaction",
      params: {
        transaction: transactionBase64,
        sendOptions: {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        },
      },
    }, chainId);
    return result?.signature || result;
  }

  const result = await provider.request({
    method: "solana_signTransaction",
    params: {
      transaction: transactionBase64,
    },
  }, chainId);

  if (!result?.transaction) {
    throw new Error("Mobile wallet did not return a signed transaction");
  }

  const signature = await connection.sendRawTransaction(base64ToBytes(result.transaction), {
    maxRetries: 3,
    skipPreflight: false,
  });
  await connection.confirmTransaction(signature, "confirmed");
  return signature;
}

function base64ToBytes(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function loadConfig() {
  try {
    const response = await fetch(`${API_BASE}/config`, {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json();
    state.config = payload;
    state.onchainAvailable = payload.onchainAvailable === true || payload.onchain?.available === true;
    state.lastError = "";
  } catch (error) {
    state.config = null;
    state.onchainAvailable = false;
    state.lastError = error instanceof Error ? error.message : String(error);
  }

  renderStatus();
  renderPools();
  renderActivity();
}

async function loadPools() {
  try {
    const url = new URL(`${API_BASE}/pools`);
    if (state.wallet?.address) {
      url.searchParams.set("player", state.wallet.address);
    }
    const response = await fetch(url.toString(), {
      headers: { accept: "application/json" },
      cache: "no-store",
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Pool fetch failed");
    }
    state.pools = Array.isArray(payload.pools) ? payload.pools : [];
    state.poolsLoaded = true;
    state.onchainAvailable = payload.onchain?.available === true;
  } catch (error) {
    state.pools = [];
    state.poolsLoaded = false;
    state.onchainAvailable = false;
    state.lastError = error instanceof Error ? error.message : String(error);
  }

  renderStatus();
  renderPools();
  renderActivity();
}

document.addEventListener("click", async (event) => {
  const routeButton = event.target.closest("[data-route]");
  if (routeButton) {
    setRoute(routeButton.dataset.route);
    return;
  }

  const poolButton = event.target.closest("[data-pool]");
  if (poolButton) {
    state.selectedPool = poolButton.dataset.pool;
    setTicketCount(1);
    state.preparedTransaction = null;
    state.lastError = "";
    setRoute("review");
    return;
  }

  const connectButton = event.target.closest("[data-connect]");
  if (connectButton) {
    await connectWallet(connectButton.dataset.connect);
    return;
  }

  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) {
    return;
  }

  const action = actionButton.dataset.action;
  if (action === "refresh") {
    await loadConfig();
    await loadPools();
  } else if (action === "toggle-wallet-menu") {
    state.walletMenuOpen = !state.walletMenuOpen;
    renderWallets();
  } else if (action === "copy-walletconnect-uri") {
    await copyWalletConnectUri();
  } else if (action === "ticket-dec") {
    setTicketCount(state.ticketCount - 1);
    renderReview();
  } else if (action === "ticket-inc") {
    setTicketCount(state.ticketCount + 1);
    renderReview();
  } else if (action === "buy") {
    await buyWithWallet();
  } else if (action === "crank-empty-rounds") {
    await crankEmptyRounds();
  } else if (action === "sign") {
    await signAndSendPreparedTransaction();
  } else if (action === "disconnect") {
    await disconnectWallet();
  }
});

document.addEventListener("change", (event) => {
  const input = event.target.closest("[data-ticket-input]");
  if (!input) {
    return;
  }
  setTicketCount(input.value);
  renderReview();
});

setInterval(() => {
  if (!state.onchainAvailable) {
    return;
  }
  renderPools();
  if (state.route === "review" && !document.activeElement?.matches?.("[data-ticket-input]")) {
    renderReview();
  }
}, 1000);

renderPools();
renderActivity();
renderWalletPill();
if (new URLSearchParams(window.location.search).has("wallet")) {
  state.walletMenuOpen = true;
  setRoute("wallet");
}
loadConfig();
loadPools();
