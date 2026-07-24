import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PublicKey } from "@solana/web3.js";

export const OFFICIAL_SKR_MINT = "SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3";
export const OFFICIAL_SKR_DECIMALS = 6;
export const CAPACITY_ONLY_EXPIRY_UNIX = 253_402_300_799;

const RESERVATION_TTL_MS = 10 * 60_000;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{12,120}$/;
const STATUS_PUBLIC = new Set(["open", "locked", "randomness_pending", "winner_ready", "paid"]);

export class PromotionalPoolError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "PromotionalPoolError";
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new PromotionalPoolError(status, code, message);
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function transaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const value = action();
    db.exec("COMMIT");
    return value;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function text(value, label, { min = 1, max = 512 } = {}) {
  const result = String(value ?? "").trim();
  if (result.length < min || result.length > max) {
    fail(400, "invalid_promotion", `${label} must contain between ${min} and ${max} characters`);
  }
  return result;
}

function integer(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < min || result > max) {
    fail(400, "invalid_promotion", `${label} must be an integer between ${min} and ${max}`);
  }
  return result;
}

function wallet(value, label = "wallet") {
  try {
    return new PublicKey(String(value ?? "")).toBase58();
  } catch {
    fail(400, "invalid_wallet", `${label} is not a valid Solana address`);
  }
}

function idempotency(value) {
  const result = String(value ?? "");
  if (!IDEMPOTENCY_RE.test(result)) {
    fail(400, "invalid_idempotency_key", "Idempotency key must contain 12-120 safe characters");
  }
  return result;
}

export function decimalToBaseUnits(value, decimals, label = "prizeAmount") {
  const normalized = String(value ?? "").trim().replace(",", ".");
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(normalized)) {
    fail(400, "invalid_promotion", `${label} must be a positive decimal value`);
  }
  const [whole, fraction = ""] = normalized.split(".");
  if (fraction.length > decimals) {
    fail(400, "invalid_promotion", `${label} supports at most ${decimals} decimal places`);
  }
  const amount = BigInt(whole) * (10n ** BigInt(decimals)) +
    BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0");
  if (amount <= 0n || amount > 0xffff_ffff_ffff_ffffn) {
    fail(400, "invalid_promotion", `${label} is outside the supported range`);
  }
  return amount;
}

function presentPool(row) {
  if (!row) return null;
  return {
    id: row.id,
    numericId: row.numeric_id,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    entryCostPoints: Number(row.entry_cost_points),
    capacity: Number(row.capacity),
    prizeAsset: row.prize_asset,
    prizeAmountBaseUnits: row.prize_amount_base_units,
    prizeDecimals: Number(row.prize_decimals),
    prizeMint: row.prize_mint,
    expiryMode: row.expiry_mode,
    expiresAtUnix: Number(row.expires_at_unix),
    rulesHash: row.rules_hash,
    sponsor: row.sponsor,
    authorizer: row.authorizer,
    promotionAddress: row.promotion_address,
    vaultAddress: row.vault_address,
    prizeConfigAddress: row.prize_config_address,
    minLevel: Number(row.min_level ?? 1),
    maxLevel: Number(row.max_level ?? 100),
    economyMode: row.economy_mode ?? "standard",
    economySnapshotId: row.economy_snapshot_id ?? null,
    status: row.status,
    entryCount: Number(row.entry_count),
    winnerIndex: row.winner_index === null ? null : Number(row.winner_index),
    winnerAddress: row.winner_address,
    initializeSignature: row.initialize_signature,
    randomnessSignature: row.randomness_signature,
    settleSignature: row.settle_signature,
    archiveSignature: row.archive_signature,
    lastError: row.last_error,
    createdAt: row.created_at,
    launchedAt: row.launched_at,
    updatedAt: row.updated_at,
  };
}

