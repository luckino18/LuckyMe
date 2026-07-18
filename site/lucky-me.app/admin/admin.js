const $ = (id) => document.getElementById(id);
const safe = (value) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const stateLabel = (state) => state?.ActiveState === "active" || (state?.ActiveState === "inactive" && state?.Result === "success") ? "Healthy" : "Attention";
const sol = (lamports) => `${(Number(lamports ?? 0) / 1_000_000_000).toFixed(6)} SOL`;
let winnerRounds = [];
let referralBindings = [];
let referralSnapshot = { counts: {}, profiles: 0, verifiedIdentities: 0 };

function renderAcquisition() {
  const analytics = referralSnapshot.appAnalytics ?? {};
  $("acquisition-summary").innerHTML = [
    ["Unique activations", analytics.uniqueActivations ?? 0],
    ["Active today", analytics.activeToday ?? 0],
    ["Total launches", analytics.launches ?? 0],
    ["Measured versions", analytics.versions?.length ?? 0],
  ].map(([label, value]) => `<article class="referral-stat"><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("");
  $("acquisition-versions").innerHTML = (analytics.versions ?? []).map((item) => `<article class="referral-card"><div class="referral-card-head"><div><span class="eyebrow">Version code ${safe(item.versionCode)}</span><h3>LuckyMe ${safe(item.appVersion)}</h3></div><span class="referral-status qualified">dApp Store</span></div><div class="referral-progress"><div><strong>${safe(item.uniqueActivations)}</strong><span>Unique activations</span></div><div><strong>${safe(item.launches)}</strong><span>Total launches</span></div></div></article>`).join("") || `<p class="entry-empty history-empty">No measured activations yet.</p>`;
}

function promotionStatusClass(status) {
  if (status === "paid") return "qualified";
  if (status === "drawn_unfunded") return "ready";
  if (["commitment_frozen", "randomness_pending"].includes(status)) return "pending";
  return status === "open" ? "qualified" : "invalid";
}

function renderPromotions() {
  const promotions = Array.isArray(referralSnapshot.promotions) ? referralSnapshot.promotions : [];
  $("promotion-list").innerHTML = promotions.length ? promotions.map((promotion) => {
    const prizes = (promotion.prizes ?? []).map((prize) => `<div><span>#${safe(prize.rank)}</span><strong>${safe(Number(prize.prizeSol).toFixed(3))} SOL</strong></div>`).join("");
    const winners = (promotion.winners ?? []).map((winner) => `<div class="history-winner"><span>#${safe(winner.rank)}</span><code class="wallet-address">${safe(winner.wallet)}</code><strong>${safe(Number(winner.prizeSol).toFixed(3))} SOL</strong></div>`).join("");
    const drawEvidence = promotion.entryCommitment
      ? `<div class="promotion-evidence"><div><span>Entry commitment</span><code>${safe(promotion.entryCommitment)}</code></div><div><span>Target / resolved slot</span><code>${safe(promotion.targetSlot)} / ${safe(promotion.resolvedSlot)}</code></div><div><span>Randomness hash</span><code>${safe(promotion.randomnessHash)}</code></div></div>`
      : "";
    return `<article class="promotion-card">
      <div class="referral-card-head"><div><span class="eyebrow">${safe(promotion.campaignId)}</span><h3>${safe(promotion.name)}</h3></div><span class="referral-status ${promotionStatusClass(promotion.status)}">${safe(promotion.status)}</span></div>
      <div class="referral-summary promotion-summary"><article class="referral-stat"><span>Validated NFTs</span><strong>${safe(promotion.entryCount)} / ${safe(promotion.entryThreshold)}</strong></article><article class="referral-stat"><span>Winners</span><strong>${safe(promotion.winnerCount)}</strong></article><article class="referral-stat"><span>Total prizes</span><strong>${safe(Number(promotion.prizeSol).toFixed(2))} SOL</strong></article><article class="referral-stat"><span>Funding</span><strong>${promotion.funded ? "Funded" : "Not loaded"}</strong></article></div>
      <div class="promotion-progress"><span style="width:${Math.max(0, Math.min(100, Number(promotion.progressPercent ?? 0)))}%"></span></div>
      <p class="panel-copy">${safe(promotion.entriesRemaining)} verified entries remaining · payout ${promotion.payoutEnabled ? "enabled" : "locked"}</p>
      <div class="promotion-prizes">${prizes}</div>
      ${drawEvidence}
      ${winners ? `<div class="history-winners promotion-winners"><span class="eyebrow">Draw winners</span>${winners}</div>` : ""}
    </article>`;
  }).join("") : `<p class="entry-empty history-empty">No promotions are registered.</p>`;
}

