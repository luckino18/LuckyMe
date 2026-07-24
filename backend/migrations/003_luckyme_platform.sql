PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA synchronous = FULL;

CREATE TABLE IF NOT EXISTS luckyme_users (
  wallet TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  username_origin TEXT NOT NULL DEFAULT 'generated'
    CHECK (username_origin IN ('generated', 'customized')),
  username_finalized_at TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS luckyme_tasks (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'x', 'community')),
  verification_type TEXT NOT NULL
    CHECK (verification_type IN ('discord_oauth', 'manual_review', 'admin_only')),
  action_type TEXT,
  target_url TEXT,
  reward_points INTEGER NOT NULL DEFAULT 0 CHECK (reward_points >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  deleted_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS luckyme_task_submissions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES luckyme_tasks(id) ON DELETE RESTRICT,
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE RESTRICT,
  submitted_value TEXT,
  normalized_value TEXT,
  proof_url TEXT,
  proof_message TEXT,
  external_id TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending_review', 'approved', 'rejected')),
  review_note TEXT,
  reviewed_by TEXT,
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reward_idempotency_key TEXT UNIQUE
);

CREATE UNIQUE INDEX IF NOT EXISTS luckyme_task_once_user_idx
  ON luckyme_task_submissions(task_id, wallet)
  WHERE status IN ('pending_review', 'approved');

CREATE INDEX IF NOT EXISTS luckyme_task_submission_status_idx
  ON luckyme_task_submissions(status, submitted_at);

CREATE TABLE IF NOT EXISTS luckyme_social_identities (
  platform TEXT NOT NULL CHECK (platform IN ('discord', 'x')),
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE RESTRICT,
  normalized_handle TEXT NOT NULL,
  display_handle TEXT NOT NULL,
  external_id TEXT,
  verified_by TEXT,
  verified_at TEXT NOT NULL,
  PRIMARY KEY (platform, wallet),
  UNIQUE (platform, normalized_handle),
  UNIQUE (platform, external_id)
);

CREATE TABLE IF NOT EXISTS luckyme_social_challenges (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES luckyme_tasks(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform = 'x'),
  nonce TEXT NOT NULL UNIQUE,
  proof_message TEXT NOT NULL,
  claimed_handle TEXT,
  proof_url TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'submitted', 'verified', 'cancelled', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  submitted_at TEXT,
  verified_at TEXT
);

CREATE INDEX IF NOT EXISTS luckyme_social_challenge_lookup_idx
  ON luckyme_social_challenges(task_id, wallet, status);

CREATE TABLE IF NOT EXISTS luckyme_oauth_states (
  state TEXT PRIMARY KEY,
  task_id TEXT NOT NULL REFERENCES luckyme_tasks(id) ON DELETE CASCADE,
  wallet TEXT NOT NULL REFERENCES luckyme_users(wallet) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider = 'discord'),
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'expired')),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS luckyme_platform_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS luckyme_platform_audit_created_idx
  ON luckyme_platform_audit(created_at DESC);

CREATE TABLE IF NOT EXISTS luckyme_promotion_notifications (
  promotion_id TEXT PRIMARY KEY REFERENCES promotional_pools(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('sending', 'sent', 'failed')),
  recipients INTEGER NOT NULL DEFAULT 0 CHECK (recipients >= 0),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
