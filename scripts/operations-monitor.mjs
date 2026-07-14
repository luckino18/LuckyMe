import { execFile } from "node:child_process";
import { chmod, rename, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Connection, PublicKey } from "@solana/web3.js";
import { loadEntryWallets } from "./admin-entry-snapshot.mjs";
import { calculateTreasuryEstimateLamports } from "./admin-treasury-estimate.mjs";

const execFileAsync = promisify(execFile);
const apiUrl = process.env.LUCKYME_API_URL ?? "https://api.lucky-me.app";
const rpcUrl = process.env.ANCHOR_PROVIDER_URL ?? "https://api.mainnet-beta.solana.com";
const keeper = new PublicKey(
  process.env.LUCKYME_EXPECTED_KEEPER_PUBKEY ?? "6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N",
);
const minimumKeeperBalance = Number(
  process.env.SETTLEMENT_KEEPER_MIN_BALANCE_LAMPORTS ?? "50000000",
);
const stuckGraceSeconds = Number(process.env.LUCKYME_STUCK_ROUND_GRACE_SECONDS ?? "1800");
const adminStatusPath = process.env.LUCKYME_ADMIN_STATUS_PATH ?? "";

const checks = {};
const alerts = [];
let treasuryEconomics = null;

function alert(code, message, details = {}) {
  alerts.push({ code, message, ...details });
}

async function json(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function unitState(unit) {
  const { stdout } = await execFileAsync("systemctl", [
    "show",
    unit,
    "-p", "ActiveState",
    "-p", "UnitFileState",
    "-p", "Result",
    "-p", "ExecMainStatus",
    "--no-pager",
  ]);
  return Object.fromEntries(
    stdout.trim().split("\n").filter(Boolean).map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
  );
}

try {
  const health = await json(`${apiUrl}/health`);
  checks.api = { ok: health.ok === true, mode: health.releaseMode, cluster: health.cluster };
  if (health.ok !== true) alert("api_unhealthy", "LuckyMe API health check is not OK");
} catch (error) {
  checks.api = { ok: false, error: error.message };
  alert("api_unreachable", "LuckyMe API is unreachable", { error: error.message });
}

try {
  const config = await json(`${apiUrl}/config`);
  const houseFeeBps = Number(config?.economics?.houseFeeBps);
  if (!Number.isInteger(houseFeeBps) || houseFeeBps < 0 || houseFeeBps > 10_000) {
    throw new Error("API returned an invalid houseFeeBps value");
  }
  const treasury = new PublicKey(config.treasury).toBase58();
  treasuryEconomics = { treasury, houseFeeBps };
  checks.treasury = { ok: true, ...treasuryEconomics };
} catch (error) {
  checks.treasury = { ok: false, error: error.message };
}

try {
  const connection = new Connection(rpcUrl, "confirmed");
  const [balance, slot] = await Promise.all([
    connection.getBalance(keeper, "confirmed"),
    connection.getSlot("confirmed"),
  ]);
  checks.rpc = { ok: true, slot };
  checks.keeper = { address: keeper.toBase58(), balanceLamports: balance };
  if (balance < minimumKeeperBalance) {
    alert("keeper_balance_low", "Settlement keeper balance is below its safety threshold", {
      balanceLamports: balance,
      minimumLamports: minimumKeeperBalance,
    });
  }
} catch (error) {
  checks.rpc = { ok: false, error: error.message };
  alert("rpc_unreachable", "Solana RPC check failed", { error: error.message });
}

try {
  const payload = await json(`${apiUrl}/pools`);
  const now = Math.floor(Date.now() / 1000);
  const rounds = [];
  for (const pool of payload.pools ?? []) {
    const round = pool.activeRound;
    const summary = {
      pool: pool.id,
      roundId: round?.roundId ?? null,
      roundAddress: round?.address ?? null,
      startTs: Number(round?.startTs ?? 0),
      endTs: Number(round?.endTs ?? 0),
      settled: Boolean(round?.settled),
      outcome: round?.roundOutcome ?? null,
      totalTickets: String(round?.totalTickets ?? "0"),
      totalLamports: String(round?.totalLamports ?? "0"),
      entrantCount: Number(round?.entrantCount ?? 0),
      minimumReached: Boolean(round?.minimumReached),
      treasuryEstimateLamports: treasuryEconomics
        ? calculateTreasuryEstimateLamports(round?.totalLamports ?? "0", treasuryEconomics.houseFeeBps)
        : null,
      treasuryHouseFeeBps: treasuryEconomics?.houseFeeBps ?? null,
    };
    rounds.push(summary);
    if (summary.endTs > 0 && now > summary.endTs + stuckGraceSeconds && !summary.settled) {
      alert("round_stuck", `${pool.id} round ${summary.roundId} is past its processing grace period`, summary);
    }
  }
  try {
    checks.rounds = await loadEntryWallets(rounds, { rpcUrl });
    checks.entryScan = {
      ok: true,
      walletCount: checks.rounds.reduce((total, round) => total + round.walletCount, 0),
    };
  } catch (error) {
    checks.rounds = rounds.map((round) => ({ ...round, entries: [], walletCount: 0 }));
    checks.entryScan = { ok: false, error: error.message };
  }
} catch (error) {
  checks.rounds = { ok: false, error: error.message };
  alert("pool_state_unreachable", "Pool state check failed", { error: error.message });
}

for (const [name, timer, service] of [
  ["settlement", "luckyme-settlement-keeper.timer", "luckyme-settlement-keeper.service"],
  ["notifications", "luckyme-push-alerts.timer", "luckyme-push-alerts.service"],
]) {
  try {
    const [timerState, serviceState] = await Promise.all([unitState(timer), unitState(service)]);
    checks[name] = { timer: timerState, service: serviceState };
    if (timerState.ActiveState !== "active" || timerState.UnitFileState !== "enabled") {
      alert(`${name}_timer_inactive`, `${name} timer is not enabled and active`, { timerState });
    }
    if (serviceState.Result && serviceState.Result !== "success") {
      alert(`${name}_service_failed`, `${name} service last run failed`, { serviceState });
    }
    if (serviceState.ExecMainStatus && serviceState.ExecMainStatus !== "0") {
      alert(`${name}_service_exit`, `${name} service returned a non-zero exit status`, { serviceState });
    }
  } catch (error) {
    checks[name] = { ok: false, error: error.message };
    alert(`${name}_state_unavailable`, `Could not inspect ${name} systemd state`, { error: error.message });
  }
}

const report = {
  event: "luckyme_operations_monitor",
  timestamp: new Date().toISOString(),
  ok: alerts.length === 0,
  alerts,
  checks,
};

if (adminStatusPath) {
  const temporaryPath = `${adminStatusPath}.${process.pid}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o640 });
    await chmod(temporaryPath, 0o640);
    await rename(temporaryPath, adminStatusPath);
  } catch (error) {
    alert("admin_status_write_failed", "Could not update the protected admin snapshot", {
      error: error.message,
    });
    report.ok = false;
    report.alerts = alerts;
  }
}

console.log(JSON.stringify(report, null, 2));
if (alerts.length > 0) process.exitCode = 1;
