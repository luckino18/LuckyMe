import { Connection, PublicKey, Transaction } from "https://esm.sh/@solana/web3.js@1.98.4?bundle";
import {
  SOLANA_MAINNET_CHAIN,
  SOLANA_SIGN_AND_SEND_TRANSACTION,
  SOLANA_SIGN_TRANSACTION,
  STANDARD_DISCONNECT,
  STANDARD_EVENTS,
  base58Encode,
  compatibleWalletStandardOptions,
  connectWalletStandardOption,
  createWalletStandardRegistry,
  mergeCompatibleWalletOptions,
  selectSolanaMainnetAccount,
} from "./wallet-standard.js?v=20260712-pool-walletconnect-fix";
import { createWalletConnectFlow } from "./walletconnect-flow.js?v=20260712-pool-walletconnect-fix";

const API_BASE = "https://api.lucky-me.app";
const PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const WALLETCONNECT_PROJECT_ID = window.LUCKYME_WALLETCONNECT_PROJECT_ID || "";
const WALLETCONNECT_SOLANA_CHAIN = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const WALLETCONNECT_SOLANA_CHAINS = [WALLETCONNECT_SOLANA_CHAIN];
const WALLETCONNECT_SOLANA_METHODS = [
  "solana_signTransaction",
  "solana_signAndSendTransaction",
];
const WALLETCONNECT_SOLANA_EVENTS = ["accountsChanged"];
const WALLETCONNECT_BUNDLE_URL = "/assets/vendor/walletconnect-bundle.js?v=20260712-walletconnect-recovery2";
const OPERATOR_MODE = new URLSearchParams(window.location.search).has("operator");
const DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111";
const MOBILE_WALLET_BROWSERS = [
  { id: "phantom", name: "Phantom" },
  { id: "solflare", name: "Solflare" },
  { id: "backpack", name: "Backpack" },
];
const walletStandardRegistry = createWalletStandardRegistry(window);

const POOLS = [
  {
    id: "mini",
    name: "Mini",
    chip: "Low entry",
    entrySol: "0.005",
    prize: "95% main prize",
    winners: "1 winner",
    limit: "1,000 tickets max",
    minimumTickets: 25,
    minimumDistinctEntrants: 1,
    note: "The target is 25 total tickets; several may come from the same wallet.",
  },
  {
    id: "normal",
    name: "Normal",
    chip: "Balanced",
    entrySol: "0.01",
    prize: "95% main prize",
    winners: "1 winner",
    limit: "1,000 tickets max",
    minimumTickets: 13,
    minimumDistinctEntrants: 1,
    note: "One wallet may buy multiple tickets toward the 13-ticket target.",
  },
  {
    id: "high",
    name: "High",
    chip: "Higher entry",
    entrySol: "0.05",
    prize: "95% main prize",
    winners: "1 winner",
    limit: "1,000 tickets max",
    minimumTickets: 3,
    minimumDistinctEntrants: 1,
    note: "The target is three total tickets; one wallet may buy more than one.",
  },
  {
    id: "premium",
    name: "Premium",
    chip: "3 winners",
    entrySol: "0.1",
    prize: "70 / 20 / 10 split",
    winners: "3 winners",
    limit: "1 ticket per wallet",
    minimumTickets: 3,
    minimumDistinctEntrants: 3,
    note: "Three tickets from three distinct wallets are required.",
  },
];