export function createPromotionalPoolsService({
  dbPath = ":memory:",
  clock = Date.now,
  chain,
  reservationTtlMs = RESERVATION_TTL_MS,
} = {}) {
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(readFileSync(new URL("../migrations/002_promotional_pools.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/003_luckyme_platform.sql", import.meta.url), "utf8"));
  db.exec(readFileSync(new URL("../migrations/004_luckyme_economy.sql", import.meta.url), "utf8"));
  const ensureColumn = (table, column, definition) => {
    const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((entry) => entry.name));
    if (!columns.has(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  const taskColumns = new Set(db.prepare("PRAGMA table_info(luckyme_tasks)").all().map((column) => column.name));
  if (!taskColumns.has("action_type")) db.exec("ALTER TABLE luckyme_tasks ADD COLUMN action_type TEXT");
  if (!taskColumns.has("target_url")) db.exec("ALTER TABLE luckyme_tasks ADD COLUMN target_url TEXT");
  if (!taskColumns.has("deleted_at")) db.exec("ALTER TABLE luckyme_tasks ADD COLUMN deleted_at TEXT");
  ensureColumn("luckyme_users", "xp_total", "INTEGER NOT NULL DEFAULT 0 CHECK (xp_total >= 0)");
  ensureColumn("luckyme_users", "last_active_at", "TEXT");
  ensureColumn("luckyme_users", "is_internal", "INTEGER NOT NULL DEFAULT 0 CHECK (is_internal IN (0, 1))");
  ensureColumn("luckyme_tasks", "reward_xp", "INTEGER NOT NULL DEFAULT 0 CHECK (reward_xp >= 0)");
  ensureColumn("luckyme_tasks", "reward_preset_key", "TEXT");
  ensureColumn("luckyme_tasks", "min_level", "INTEGER NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 100)");
  ensureColumn("luckyme_tasks", "max_level", "INTEGER NOT NULL DEFAULT 100 CHECK (max_level BETWEEN 1 AND 100)");
  ensureColumn("luckyme_tasks", "participant_limit", "INTEGER CHECK (participant_limit IS NULL OR participant_limit > 0)");
  ensureColumn("luckyme_tasks", "gameplay_pool_type", "TEXT");
  ensureColumn("luckyme_tasks", "gameplay_required_count", "INTEGER");
  ensureColumn("luckyme_tasks", "starts_at", "TEXT");
  ensureColumn("promotional_pools", "min_level", "INTEGER NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 100)");
  ensureColumn("promotional_pools", "max_level", "INTEGER NOT NULL DEFAULT 100 CHECK (max_level BETWEEN 1 AND 100)");
  ensureColumn("promotional_pools", "economy_mode", "TEXT NOT NULL DEFAULT 'standard'");
  ensureColumn("promotional_pools", "economy_snapshot_id", "TEXT");

  function audit(actor, action, promotionId, details = {}) {
    db.prepare(`
      INSERT INTO promotional_pool_audit (actor, action, promotion_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(String(actor), action, promotionId ?? null, JSON.stringify(details), nowIso(clock));
  }

  function points(walletAddress) {
    const address = wallet(walletAddress);
    const row = db.prepare("SELECT balance FROM promotional_wallet_points WHERE wallet = ?").get(address);
    return Number(row?.balance ?? 0);
  }

  function availablePoints(walletAddress) {
    const address = wallet(walletAddress);
    const row = db.prepare(`
      SELECT balance - reserved_balance AS available
      FROM promotional_wallet_points WHERE wallet = ?
    `).get(address);
    return Number(row?.available ?? 0);
  }

  function creditPoints({ wallet: walletAddress, amount, idempotencyKey, actor = "admin", reason = "admin_credit" }) {
    const address = wallet(walletAddress);
    const units = integer(amount, "amount", { min: 1, max: 100_000_000 });
    const key = idempotency(idempotencyKey);
    return transaction(db, () => {
      const existing = db.prepare("SELECT * FROM promotional_points_ledger WHERE idempotency_key = ?").get(key);
      if (existing) return { balance: Number(existing.balance_after), replayed: true };
      const current = points(address);
      const next = current + units;
      const timestamp = nowIso(clock);
      db.prepare(`
        INSERT INTO promotional_wallet_points (wallet, balance, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(wallet) DO UPDATE SET balance = excluded.balance, updated_at = excluded.updated_at
      `).run(address, next, timestamp);
      const ledgerId = randomUUID();
      db.prepare(`
        INSERT INTO promotional_points_ledger
          (id, wallet, delta, balance_after, reason, promotion_id, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(ledgerId, address, units, next, reason, key, timestamp);
      audit(actor, "points_credit", null, { wallet: address, amount: units, balance: next });
      return { balance: next, replayed: false, ledgerId };
    });
  }

  function createDraft({
    title,
    subtitle = "Exclusive LuckyMe promotion",
    description,
    entryCostPoints,
    capacity,
    prizeAsset,
    prizeAmount,
    expiryMode = "capacity-only",
    expiresInMinutes,
    sponsor,
    authorizer,
    addresses,
    minLevel = 1,
    maxLevel = 100,
    economyMode = "standard",
    numericId = String(clock()),
    actor = "admin",
  }) {
    const asset = String(prizeAsset ?? "").trim().toUpperCase();
    if (!["SOL", "SKR"].includes(asset)) fail(400, "invalid_promotion", "Prize asset must be SOL or SKR");
    const mode = expiryMode === "timed" ? "timed" : "capacity-only";
    const decimals = asset === "SKR" ? OFFICIAL_SKR_DECIMALS : 9;
    const prizeBaseUnits = decimalToBaseUnits(prizeAmount, decimals);
    const capacityValue = integer(capacity, "capacity", { min: 2, max: 10_000 });
    const entryCost = integer(entryCostPoints, "entryCostPoints", { min: 1, max: 1_000_000 });
    const accessMinLevel = integer(minLevel, "minLevel", { min: 1, max: 100 });
    const accessMaxLevel = integer(maxLevel, "maxLevel", { min: 1, max: 100 });
    if (accessMinLevel > accessMaxLevel) {
      fail(400, "invalid_promotion", "Minimum level cannot exceed maximum level");
    }
    const normalizedEconomyMode = economyMode === "ultra" ? "ultra" : "standard";
    const expiresAtUnix = mode === "capacity-only"
      ? CAPACITY_ONLY_EXPIRY_UNIX
      : Math.floor(clock() / 1_000) + integer(expiresInMinutes, "expiresInMinutes", { min: 5, max: 43_200 }) * 60;
    const canonical = {
      version: 1,
      numericId: String(numericId),
      title: text(title, "title", { max: 100 }),
      subtitle: text(subtitle, "subtitle", { max: 140 }),
      description: text(description, "description", { max: 2_000 }),
      entryCostPoints: entryCost,
      capacity: capacityValue,
      prizeAsset: asset,
      prizeAmountBaseUnits: prizeBaseUnits.toString(),
      prizeMint: asset === "SKR" ? OFFICIAL_SKR_MINT : null,
      expiryMode: mode,
      expiresAtUnix,
      minLevel: accessMinLevel,
      maxLevel: accessMaxLevel,
      economyMode: normalizedEconomyMode,
    };
    const rulesHash = createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
    const id = randomUUID();
    const timestamp = nowIso(clock);
    const sponsorAddress = wallet(sponsor, "sponsor");
    const authorizerAddress = wallet(authorizer, "authorizer");
    const promotionAddress = wallet(addresses?.promotion, "promotion address");
    const vaultAddress = wallet(addresses?.vault, "vault address");
    const prizeConfigAddress = asset === "SKR"
      ? wallet(addresses?.prizeConfig, "prize config address")
      : null;
    db.prepare(`
      INSERT INTO promotional_pools
        (id, numeric_id, title, subtitle, description, entry_cost_points, capacity,
         prize_asset, prize_amount_base_units, prize_decimals, prize_mint, expiry_mode,
         expires_at_unix, rules_hash, sponsor, authorizer, promotion_address, vault_address,
         prize_config_address, min_level, max_level, economy_mode, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)
    `).run(
      id, canonical.numericId, canonical.title, canonical.subtitle, canonical.description,
      entryCost, capacityValue, asset, prizeBaseUnits.toString(), decimals,
      canonical.prizeMint, mode, expiresAtUnix, rulesHash, sponsorAddress, authorizerAddress,
      promotionAddress, vaultAddress, prizeConfigAddress, accessMinLevel, accessMaxLevel,
      normalizedEconomyMode, timestamp, timestamp,
    );
    audit(actor, "promotion_draft_created", id, canonical);
    return pool(id);
  }

  function pool(id) {
    return presentPool(db.prepare("SELECT * FROM promotional_pools WHERE id = ?").get(String(id)));
  }

  function list({ includeDrafts = false } = {}) {
    const rows = includeDrafts
      ? db.prepare("SELECT * FROM promotional_pools ORDER BY created_at DESC").all()
      : db.prepare(`
          SELECT * FROM promotional_pools
          WHERE status IN ('open', 'locked', 'randomness_pending', 'winner_ready', 'paid')
          ORDER BY created_at DESC
        `).all();
    return rows.map(presentPool);
  }

  function markPrepared(id, { actor = "admin" } = {}) {
    const timestamp = nowIso(clock);
    const result = db.prepare(`
      UPDATE promotional_pools SET status = 'prepared', updated_at = ?
      WHERE id = ? AND status = 'draft'
    `).run(timestamp, String(id));
    if (result.changes !== 1) fail(409, "promotion_not_draft", "Promotion is not a draft");
    audit(actor, "promotion_prepared", id);
    return pool(id);
  }

  function saveEconomySnapshot(promotionId, snapshot, {
    actor = "admin",
    overrides = null,
    approved = false,
  } = {}) {
    const promotion = pool(promotionId);
    if (!promotion) fail(404, "promotion_not_found", "Promotion was not found");
    const id = randomUUID();
    const timestamp = nowIso(clock);
    db.prepare(`
      INSERT INTO luckyme_promotion_economy_snapshots
        (id, promotion_id, calculator_version, mode, prize_asset, prize_amount,
         usd_price, price_source, price_fetched_at, price_block_id, prize_usd,
         buffer_bps, adjusted_budget_usd, lp_accounting_value_usd, required_lp_burn,
         recommended_capacity, recommended_entry_cost_points, selected_capacity,
         selected_entry_cost_points, total_lp_at_capacity, use_live_audience,
         audience_reliable, eligible_active_users, historical_conversion_rate,
         intentional_subsidy, house_subsidy_usd, min_level, max_level, terminal_json,
         override_json, approved_by, approved_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
              ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      promotion.id,
      snapshot.calculatorVersion,
      snapshot.mode,
      snapshot.prizeAsset,
      String(snapshot.prizeAmount),
      snapshot.usdPrice,
      snapshot.priceSource,
      snapshot.priceFetchedAt,
      snapshot.priceBlockId,
      snapshot.prizeUsd,
      snapshot.bufferBps,
      snapshot.adjustedBudgetUsd,
      snapshot.lpAccountingValueUsd,
      snapshot.requiredLpBurn,
      snapshot.recommendedCapacity,
      snapshot.recommendedEntryCostPoints,
      snapshot.capacity,
      snapshot.entryCostPoints,
      snapshot.totalLpAtCapacity,
      snapshot.useLiveAudience ? 1 : 0,
      snapshot.audienceReliable ? 1 : 0,
      snapshot.eligibleActiveUsers,
      snapshot.historicalConversionRate,
      snapshot.intentionalSubsidy ? 1 : 0,
      snapshot.houseSubsidyUsd,
      snapshot.minLevel,
      snapshot.maxLevel,
      JSON.stringify(snapshot.terminal ?? []),
      overrides ? JSON.stringify(overrides) : null,
      approved ? String(actor) : null,
      approved ? timestamp : null,
      timestamp,
    );
    db.prepare(`
      UPDATE promotional_pools
      SET economy_snapshot_id = ?, economy_mode = ?, min_level = ?, max_level = ?, updated_at = ?
      WHERE id = ?
    `).run(id, snapshot.mode, snapshot.minLevel, snapshot.maxLevel, timestamp, promotion.id);
    audit(actor, "promotion_economy_snapshot_saved", promotion.id, {
      snapshotId: id,
      calculatorVersion: snapshot.calculatorVersion,
      intentionalSubsidy: snapshot.intentionalSubsidy,
    });
    return economySnapshot(promotion.id);
  }

  function economySnapshot(promotionId) {
    const row = db.prepare(`
      SELECT * FROM luckyme_promotion_economy_snapshots WHERE promotion_id = ?
    `).get(String(promotionId));
    if (!row) return null;
    return {
      id: row.id,
      promotionId: row.promotion_id,
      calculatorVersion: row.calculator_version,
      mode: row.mode,
      prizeAsset: row.prize_asset,
      prizeAmount: row.prize_amount,
      usdPrice: Number(row.usd_price),
      priceSource: row.price_source,
      priceFetchedAt: row.price_fetched_at,
      priceBlockId: row.price_block_id == null ? null : Number(row.price_block_id),
      prizeUsd: Number(row.prize_usd),
      requiredLpBurn: Number(row.required_lp_burn),
      recommendedCapacity: Number(row.recommended_capacity),
      recommendedEntryCostPoints: Number(row.recommended_entry_cost_points),
      capacity: Number(row.selected_capacity),
      entryCostPoints: Number(row.selected_entry_cost_points),
      totalLpAtCapacity: Number(row.total_lp_at_capacity),
      useLiveAudience: Boolean(row.use_live_audience),
      audienceReliable: Boolean(row.audience_reliable),
      eligibleActiveUsers: Number(row.eligible_active_users),
      intentionalSubsidy: Boolean(row.intentional_subsidy),
      houseSubsidyUsd: Number(row.house_subsidy_usd),
      terminal: JSON.parse(row.terminal_json),
      overrides: row.override_json ? JSON.parse(row.override_json) : null,
      approvedBy: row.approved_by,
      approvedAt: row.approved_at,
      createdAt: row.created_at,
    };
  }

  function markLaunched(id, { signature, actor = "admin" }) {
    const tx = text(signature, "initialize signature", { min: 64, max: 128 });
    const timestamp = nowIso(clock);
    const result = db.prepare(`
      UPDATE promotional_pools
      SET status = 'open', initialize_signature = ?, launched_at = ?, updated_at = ?
      WHERE id = ? AND status = 'prepared'
    `).run(tx, timestamp, timestamp, String(id));
    if (result.changes !== 1) fail(409, "promotion_not_prepared", "Promotion is not prepared");
    audit(actor, "promotion_launched", id, { signature: tx });
    return pool(id);
  }

  function reserveEntry({ promotionId, wallet: walletAddress, idempotencyKey }) {
    releaseExpiredReservations();
    const address = wallet(walletAddress);
    const key = idempotency(idempotencyKey);
    return transaction(db, () => {
      const existing = db.prepare(`
        SELECT e.*, p.balance, (p.balance - p.reserved_balance) AS available_balance
        FROM promotional_pool_entries e
        JOIN promotional_wallet_points p ON p.wallet = e.wallet
        WHERE e.idempotency_key = ?
      `).get(key);
      if (existing) {
        return {
          entryId: existing.id,
          balance: Number(existing.balance),
          availableBalance: Number(existing.available_balance),
          replayed: true,
          status: existing.status,
        };
      }
      const promotion = pool(promotionId);
      if (!promotion || promotion.status !== "open") {
        fail(409, "promotion_not_open", "Promotion is not open");
      }
      if (promotion.entryCount >= promotion.capacity) fail(409, "promotion_full", "Promotion is full");
      const total = points(address);
      const available = availablePoints(address);
      if (available < promotion.entryCostPoints) {
        fail(409, "insufficient_lucky_points", "Not enough Lucky Points");
      }
      const timestamp = nowIso(clock);
      const entryId = randomUUID();
      db.prepare(`
        UPDATE promotional_wallet_points
        SET reserved_balance = reserved_balance + ?, updated_at = ?
        WHERE wallet = ?
      `).run(promotion.entryCostPoints, timestamp, address);
      db.prepare(`
        INSERT INTO promotional_pool_entries
          (id, promotion_id, wallet, points_ledger_id, status, idempotency_key,
           reservation_expires_at, created_at)
        VALUES (?, ?, ?, NULL, 'reserved', ?, ?, ?)
      `).run(
        entryId,
        promotion.id,
        address,
        key,
        new Date(clock() + reservationTtlMs).toISOString(),
        timestamp,
      );
      return {
        entryId,
        balance: total,
        availableBalance: available - promotion.entryCostPoints,
        replayed: false,
        status: "reserved",
      };
    });
  }

  async function confirmEntry({ entryId, wallet: expectedWallet, entryAddress, entryIndex, entrySignature }) {
    const reservation = db.prepare("SELECT * FROM promotional_pool_entries WHERE id = ?").get(String(entryId));
    if (!reservation) fail(404, "entry_not_found", "Entry reservation was not found");
    if (expectedWallet && reservation.wallet !== wallet(expectedWallet)) {
      fail(403, "entry_wallet_mismatch", "Entry reservation belongs to another wallet");
    }
    if (reservation.status === "confirmed") {
      return { entry: reservation, promotion: pool(reservation.promotion_id), replayed: true };
    }
    if (reservation.status !== "reserved") fail(409, "entry_not_reserved", "Entry is not reserved");
    const verified = await chain?.verifyEntry?.({
      promotion: pool(reservation.promotion_id),
      wallet: reservation.wallet,
      entryAddress: wallet(entryAddress, "entry address"),
      entryIndex: integer(entryIndex, "entryIndex", { min: 0, max: 9_999 }),
      signature: text(entrySignature, "entry signature", { min: 64, max: 128 }),
    });
    if (verified !== true) fail(409, "entry_not_confirmed_onchain", "Entry is not confirmed on Solana");
    return transaction(db, () => {
      const promotion = pool(reservation.promotion_id);
      const nextCount = promotion.entryCount + 1;
      if (nextCount > promotion.capacity) fail(409, "promotion_full", "Promotion is full");
      const timestamp = nowIso(clock);
      const total = points(reservation.wallet);
      const nextBalance = total - promotion.entryCostPoints;
      const ledgerId = randomUUID();
      const debit = db.prepare(`
        UPDATE promotional_wallet_points
        SET balance = ?, reserved_balance = reserved_balance - ?, updated_at = ?
        WHERE wallet = ? AND reserved_balance >= ? AND balance >= ?
      `).run(
        nextBalance,
        promotion.entryCostPoints,
        timestamp,
        reservation.wallet,
        promotion.entryCostPoints,
        promotion.entryCostPoints,
      );
      if (debit.changes !== 1) fail(409, "points_reservation_missing", "Lucky Points reservation is unavailable");
      db.prepare(`
        INSERT INTO promotional_points_ledger
          (id, wallet, delta, balance_after, reason, promotion_id, idempotency_key, created_at)
        VALUES (?, ?, ?, ?, 'promotion_entry_confirmed', ?, ?, ?)
      `).run(
        ledgerId,
        reservation.wallet,
        -promotion.entryCostPoints,
        nextBalance,
        promotion.id,
        `confirmed:${reservation.id}`,
        timestamp,
      );
      db.prepare(`
        UPDATE promotional_pool_entries
        SET status = 'confirmed', points_ledger_id = ?, entry_address = ?, entry_index = ?, entry_signature = ?,
            confirmed_at = ?
        WHERE id = ? AND status = 'reserved'
      `).run(ledgerId, wallet(entryAddress), Number(entryIndex), String(entrySignature), timestamp, reservation.id);
      db.prepare(`
        UPDATE promotional_pools
        SET entry_count = ?, status = ?, updated_at = ?
        WHERE id = ?
      `).run(nextCount, nextCount === promotion.capacity ? "locked" : "open", timestamp, promotion.id);
      return {
        entry: db.prepare("SELECT * FROM promotional_pool_entries WHERE id = ?").get(reservation.id),
        promotion: pool(promotion.id),
        replayed: false,
      };
    });
  }

  function confirmedEntryAtIndex(promotionId, entryIndex) {
    const row = db.prepare(`
      SELECT * FROM promotional_pool_entries
      WHERE promotion_id = ? AND entry_index = ? AND status = 'confirmed'
    `).get(String(promotionId), integer(entryIndex, "entryIndex", { min: 0, max: 9_999 }));
    return row ? {
      id: row.id,
      promotionId: row.promotion_id,
      wallet: row.wallet,
      entryAddress: row.entry_address,
      entryIndex: Number(row.entry_index),
      entrySignature: row.entry_signature,
    } : null;
  }

  function recordRandomnessRequested(id, { signature, actor = "keeper" }) {
    const tx = text(signature, "randomness signature", { min: 64, max: 128 });
    const timestamp = nowIso(clock);
    const result = db.prepare(`
      UPDATE promotional_pools
      SET status = 'randomness_pending', randomness_signature = ?, updated_at = ?
      WHERE id = ? AND status = 'locked'
    `).run(tx, timestamp, String(id));
    if (result.changes !== 1) fail(409, "promotion_not_locked", "Promotion is not ready for randomness");
    audit(actor, "promotion_randomness_requested", id, { signature: tx });
    return pool(id);
  }

  function recordSettlement(id, { signature, winnerAddress, actor = "keeper" }) {
    const tx = text(signature, "settlement signature", { min: 64, max: 128 });
    const winner = wallet(winnerAddress, "winner");
    const timestamp = nowIso(clock);
    const result = db.prepare(`
      UPDATE promotional_pools
      SET status = 'paid', winner_address = ?, settle_signature = ?, updated_at = ?
      WHERE id = ? AND status IN ('winner_ready', 'randomness_pending')
    `).run(winner, tx, timestamp, String(id));
    if (result.changes !== 1) fail(409, "promotion_not_payable", "Promotion is not ready for payout");
    audit(actor, "promotion_paid", id, { signature: tx, winner });
    return pool(id);
  }

  function releaseExpiredReservations() {
    const expired = db.prepare(`
      SELECT * FROM promotional_pool_entries
      WHERE status = 'reserved' AND reservation_expires_at <= ?
      ORDER BY created_at
    `).all(nowIso(clock));
    for (const entry of expired) {
      transaction(db, () => {
        const promotion = pool(entry.promotion_id);
        const timestamp = nowIso(clock);
        db.prepare(`
          UPDATE promotional_wallet_points
          SET reserved_balance = reserved_balance - ?, updated_at = ?
          WHERE wallet = ? AND reserved_balance >= ?
        `).run(promotion.entryCostPoints, timestamp, entry.wallet, promotion.entryCostPoints);
        db.prepare(`
          UPDATE promotional_pool_entries SET status = 'released', released_at = ? WHERE id = ?
        `).run(timestamp, entry.id);
      });
    }
    return expired.length;
  }

  async function sync(id) {
    const promotion = pool(id);
    if (!promotion) fail(404, "promotion_not_found", "Promotion was not found");
    if (!chain?.readPromotion) return promotion;
    const state = await chain.readPromotion(promotion);
    if (!state) {
      if (promotion.status === "paid" || promotion.status === "cancelled") {
        db.prepare("UPDATE promotional_pools SET status = 'archived', updated_at = ? WHERE id = ?")
          .run(nowIso(clock), promotion.id);
        return pool(id);
      }
      fail(503, "promotion_unavailable", "Promotion account is unavailable");
    }
    const status = text(state.status, "status", { max: 32 });
    if (!STATUS_PUBLIC.has(status) && !["cancelled", "archived", "error"].includes(status)) {
      fail(503, "promotion_invalid_state", "Promotion returned an invalid state");
    }
    db.prepare(`
      UPDATE promotional_pools
      SET status = ?, entry_count = ?, winner_index = ?, winner_address = ?,
          last_error = NULL, updated_at = ?
      WHERE id = ?
    `).run(
      status,
      integer(state.entryCount, "entryCount", { min: 0, max: promotion.capacity }),
      state.winnerIndex ?? null,
      state.winnerAddress ? wallet(state.winnerAddress, "winner") : null,
      nowIso(clock),
      promotion.id,
    );
    return pool(id);
  }

  async function treasury() {
    if (!chain?.treasurySummary) fail(503, "treasury_unavailable", "Treasury reader is not configured");
    return chain.treasurySummary(list({ includeDrafts: true }));
  }

  function close() {
    db.close();
  }

  return {
    db,
    points,
    availablePoints,
    creditPoints,
    createDraft,
    saveEconomySnapshot,
    economySnapshot,
    pool,
    list,
    markPrepared,
    markLaunched,
    reserveEntry,
    confirmEntry,
    confirmedEntryAtIndex,
    recordRandomnessRequested,
    recordSettlement,
    releaseExpiredReservations,
    sync,
    treasury,
    close,
  };
}
