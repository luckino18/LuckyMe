PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS promotional_wallet_points (
  wallet TEXT PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK (balance >= 0),
  reserved_balance INTEGER NOT NULL DEFAULT 0 CHECK (reserved_balance >= 0 AND reserved_balance <= balance),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS promotional_points_ledger (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES promotional_wallet_points(wallet),
  delta INTEGER NOT NULL CHECK (delta <> 0),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reason TEXT NOT NULL,
  promotion_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS promotional_points_ledger_wallet_idx
  ON promotional_points_ledger(wallet, created_at DESC);

CREATE TABLE IF NOT EXISTS promotional_pools (
  id TEXT PRIMARY KEY,
  numeric_id TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  subtitle TEXT NOT NULL,
  description TEXT NOT NULL,
  entry_cost_points INTEGER NOT NULL CHECK (entry_cost_points > 0),
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  prize_asset TEXT NOT NULL CHECK (prize_asset IN ('SOL', 'SKR')),
  prize_amount_base_units TEXT NOT NULL,
  prize_decimals INTEGER NOT NULL CHECK (prize_decimals BETWEEN 0 AND 18),
  prize_mint TEXT,
  expiry_mode TEXT NOT NULL CHECK (expiry_mode IN ('capacity-only', 'timed')),
  expires_at_unix INTEGER NOT NULL,
  rules_hash TEXT NOT NULL UNIQUE,
  sponsor TEXT NOT NULL,
  authorizer TEXT NOT NULL,
  promotion_address TEXT NOT NULL UNIQUE,
  vault_address TEXT NOT NULL,
  prize_config_address TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'draft', 'prepared', 'open', 'locked', 'randomness_pending',
    'winner_ready', 'paid', 'cancelled', 'archived', 'error'
  )),
  entry_count INTEGER NOT NULL DEFAULT 0 CHECK (entry_count >= 0),
  winner_index INTEGER,
  winner_address TEXT,
  initialize_signature TEXT,
  randomness_signature TEXT,
  settle_signature TEXT,
  archive_signature TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  launched_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS promotional_pools_status_idx
  ON promotional_pools(status, created_at DESC);

CREATE TABLE IF NOT EXISTS promotional_pool_entries (
  id TEXT PRIMARY KEY,
  promotion_id TEXT NOT NULL REFERENCES promotional_pools(id) ON DELETE RESTRICT,
  wallet TEXT NOT NULL,
  entry_address TEXT,
  entry_index INTEGER,
  points_ledger_id TEXT UNIQUE REFERENCES promotional_points_ledger(id),
  status TEXT NOT NULL CHECK (status IN ('reserved', 'confirmed', 'released', 'closed')),
  idempotency_key TEXT NOT NULL UNIQUE,
  reservation_expires_at TEXT NOT NULL,
  entry_signature TEXT,
  close_signature TEXT,
  created_at TEXT NOT NULL,
  confirmed_at TEXT,
  released_at TEXT,
  closed_at TEXT,
  UNIQUE (promotion_id, wallet)
);

CREATE INDEX IF NOT EXISTS promotional_pool_entries_status_idx
  ON promotional_pool_entries(status, reservation_expires_at);

CREATE TABLE IF NOT EXISTS promotional_pool_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  promotion_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
