import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sendDiscordWebhook } from "../backend/src/discord-notifications.mjs";
import { buildWinnerHistory } from "./admin-winner-history.mjs";
import { readSettlementArchive } from "./settlement-archive.mjs";

const LAST_10_SECONDS = 10 * 60;

export async function runDiscordAlerts({
  apiUrl = process.env.LUCKYME_API_URL ?? "https://api.lucky-me.app",
  archivePath = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH ?? "",
  monitorPath = process.env.LUCKYME_ADMIN_STATUS_PATH ?? "",
  statePath = process.env.LUCKYME_DISCORD_STATE_PATH ?? path.join(process.cwd(), "data", "discord-alerts.json"),
  roundsWebhook = process.env.DISCORD_ROUNDS_WEBHOOK_URL ?? "",
  resultsWebhook = process.env.DISCORD_RESULTS_WEBHOOK_URL ?? "",
  statusWebhook = process.env.DISCORD_STATUS_WEBHOOK_URL ?? "",
  dryRun = process.env.LUCKYME_DISCORD_SEND !== "true",
  fetchImpl = fetch,
  now = Math.floor(Date.now() / 1_000),
} = {}) {
  const state = await readState(statePath);
  const planned = [];

  const poolsResponse = await fetchJson(`${apiUrl}/pools`, fetchImpl);
  const poolConfigs = Array.isArray(poolsResponse?.pools) ? poolsResponse.pools : [];
  for (const pool of poolConfigs) {
    const round = pool.activeRound;
    if (!round || Number(round.startTs) <= 0 || Number(round.endTs) <= now || round.settled) continue;
    const base = { pool: String(pool.id), roundId: Number(round.roundId) };
    addOnce(planned, state, `round:${base.pool}:${base.roundId}:started`, "rounds", {
      content: `🎟️ **${poolLabel(base.pool)} Pool — Round ${base.roundId} is live**\nThe countdown has started. Open LuckyMe and choose your tickets.`,
    });
    if (Number(round.endTs) - now <= LAST_10_SECONDS) {
      addOnce(planned, state, `round:${base.pool}:${base.roundId}:last10`, "rounds", {
        content: `⏳ **${poolLabel(base.pool)} Pool — last 10 minutes**\nRound ${base.roundId} is closing soon.`,
      });
    }
  }

  const history = buildWinnerHistory(readSettlementArchive(archivePath), poolConfigs);
  if (!state.initializedResults) {
    for (const result of history) state.sent[resultKey(result)] = baselineRecord();
    state.initializedResults = true;
  } else {
    for (const result of history) {
      addOnce(planned, state, resultKey(result), "results", formatResult(result));
    }
  }

  const monitor = await readJsonIfPresent(monitorPath);
  const currentAlerts = Array.isArray(monitor?.alerts) ? monitor.alerts : [];
  const currentCodes = new Set(currentAlerts.map((alert) => String(alert.code)));
  for (const alert of currentAlerts) {
    addOnce(planned, state, `status:active:${alert.code}`, "status", {
      content: `🚨 **LuckyMe status alert**\n${safeLine(alert.message ?? alert.code)}\nCode: \`${safeLine(alert.code)}\``,
    });
  }
  if (state.activeStatusCodes.length > 0 && currentCodes.size === 0) {
    addOnce(planned, state, `status:recovered:${monitor?.timestamp ?? new Date(now * 1_000).toISOString()}`, "status", {
      content: "✅ **LuckyMe status recovered**\nAll monitored production checks are healthy again.",
    });
    for (const code of state.activeStatusCodes) delete state.sent[`status:active:${code}`];
  }
  state.activeStatusCodes = [...currentCodes].sort();

  const webhooks = { rounds: roundsWebhook, results: resultsWebhook, status: statusWebhook };
  const delivered = [];
  for (const item of planned) {
    const delivery = await sendDiscordWebhook(webhooks[item.channel], item.message, { dryRun, fetchImpl });
    delivered.push({ key: item.key, channel: item.channel, ...delivery });
    if (delivery.ok && !delivery.skipped && (!dryRun || delivery.dryRun)) {
      if (!dryRun) state.sent[item.key] = { sentAt: new Date(now * 1_000).toISOString() };
    }
  }
  if (!dryRun) await writeState(statePath, state);

  return { ok: true, dryRun, planned: planned.map(({ message, ...item }) => ({ ...item, content: message.content })), delivered };
}

function addOnce(planned, state, key, channel, message) {
  if (!state.sent[key]) planned.push({ key, channel, message });
}

function resultKey(result) {
  return `result:${result.pool}:${result.roundId}:${result.settlementSignature ?? result.outcome}`;
}

function formatResult(result) {
  const title = `🏆 **${poolLabel(result.pool)} Pool — Round ${result.roundId} result**`;
  if (result.outcome === "cancelled_below_minimum") {
    return { content: `${title}\nRound cancelled below the minimum. Automatic refunds completed.` };
  }
  const winners = result.winners.map((winner) =>
    `${winner.rank}. \`${winner.wallet}\` — ${lamportsToSol(winner.prizeLamports)} SOL`);
  if (result.jackpot) winners.push(`Jackpot: \`${result.jackpot.wallet}\` — ${lamportsToSol(result.jackpot.prizeLamports)} SOL`);
  return { content: `${title}\n${winners.join("\n") || "Settlement completed."}` };
}

function poolLabel(pool) {
  return ({ mini: "Mini", normal: "Normal", high: "High", premium: "Premium" })[pool] ?? String(pool);
}

function lamportsToSol(value) {
  const lamports = BigInt(value ?? 0);
  const whole = lamports / 1_000_000_000n;
  const fraction = (lamports % 1_000_000_000n).toString().padStart(9, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function safeLine(value) {
  return String(value).replace(/[\r\n]+/g, " ").slice(0, 500);
}

async function fetchJson(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.json();
}

async function readJsonIfPresent(filePath) {
  if (!filePath) return null;
  try { return JSON.parse(await readFile(filePath, "utf8")); }
  catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}

async function readState(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8"));
    return {
      sent: parsed?.sent && typeof parsed.sent === "object" ? parsed.sent : {},
      initializedResults: parsed?.initializedResults === true,
      activeStatusCodes: Array.isArray(parsed?.activeStatusCodes) ? parsed.activeStatusCodes : [],
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { sent: {}, initializedResults: false, activeStatusCodes: [] };
    throw error;
  }
}

function baselineRecord() {
  return { baseline: true, recordedAt: new Date().toISOString() };
}

async function writeState(filePath, state) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, filePath);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await runDiscordAlerts();
  console.log(JSON.stringify(result, null, 2));
}
