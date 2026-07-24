PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS luckyme_xp_ledger (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE RESTRICT,
  delta INTEGER NOT NULL CHECK (delta > 0),
  xp_after INTEGER NOT NULL CHECK (xp_after >= 0),
  reason TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS luckyme_xp_ledger_wallet_idx
  ON luckyme_xp_ledger(wallet, created_at DESC);

CREATE TABLE IF NOT EXISTS luckyme_gameplay_events (
  id TEXT PRIMARY KEY,
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE RESTRICT,
  pool_type TEXT NOT NULL CHECK (pool_type IN ('mini', 'normal', 'high', 'premium')),
  round_id INTEGER NOT NULL CHECK (round_id > 0),
  settlement_signature TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  settled_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (wallet, pool_type, round_id)
);

CREATE INDEX IF NOT EXISTS luckyme_gameplay_events_wallet_idx
  ON luckyme_gameplay_events(wallet, settled_at DESC);

CREATE TABLE IF NOT EXISTS luckyme_task_progress (
  task_id TEXT NOT NULL REFERENCES luckyme_tasks(id) ON DELETE RESTRICT,
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE RESTRICT,
  progress_count INTEGER NOT NULL DEFAULT 0 CHECK (progress_count >= 0),
  required_count INTEGER NOT NULL CHECK (required_count > 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'completed', 'rewarded', 'expired')),
  started_at TEXT NOT NULL,
  last_event_at TEXT,
  completed_at TEXT,
  rewarded_at TEXT,
  PRIMARY KEY (task_id, wallet)
);

CREATE TABLE IF NOT EXISTS luckyme_avatar_catalog (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  asset_key TEXT NOT NULL UNIQUE,
  min_level INTEGER NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 100),
  price_points INTEGER NOT NULL DEFAULT 0 CHECK (price_points >= 0),
  rank_key TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'retired')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS luckyme_avatar_ownership (
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE RESTRICT,
  avatar_id TEXT NOT NULL REFERENCES luckyme_avatar_catalog(id) ON DELETE RESTRICT,
  acquisition_type TEXT NOT NULL CHECK (acquisition_type IN ('level', 'points', 'admin')),
  points_spent INTEGER NOT NULL DEFAULT 0 CHECK (points_spent >= 0),
  acquired_at TEXT NOT NULL,
  PRIMARY KEY (wallet, avatar_id)
);

CREATE TABLE IF NOT EXISTS luckyme_active_avatars (
  wallet TEXT PRIMARY KEY REFERENCES luckyme_users(wallet) ON DELETE RESTRICT,
  avatar_id TEXT NOT NULL REFERENCES luckyme_avatar_catalog(id) ON DELETE RESTRICT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS luckyme_promotion_economy_snapshots (
  id TEXT PRIMARY KEY,
  promotion_id TEXT UNIQUE REFERENCES promotional_pools(id) ON DELETE RESTRICT,
  calculator_version TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('standard', 'ultra')),
  prize_asset TEXT NOT NULL CHECK (prize_asset IN ('SOL', 'SKR')),
  prize_amount TEXT NOT NULL,
  usd_price REAL NOT NULL CHECK (usd_price > 0),
  price_source TEXT NOT NULL,
  price_fetched_at TEXT NOT NULL,
  price_block_id INTEGER,
  prize_usd REAL NOT NULL CHECK (prize_usd > 0),
  buffer_bps INTEGER NOT NULL CHECK (buffer_bps >= 10000),
  adjusted_budget_usd REAL NOT NULL CHECK (adjusted_budget_usd > 0),
  lp_accounting_value_usd REAL NOT NULL CHECK (lp_accounting_value_usd > 0),
  required_lp_burn INTEGER NOT NULL CHECK (required_lp_burn > 0),
  recommended_capacity INTEGER NOT NULL CHECK (recommended_capacity > 1),
  recommended_entry_cost_points INTEGER NOT NULL CHECK (recommended_entry_cost_points > 0),
  selected_capacity INTEGER NOT NULL CHECK (selected_capacity > 1),
  selected_entry_cost_points INTEGER NOT NULL CHECK (selected_entry_cost_points > 0),
  total_lp_at_capacity INTEGER NOT NULL CHECK (total_lp_at_capacity > 0),
  use_live_audience INTEGER NOT NULL DEFAULT 0 CHECK (use_live_audience IN (0, 1)),
  audience_reliable INTEGER NOT NULL DEFAULT 0 CHECK (audience_reliable IN (0, 1)),
  eligible_active_users INTEGER NOT NULL DEFAULT 0 CHECK (eligible_active_users >= 0),
  historical_conversion_rate REAL NOT NULL,
  intentional_subsidy INTEGER NOT NULL DEFAULT 0 CHECK (intentional_subsidy IN (0, 1)),
  house_subsidy_usd REAL NOT NULL DEFAULT 0 CHECK (house_subsidy_usd >= 0),
  min_level INTEGER NOT NULL DEFAULT 1 CHECK (min_level BETWEEN 1 AND 100),
  max_level INTEGER NOT NULL DEFAULT 100 CHECK (max_level BETWEEN 1 AND 100),
  terminal_json TEXT NOT NULL,
  override_json TEXT,
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS luckyme_promotion_economy_created_idx
  ON luckyme_promotion_economy_snapshots(created_at DESC);
