PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS seeker_identities (
  id INTEGER PRIMARY KEY,
  sgt_mint TEXT NOT NULL UNIQUE,
  current_wallet TEXT NOT NULL,
  skr_domain TEXT,
  verified_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('verified', 'suspended', 'invalidated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS seeker_identities_wallet_idx
  ON seeker_identities(current_wallet);

CREATE TABLE IF NOT EXISTS seeker_identity_wallets (
  sgt_mint TEXT NOT NULL REFERENCES seeker_identities(sgt_mint),
  wallet TEXT NOT NULL,
  first_verified_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  PRIMARY KEY (sgt_mint, wallet)
);

CREATE INDEX IF NOT EXISTS seeker_identity_wallets_wallet_idx
  ON seeker_identity_wallets(wallet);

CREATE TABLE IF NOT EXISTS siws_nonces (
  nonce_hash TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  uri TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  consumed_at TEXT,
  wallet TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS siws_nonces_expiry_idx
  ON siws_nonces(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS referral_seasons (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  closes_at TEXT NOT NULL,
  test_only INTEGER NOT NULL CHECK (test_only IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_profiles (
  id INTEGER PRIMARY KEY,
  sgt_mint TEXT NOT NULL UNIQUE REFERENCES seeker_identities(sgt_mint),
  referral_code TEXT NOT NULL UNIQUE,
  season_id TEXT NOT NULL REFERENCES referral_seasons(id),
  points INTEGER NOT NULL DEFAULT 0 CHECK (points >= 0),
  status TEXT NOT NULL CHECK (status IN ('pending_activation', 'active', 'suspended', 'invalidated')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_bindings (
  id INTEGER PRIMARY KEY,
  referrer_sgt_mint TEXT NOT NULL REFERENCES seeker_identities(sgt_mint),
  referred_sgt_mint TEXT NOT NULL UNIQUE REFERENCES seeker_identities(sgt_mint),
  referral_code TEXT NOT NULL REFERENCES referral_profiles(referral_code),
  status TEXT NOT NULL CHECK (status IN ('pending', 'qualified', 'qualified_test', 'invalidated')),
  bound_at TEXT NOT NULL,
  qualified_at TEXT,
  invalidated_at TEXT,
  invalidation_reason TEXT,
  CHECK (referrer_sgt_mint <> referred_sgt_mint)
);

CREATE INDEX IF NOT EXISTS referral_bindings_referrer_idx
  ON referral_bindings(referrer_sgt_mint, status);

CREATE TABLE IF NOT EXISTS referral_events (
  id INTEGER PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  referrer_sgt_mint TEXT,
  referred_sgt_mint TEXT,
  season_id TEXT NOT NULL REFERENCES referral_seasons(id),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS referral_events_sgt_idx
  ON referral_events(referrer_sgt_mint, referred_sgt_mint, event_type);

CREATE TABLE IF NOT EXISTS referral_audit_log (
  id INTEGER PRIMARY KEY,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS referral_sessions (
  token_hash TEXT PRIMARY KEY,
  sgt_mint TEXT NOT NULL REFERENCES seeker_identities(sgt_mint),
  wallet TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS referral_sessions_expiry_idx
  ON referral_sessions(expires_at, revoked_at);

CREATE TABLE IF NOT EXISTS referral_activity_days (
  sgt_mint TEXT NOT NULL REFERENCES seeker_identities(sgt_mint),
  activity_date TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (sgt_mint, activity_date)
);

CREATE INDEX IF NOT EXISTS referral_activity_days_date_idx
  ON referral_activity_days(activity_date);

CREATE TABLE IF NOT EXISTS app_installations (
  install_hash TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('solana-dapp-store')),
  platform TEXT NOT NULL CHECK (platform IN ('android')),
  app_version TEXT NOT NULL,
  version_code INTEGER NOT NULL CHECK (version_code > 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  launch_count INTEGER NOT NULL DEFAULT 1 CHECK (launch_count > 0)
);

CREATE INDEX IF NOT EXISTS app_installations_version_idx
  ON app_installations(channel, version_code, first_seen_at);

CREATE TABLE IF NOT EXISTS app_installation_activity_days (
  install_hash TEXT NOT NULL REFERENCES app_installations(install_hash) ON DELETE CASCADE,
  activity_date TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (install_hash, activity_date)
);

CREATE INDEX IF NOT EXISTS app_installation_activity_date_idx
  ON app_installation_activity_days(activity_date);

CREATE TABLE IF NOT EXISTS seeker_pass_nonces (
  nonce_hash TEXT PRIMARY KEY,
  domain TEXT NOT NULL,
  uri TEXT NOT NULL,
  statement TEXT NOT NULL,
  issued_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  consumed_at TEXT,
  wallet TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS seeker_pass_nonces_expiry_idx
  ON seeker_pass_nonces(expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS promotions (
  campaign_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'commitment_frozen', 'randomness_pending', 'drawn_unfunded', 'paid')),
  entry_threshold INTEGER NOT NULL CHECK (entry_threshold > 0),
  winner_count INTEGER NOT NULL CHECK (winner_count > 0),
  prize_lamports INTEGER NOT NULL CHECK (prize_lamports > 0),
  collection_address TEXT NOT NULL,
  tree_address TEXT NOT NULL,
  verified_creator TEXT NOT NULL,
  funded INTEGER NOT NULL DEFAULT 0 CHECK (funded IN (0, 1)),
  payout_enabled INTEGER NOT NULL DEFAULT 0 CHECK (payout_enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  frozen_at TEXT,
  entry_commitment TEXT,
  target_slot INTEGER,
  resolved_slot INTEGER,
  randomness_blockhash TEXT,
  randomness_hash TEXT,
  drawn_at TEXT,
  CHECK (winner_count <= entry_threshold)
);

CREATE TABLE IF NOT EXISTS promotion_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  campaign_id TEXT NOT NULL REFERENCES promotions(campaign_id) ON DELETE RESTRICT,
  wallet TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  tree_address TEXT NOT NULL,
  leaf_id INTEGER,
  verified_at TEXT NOT NULL,
  UNIQUE (campaign_id, wallet),
  UNIQUE (campaign_id, asset_id)
);

CREATE INDEX IF NOT EXISTS promotion_entries_campaign_idx
  ON promotion_entries(campaign_id, id);

CREATE TABLE IF NOT EXISTS promotion_winners (
  campaign_id TEXT NOT NULL REFERENCES promotions(campaign_id) ON DELETE RESTRICT,
  rank INTEGER NOT NULL CHECK (rank > 0),
  entry_id INTEGER NOT NULL REFERENCES promotion_entries(id) ON DELETE RESTRICT,
  wallet TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  prize_lamports INTEGER NOT NULL CHECK (prize_lamports > 0),
  ownership_status TEXT NOT NULL DEFAULT 'pending' CHECK (ownership_status IN ('pending', 'verified', 'ineligible')),
  payout_status TEXT NOT NULL DEFAULT 'locked_unfunded' CHECK (payout_status IN ('locked_unfunded', 'ready', 'paid')),
  payout_signature TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (campaign_id, rank),
  UNIQUE (campaign_id, entry_id)
);

CREATE INDEX IF NOT EXISTS promotion_winners_wallet_idx
  ON promotion_winners(campaign_id, wallet);