const state = {
  route: "home",
  config: null,
  pools: [],
  poolsLoaded: false,
  poolsLoading: false,
  onchainAvailable: false,
  wallet: null,
  walletEventCleanup: null,
  walletModalOpen: false,
  walletModalMessage: "",
  walletModalTone: "soft",
  walletConnectProvider: null,
  walletConnectModal: null,
  walletConnectUri: "",
  walletConnectQrDataUrl: "",
  walletConnectBusy: false,
  walletConnectPhase: "idle",
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
  walletModal: document.querySelector("#wallet-modal"),
  walletModalBody: document.querySelector("#wallet-modal-body"),
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

function minimumPolicy(poolId = state.selectedPool) {
  const staticPool = poolById(poolId);
  const livePool = poolFromApi(poolId);
  return {
    minimumTickets: Number(livePool?.minimumTickets ?? staticPool.minimumTickets),
    minimumDistinctEntrants: Number(
      livePool?.minimumDistinctEntrants ?? staticPool.minimumDistinctEntrants,
    ),
  };
}

function hasVerifiedMinimumPolicy(poolId = state.selectedPool) {
  const staticPool = poolById(poolId);
  const livePool = poolFromApi(poolId);
  const round = activeRound(livePool);
  return Boolean(
    round &&
    Number(livePool?.minimumTickets) === staticPool.minimumTickets &&
    Number(livePool?.minimumDistinctEntrants) === staticPool.minimumDistinctEntrants &&
    Number(round.minimumTickets) === staticPool.minimumTickets &&
    Number(round.minimumDistinctEntrants) === staticPool.minimumDistinctEntrants &&
    typeof round.minimumReached === "boolean" &&
    Number.isFinite(Number(round.ticketsRemaining)) &&
    typeof round.roundOutcome === "string" &&
    typeof round.refundStatus === "string"
  );
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

function bigintValue(value) {
  try {
    return BigInt(value?.toString?.() ?? value ?? 0);
  } catch {
    return 0n;
  }
}

function numberValue(value) {
  const parsed = Number(value?.toString?.() ?? value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function activeRound(poolOrId) {
  const livePool = typeof poolOrId === "string" ? poolFromApi(poolOrId) : poolOrId;
  const round = livePool?.activeRound;
  return round && round.missing !== true ? round : null;
}

function roundUserEntry(round) {
  const entry = round?.userEntry;
  return entry && bigintValue(entry.ticketCount) > 0n ? entry : null;
}

function ticketWord(value) {
  return Number(value) === 1 ? "ticket" : "tickets";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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
  const round = activeRound(livePool);
  const roundId = round?.roundId ?? livePool?.currentRound ?? null;

  if (!livePool) {
    return {
      isOpen: false,
      canDetermine: state.poolsLoaded,
      roundId,
      status: state.poolsLoaded ? "Unavailable" : "Syncing",
      timeLeft: state.poolsLoaded ? "No verified pool state" : "Syncing",
      chipClass: "warning",
    };
  }

  if (!round) {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: "No active round",
      timeLeft: "Maintenance required",
      chipClass: "warning",
    };
  }

  if (!hasVerifiedMinimumPolicy(livePool.id || poolId)) {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Rule update required",
      chipClass: "warning",
      maintenanceRequired: true,
    };
  }

  const outcome = round.roundOutcome;
  if (outcome === "waiting") {
    return {
      isOpen: true,
      waitingFirstTicket: true,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Starts with first ticket",
      chipClass: "success",
    };
  }

  if (outcome === "settled") {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Settled",
      chipClass: "success",
    };
  }

  if (outcome === "cancelled_below_minimum") {
    const refundComplete = round.refundStatus === "completed";
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: refundComplete ? "Refund complete" : "Refunding",
      chipClass: refundComplete ? "success" : "warning",
      cancelledBelowMinimum: true,
      refundComplete,
    };
  }

  if (outcome === "eligible_for_draw") {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Draw queued",
      chipClass: "success",
      settlementPending: true,
    };
  }

  if (outcome === "settling") {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Settling",
      chipClass: "warning",
      settlementPending: true,
    };
  }

  const endTs = Number(round.endTs || 0);
  const remainingSeconds = endTs - Math.floor(Date.now() / 1000);
  if (outcome === "open" && remainingSeconds <= 0) {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Confirming final state",
      chipClass: "warning",
    };
  }

  if (outcome !== "open") {
    return {
      isOpen: false,
      canDetermine: true,
      roundId,
      status: `Round ${roundId}`,
      timeLeft: "Maintenance required",
      chipClass: "warning",
      maintenanceRequired: true,
    };
  }

  return {
    isOpen: outcome === "open" && remainingSeconds > 0,
    canDetermine: true,
    roundId,
    status: `Round ${roundId}`,
    timeLeft: formatDuration(remainingSeconds),
    chipClass: "success",
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

function renderMinimumTarget(pool, livePool, round) {
  const policy = minimumPolicy(pool.id);
  const verified = Boolean(round) && hasVerifiedMinimumPolicy(pool.id);
  const sold = verified ? Math.max(0, numberValue(round.totalTickets)) : null;
  const remaining = verified
    ? Math.max(0, Number(round.ticketsRemaining))
    : null;
  const progressValue = verified
    ? Math.min(sold, policy.minimumTickets)
    : 0;
  const refundComplete = verified && round.refundStatus === "completed";
  const refundPending = verified && round.roundOutcome === "cancelled_below_minimum" && !refundComplete;
  const minimumReached = verified && round.minimumReached === true;
  let message;
  let tone = "";

  if (!round) {
    message = "Maintenance required — verified round data is unavailable";
    tone = "warning";
  } else if (!verified) {
    message = "Maintenance required — minimum rules are not verified";
    tone = "warning";
  } else if (refundComplete) {
    message = "Refund complete — ticket purchase amount returned";
    tone = "success";
  } else if (refundPending) {
    message = "Round cancelled — automatic refunds in progress";
    tone = "warning";
  } else if (minimumReached) {
    message = pool.id === "premium"
      ? "Minimum reached — this round will draw three winners"
      : "Minimum reached — this round will draw a winner";
    tone = "success";
  } else {
    message = `${remaining} ${ticketWord(remaining)} still needed`;
  }

  const soldCopy = verified
    ? `${sold} / ${policy.minimumTickets} tickets sold`
    : `— / ${policy.minimumTickets} tickets sold`;
  const premiumWalletCopy = pool.id === "premium" && verified
    ? `<p class="minimum-wallets">${numberValue(round.entrantCount)} / ${policy.minimumDistinctEntrants} distinct wallets</p>`
    : "";

  return `
    <section class="minimum-target ${tone}" aria-label="${escapeHtml(pool.name)} minimum for a valid draw">
      <span class="label">Minimum for a valid draw</span>
      <strong>${soldCopy}</strong>
      <div
        class="minimum-progress"
        role="progressbar"
        aria-label="${escapeHtml(pool.name)} total ticket target"
        aria-valuemin="0"
        aria-valuemax="${policy.minimumTickets}"
        ${verified ? `aria-valuenow="${progressValue}"` : "aria-valuetext=\"Unavailable\""}
      ><span style="width:${verified ? (progressValue / policy.minimumTickets) * 100 : 0}%"></span></div>
      <p class="minimum-message">${message}</p>
      ${premiumWalletCopy}
      <p class="minimum-clarification">Target counts total tickets sold, not players.${pool.id === "premium" ? " Premium also requires three distinct wallets." : ""}</p>
    </section>
  `;
}

function renderPoolCard(pool, compact = false) {
  const livePool = poolFromApi(pool.id);
  const timing = roundTiming(pool.id);
  const round = activeRound(livePool);
  const userEntry = roundUserEntry(round);
  const totalTickets = bigintValue(round?.totalTickets);
  const entrantCount = numberValue(round?.entrantCount);
  const poolStateReady = state.onchainAvailable && state.poolsLoaded &&
    Boolean(round) && hasVerifiedMinimumPolicy(pool.id);
  const liveStatus = timing.status;
  const jackpotValue = poolStateReady && livePool?.jackpotSol
    ? `${livePool.jackpotSol} SOL`
    : "Pending";
  const actionLabel = poolStateReady
    ? timing.isOpen
      ? `Join ${pool.name}`
      : timing.refundComplete
      ? "Refund complete"
      : timing.cancelledBelowMinimum
      ? "Refunding"
      : timing.settlementPending
      ? "Settling"
      : "Maintenance"
    : state.poolsLoaded ? "Unavailable" : "Syncing";
  const disablePrimary = !poolStateReady || !timing.isOpen;

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
      ${renderMinimumTarget(pool, livePool, round)}
      <div class="facts-grid">
        <div class="fact"><span class="label">Prize</span><strong>${pool.prize}</strong></div>
        <div class="fact"><span class="label">Winners</span><strong>${pool.winners}</strong></div>
        <div class="fact"><span class="label">Limit</span><strong>${pool.limit}</strong></div>
        <div class="fact"><span class="label">Sold</span><strong>${totalTickets.toString()} ${ticketWord(totalTickets)}</strong></div>
        <div class="fact"><span class="label">Players</span><strong>${entrantCount}</strong></div>
        ${state.wallet ? `<div class="fact"><span class="label">My tickets</span><strong>${userEntry ? `${escapeHtml(userEntry.ticketCount)} ${ticketWord(userEntry.ticketCount)}` : "0"}</strong></div>` : ""}
        <div class="fact time-fact"><span class="label">Time left</span><strong>${timing.timeLeft}</strong></div>
        <div class="fact jackpot-fact"><span class="label">Jackpot</span><strong>${jackpotValue}</strong></div>
      </div>
      <div class="pool-card-footer">
        ${compact ? "" : `<p>${pool.note} Live state loads only from verified on-chain data.</p>`}
        <button class="primary-button" data-pool="${pool.id}" ${disablePrimary ? "disabled" : ""}>${actionLabel}</button>
        ${operatorPoolActions(pool, timing, round)}
      </div>
    </article>
  `;
}

function operatorPoolActions(pool, timing, round) {
  if (!OPERATOR_MODE) {
    return "";
  }

  const roundId = round?.roundId;
  const provider = round?.providerRandomness || {};
  const buttons = [];

  if (timing.settlementPending && roundId) {
    if (provider.status === "not_requested") {
      buttons.push(`<button class="secondary-button" data-action="operator-request-randomness" data-pool-id="${pool.id}" data-round-id="${roundId}">Request randomness</button>`);
    } else if (provider.providerStatus === "missing") {
      buttons.push(`<button class="secondary-button" data-action="operator-request-orao" data-pool-id="${pool.id}" data-round-id="${roundId}">Request ORAO</button>`);
    } else if (provider.providerStatus === "fulfilled") {
      buttons.push(`<button class="secondary-button" data-action="operator-settle" data-pool-id="${pool.id}" data-round-id="${roundId}">Settle</button>`);
    } else {
      buttons.push(`<button class="secondary-button" disabled>ORAO pending</button>`);
    }
  }

  if (!buttons.length) {
    return "";
  }

  return `<div class="wallet-actions operator-actions">${buttons.join("")}</div>`;
}

function renderPools() {
  const homeCards = POOLS.slice(0, 4).map((pool) => renderPoolCard(pool, true)).join("");
  const poolCards = POOLS.map((pool) => renderPoolCard(pool)).join("");
  dom.homePools.innerHTML = homeCards;
  dom.poolList.innerHTML = poolCards;
}

function renderActivity() {
  const winnerItems = winnerShareItems();
  const roundItems = state.pools.flatMap((pool) => {
    const rows = [];
    const poolName = escapeHtml(pool.label || poolById(pool.id)?.name || pool.id);

    const currentRound = activeRound(pool);
    if (currentRound) {
      const timing = roundTiming(pool.id);
      const round = currentRound;
      const minimumTickets = Number(round.minimumTickets || pool.minimumTickets || 0);
      rows.push({
        label: `${poolName} round #${escapeHtml(round.roundId)}`,
        detail: `${escapeHtml(round.totalTickets)} / ${escapeHtml(minimumTickets)} total tickets · ${escapeHtml(round.entrantCount)} players · ${escapeHtml(round.totalSol || "0")} SOL`,
        value: timing.timeLeft,
        tone: timing.isOpen || timing.refundComplete ? "success" : "warning",
      });

      const entry = roundUserEntry(round);
      if (entry) {
        rows.push({
          label: `${poolName} my entry`,
          detail: `Round #${escapeHtml(round.roundId)} · entry ${escapeHtml(entry.address || "")}`,
          value: `${escapeHtml(entry.ticketCount)} ${ticketWord(entry.ticketCount)}`,
          tone: "success",
        });
      }
    }

    for (const round of pool.recentRounds || []) {
      const hasRefundOutcome = round?.roundOutcome === "cancelled_below_minimum" ||
        ["pending", "completed"].includes(round?.refundStatus);
      if (
        Number(round?.roundId) === Number(currentRound?.roundId) ||
        !hasRefundOutcome
      ) {
        continue;
      }
      const refundComplete = round.refundStatus === "completed";
      rows.push({
        label: `${poolName} round #${escapeHtml(round.roundId)}`,
        detail: refundComplete
          ? "Automatic refund complete. Ticket purchase amount returned."
          : "Round cancelled below its total-ticket target. Automatic refunds are in progress.",
        value: refundComplete ? "Refund complete" : "Refunding",
        tone: refundComplete ? "success" : "warning",
      });
    }

    return rows;
  });

  const winnerRows = winnerItems.map((item) => ({
    label: `${escapeHtml(item.poolName)} round #${escapeHtml(item.roundId)}`,
    detail: `${escapeHtml(item.amountSol)} SOL won by ${escapeHtml(formatAddress(item.wallet))}`,
    value: "Share card",
    tone: "success",
    href: item.href,
  }));

  if (winnerRows.length || roundItems.length) {
    dom.activityList.innerHTML = [...winnerRows, ...roundItems].map((item) => `
      <div class="list-row">
        <div>
          <span class="label">${item.label}</span>
          <p>${item.detail}</p>
        </div>
        ${item.href
          ? `<a class="secondary-button" href="${escapeHtml(item.href)}" target="_blank" rel="noopener">${item.value}</a>`
          : `<strong class="mono ${item.tone}">${item.value}</strong>`}
      </div>
    `).join("");
    return;
  }

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

