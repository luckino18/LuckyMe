const $ = (id) => document.getElementById(id);
const safe = (value) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const stateLabel = (state) => state?.ActiveState === "active" || (state?.ActiveState === "inactive" && state?.Result === "success") ? "Healthy" : "Attention";
const sol = (lamports) => `${(Number(lamports ?? 0) / 1_000_000_000).toFixed(6)} SOL`;

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
  $("entry-pools").innerHTML = (report.checks?.rounds ?? []).map((round) => {
    const entries = Array.isArray(round.entries) ? round.entries : [];
    const wallets = entries.length
      ? entries.map((entry) => `<div class="entry-wallet"><code class="wallet-address">${safe(entry.player)}</code><div class="entry-metrics"><strong>${safe(entry.ticketCount)} ticket${String(entry.ticketCount) === "1" ? "" : "s"}</strong><span>${safe(sol(entry.lamports))}</span></div></div>`).join("")
      : `<p class="entry-empty">No tickets in this round.</p>`;
    return `<article class="entry-pool"><div class="entry-heading"><div><span class="eyebrow">${safe(round.pool)}</span><h3>Round ${safe(round.roundId)}</h3></div><div class="entry-total"><strong>${safe(round.totalTickets)} tickets</strong><span>${safe(round.walletCount ?? entries.length)} wallets</span></div></div><div class="entry-wallets">${wallets}</div></article>`;
  }).join("");
  $("services").innerHTML = ["settlement","notifications"].map((name) => { const check=report.checks?.[name]??{}; return `<article class="service"><h3>${safe(name)}</h3><div class="kv"><span>Timer</span><strong>${safe(check.timer?.ActiveState)}</strong></div><div class="kv"><span>Enabled</span><strong>${safe(check.timer?.UnitFileState)}</strong></div><div class="kv"><span>Last run</span><strong>${safe(stateLabel(check.service))}</strong></div><div class="kv"><span>Exit</span><strong>${safe(check.service?.ExecMainStatus ?? "0")}</strong></div></article>`; }).join("");
}

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
