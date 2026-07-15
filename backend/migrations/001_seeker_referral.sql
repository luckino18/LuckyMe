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
  status TEXT NOT NULL CHECK (status IN ('pending', 'qualified_test', 'invalidated')),
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