function winnerShareItems() {
  return state.pools
    .flatMap((pool) => {
      const poolName = winnerPoolName(pool);
      return (pool.recentRounds || [])
        .filter((round) => round?.settled && Array.isArray(round.winners) && round.winners.length > 0)
        .flatMap((round) => round.winners
          .filter((winner) => winner?.winner && winner.winner !== DEFAULT_PUBLIC_KEY)
          .map((winner) => {
            const amountSol = winnerPrizeSol(pool, round, winner.rank);
            const params = new URLSearchParams({
              pool: poolName,
              round: String(round.roundId),
              amount: amountSol,
              wallet: winner.winner,
              shareUrl: "https://lucky-me.app/play/",
            });
            return {
              poolName,
              roundId: round.roundId,
              amountSol,
              wallet: winner.winner,
              href: `/winner/?${params.toString()}`,
            };
          }));
    })
    .slice(0, 8);
}

function winnerPoolName(pool) {
  const label = pool?.label || poolById(pool?.id)?.name || "LuckyMe";
  return /pool$/i.test(label) ? label : `${label} Pool`;
}

function winnerPrizeSol(pool, round, rank = 1) {
  try {
    const totalLamports = BigInt(round.totalLamports || 0);
    const mainPrizeBps = BigInt(pool.mainPrizeBps ?? 9500);
    const splitBps = BigInt(pool.prizeSplitBps?.[Number(rank) - 1] ?? (Number(rank) === 1 ? 10000 : 0));
    const prizeLamports = (totalLamports * mainPrizeBps * splitBps) / 100_000_000n;
    return formatSolFromLamports(prizeLamports);
  } catch {
    return "0";
  }
}

