const $ = (id) => document.getElementById(id);
const safe = (value) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const stateLabel = (state) => state?.ActiveState === "active" || (state?.ActiveState === "inactive" && state?.Result === "success") ? "Healthy" : "Attention";
const sol = (lamports) => `${(Number(lamports ?? 0) / 1_000_000_000).toFixed(6)} SOL`;
let winnerRounds = [];

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
  $("services").innerHTML = ["settlement","notifications"].map((name) => { const check=report.checks?.[name]??{}; return `<article class="service"><h3>${safe(name)}</h3><div class="kv"><span>Timer</span><strong>${safe(check.timer?.ActiveState)}</strong></div><div class="kv"><span>Enabled</span><strong>${safe(check.timer?.UnitFileState)}</strong></div><div class="kv"><span>Last run</span><strong>${safe(stateLabel(check.service))}</strong></div><div class="kv"><span>Exit</span><strong>${safe(check.service?.ExecMainStatus ?? "0")}</strong></div></article>`; }).join("");
}

$("history-pool").addEventListener("change", renderWinnerHistory);
$("history-round").addEventListener("input", renderWinnerHistory);

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
