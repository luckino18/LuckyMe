import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$/;
const VALID_PLATFORMS = new Set(["android", "ios", "web", "unknown"]);

export function defaultPushTokenStorePath() {
  return process.env.LUCKYME_PUSH_TOKEN_STORE ??
    path.join(process.cwd(), "data", "push-tokens.json");
}

export function normalizeExpoPushToken(value) {
  if (typeof value !== "string") {
    throw new Error("Expo push token is required");
  }

  const token = value.trim();
  if (!EXPO_TOKEN_RE.test(token)) {
    throw new Error("Invalid Expo push token");
  }

  return token;
}

export function pushTokenHash(token) {
  return createHash("sha256").update(token).digest("hex").slice(0, 24);
}

export async function registerPushToken(payload, options = {}) {
  const storePath = options.storePath ?? defaultPushTokenStorePath();
  const now = options.now ?? new Date().toISOString();
  const token = normalizeExpoPushToken(payload?.token);
  const tokenHash = pushTokenHash(token);
  const platform = parsePlatform(payload?.platform);
  const deviceId = parseOptionalString(payload?.deviceId, 128);
  const wallet = parseOptionalString(payload?.wallet, 64);
  const projectId = parseOptionalString(payload?.projectId, 128);
  const store = await readStore(storePath);
  if (deviceId) {
    store.tokens = store.tokens.filter((item) => (
      item.tokenHash === tokenHash ||
      item.deviceId !== deviceId
    ));
    if (wallet) {
      store.tokens = store.tokens.filter((item) => (
        item.tokenHash === tokenHash ||
        item.deviceId ||
        item.wallet !== wallet ||
        (projectId && item.projectId && item.projectId !== projectId)
      ));
    }
  }
  const existing = store.tokens.find((item) => item.tokenHash === tokenHash);

  if (existing) {
    existing.token = token;
    existing.platform = platform;
    existing.deviceId = deviceId ?? existing.deviceId ?? null;
    existing.wallet = wallet ?? existing.wallet ?? null;
    existing.projectId = projectId ?? existing.projectId ?? null;
    existing.updatedAt = now;
  } else {
    store.tokens.push({
      token,
      tokenHash,
      platform,
      deviceId: deviceId ?? null,
      wallet: wallet ?? null,
      projectId: projectId ?? null,
      createdAt: now,
      updatedAt: now,
    });
  }

  await writeStore(storePath, store);
  return {
    ok: true,
    tokenHash,
    platform,
    registeredAt: now,
    registrations: store.tokens.length,
  };
}

export async function unregisterPushToken(payload, options = {}) {
  const storePath = options.storePath ?? defaultPushTokenStorePath();
  const token = normalizeExpoPushToken(payload?.token);
  const tokenHash = pushTokenHash(token);
  const store = await readStore(storePath);
  const tokens = store.tokens.filter((item) => item.tokenHash !== tokenHash);

  if (tokens.length !== store.tokens.length) {
    await writeStore(storePath, { tokens });
  }

  return {
    ok: true,
    tokenHash,
    removed: tokens.length !== store.tokens.length,
    registrations: tokens.length,
  };
}

export async function loadPushRegistrations(options = {}) {
  const storePath = options.storePath ?? defaultPushTokenStorePath();
  const store = await readStore(storePath);
  return store.tokens.map((item) => ({ ...item }));
}

export async function sendExpoPushNotifications(messages, options = {}) {
  const dryRun = options.dryRun ?? process.env.LUCKYME_PUSH_SEND !== "true";
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const normalized = messages.map(normalizeMessage);

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      sent: 0,
      planned: normalized.length,
    };
  }

  if (typeof fetchImpl !== "function") {
    throw new Error("fetch is required for Expo push delivery");
  }

  const responses = [];
  for (const chunk of chunks(normalized, 100)) {
    const response = await fetchImpl(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(chunk),
    });

    const payload = await response.json().catch(() => ({}));
    responses.push(payload);

    if (!response.ok) {
      throw new Error(`Expo push delivery failed: ${response.status}`);
    }
  }

  return {
    ok: true,
    dryRun: false,
    sent: normalized.length,
    planned: normalized.length,
    responses,
  };
}

async function readStore(storePath) {
  try {
    const parsed = JSON.parse(await readFile(storePath, "utf8"));
    const tokens = Array.isArray(parsed?.tokens) ? parsed.tokens : [];
    return {
      tokens: tokens
        .filter((item) => item && typeof item.token === "string")
        .map((item) => ({
          token: item.token,
          tokenHash: item.tokenHash ?? pushTokenHash(item.token),
          platform: parsePlatform(item.platform),
          deviceId: parseOptionalString(item.deviceId, 128) ?? null,
          wallet: parseOptionalString(item.wallet, 64) ?? null,
          projectId: parseOptionalString(item.projectId, 128) ?? null,
          createdAt: parseOptionalString(item.createdAt, 64) ?? new Date(0).toISOString(),
          updatedAt: parseOptionalString(item.updatedAt, 64) ?? new Date(0).toISOString(),
        })),
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { tokens: [] };
    }
    throw error;
  }
}

async function writeStore(storePath, store) {
  await mkdir(path.dirname(storePath), { recursive: true });
  const tmp = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await rename(tmp, storePath);
}

function normalizeMessage(message) {
  const to = normalizeExpoPushToken(message.to);
  const title = parseRequiredString(message.title, 80, "title");
  const body = parseRequiredString(message.body, 180, "body");

  return {
    to,
    title,
    body,
    data: message.data && typeof message.data === "object" ? message.data : {},
    channelId: parseOptionalString(message.channelId, 80) ?? "luckyme-round-alerts",
    priority: "high",
  };
}

function parsePlatform(value) {
  const platform = typeof value === "string" ? value.trim().toLowerCase() : "unknown";
  return VALID_PLATFORMS.has(platform) ? platform : "unknown";
}

function parseRequiredString(value, maxLength, label) {
  const text = parseOptionalString(value, maxLength);
  if (!text) {
    throw new Error(`${label} is required`);
  }
  return text;
}

function parseOptionalString(value, maxLength) {
  if (typeof value !== "string") {
    return undefined;
  }

  const text = value.trim();
  if (!text) {
    return undefined;
  }

  return text.slice(0, maxLength);
}

function chunks(items, size) {
  const output = [];
  for (let index = 0; index < items.length; index += size) {
    output.push(items.slice(index, index + size));
  }
  return output;
}
