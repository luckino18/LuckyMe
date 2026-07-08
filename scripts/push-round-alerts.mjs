import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  POOLS,
  createClient,
  deriveConfig,
  derivePool,
  deriveRound,
} from "./anchor-client.mjs";
import {
  defaultPushTokenStorePath,
  loadPushRegistrations,
  sendExpoPushNotifications,
} from "../backend/src/push-notifications.mjs";

const DEFAULT_PUBLIC_KEY = "11111111111111111111111111111111";
const CHANNEL_ID = "luckyme-round-alerts";
const LAST_10_SECONDS = 10 * 60;
const STATE_PATH =
  process.env.LUCKYME_PUSH_STATE_STORE ??
  path.join(process.cwd(), "data", "push-round-alerts.json");
const TOKEN_STORE = defaultPushTokenStorePath();
const SEND_ENABLED = process.env.LUCKYME_PUSH_SEND === "true";

if (
  isMainnetRpc(process.env.ANCHOR_PROVIDER_URL ?? "") &&
  process.env.CONFIRM_MAINNET_PUSH_ALERTS !== "true"
) {
  throw new Error("Refusing mainnet push alerts without CONFIRM_MAINNET_PUSH_ALERTS=true");
}

const result = await runOnce();
console.log(JSON.stringify(result, null, 2));

async function runOnce() {
  const registrations = await loadPushRegistrations({ storePath: TOKEN_STORE });
  const activeTokens = registrations.filter((item) => item.token);
  const state = await readState(STATE_PATH);
  const alerts = await collectAlerts(state);
  const messages = buildMessages(alerts, activeTokens);
  const delivery = await sendExpoPushNotifications(messages, {
    dryRun: !SEND_ENABLED,
  });

  if (delivery.ok && !delivery.dryRun && messages.length > 0) {
    for (const alert of alerts) {
      state.sent[alert.key] = {
        sentAt: new Date().toISOString(),
        pool: alert.pool,
        roundId: alert.roundId,
        type: alert.type,
        dryRun: delivery.dryRun,
      };
    }
    await writeState(STATE_PATH, state);
  }

  return {
    ok: true,
    dryRun: delivery.dryRun,
    tokenStore: TOKEN_STORE,
    stateStore: STATE_PATH,
    registrations: activeTokens.length,
    alerts: alerts.map(({ key, ...alert }) => alert),
    messages: messages.length,
    delivery,
  };
}

async function collectAlerts(state) {
  const { program, url } = createClient({
    requireSigner: false,
    url: process.env.ANCHOR_PROVIDER_URL,
  });
  const config = deriveConfig();
  const now = Math.floor(Date.now() / 1000);
  const alerts = [];

  for (const poolSpec of POOLS) {
    const pool = derivePool(config, poolSpec.id);
    let poolAccount;

    try {
      poolAccount = await program.account.pool.fetch(pool);
    } catch (error) {
      alerts.push({
        type: "skip",
        pool: poolSpec.slug,
        poolLabel: poolSpec.label,
        reason: "pool_unavailable",
        rpc: publicRpcUrl(url),
      });
      continue;
    }

    const roundId = numberFromAnchor(poolAccount.currentRound);
    if (roundId <= 0) {
      continue;
    }

    const roundAddress = deriveRound(pool, roundId);
    const round = await program.account.round.fetch(roundAddress);
    const totalTickets = bigintFromAnchor(round.totalTickets);
    const endTs = numberFromAnchor(round.endTs);
    const remainingSeconds = endTs - now;

    if (round.settled || totalTickets <= 0n || remainingSeconds <= 0) {
      continue;
    }

    const base = {
      pool: poolSpec.slug,
      poolLabel: poolSpec.label,
      roundId,
      round: roundAddress.toBase58(),
      endTs,
      remainingSeconds,
      totalTickets: totalTickets.toString(),
      url: `luckyme://pools?pool=${encodeURIComponent(poolSpec.slug)}`,
    };

    const startedKey = alertKey(poolSpec.slug, roundId, "started");
    if (!state.sent[startedKey]) {
      alerts.push({
        ...base,
        type: "started",
        key: startedKey,
        title: `${poolSpec.label} pool countdown started`,
        body: "The 1 hour draw is live. Grab your ticket before the round finishes.",
      });
    }

    const last10Key = alertKey(poolSpec.slug, roundId, "last10");
    if (remainingSeconds <= LAST_10_SECONDS && !state.sent[last10Key]) {
      alerts.push({
        ...base,
        type: "last10",
        key: last10Key,
        title: `${poolSpec.label} pool: last 10 minutes`,
        body: "Last 10 minutes before winner selection. Try your luck before the draw closes.",
      });
    }
  }

  return alerts.filter((alert) => alert.type !== "skip");
}

function buildMessages(alerts, registrations) {
  const messages = [];

  for (const alert of alerts) {
    for (const registration of registrations) {
      messages.push({
        to: registration.token,
        title: alert.title,
        body: alert.body,
        channelId: CHANNEL_ID,
        data: {
          type: "round_alert",
          pool: alert.pool,
          roundId: String(alert.roundId),
          alert: alert.type,
          url: alert.url,
        },
      });
    }
  }

  return messages;
}

async function readState(statePath) {
  try {
    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    return {
      sent: parsed && typeof parsed.sent === "object" && parsed.sent ? parsed.sent : {},
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { sent: {} };
    }
    throw error;
  }
}

async function writeState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const tmp = `${statePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  await rename(tmp, statePath);
}

function alertKey(pool, roundId, type) {
  return `${pool}:${roundId}:${type}`;
}

function numberFromAnchor(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value?.toNumber === "function") {
    return value.toNumber();
  }
  return Number(value?.toString?.() ?? value);
}

function bigintFromAnchor(value) {
  if (typeof value === "bigint") {
    return value;
  }
  return BigInt(value?.toString?.() ?? value);
}

function publicRpcUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.search) {
      url.search = "";
    }
    return url.toString();
  } catch {
    return "";
  }
}

function isMainnetRpc(rawUrl) {
  return /mainnet-beta|mainnet/i.test(rawUrl) && !/devnet|testnet|localhost|127\.0\.0\.1/i.test(rawUrl);
}