function statusClass(status) {
  if (["qualified", "qualified_test"].includes(status)) return "qualified";
  if (status === "ready_to_qualify") return "ready";
  if (status === "invalidated") return "invalid";
  return "pending";
}

function renderReferrals() {
  const selectedStatus = $("referral-status").value;
  const search = $("referral-search").value.trim().toLowerCase();
  const counts = referralSnapshot.counts ?? {};
  $("referral-summary").innerHTML = [
    ["Verified SGTs", referralSnapshot.verifiedIdentities ?? 0],
    ["Referral profiles", referralSnapshot.profiles ?? 0],
    ["Pending", counts.pending ?? 0],
    ["Qualified", (counts.qualified ?? 0) + (counts.qualified_test ?? 0)],
  ].map(([label, value]) => `<article class="referral-stat"><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("");

  const filtered = referralBindings.filter((binding) => {
    const statusMatches = !selectedStatus || binding.status === selectedStatus ||
      (selectedStatus === "qualified" && binding.status === "qualified_test");
    const haystack = [
      binding.referralCode,
      binding.referrer?.wallet,
      binding.referred?.wallet,
      binding.referrer?.sgtMint,
      binding.referred?.sgtMint,
    ].join(" ").toLowerCase();
    return statusMatches && (!search || haystack.includes(search));
  });

  $("referral-list").innerHTML = filtered.length ? filtered.map((binding) => {
    const progress = binding.progress ?? {};
    return `<article class="referral-card">
      <div class="referral-card-head"><div><span class="eyebrow">${safe(binding.referralCode)}</span><h3>${safe(binding.referrer?.wallet)} → ${safe(binding.referred?.wallet)}</h3></div><span class="referral-status ${statusClass(binding.status)}">${safe(binding.status)}</span></div>
      <div class="referral-identities">
        <div><span>Referrer wallet</span><code class="wallet-address">${safe(binding.referrer?.wallet)}</code><small>SGT ${safe(binding.referrer?.sgtMint)}</small></div>
        <div><span>Referred wallet</span><code class="wallet-address">${safe(binding.referred?.wallet)}</code><small>SGT ${safe(binding.referred?.sgtMint)}</small></div>
      </div>
      <div class="referral-progress">
        <div><strong>${safe(Math.min(Number(progress.winningRounds ?? 0), 3))}/3</strong><span>Completed rounds</span></div>
        <div><strong>${safe(Math.min(Number(progress.playDays ?? 0), 3))}/3</strong><span>Play days</span></div>
        <div><strong>${safe(Math.min(Number(progress.activeDays ?? 0), 7))}/7</strong><span>Active days</span></div>
      </div>
      <div class="history-footer"><span>Bound ${binding.boundAt ? safe(new Date(binding.boundAt).toLocaleString()) : "—"}</span><span>Last active ${safe(binding.lastActivityDate ?? "—")}</span></div>
    </article>`;
  }).join("") : `<p class="entry-empty history-empty">No referral matches this filter.</p>`;
}

function renderWinnerHistory() {
  const pool = $("history-pool").value;
  const roundFilter = $("history-round").value.trim();
  const rounds = winnerRounds.filter((round) =>
    (!pool || round.pool === pool) && (!roundFilter || String(round.roundId) === roundFilter));
  $("winner-history").innerHTML = rounds.length ? rounds.map((round) => {
    const winners = (round.winners ?? []).map((winner) => `<div class="history-winner"><span>#${safe(winner.rank)}</span><code class="wallet-address">${safe(winner.wallet)}</code><strong>${safe(sol(winner.prizeLamports))}</strong></div>`).join("");
    const jackpot = round.jackpot ? `<div class="history-winner jackpot"><span>Jackpot</span><code class="wallet-address">${safe(round.jackpot.wallet)}</code><strong>${safe(sol(round.jackpot.prizeLamports))}</strong></div>` : "";
    const empty = !winners && !jackpot ? `<p class="entry-empty">No winner — ${safe(round.outcome === "cancelled_below_minimum" ? "round refunded" : round.outcome)}</p>` : "";
    const explorer = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(round.settlementSignature ?? "") ? `<a class="explorer" href="https://solscan.io/tx/${encodeURIComponent(round.settlementSignature)}" target="_blank" rel="noopener noreferrer">Settlement transaction</a>` : "";
    return `<article class="history-round"><div class="entry-heading"><div><span class="eyebrow">${safe(round.pool)}</span><h3>Round ${safe(round.roundId)}</h3></div><div class="entry-total"><strong>${safe(round.totalTickets)} tickets</strong><span>${safe(sol(round.totalLamports))} played</span></div></div><div class="history-winners">${winners}${jackpot}${empty}</div><div class="history-footer"><span>${round.archivedAt ? safe(new Date(round.archivedAt).toLocaleString()) : "Archived"}</span>${explorer}</div></article>`;
  }).join("") : `<p class="entry-empty history-empty">No archived round matches this filter.</p>`;
}

