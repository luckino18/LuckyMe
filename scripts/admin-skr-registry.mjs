import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const SKR_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}\.skr$/;
export const SKR_EXPORT_SIZES = Object.freeze([10, 20, 50, 100]);
export const MAX_SKR_IMPORT = 1_000;

export function normalizeSkrName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^@+/, "");
}

function safeIso(value, fallback = new Date().toISOString()) {
  const date = new Date(value ?? fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function emptyRegistry() {
  return { version: 2, nextId: 1, updatedAt: null, aliases: {}, users: {} };
}

function normalizeRegistry(parsed) {
  if (![1, 2].includes(parsed?.version) || !parsed.users || typeof parsed.users !== "object") return emptyRegistry();
  const registry = { ...parsed, version: 2, aliases: { ...(parsed.aliases ?? {}) }, users: { ...parsed.users } };
  let nextId = Math.max(1, Number(registry.nextId) || 1);
  const records = Object.values(registry.users).sort((left, right) =>
    String(left.firstSeenAt ?? "").localeCompare(String(right.firstSeenAt ?? "")) || String(left.name ?? "").localeCompare(String(right.name ?? ""))
  );
  for (const record of records) {
    if (!Number.isSafeInteger(record.id) || record.id < 1) record.id = nextId++;
    else nextId = Math.max(nextId, record.id + 1);
  }
  registry.nextId = nextId;
  return registry;
}

function readRegistry(filePath) {
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeRegistry(parsed);
  } catch (error) {
    if (error?.code === "ENOENT") return emptyRegistry();
    throw error;
  }
}

function writeRegistry(filePath, registry) {
  mkdirSync(dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  registry.updatedAt = new Date().toISOString();
  writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, filePath);
}

function publicUser(record) {
  const minted = Boolean(record.mintedAt || record.assetId);
  const reserved = !minted && Boolean(record.reservedAt);
  return {
    id: record.id,
    name: record.name,
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    captureCount: record.captureCount,
    sources: Object.entries(record.sources ?? {}).map(([label, source]) => ({ label, ...source })),
    exportCount: record.exportCount ?? 0,
    lastExportedAt: record.lastExportedAt ?? null,
    status: minted ? "sent" : reserved ? "reserved" : "ready",
    minted,
    reservedAt: reserved ? record.reservedAt : null,
    reservationId: reserved ? record.reservationId ?? null : null,
    mintedAt: record.mintedAt ?? null,
    wallet: record.wallet ?? null,
    assetId: record.assetId ?? null,
    signature: record.signature ?? null,
  };
}

export function createSkrRegistry({ filePath } = {}) {
  if (!filePath) throw new Error("A persistent SKR registry path is required");

  function canonicalName(registry, value) {
    let name = normalizeSkrName(value);
    const visited = new Set();
    while (registry.aliases?.[name] && !visited.has(name)) {
      visited.add(name);
      name = normalizeSkrName(registry.aliases[name]);
    }
    return name;
  }

  function importNames(values, { source = "ADB capture", capturedAt } = {}) {
    if (!Array.isArray(values) || values.length > MAX_SKR_IMPORT) throw Object.assign(new Error(`An import can contain at most ${MAX_SKR_IMPORT} usernames`), { status: 400 });
    const sourceLabel = String(source ?? "ADB capture").normalize("NFKC").trim().slice(0, 100) || "ADB capture";
    const timestamp = safeIso(capturedAt);
    const registry = readRegistry(filePath);
    const seenInRequest = new Set();
    const rows = [];

    for (const value of values) {
      const name = canonicalName(registry, value);
      if (!SKR_PATTERN.test(name) || seenInRequest.has(name)) continue;
      seenInRequest.add(name);
      const existing = registry.users[name];
      const record = existing ?? {
        id: registry.nextId++,
        name,
        firstSeenAt: timestamp,
        captureCount: 0,
        sources: {},
        exportCount: 0,
      };
      record.lastSeenAt = timestamp;
      record.captureCount += 1;
      const sourceRecord = record.sources[sourceLabel] ?? { firstSeenAt: timestamp, count: 0 };
      sourceRecord.lastSeenAt = timestamp;
      sourceRecord.count += 1;
      record.sources[sourceLabel] = sourceRecord;
      registry.users[name] = record;
      rows.push({ ...publicUser(record), existedBefore: Boolean(existing) });
    }
    writeRegistry(filePath, registry);
    return rows;
  }

  function reserveNext(limit = 100) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw Object.assign(new Error("A Send NFT batch can contain between 1 and 100 usernames"), { status: 400 });
    const registry = readRegistry(filePath);
    const existingReservation = Object.values(registry.users)
      .filter((record) => record.reservedAt && !record.mintedAt && !record.assetId)
      .sort((left, right) => Number(left.id) - Number(right.id));
    if (existingReservation.length) {
      return {
        reservationId: existingReservation[0].reservationId ?? null,
        names: existingReservation.slice(0, limit).map((record) => record.name),
        reused: true,
      };
    }
    const ready = Object.values(registry.users)
      .filter((record) => !record.reservedAt && !record.mintedAt && !record.assetId)
      .sort((left, right) => Number(left.id) - Number(right.id))
      .slice(0, limit);
    const timestamp = new Date().toISOString();
    const reservationId = ready.length ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}` : null;
    for (const record of ready) {
      record.reservedAt = timestamp;
      record.reservationId = reservationId;
      record.exportCount = Number(record.exportCount ?? 0) + 1;
      record.lastExportedAt = timestamp;
    }
    if (ready.length) writeRegistry(filePath, registry);
    return { reservationId, names: ready.map((record) => record.name), reused: false };
  }

  function releaseReserved() {
    const registry = readRegistry(filePath);
    const released = [];
    for (const record of Object.values(registry.users)) {
      if (!record.reservedAt || record.mintedAt || record.assetId) continue;
      released.push(record.name);
      delete record.reservedAt;
      delete record.reservationId;
    }
    if (released.length) writeRegistry(filePath, registry);
    return released;
  }

  function releaseNames(values) {
    if (!Array.isArray(values)) return [];
    const registry = readRegistry(filePath);
    const requested = new Set(values.map((value) => canonicalName(registry, value)).filter((name) => SKR_PATTERN.test(name)));
    const released = [];
    for (const name of requested) {
      const record = registry.users[name];
      if (!record?.reservedAt || record.mintedAt || record.assetId) continue;
      released.push(name);
      delete record.reservedAt;
      delete record.reservationId;
    }
    if (released.length) writeRegistry(filePath, registry);
    return released;
  }

  function exportBatch(values, limit) {
    if (!SKR_EXPORT_SIZES.includes(limit)) throw Object.assign(new Error(`Export size must be one of: ${SKR_EXPORT_SIZES.join(", ")}`), { status: 400 });
    if (!Array.isArray(values) || values.length > MAX_SKR_IMPORT) throw Object.assign(new Error(`An export can contain at most ${MAX_SKR_IMPORT} usernames`), { status: 400 });
    const registry = readRegistry(filePath);
    const unique = [];
    const seen = new Set();
    for (const value of values) {
      const name = normalizeSkrName(value);
      if (!SKR_PATTERN.test(name) || seen.has(name)) continue;
      seen.add(name);
      const record = registry.users[name];
      if (!record || record.mintedAt || record.assetId) continue;
      unique.push(name);
      if (unique.length >= limit) break;
    }
    const timestamp = new Date().toISOString();
    for (const name of unique) {
      const record = registry.users[name];
      record.exportCount = Number(record.exportCount ?? 0) + 1;
      record.lastExportedAt = timestamp;
    }
    if (unique.length) writeRegistry(filePath, registry);
    return unique;
  }

  function markMinted(assets, { signature, mintedAt } = {}) {
    if (!Array.isArray(assets)) return [];
    const timestamp = safeIso(mintedAt);
    const registry = readRegistry(filePath);
    const updated = [];
    for (const asset of assets) {
      const name = canonicalName(registry, asset?.name);
      if (!SKR_PATTERN.test(name)) continue;
      const record = registry.users[name] ?? {
        id: registry.nextId++,
        name,
        firstSeenAt: timestamp,
        lastSeenAt: timestamp,
        captureCount: 0,
        sources: {},
        exportCount: 0,
      };
      record.mintedAt = record.mintedAt ?? timestamp;
      record.wallet = asset.wallet ?? record.wallet ?? null;
      record.assetId = asset.assetId ?? record.assetId ?? null;
      record.signature = signature ?? asset.signature ?? record.signature ?? null;
      delete record.reservedAt;
      delete record.reservationId;
      registry.users[name] = record;
      updated.push(publicUser(record));
    }
    if (updated.length) writeRegistry(filePath, registry);
    return updated;
  }

  function correctName(fromValue, toValue, { wallet } = {}) {
    const from = normalizeSkrName(fromValue);
    const to = normalizeSkrName(toValue);
    if (!SKR_PATTERN.test(from) || !SKR_PATTERN.test(to)) throw Object.assign(new Error("Valid source and corrected .skr names are required"), { status: 400 });
    const registry = readRegistry(filePath);
    const canonicalTo = canonicalName(registry, to);
    if (from === canonicalTo) return registry.users[canonicalTo] ? publicUser(registry.users[canonicalTo]) : null;

    const source = registry.users[from];
    const target = registry.users[canonicalTo];
    registry.aliases[from] = canonicalTo;
    if (!source) {
      writeRegistry(filePath, registry);
      return target ? publicUser(target) : null;
    }

    const merged = target ?? { ...source, name: canonicalTo };
    if (target) {
      merged.id = Math.min(Number(source.id), Number(target.id));
      merged.firstSeenAt = [source.firstSeenAt, target.firstSeenAt].filter(Boolean).sort()[0] ?? null;
      merged.lastSeenAt = [source.lastSeenAt, target.lastSeenAt].filter(Boolean).sort().at(-1) ?? null;
      merged.captureCount = Number(source.captureCount ?? 0) + Number(target.captureCount ?? 0);
      merged.exportCount = Number(source.exportCount ?? 0) + Number(target.exportCount ?? 0);
      merged.lastExportedAt = [source.lastExportedAt, target.lastExportedAt].filter(Boolean).sort().at(-1) ?? null;
      merged.sources = { ...(source.sources ?? {}) };
      for (const [label, item] of Object.entries(target.sources ?? {})) {
        const previous = merged.sources[label];
        merged.sources[label] = previous ? {
          firstSeenAt: [previous.firstSeenAt, item.firstSeenAt].filter(Boolean).sort()[0] ?? null,
          lastSeenAt: [previous.lastSeenAt, item.lastSeenAt].filter(Boolean).sort().at(-1) ?? null,
          count: Number(previous.count ?? 0) + Number(item.count ?? 0),
        } : item;
      }
      for (const field of ["mintedAt", "wallet", "assetId", "signature"]) merged[field] = target[field] ?? source[field] ?? null;
      if (!merged.mintedAt && !merged.assetId) {
        merged.reservedAt = target.reservedAt ?? source.reservedAt ?? null;
        merged.reservationId = target.reservationId ?? source.reservationId ?? null;
      } else {
        delete merged.reservedAt;
        delete merged.reservationId;
      }
    }
    merged.name = canonicalTo;
    if (wallet) merged.wallet = wallet;
    registry.users[canonicalTo] = merged;
    delete registry.users[from];
    writeRegistry(filePath, registry);
    return publicUser(merged);
  }

  function removeName(value) {
    const name = normalizeSkrName(value);
    if (!SKR_PATTERN.test(name)) throw Object.assign(new Error("A valid username.skr is required"), { status: 400 });
    const registry = readRegistry(filePath);
    const record = registry.users[name];
    if (!record) throw Object.assign(new Error("username_not_found"), { status: 404 });
    if (record.mintedAt || record.assetId) {
      throw Object.assign(new Error("confirmed_nft_history_cannot_be_removed"), { status: 409 });
    }
    const removed = publicUser(record);
    delete registry.users[name];
    writeRegistry(filePath, registry);
    return removed;
  }

  function snapshot({ search = "", status = "all" } = {}) {
    const registry = readRegistry(filePath);
    const needle = String(search ?? "").trim().toLocaleLowerCase("en-US");
    const all = Object.values(registry.users).map(publicUser);
    const users = all
      .filter((row) => !needle || row.name.includes(needle) || row.wallet?.toLowerCase().includes(needle))
      .filter((row) => status === "sent" || status === "minted" ? row.status === "sent" : status === "reserved" ? row.status === "reserved" : status === "ready" || status === "eligible" ? row.status === "ready" : true)
      .sort((left, right) => Number(left.id) - Number(right.id));
    return {
      updatedAt: registry.updatedAt,
      summary: {
        total: all.length,
        ready: all.filter((row) => row.status === "ready").length,
        reserved: all.filter((row) => row.status === "reserved").length,
        sent: all.filter((row) => row.status === "sent").length,
        minted: all.filter((row) => row.status === "sent").length,
        eligible: all.filter((row) => row.status === "ready").length,
        duplicateCaptures: all.reduce((sum, row) => sum + Math.max(0, Number(row.captureCount) - 1), 0),
      },
      users,
    };
  }

  return { importNames, exportBatch, reserveNext, releaseReserved, releaseNames, markMinted, correctName, removeName, snapshot };
}