function renderStatus() {
  const live = state.onchainAvailable;
  const minimumRulesVerified = state.poolsLoaded && POOLS.every((pool) => {
    const livePool = poolFromApi(pool.id);
    return Number(livePool?.minimumTickets) === pool.minimumTickets &&
      Number(livePool?.minimumDistinctEntrants) === pool.minimumDistinctEntrants;
  });
  const reason = state.config?.onchain?.reason || normalizeReason(state.lastError) || "";
  const statusText = live ? "Mainnet live" : "Mainnet syncing";
  const dotClass = live ? "dot-live" : "dot-sync";

  dom.chainStatus.innerHTML = `<span class="status-dot ${dotClass}"></span><span>${statusText}</span>`;
  dom.homeStatusTitle.textContent = live && minimumRulesVerified ? "Live" : live ? "Maintenance" : "Pending";
  dom.homeStatusCopy.textContent = live && minimumRulesVerified
    ? "Backend, on-chain pool state, and ticket targets are verified."
    : live
    ? "On-chain state is available, but the minimum-ticket rules are not yet verified across every pool."
    : reason
      ? `Waiting for verified chain state: ${reason}.`
      : "Live pool values appear only after the backend confirms the deployed program.";
  dom.homeStatusPill.textContent = live && minimumRulesVerified ? "Live" : live ? "Maintenance" : "Syncing";
  dom.homeStatusPill.className = `status-pill ${live && minimumRulesVerified ? "success" : "warning"}`;
  dom.poolsNote.textContent = live && minimumRulesVerified
    ? "Live pool state and total-ticket targets are available. Review each purchase before signing."
    : live
    ? "Buying stays disabled until the backend and on-chain minimum-ticket rules are verified."
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
            <h3>${escapeHtml(state.wallet.name)}</h3>
          </div>
          <strong class="success">CONNECTED</strong>
        </div>
        <p class="mono">${state.wallet.address}</p>
        <div class="wallet-actions">
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
          <button class="primary-button" data-action="open-wallet-modal">Connect wallet</button>
        </div>
      </article>
    `;
    showWalletMessage(
      hasWalletOption
        ? "Connect a wallet before reviewing a pool entry."
        : "No compatible Solana wallet was detected in this browser.",
      hasWalletOption ? "soft" : "warning",
    );
  }
}

function walletInitials(name) {
  return String(name || "Wallet")
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function walletIconMarkup(wallet) {
  const icon = wallet.icon || wallet.provider?.icon || wallet.provider?._wallet?.icon;
  if (typeof icon === "string" && /^(data:image\/|https?:\/\/)/i.test(icon)) {
    return `<span class="wallet-modal-icon"><img src="${escapeHtml(icon)}" alt="" /></span>`;
  }
  return `<span class="wallet-modal-icon">${escapeHtml(walletInitials(wallet.name))}</span>`;
}

function renderWalletModal() {
  if (!dom.walletModal || !dom.walletModalBody) {
    return;
  }
  const wallets = discoverWallets();
  dom.walletModalBody.innerHTML = `
    <section class="wallet-modal-section">
      <h3>${wallets.length ? "Installed wallets" : "Browser wallets"}</h3>
      ${wallets.length ? `
        <div class="wallet-modal-grid">
          ${wallets.map((wallet) => `
            <button class="wallet-modal-option" data-connect="${escapeHtml(wallet.id)}" ${state.walletConnectBusy ? "disabled" : ""}>
              ${walletIconMarkup(wallet)}
              <span>${escapeHtml(wallet.name)}</span>
            </button>
          `).join("")}
        </div>
      ` : `<p class="wallet-modal-note">No compatible Solana extension was detected in this browser. Only wallets discovered in this browser are listed.</p>`}
    </section>
    ${WALLETCONNECT_PROJECT_ID ? `
      <section class="wallet-modal-section">
        <h3>Reown / WalletConnect</h3>
        <button class="wallet-modal-option walletconnect-option" data-connect="mobile-wallet" ${state.walletConnectBusy ? "disabled" : ""}>
          <span class="wallet-modal-icon">W</span>
          <span>WalletConnect</span>
          <strong>${state.walletConnectBusy ? "Connecting" : "Connect"}</strong>
        </button>
        ${state.walletConnectBusy ? `
          <div class="wallet-modal-controls">
            <button class="secondary-button" data-action="cancel-walletconnect">Cancel</button>
          </div>
        ` : ["error", "cancelled"].includes(state.walletConnectPhase) ? `
          <div class="wallet-modal-controls">
            <button class="secondary-button" data-action="retry-walletconnect">Try again</button>
          </div>
        ` : ""}
      </section>
    ` : ""}
    ${isMobileBrowser() ? `
      <section class="wallet-modal-section">
        <h3>Open wallet browser</h3>
        <div class="wallet-modal-grid">
          ${mobileWalletBrowserOptions().map((wallet) => `
            <button class="wallet-modal-option" data-connect="mobile-open:${wallet.id}" ${state.walletConnectBusy ? "disabled" : ""}>
              <span class="wallet-modal-icon">${escapeHtml(walletInitials(wallet.name))}</span>
              <span>${escapeHtml(wallet.name)}</span>
            </button>
          `).join("")}
        </div>
      </section>
    ` : ""}
    ${state.walletModalMessage ? `
      <div class="notice ${escapeHtml(state.walletModalTone)} wallet-modal-message" role="status">
        ${escapeHtml(state.walletModalMessage)}
      </div>
    ` : ""}
    ${state.walletConnectUri ? `
      <div class="wallet-uri-box wallet-modal-uri">
        <span class="label">WalletConnect session URI</span>
        ${state.walletConnectQrDataUrl
          ? `<img class="walletconnect-qr" src="${escapeHtml(state.walletConnectQrDataUrl)}" alt="WalletConnect pairing QR code" />`
          : `<div class="walletconnect-qr-loading" role="status">Preparing the local QR code…</div>`}
        <p>Pairing URI ready. Scan the QR code or copy it to your wallet app.</p>
        <button class="secondary-button" data-action="copy-walletconnect-uri">Copy session URI</button>
      </div>
    ` : ""}
  `;
}

function openWalletModal() {
  state.walletModalOpen = true;
  if (!state.walletConnectUri) {
    state.walletModalMessage = "";
  }
  renderWalletModal();
  dom.walletModal.hidden = false;
  dom.walletModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("wallet-modal-open");
}

function closeWalletModal() {
  if (walletConnectFlow.busy) {
    cancelWalletConnect("WalletConnect was cancelled. You can open the selector and try again.");
  }
  state.walletModalOpen = false;
  dom.walletModal.hidden = true;
  dom.walletModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("wallet-modal-open");
}

function showWalletMessage(message, tone = "warning") {
  dom.walletMessage.hidden = false;
  dom.walletMessage.textContent = message;
  dom.walletMessage.className = `notice ${tone}`;
}

function setWalletModalMessage(message, tone = "soft") {
  state.walletModalMessage = message;
  state.walletModalTone = tone;
  if (state.walletModalOpen) {
    renderWalletModal();
  }
}

function injectedWalletCandidates() {
  const candidates = [];
  const seen = new Set();
  const add = (id, name, provider) => {
    if (!provider || seen.has(provider)) {
      return;
    }
    seen.add(provider);
    candidates.push({ id, name, provider });
  };

  add("phantom", "Phantom", window.phantom?.solana);
  if (window.solana?.isPhantom) {
    add("phantom", "Phantom", window.solana);
  }
  add("solflare", "Solflare", window.solflare);
  add("backpack", "Backpack", window.backpack?.solana || window.backpack);
  add("coinbase", "Coinbase Wallet", window.coinbaseSolana || window.coinbaseWalletExtension?.solana);
  add("okx", "OKX Wallet", window.okxwallet?.solana || window.okxwallet);
  add("brave", "Brave Wallet", window.braveSolana);
  add("glow", "Glow", window.glowSolana);
  add("trust", "Trust Wallet", window.trustwallet?.solana);

  if (window.solana && !seen.has(window.solana)) {
    const providerName = typeof window.solana.name === "string" && window.solana.name.trim()
      ? window.solana.name.trim()
      : "Solana wallet";
    add("solana-wallet", providerName, window.solana);
  }

  return candidates;
}

function discoverWallets() {
  const standardOptions = compatibleWalletStandardOptions(walletStandardRegistry.get());
  return mergeCompatibleWalletOptions(standardOptions, injectedWalletCandidates());
}

function bytesEqual(left, right) {
  if (!left || !right || left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

function validatedSignerAddress(address, expectedPublicKey) {
  let publicKey;
  try {
    publicKey = new PublicKey(String(address || ""));
  } catch {
    throw new Error("Wallet returned an invalid Solana public key");
  }

  const publicKeyBytes = publicKey.toBytes();
  if (!PublicKey.isOnCurve(publicKeyBytes)) {
    throw new Error("Wallet account must be an on-curve Solana signer");
  }
  if (expectedPublicKey && !bytesEqual(publicKeyBytes, new Uint8Array(expectedPublicKey))) {
    throw new Error("Wallet address does not match the account public key");
  }
  return publicKey.toBase58();
}

let walletConnectBundleFailures = 0;
let walletConnectDependencies = null;
let walletConnectBundlePromise = null;

async function loadWalletConnectDependencies() {
  if (walletConnectDependencies) {
    return walletConnectDependencies;
  }
  if (walletConnectBundlePromise) {
    return walletConnectBundlePromise;
  }
  const bundleUrl = new URL(WALLETCONNECT_BUNDLE_URL, window.location.origin);
  bundleUrl.searchParams.set("retry", String(walletConnectBundleFailures));
  walletConnectBundlePromise = import(bundleUrl.href).then((dependencies) => {
    if (
      typeof dependencies?.UniversalProvider?.init !== "function" ||
      typeof dependencies?.createWalletConnectQrDataUrl !== "function"
    ) {
      throw new Error("WalletConnect bundle is incomplete");
    }
    walletConnectDependencies = dependencies;
    return dependencies;
  }).catch((error) => {
    walletConnectBundleFailures += 1;
    walletConnectBundlePromise = null;
    throw error;
  });
  return walletConnectBundlePromise;
}

function subscribeWalletConnectEvents(provider) {
  releaseWalletEventSubscription();
  const cleanups = [];
  const subscribe = (event, listener) => {
    provider.on?.(event, listener);
    cleanups.push(() => {
      if (typeof provider.off === "function") {
        provider.off(event, listener);
      } else {
        provider.removeListener?.(event, listener);
      }
    });
  };

  subscribe("session_delete", () => {
    state.walletConnectUri = "";
    if (state.wallet?.type === "walletconnect") {
      void clearConnectedWallet("WalletConnect session ended.");
    }
  });

  subscribe("session_update", ({ params } = {}) => {
    if (state.wallet?.type !== "walletconnect") {
      return;
    }
    const session = {
      ...(provider.session || state.wallet.session),
      namespaces: params?.namespaces || provider.session?.namespaces || state.wallet.session?.namespaces,
    };
    try {
      const account = parseWalletConnectAccount(session);
      state.wallet = {
        ...state.wallet,
        session,
        chainId: account.chainId,
        address: account.address,
      };
      walletAccountChanged("WalletConnect account updated.");
    } catch (error) {
      void clearConnectedWallet(error instanceof Error ? error.message : "WalletConnect account became unavailable.");
    }
  });

  subscribe("session_event", ({ params } = {}) => {
    const event = params?.event;
    if (state.wallet?.type !== "walletconnect" || event?.name !== "accountsChanged") {
      return;
    }
    if (params?.chainId !== WALLETCONNECT_SOLANA_CHAIN) {
      void clearConnectedWallet("WalletConnect changed to a non-mainnet Solana account.");
      return;
    }
    const next = Array.isArray(event.data) ? event.data[0] : event.data;
    const rawAddress = String(next || "");
    const address = rawAddress.startsWith(`${WALLETCONNECT_SOLANA_CHAIN}:`)
      ? rawAddress.slice(WALLETCONNECT_SOLANA_CHAIN.length + 1)
      : rawAddress;
    try {
      state.wallet = {
        ...state.wallet,
        address: validatedSignerAddress(address),
      };
      walletAccountChanged("WalletConnect account updated.");
    } catch (error) {
      void clearConnectedWallet(error instanceof Error ? error.message : "WalletConnect account became unavailable.");
    }
  });

  state.walletEventCleanup = () => cleanups.splice(0).forEach((cleanup) => {
    try {
      cleanup();
    } catch {
      // Session cleanup must not block disconnect.
    }
  });
}

const walletConnectFlow = createWalletConnectFlow({
  loadDependencies: loadWalletConnectDependencies,
  initializeProvider: (dependencies) => dependencies.UniversalProvider.init({
    projectId: WALLETCONNECT_PROJECT_ID,
    metadata: {
      name: "LuckyMe",
      description: "LuckyMe Solana pools",
      url: window.location.origin,
      icons: [`${window.location.origin}/assets/brand/apple-touch-icon.png`],
    },
  }),
  connectOptions: {
    optionalNamespaces: {
      solana: {
        chains: WALLETCONNECT_SOLANA_CHAINS,
        methods: WALLETCONNECT_SOLANA_METHODS,
        events: WALLETCONNECT_SOLANA_EVENTS,
      },
    },
  },
  onStatus: ({ phase, message, busy }) => {
    state.walletConnectPhase = phase;
    state.walletConnectBusy = busy;
    setWalletModalMessage(message, phase === "error" ? "danger" : "soft");
    if (phase === "error") {
      showWalletMessage(message, "danger");
    }
  },
  onUri: ({ uri, dependencies }) => {
    state.walletConnectUri = uri;
    state.walletConnectQrDataUrl = "";
    renderWalletModal();
    showWalletMessage("WalletConnect session ready. Continue in your wallet app.", "soft");
    const qrPromise = dependencies.createWalletConnectQrDataUrl(uri);
    Promise.resolve(qrPromise).then((dataUrl) => {
      if (state.walletConnectUri !== uri || typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
        return;
      }
      state.walletConnectQrDataUrl = dataUrl;
      renderWalletModal();
    }).catch(() => {
      if (state.walletConnectUri === uri) {
        setWalletModalMessage("The pairing URI is ready. Copy it into your wallet app to continue.", "warning");
      }
    });
  },
});

function parseWalletConnectAccount(session) {
  const namespace = session?.namespaces?.solana;
  const supportedMethod = namespace?.methods?.some((method) => WALLETCONNECT_SOLANA_METHODS.includes(method));
  if (!supportedMethod) {
    throw new Error("WalletConnect wallet cannot sign Solana transactions");
  }
  const prefix = `${WALLETCONNECT_SOLANA_CHAIN}:`;
  const account = namespace?.accounts?.find((item) => typeof item === "string" && item.startsWith(prefix));
  if (!account) {
    throw new Error("WalletConnect did not return a Solana mainnet account");
  }
  const address = validatedSignerAddress(account.slice(prefix.length));
  return { account, chainId: WALLETCONNECT_SOLANA_CHAIN, address };
}

async function connectWalletConnect() {
  if (!WALLETCONNECT_PROJECT_ID) {
    throw new Error("Mobile wallet connection is not configured yet");
  }
  state.walletConnectUri = "";
  state.walletConnectQrDataUrl = "";
  const { provider, session, modal } = await walletConnectFlow.start();
  state.walletConnectProvider = provider;
  state.walletConnectModal = modal;
  state.walletConnectUri = "";
  state.walletConnectQrDataUrl = "";

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
  subscribeWalletConnectEvents(provider);
}

function cancelWalletConnect(message) {
  const cancelled = walletConnectFlow.cancel(message);
  state.walletConnectUri = "";
  state.walletConnectQrDataUrl = "";
  state.walletConnectBusy = false;
  if (state.walletModalOpen) {
    renderWalletModal();
  }
  return cancelled;
}

function releaseWalletEventSubscription() {
  try {
    state.walletEventCleanup?.();
  } catch {
    // Wallet event cleanup must not block an explicit disconnect.
  }
  state.walletEventCleanup = null;
}

function walletAccountChanged(message) {
  state.preparedTransaction = null;
  renderWalletPill();
  renderWallets();
  showWalletMessage(message, "success");
  void loadPools();
}

async function clearConnectedWallet(message = "Wallet disconnected.") {
  releaseWalletEventSubscription();
  state.wallet = null;
  state.walletConnectProvider = null;
  state.walletConnectModal = null;
  state.walletConnectUri = "";
  state.walletConnectQrDataUrl = "";
  state.preparedTransaction = null;
  renderWalletPill();
  renderWallets();
  showWalletMessage(message, "warning");
  await loadPools();
}

function subscribeStandardWalletEvents(standardWallet) {
  releaseWalletEventSubscription();
  const on = standardWallet.features?.[STANDARD_EVENTS]?.on;
  if (typeof on !== "function") {
    return;
  }

  try {
    const off = on("change", (properties = {}) => {
      if (state.wallet?.type !== "standard" || state.wallet.standardWallet !== standardWallet) {
        return;
      }
      if (properties.accounts === undefined) {
        return;
      }
      const account = selectSolanaMainnetAccount(properties.accounts, standardWallet);
      if (!account) {
        void clearConnectedWallet(`${standardWallet.name} no longer exposes a compatible Solana mainnet account.`);
        return;
      }
      try {
        const address = validatedSignerAddress(account.address, account.publicKey);
        state.wallet = { ...state.wallet, account, address };
        walletAccountChanged(`${standardWallet.name} account updated.`);
      } catch (error) {
        void clearConnectedWallet(error instanceof Error ? error.message : "Wallet account became unavailable.");
      }
    });
    state.walletEventCleanup = typeof off === "function" ? off : null;
  } catch {
    state.walletEventCleanup = null;
  }
}

function subscribeInjectedWalletEvents(provider, walletName) {
  releaseWalletEventSubscription();
  if (typeof provider?.on !== "function") {
    return;
  }
  const cleanups = [];
  const subscribe = (event, listener) => {
    try {
      const returned = provider.on(event, listener);
      if (typeof returned === "function") {
        cleanups.push(returned);
      } else {
        cleanups.push(() => {
          if (typeof provider.removeListener === "function") {
            provider.removeListener(event, listener);
          } else if (typeof provider.off === "function") {
            provider.off(event, listener);
          }
        });
      }
    } catch {
      // Some legacy extensions expose `on` but not every standard Solana event.
    }
  };

  subscribe("accountChanged", (nextPublicKey) => {
    if (state.wallet?.type !== "injected" || state.wallet.provider !== provider) {
      return;
    }
    if (!nextPublicKey) {
      void clearConnectedWallet(`${walletName} disconnected.`);
      return;
    }
    const address = nextPublicKey?.toBase58?.() || nextPublicKey?.toString?.();
    try {
      state.wallet = {
        ...state.wallet,
        address: validatedSignerAddress(address),
      };
      walletAccountChanged(`${walletName} account updated.`);
    } catch (error) {
      void clearConnectedWallet(error instanceof Error ? error.message : "Wallet account became unavailable.");
    }
  });
  subscribe("disconnect", () => {
    if (state.wallet?.type === "injected" && state.wallet.provider === provider) {
      void clearConnectedWallet(`${walletName} disconnected.`);
    }
  });
  state.walletEventCleanup = () => cleanups.splice(0).forEach((cleanup) => cleanup());
}

async function connectStandard(walletOption) {
  const { standardWallet, account } = await connectWalletStandardOption(walletOption);
  const address = validatedSignerAddress(account.address, account.publicKey);
  state.wallet = {
    id: walletOption.id,
    name: walletOption.name,
    type: "standard",
    standardWallet,
    account,
    address,
  };
  subscribeStandardWalletEvents(standardWallet);
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
    address: validatedSignerAddress(address),
  };
  subscribeInjectedWalletEvents(wallet.provider, wallet.name);
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
      closeWalletModal();
      renderWalletPill();
      renderWallets();
      await loadPools();
    } catch (error) {
      state.walletConnectModal?.closeModal?.();
      state.walletConnectProvider = null;
      state.walletConnectModal = null;
      state.walletConnectBusy = false;
      state.walletConnectUri = "";
      state.walletConnectQrDataUrl = "";
      const message = error instanceof Error ? error.message : String(error);
      if (error?.code !== "cancelled") {
        setWalletModalMessage(message, "danger");
        showWalletMessage(message, "danger");
      }
    }
    return;
  }

  const wallet = discoverWallets().find((item) => item.id === walletId);
  if (!wallet) {
    return;
  }

  try {
    if (wallet.type === "standard") {
      await connectStandard(wallet);
    } else {
      await connectInjected(wallet);
    }
    closeWalletModal();

    renderWalletPill();
    renderWallets();
    await loadPools();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setWalletModalMessage(message, "danger");
    showWalletMessage(message, "danger");
  }
}

async function disconnectWallet() {
  try {
    if (state.wallet?.type === "walletconnect") {
      await state.wallet.provider?.disconnect?.();
    } else if (state.wallet?.type === "standard") {
      await state.wallet.standardWallet?.features?.[STANDARD_DISCONNECT]?.disconnect?.();
    } else if (state.wallet?.provider?.disconnect) {
      await state.wallet.provider.disconnect();
    }
  } finally {
    await clearConnectedWallet();
  }
}

async function copyWalletConnectUri() {
  if (!state.walletConnectUri) {
    setWalletModalMessage("WalletConnect session is not ready yet.", "warning");
    showWalletMessage("WalletConnect session is not ready yet.", "warning");
    return;
  }

  try {
    await navigator.clipboard.writeText(state.walletConnectUri);
    setWalletModalMessage("WalletConnect session URI copied.", "success");
    showWalletMessage("WalletConnect session URI copied.", "success");
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not copy WalletConnect URI.";
    setWalletModalMessage(message, "danger");
    showWalletMessage(message, "danger");
  }
}

function renderReview() {
  const pool = state.selectedPool ? poolById(state.selectedPool) : POOLS[0];
  const livePool = poolFromApi(pool.id);
  const round = activeRound(livePool);
  const userEntry = roundUserEntry(round);
  const ticketLimit = selectedTicketLimit(pool.id);
  const ticketCount = Math.min(state.ticketCount, ticketLimit);
  const amountLamports = selectedTicketPriceLamports(pool.id) * BigInt(ticketCount);
  const timing = roundTiming(pool.id);
  const policy = minimumPolicy(pool.id);
  const ticketsSold = numberValue(round?.totalTickets);
  const ticketsAfterPurchase = ticketsSold + ticketCount;
  const ticketsRemainingAfter = Math.max(policy.minimumTickets - ticketsAfterPurchase, 0);
  const entrantsAfterPurchase = numberValue(round?.entrantCount) + (userEntry ? 0 : 1);
  const minimumReachedAfter = ticketsAfterPurchase >= policy.minimumTickets &&
    entrantsAfterPurchase >= policy.minimumDistinctEntrants;
  const connected = Boolean(state.wallet);
  const alreadyEntered = Boolean(userEntry);
  const poolStateReady = state.onchainAvailable && state.poolsLoaded &&
    Boolean(round) && hasVerifiedMinimumPolicy(pool.id);
  const canBuy = connected && poolStateReady && timing.isOpen && !alreadyEntered;
  const buyLabel = ticketCount === 1 ? "Buy 1 ticket" : `Buy ${ticketCount} tickets`;
  const roundCopy = timing.isOpen
    ? timing.waitingFirstTicket
      ? "The first confirmed ticket starts the one-hour countdown"
      : "Round is open for entries"
    : timing.settlementPending
    ? "Round ended after reaching its target and is waiting for the draw"
    : timing.cancelledBelowMinimum
    ? timing.refundComplete
      ? "The round was cancelled and its automatic refunds are complete"
      : "The round was cancelled and automatic refunds are in progress"
    : timing.maintenanceRequired
    ? "Verified round rules or state are unavailable"
    : "This round is no longer accepting entries";

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
    <section class="minimum-target review-target ${minimumReachedAfter ? "success" : ""}" aria-label="Ticket target after this purchase">
      <span class="label">Minimum for a valid draw</span>
      <strong>${ticketsSold} / ${policy.minimumTickets} tickets sold now</strong>
      <div class="minimum-progress" role="progressbar" aria-label="Tickets after purchase" aria-valuemin="0" aria-valuemax="${policy.minimumTickets}" aria-valuenow="${Math.min(ticketsAfterPurchase, policy.minimumTickets)}"><span style="width:${Math.min(ticketsAfterPurchase / policy.minimumTickets, 1) * 100}%"></span></div>
      <p class="minimum-message">After this purchase: ${ticketsAfterPurchase} / ${policy.minimumTickets} total tickets${minimumReachedAfter ? " — target reached" : ` — ${ticketsRemainingAfter} ${ticketWord(ticketsRemainingAfter)} still needed`}.</p>
      <p class="minimum-clarification">The target is based on total tickets sold, not the number of players. ${pool.id === "premium" ? "Premium allows one ticket per wallet and requires three distinct wallets." : "One wallet may buy multiple tickets in Mini, Normal, and High."}</p>
    </section>
    <div class="review-summary">
      <div class="list-row">
        <div><span class="label">${timing.status}</span><p>${roundCopy}</p></div>
        <strong class="${timing.isOpen ? "success" : "warning"}">${timing.timeLeft}</strong>
      </div>
      <div class="list-row">
        <div><span class="label">Tickets sold</span><p>${escapeHtml(round?.totalSol || "0")} SOL in this round</p></div>
        <strong class="mono">${ticketsSold} / ${policy.minimumTickets}</strong>
      </div>
      <div class="list-row">
        <div><span class="label">Players</span><p>Confirmed entry accounts</p></div>
        <strong class="mono">${numberValue(round?.entrantCount)}</strong>
      </div>
      ${connected ? `<div class="list-row">
        <div><span class="label">My tickets</span><p>${alreadyEntered ? `Entry ${escapeHtml(userEntry.address || "")}` : "No entry for this wallet in this round"}</p></div>
        <strong class="${alreadyEntered ? "success" : "warning"}">${alreadyEntered ? `${escapeHtml(userEntry.ticketCount)} ${ticketWord(userEntry.ticketCount)}` : "0"}</strong>
      </div>` : ""}
      <div class="list-row">
        <div><span class="label">Wallet</span><p class="mono">${state.wallet?.address || "Not connected"}</p></div>
        <strong class="${connected ? "success" : "warning"}">${connected ? "CONNECTED" : "REQUIRED"}</strong>
      </div>
    </div>
    <div class="refund-explainer">
      <strong>If the target is not reached in time</strong>
      <p>If the minimum is not reached before the round ends, no winner is drawn. 100% of the ticket purchase amount is automatically returned to the wallet that bought the tickets.</p>
      <p>No claim button is required. Refunds are processed automatically. Solana network fees are not refundable.</p>
    </div>
    ${state.lastError ? `<div class="notice danger">${state.lastError}</div>` : ""}
    <div class="wallet-actions">
      ${connected ? "" : `<button class="primary-button" data-route="wallet">Connect wallet</button>`}
      <button class="primary-button" data-action="buy" ${canBuy ? "" : "disabled"}>${buyLabel}</button>
      <button class="secondary-button" data-route="pools">Back to pools</button>
    </div>
    ${poolStateReady ? "" : `<div class="notice">Verified mainnet state for this pool is not available yet.</div>`}
    ${alreadyEntered ? `<div class="notice success">This wallet already has confirmed tickets in the current round.</div>` : ""}
    ${state.onchainAvailable && timing.settlementPending ? `<div class="notice">This round has ended and the automatic draw is being processed.</div>` : ""}
    ${state.onchainAvailable && timing.cancelledBelowMinimum ? `<div class="notice ${timing.refundComplete ? "success" : ""}">${timing.refundComplete ? "Refund complete — ticket purchase amount returned." : "Round cancelled — automatic refunds in progress."}</div>` : ""}
    ${state.onchainAvailable && timing.maintenanceRequired ? `<div class="notice">Maintenance required. Buying stays disabled until verified round rules are available.</div>` : ""}
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
    const livePool = poolFromApi(state.selectedPool);
    const round = activeRound(livePool);
    const timing = roundTiming(state.selectedPool);
    if (!state.onchainAvailable || !state.poolsLoaded || !round || !timing.isOpen) {
      throw new Error("This pool does not currently have a verified round open for entries");
    }
    if (!hasVerifiedMinimumPolicy(state.selectedPool)) {
      throw new Error("Verified round rules changed. Refresh and review the purchase again.");
    }
    const expectedRoundId = Number(round.id ?? round.roundId);
    const expectedTotalTickets = String(round.totalTickets ?? "");
    if (
      !Number.isSafeInteger(expectedRoundId) ||
      expectedRoundId < 1 ||
      !/^\d+$/.test(expectedTotalTickets)
    ) {
      throw new Error("Verified round state is incomplete. Refresh and review again.");
    }
    const response = await fetch(`${API_BASE}/transactions/buy-tickets`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        pool: state.selectedPool,
        ticketCount: state.ticketCount,
        player: state.wallet.address,
        expectedRoundId,
        expectedTotalTickets,
      }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Transaction build failed");
    }
    if (
      Number(payload.summary?.roundId) !== expectedRoundId ||
      String(payload.summary?.totalTicketsBefore ?? "") !== expectedTotalTickets
    ) {
      throw new Error("Round progress changed while preparing the transaction. Refresh and review again.");
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
    state.lastError = signature ? `Submitted: ${signature}. Confirming chain state...` : "Transaction submitted. Confirming chain state...";
    await refreshAfterTransaction();
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

  if (state.wallet.type === "walletconnect") {
    return signAndSendWalletConnectTransaction(preparedTransaction.transactionBase64, preparedTransaction.clusterUrl);
  }
  if (state.wallet.type === "standard") {
    return signAndSendWalletStandardTransaction(transaction, preparedTransaction.clusterUrl);
  }

  const provider = state.wallet.provider;

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

async function signAndSendWalletStandardTransaction(transaction, clusterUrl) {
  const standardWallet = state.wallet?.standardWallet;
  const account = state.wallet?.account;
  if (!standardWallet || !account) {
    throw new Error("Wallet Standard account is no longer connected");
  }

  const serialized = new Uint8Array(transaction.serialize({
    requireAllSignatures: false,
    verifySignatures: false,
  }));
  const signAndSend = standardWallet.features?.[SOLANA_SIGN_AND_SEND_TRANSACTION];
  if (
    account.features.includes(SOLANA_SIGN_AND_SEND_TRANSACTION)
    && typeof signAndSend?.signAndSendTransaction === "function"
  ) {
    const [output] = await signAndSend.signAndSendTransaction({
      account,
      transaction: serialized,
      chain: SOLANA_MAINNET_CHAIN,
      options: {
        commitment: "confirmed",
        preflightCommitment: "confirmed",
        skipPreflight: false,
        maxRetries: 3,
      },
    });
    const signatureBytes = output?.signature ? new Uint8Array(output.signature) : new Uint8Array();
    if (signatureBytes.length !== 64) {
      throw new Error(`${state.wallet.name} did not return a valid Solana signature`);
    }
    return base58Encode(signatureBytes);
  }

  const sign = standardWallet.features?.[SOLANA_SIGN_TRANSACTION];
  if (account.features.includes(SOLANA_SIGN_TRANSACTION) && typeof sign?.signTransaction === "function") {
    const [output] = await sign.signTransaction({
      account,
      transaction: serialized,
      chain: SOLANA_MAINNET_CHAIN,
      options: { preflightCommitment: "confirmed" },
    });
    const signedTransaction = output?.signedTransaction
      ? new Uint8Array(output.signedTransaction)
      : new Uint8Array();
    if (!signedTransaction.length) {
      throw new Error(`${state.wallet.name} did not return a signed Solana transaction`);
    }
    const connection = new Connection(clusterUrl || state.config?.clusterUrl || DEFAULT_RPC, "confirmed");
    const signature = await connection.sendRawTransaction(signedTransaction, {
      maxRetries: 3,
      skipPreflight: false,
    });
    await connection.confirmTransaction(signature, "confirmed");
    return signature;
  }

  throw new Error(`${state.wallet.name} no longer exposes a compatible transaction signing feature`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function refreshAfterTransaction() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await sleep(attempt === 0 ? 900 : 1500);
    await loadPools();
    const round = activeRound(state.selectedPool);
    if (!state.wallet?.address || roundUserEntry(round)) {
      return;
    }
  }
}

async function sendOperatorTransaction(endpoint, body, preparingMessage, successPrefix) {
  if (!state.wallet?.address) {
    showWalletMessage("Connect a funded Solana wallet first.", "warning");
    return;
  }

  showWalletMessage(preparingMessage, "soft");

  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ keeper: state.wallet.address, ...body }),
    });
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.message || payload.error || "Operator transaction build failed");
    }
    if (!payload.transactionBase64) {
      showWalletMessage(payload.summary?.actions?.length ? "No executable transaction is needed." : "Nothing to do.", "success");
      return;
    }
    if (payload.simulation && payload.simulation.ok === false) {
      throw new Error(`Simulation failed: ${JSON.stringify(payload.simulation.err)}`);
    }

    const signature = await signAndSendTransactionPayload(payload);
    showWalletMessage(signature ? `${successPrefix}: ${signature}` : `${successPrefix}.`, "success");
    await loadPools();
    renderWallets();
  } catch (error) {
    showWalletMessage(error instanceof Error ? error.message : String(error), "danger");
  }
}

async function requestLuckyMeRandomness(poolId, roundId) {
  await sendOperatorTransaction(
    "/transactions/request-randomness",
    { pool: poolId, roundId: Number(roundId) },
    `Preparing ${poolId} LuckyMe randomness request...`,
    "LuckyMe randomness request submitted",
  );
}

async function requestOraoRandomness(poolId, roundId) {
  await sendOperatorTransaction(
    "/transactions/request-orao-randomness",
    { pool: poolId, roundId: Number(roundId) },
    `Preparing ${poolId} ORAO randomness request...`,
    "ORAO request submitted",
  );
}

async function settleProviderRound(poolId, roundId) {
  await sendOperatorTransaction(
    "/transactions/settle-provider-round",
    { pool: poolId, roundId: Number(roundId) },
    `Preparing ${poolId} settlement...`,
    "Settlement submitted",
  );
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
  if (state.poolsLoading) {
    return;
  }
  state.poolsLoading = true;
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
  } finally {
    state.poolsLoading = false;
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
  } else if (action === "toggle-wallet-menu" || action === "open-wallet-modal") {
    openWalletModal();
  } else if (action === "close-wallet-modal") {
    closeWalletModal();
  } else if (action === "cancel-walletconnect") {
    cancelWalletConnect("WalletConnect was cancelled. You can try again whenever you are ready.");
  } else if (action === "retry-walletconnect") {
    await connectWallet("mobile-wallet");
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
  } else if (action === "operator-request-randomness") {
    await requestLuckyMeRandomness(actionButton.dataset.poolId, actionButton.dataset.roundId);
  } else if (action === "operator-request-orao") {
    await requestOraoRandomness(actionButton.dataset.poolId, actionButton.dataset.roundId);
  } else if (action === "operator-settle") {
    await settleProviderRound(actionButton.dataset.poolId, actionButton.dataset.roundId);
  } else if (action === "sign") {
    await signAndSendPreparedTransaction();
  } else if (action === "disconnect") {
    await disconnectWallet();
  }
});

document.addEventListener("click", (event) => {
  if (event.target === dom.walletModal) {
    closeWalletModal();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && state.walletModalOpen) {
    closeWalletModal();
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

walletStandardRegistry.on("register", () => {
  if (state.walletModalOpen) {
    renderWalletModal();
  }
  if (!state.wallet) {
    renderWallets();
  }
});

walletStandardRegistry.on("unregister", (...wallets) => {
  if (state.wallet?.type === "standard" && wallets.includes(state.wallet.standardWallet)) {
    void clearConnectedWallet(`${state.wallet.name} is no longer available in this browser.`);
    return;
  }
  if (state.walletModalOpen) {
    renderWalletModal();
  }
  if (!state.wallet) {
    renderWallets();
  }
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

setInterval(() => {
  if (document.visibilityState === "visible") {
    void loadPools();
  }
}, 12_000);

renderPools();
renderActivity();
renderWalletPill();
if (new URLSearchParams(window.location.search).has("wallet")) {
  openWalletModal();
}
loadConfig();
loadPools();