function render(report) {
  $("overall").textContent = report.ok ? "All systems healthy" : `${report.alerts.length} alert${report.alerts.length === 1 ? "" : "s"}`;
  $("overall").className = `status ${report.ok ? "ok" : "bad"}`;
  $("updated").textContent = `Updated ${new Date(report.timestamp).toLocaleString()} · refreshes every 15 seconds`;
  $("alerts").innerHTML = report.alerts.length ? report.alerts.map((item) => `<div class="alert"><strong>${safe(item.code)}</strong>${safe(item.message)}</div>`).join("") : "";
  const keeperSol = Number(report.checks?.keeper?.balanceLamports ?? 0) / 1_000_000_000;
  $("summary").innerHTML = [
    ["API", report.checks?.api?.ok ? "Healthy" : "Unavailable", report.checks?.api?.cluster ?? "mainnet-beta"],
    ["Solana RPC", report.checks?.rpc?.ok ? "Healthy" : "Unavailable", `confirmed slot ${report.checks?.rpc?.slot ?? "—"}`],
    ["Keeper balance", `${keeperSol.toFixed(6)} SOL`, safe(report.checks?.keeper?.address)],
    ["Open alerts", String(report.alerts?.length ?? 0), report.ok ? "No action required" : "Review details above"],
  ].map(([title,value,copy]) => `<article class="card"><span class="eyebrow">${safe(title)}</span><strong class="card-value ${value === "Healthy" || value === "0" ? "good" : ""}">${safe(value)}</strong><p class="card-copy">${safe(copy)}</p></article>`).join("");
  $("rounds").innerHTML = (report.checks?.rounds ?? []).map((round) => `<article class="round"><h3>${safe(round.pool)}</h3><div class="kv"><span>Round</span><strong>${safe(round.roundId)}</strong></div><div class="kv"><span>Outcome</span><strong>${safe(round.outcome)}</strong></div><div class="kv"><span>Started</span><strong>${round.startTs > 0 ? new Date(round.startTs * 1000).toLocaleTimeString() : "Waiting"}</strong></div><div class="kv"><span>Settled</span><strong>${round.settled ? "Yes" : "No"}</strong></div></article>`).join("");
  $("treasury-pools").innerHTML = (report.checks?.rounds ?? []).map((round) => {
    const bps = Number(round.treasuryHouseFeeBps);
    const percent = round.treasuryHouseFeeBps != null && Number.isFinite(bps) ? `${(bps / 100).toFixed(2)}%` : "—";
    const estimate = round.treasuryEstimateLamports == null ? "Unavailable" : sol(round.treasuryEstimateLamports);
    const settlementCopy = Number(round.totalTickets ?? 0) === 0
      ? "No tickets sold yet"
      : round.minimumReached
        ? "Target reached · paid at settlement"
        : "Paid only if the round reaches its target";
    return `<article class="treasury-pool"><span class="eyebrow">${safe(round.pool)} · round ${safe(round.roundId)}</span><strong class="treasury-value">${safe(estimate)}</strong><div class="kv"><span>Treasury rate</span><strong>${safe(percent)}</strong></div><div class="kv"><span>Ticket value</span><strong>${safe(sol(round.totalLamports))}</strong></div><p class="treasury-copy">${safe(settlementCopy)}</p></article>`;
  }).join("");
  $("entry-pools").innerHTML = (report.checks?.rounds ?? []).map((round) => {
    const entries = Array.isArray(round.entries) ? round.entries : [];
    const wallets = entries.length
      ? entries.map((entry) => `<div class="entry-wallet"><code class="wallet-address">${safe(entry.player)}</code><div class="entry-metrics"><strong>${safe(entry.ticketCount)} ticket${String(entry.ticketCount) === "1" ? "" : "s"}</strong><span>${safe(sol(entry.lamports))}</span></div></div>`).join("")
      : `<p class="entry-empty">No tickets in this round.</p>`;
    return `<article class="entry-pool"><div class="entry-heading"><div><span class="eyebrow">${safe(round.pool)}</span><h3>Round ${safe(round.roundId)}</h3></div><div class="entry-total"><strong>${safe(round.totalTickets)} tickets</strong><span>${safe(round.walletCount ?? entries.length)} wallets</span></div></div><div class="entry-wallets">${wallets}</div></article>`;
  }).join("");
  winnerRounds = Array.isArray(report.checks?.winnerHistory?.rounds) ? report.checks.winnerHistory.rounds : [];
  renderWinnerHistory();
  referralSnapshot = report.checks?.referrals ?? { counts: {}, profiles: 0, verifiedIdentities: 0 };
  referralBindings = Array.isArray(referralSnapshot.bindings) ? referralSnapshot.bindings : [];
  renderReferrals();
  renderAcquisition();
  renderPromotions();
  $("services").innerHTML = ["settlement","notifications"].map((name) => { const check=report.checks?.[name]??{}; return `<article class="service"><h3>${safe(name)}</h3><div class="kv"><span>Timer</span><strong>${safe(check.timer?.ActiveState)}</strong></div><div class="kv"><span>Enabled</span><strong>${safe(check.timer?.UnitFileState)}</strong></div><div class="kv"><span>Last run</span><strong>${safe(stateLabel(check.service))}</strong></div><div class="kv"><span>Exit</span><strong>${safe(check.service?.ExecMainStatus ?? "0")}</strong></div></article>`; }).join("");
}

$("history-pool").addEventListener("change", renderWinnerHistory);
$("history-round").addEventListener("input", renderWinnerHistory);
$("referral-status").addEventListener("change", renderReferrals);
$("referral-search").addEventListener("input", renderReferrals);

function selectTab(name) {
  const selected = ["status", "treasury", "winners", "referrals", "downloads", "promotions"].includes(name) ? name : "status";
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === selected);
  });
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.adminPanel === selected);
  });
  history.replaceState(null, "", `#${selected}`);
}

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.adminTab));
});
selectTab(location.hash.slice(1));

async function refresh() {
  try {
    const response = await fetch("/admin/status.json", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    $("overall").textContent = "Status unavailable";
    $("overall").className = "status bad";
    $("alerts").innerHTML = `<div class="alert"><strong>dashboard_error</strong>${safe(error.message)}</div>`;
  }
}

refresh();
window.setInterval(refresh, 15_000);
