import fs from "node:fs";
import path from "node:path";

const STALE_APPEND_LOCK_MS = 5 * 60 * 1_000;

export function readSettlementArchive(
  filePath = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH,
  { strict = false } = {},
) {
  if (!filePath || !fs.existsSync(filePath)) {
    return [];
  }

  const records = [];
  for (const [index, line] of fs.readFileSync(filePath, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const record = JSON.parse(line);
      if (record && record.pool && Number.isSafeInteger(Number(record.roundId))) {
        records.push(record);
      }
    } catch (error) {
      if (strict) {
        throw new Error(`Invalid settlement archive JSON at line ${index + 1}: ${error.message}`);
      }
      // Read-only API consumers may continue serving other valid records.
    }
  }
  return records;
}

export function hasArchivedSettlement(filePath, pool, roundId, identity = {}) {
  return readSettlementArchive(filePath, { strict: true }).some((record) =>
    record.pool === pool &&
    Number(record.roundId) === Number(roundId) &&
    Object.entries(identity).every(([key, value]) => record[key] === value));
}

export function appendSettlementArchive(filePath, record) {
  if (!filePath) {
    throw new Error("LUCKYME_SETTLEMENT_ARCHIVE_PATH is required before closing settled rounds");
  }
  const identity = archiveIdentity(record);
  if (hasArchivedSettlement(filePath, record.pool, record.roundId, identity)) {
    return false;
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lockPath = `${filePath}.lock`;
  let lock;
  let archive;
  try {
    lock = acquireAppendLock(lockPath);
    if (hasArchivedSettlement(filePath, record.pool, record.roundId, identity)) {
      return false;
    }
    archive = fs.openSync(filePath, "a", 0o600);
    fs.writeSync(archive, `${JSON.stringify({ ...record, archivedAt: new Date().toISOString() })}\n`);
    fs.fsyncSync(archive);
    return true;
  } finally {
    if (archive !== undefined) {
      fs.closeSync(archive);
    }
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}

export function refundJournalPath(filePath = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH) {
  return filePath ? `${filePath}.refunds.jsonl` : "";
}

export function readRefundJournal(
  filePath = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH,
  { strict = false } = {},
) {
  const journalPath = refundJournalPath(filePath);
  if (!journalPath || !fs.existsSync(journalPath)) {
    return [];
  }

  const events = [];
  for (const [index, line] of fs.readFileSync(journalPath, "utf8").split(/\r?\n/).entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      const event = JSON.parse(line);
      if (
        event &&
        typeof event.eventId === "string" &&
        typeof event.kind === "string" &&
        event.pool &&
        Number.isSafeInteger(Number(event.roundId)) &&
        typeof event.address === "string"
      ) {
        events.push(event);
      } else if (strict) {
        throw new Error("invalid refund journal event shape");
      }
    } catch (error) {
      if (strict) {
        throw new Error(`Invalid refund journal JSON at line ${index + 1}: ${error.message}`);
      }
    }
  }
  return events;
}

export function appendRefundJournalEvent(filePath, event) {
  if (!filePath) {
    throw new Error("LUCKYME_SETTLEMENT_ARCHIVE_PATH is required for refund progress");
  }
  if (!event?.eventId || !event?.kind || !event?.pool || !event?.address) {
    throw new Error("Refund journal event is missing its durable identity");
  }

  const journalPath = refundJournalPath(filePath);
  fs.mkdirSync(path.dirname(journalPath), { recursive: true });
  const lockPath = `${journalPath}.lock`;
  let lock;
  let journal;
  try {
    lock = acquireAppendLock(lockPath);
    if (readRefundJournal(filePath, { strict: true }).some((item) => item.eventId === event.eventId)) {
      return false;
    }
    journal = fs.openSync(journalPath, "a", 0o600);
    fs.writeSync(journal, `${JSON.stringify({ ...event, recordedAt: new Date().toISOString() })}\n`);
    fs.fsyncSync(journal);
    return true;
  } finally {
    if (journal !== undefined) {
      fs.closeSync(journal);
    }
    if (lock !== undefined) {
      fs.closeSync(lock);
      fs.unlinkSync(lockPath);
    }
  }
}

export function refundProgressForRound(filePath, identity) {
  const matching = readRefundJournal(filePath, { strict: true }).filter((event) =>
    (!identity.genesisHash || event.genesisHash === identity.genesisHash) &&
    event.programId === identity.programId &&
    event.pool === identity.pool &&
    Number(event.roundId) === Number(identity.roundId) &&
    event.address === identity.address,
  );
  const initialized = matching.find((event) => event.kind === "refund_initialized");
  if (!initialized) {
    return null;
  }

  const intents = new Map();
  const confirmed = new Map();
  for (const event of matching) {
    if (event.kind === "refund_intent" && event.entry) {
      intents.set(event.entry, event);
    }
    if (event.kind === "refund_confirmed" && event.entry) {
      confirmed.set(event.entry, event);
    }
  }
  const originalEntries = Array.isArray(initialized.entries) ? initialized.entries : [];
  return {
    ...initialized,
    originalEntries,
    intents: [...intents.values()],
    confirmed: [...confirmed.values()],
    refundsCompleted: confirmed.size,
    refundsPending: Math.max(0, originalEntries.length - confirmed.size),
    refundSignatures: [...confirmed.values()]
      .map((event) => event.signature)
      .filter((signature) => typeof signature === "string" && signature.length > 0),
  };
}

function archiveIdentity(record) {
  return Object.fromEntries(
    ["genesisHash", "programId", "poolAddress", "address", "accountDataHash"]
      .filter((key) => typeof record[key] === "string" && record[key])
      .map((key) => [key, record[key]]),
  );
}

function acquireAppendLock(lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const descriptor = fs.openSync(lockPath, "wx", 0o600);
      fs.writeSync(descriptor, `${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
      fs.fsyncSync(descriptor);
      return descriptor;
    } catch (error) {
      if (error?.code !== "EEXIST" || attempt > 0 || !appendLockIsStale(lockPath)) {
        throw error;
      }
      try {
        fs.unlinkSync(lockPath);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") {
          throw unlinkError;
        }
      }
    }
  }
  throw new Error(`Could not acquire append lock ${lockPath}`);
}

function appendLockIsStale(lockPath) {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > STALE_APPEND_LOCK_MS;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return true;
    }
    throw error;
  }
}
