import { createHash, randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import { PromotionalPoolError } from "./promotional-pools-service.mjs";
import {
  AVATAR_CATALOG,
  MAX_LEVEL,
  POOL_PARTICIPATION_REWARDS,
  levelState,
  missionRewardPreset,
} from "./luckyme-economy.mjs";
import { readSettlementArchive } from "../../scripts/settlement-archive.mjs";

const USERNAME_RE = /^[a-z0-9_]{3,32}$/;
const X_POST_HOSTS = new Set(["x.com", "www.x.com", "twitter.com", "www.twitter.com"]);
const X_ACTIONS = new Set(["like", "follow", "repost", "comment"]);

function fail(status, code, message) {
  throw new PromotionalPoolError(status, code, message);
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function text(value, label, max = 500) {
  const result = String(value ?? "").trim();
  if (!result || result.length > max) fail(400, "invalid_platform_input", `${label} is required`);
  return result;
}

function wallet(value) {
  try {
    return new PublicKey(String(value ?? "")).toBase58();
  } catch {
    fail(400, "invalid_wallet", "Wallet is not a valid Solana address");
  }
}

function normalizeUsername(value) {
  const username = String(value ?? "").trim().toLowerCase();
  if (!USERNAME_RE.test(username)) {
    fail(400, "invalid_username", "Username must contain 3-32 letters, numbers or underscores");
  }
  return username;
}

function normalizeHandle(platform, value) {
  const handle = text(value, `${platform} username`, 64).replace(/^@/, "").trim();
  const normalized = handle.toLowerCase();
  if (!/^[a-z0-9_.]{2,64}$/.test(normalized)) {
    fail(400, "invalid_social_handle", `Enter a valid ${platform} username`);
  }
  return { display: handle, normalized };
}

function taskSlug(value) {
  const slug = String(value ?? "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  if (!slug) fail(400, "invalid_task", "Task title is invalid");
  return slug;
}

function xActionLabel(action) {
  return {
    like: "Like this post",
    follow: "Follow this account",
    repost: "Repost this post",
    comment: "Comment on this post",
  }[action] ?? null;
}

function normalizeXTarget(actionValue, targetValue) {
  const action = String(actionValue ?? "").trim().toLowerCase();
  if (!X_ACTIONS.has(action)) {
    fail(400, "invalid_x_action", "X action must be Like, Follow, Repost or Comment");
  }
  let target;
  try {
    target = new URL(text(targetValue, "X target link", 500));
  } catch {
    fail(400, "invalid_x_target", "Enter a valid X link");
  }
  if (target.protocol !== "https:" || !X_POST_HOSTS.has(target.hostname.toLowerCase())) {
    fail(400, "invalid_x_target", "Use a direct https://x.com link");
  }
  const parts = target.pathname.split("/").filter(Boolean);
  if (action === "follow") {
    if (parts.length !== 1 || !/^[a-zA-Z0-9_]{1,15}$/.test(parts[0])) {
      fail(400, "invalid_x_target", "Follow requires a direct X profile link");
    }
  } else if (parts.length < 3 || parts[1] !== "status" || !/^\d+$/.test(parts[2])) {
    fail(400, "invalid_x_target", `${xActionLabel(action)} requires a direct X post link`);
  }
  return {
    action,
    targetUrl: `https://x.com/${parts.join("/")}`,
    postId: action === "follow" ? null : parts[2],
  };
}

function xActionOpenUrl(action, targetUrl) {
  const target = normalizeXTarget(action, targetUrl);
  if (target.action === "like") {
    return `https://twitter.com/intent/like?tweet_id=${encodeURIComponent(target.postId)}`;
  }
  if (target.action === "repost") {
    return `https://twitter.com/intent/retweet?tweet_id=${encodeURIComponent(target.postId)}`;
  }
  if (target.action === "comment") {
    return `https://twitter.com/intent/tweet?in_reply_to=${encodeURIComponent(target.postId)}`;
  }
  const handle = new URL(target.targetUrl).pathname.split("/").filter(Boolean)[0];
  return `https://twitter.com/intent/follow?screen_name=${encodeURIComponent(handle)}`;
}

function transaction(db, action) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function publicTask(row) {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    platform: row.platform,
    verificationType: row.verification_type,
    actionType: row.action_type ?? null,
    actionLabel: xActionLabel(row.action_type),
    targetUrl: row.target_url ?? null,
    rewardPoints: Number(row.reward_points),
    rewardXp: Number(row.reward_xp ?? 0),
    rewardPresetKey: row.reward_preset_key ?? null,
    minLevel: Number(row.min_level ?? 1),
    maxLevel: Number(row.max_level ?? MAX_LEVEL),
    participantLimit: row.participant_limit == null ? null : Number(row.participant_limit),
    gameplay: row.gameplay_pool_type ? {
      poolType: row.gameplay_pool_type,
      requiredCount: Number(row.gameplay_required_count ?? 1),
    } : null,
    startsAt: row.starts_at ?? row.created_at,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    submission: row.submission_id ? {
      id: row.submission_id,
      status: row.submission_status,
      proofUrl: row.proof_url,
      submittedAt: row.submitted_at,
      reviewedAt: row.reviewed_at,
    } : null,
    progress: row.progress_count == null ? null : {
      count: Number(row.progress_count),
      required: Number(row.progress_required_count ?? row.gameplay_required_count ?? 1),
      status: row.progress_status,
      completedAt: row.progress_completed_at,
    },
  };
}

export function createLuckyMePlatformService({
  db,
  pointsService,
  clock = Date.now,
} = {}) {
  if (!db || !pointsService) throw new Error("Platform service requires the promotions database and points service");

  function audit(actor, action, targetType, targetId, details = {}) {
    db.prepare(`
      INSERT INTO luckyme_platform_audit
        (actor, action, target_type, target_id, details_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(String(actor), action, targetType, targetId ?? null, JSON.stringify(details), nowIso(clock));
  }

  function creditTaskPoints({ walletAddress, amount, idempotencyKey, reason }) {
    const existing = db.prepare(`
      SELECT balance_after FROM promotional_points_ledger WHERE idempotency_key = ?
    `).get(idempotencyKey);
    if (existing) return { balance: Number(existing.balance_after), replayed: true };
    const timestamp = nowIso(clock);
    db.prepare(`
      INSERT OR IGNORE INTO promotional_wallet_points (wallet, balance, reserved_balance, updated_at)
      VALUES (?, 0, 0, ?)
    `).run(walletAddress, timestamp);
    const current = Number(db.prepare(`
      SELECT balance FROM promotional_wallet_points WHERE wallet = ?
    `).get(walletAddress)?.balance ?? 0);
    const next = current + amount;
    db.prepare(`
      UPDATE promotional_wallet_points SET balance = ?, updated_at = ? WHERE wallet = ?
    `).run(next, timestamp, walletAddress);
    db.prepare(`
      INSERT INTO promotional_points_ledger
        (id, wallet, delta, balance_after, reason, promotion_id, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    `).run(randomUUID(), walletAddress, amount, next, reason, idempotencyKey, timestamp);
    return { balance: next, replayed: false };
  }

  function creditXp({ walletAddress, amount, idempotencyKey, reason, sourceType, sourceId = null }) {
    const xp = Number(amount);
    if (!Number.isSafeInteger(xp) || xp <= 0) {
      const user = ensureUser(walletAddress);
      return { xpTotal: Number(user.xp_total ?? 0), replayed: true };
    }
    const existing = db.prepare(`
      SELECT xp_after FROM luckyme_xp_ledger WHERE idempotency_key = ?
    `).get(String(idempotencyKey));
    if (existing) return { xpTotal: Number(existing.xp_after), replayed: true };
    const user = ensureUser(walletAddress);
    const next = Number(user.xp_total ?? 0) + xp;
    const timestamp = nowIso(clock);
    db.prepare("UPDATE luckyme_users SET xp_total = ?, updated_at = ? WHERE wallet = ?")
      .run(next, timestamp, user.wallet);
    db.prepare(`
      INSERT INTO luckyme_xp_ledger
        (id, wallet, delta, xp_after, reason, source_type, source_id, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      user.wallet,
      xp,
      next,
      String(reason),
      String(sourceType),
      sourceId == null ? null : String(sourceId),
      String(idempotencyKey),
      timestamp,
    );
    return { xpTotal: next, replayed: false };
  }

  function generatedUsername(address) {
    const digest = createHash("sha256").update(address).digest("hex");
    for (let size = 8; size <= 24; size += 4) {
      const candidate = `player_${digest.slice(0, size)}`;
      if (!db.prepare("SELECT 1 FROM luckyme_users WHERE username = ? COLLATE NOCASE").get(candidate)) {
        return candidate;
      }
    }
    return `player_${digest.slice(0, 20)}_${Date.now().toString(36)}`;
  }

  function ensureUser(walletAddress, { allowSuspended = false } = {}) {
    const address = wallet(walletAddress);
    let row = db.prepare("SELECT * FROM luckyme_users WHERE wallet = ?").get(address);
    if (!row) {
      const timestamp = nowIso(clock);
      const username = generatedUsername(address);
      db.prepare(`
        INSERT INTO luckyme_users
          (wallet, username, display_name, username_origin, status, created_at, updated_at)
        VALUES (?, ?, ?, 'generated', 'active', ?, ?)
      `).run(address, username, username, timestamp, timestamp);
      db.prepare(`
        INSERT OR IGNORE INTO promotional_wallet_points (wallet, balance, reserved_balance, updated_at)
        VALUES (?, 0, 0, ?)
      `).run(address, timestamp);
      audit(address, "user_created", "user", address, { username });
      row = db.prepare("SELECT * FROM luckyme_users WHERE wallet = ?").get(address);
    }
    if (row.status !== "active" && !allowSuspended) {
      fail(403, "user_suspended", "This LuckyMe account is suspended");
    }
    if (!allowSuspended) {
      const timestamp = nowIso(clock);
      db.prepare("UPDATE luckyme_users SET last_active_at = ?, updated_at = ? WHERE wallet = ?")
        .run(timestamp, timestamp, row.wallet);
      row = db.prepare("SELECT * FROM luckyme_users WHERE wallet = ?").get(address);
    }
    return row;
  }

  function profile(walletAddress, { allowSuspended = false } = {}) {
    const user = ensureUser(walletAddress, { allowSuspended });
    ensureStarterAvatar(user.wallet);
    const points = db.prepare(`
      SELECT balance, reserved_balance FROM promotional_wallet_points WHERE wallet = ?
    `).get(user.wallet) ?? { balance: 0, reserved_balance: 0 };
    const identities = db.prepare(`
      SELECT platform, display_handle, normalized_handle, verified_at
      FROM luckyme_social_identities WHERE wallet = ? ORDER BY platform
    `).all(user.wallet).map((row) => ({
      platform: row.platform,
      displayHandle: row.display_handle,
      normalizedHandle: row.normalized_handle,
      verifiedAt: row.verified_at,
    }));
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) completed,
        SUM(CASE WHEN status = 'pending_review' THEN 1 ELSE 0 END) pending
      FROM luckyme_task_submissions WHERE wallet = ?
    `).get(user.wallet);
    const xp = levelState(user.xp_total ?? 0);
    const activeAvatar = db.prepare(`
      SELECT c.id, c.name, c.asset_key, c.min_level, c.price_points, c.rank_key
      FROM luckyme_active_avatars a
      JOIN luckyme_avatar_catalog c ON c.id = a.avatar_id
      WHERE a.wallet = ?
    `).get(user.wallet);
    const avatars = db.prepare(`
      SELECT c.id, c.name, c.asset_key, c.min_level, c.price_points, c.rank_key,
             CASE WHEN o.wallet IS NULL THEN 0 ELSE 1 END owned
      FROM luckyme_avatar_catalog c
      LEFT JOIN luckyme_avatar_ownership o ON o.avatar_id = c.id AND o.wallet = ?
      WHERE c.status = 'active'
      ORDER BY c.sort_order, c.min_level, c.id
    `).all(user.wallet).map((row) => ({
      id: row.id,
      name: row.name,
      assetKey: row.asset_key,
      minLevel: Number(row.min_level),
      pricePoints: Number(row.price_points),
      rankKey: row.rank_key,
      owned: Boolean(row.owned),
      levelUnlocked: xp.level >= Number(row.min_level),
    }));
    return {
      wallet: user.wallet,
      username: user.username,
      displayName: user.display_name,
      status: user.status,
      luckyPoints: Number(points.balance),
      reservedPoints: Number(points.reserved_balance),
      availablePoints: Number(points.balance) - Number(points.reserved_balance),
      xp: {
        total: xp.totalXp,
        level: xp.level,
        rankKey: xp.rankKey,
        rankTitle: xp.rankTitle,
        frameTitle: xp.frameTitle,
        progress: xp.progressXp,
        nextLevel: xp.nextLevelXp,
        progressPercent: xp.progressPercent,
      },
      avatar: activeAvatar ? {
        id: activeAvatar.id,
        name: activeAvatar.name,
        assetKey: activeAvatar.asset_key,
        minLevel: Number(activeAvatar.min_level),
        pricePoints: Number(activeAvatar.price_points),
        rankKey: activeAvatar.rank_key,
      } : null,
      avatars,
      usernameState: {
        origin: user.username_origin,
        canCustomize: user.username_origin === "generated" && !user.username_finalized_at,
        finalizedAt: user.username_finalized_at,
        warning: "This username is permanent and cannot be changed after confirmation.",
      },
      identities,
      tasks: {
        completed: Number(counts?.completed ?? 0),
        pending: Number(counts?.pending ?? 0),
      },
      createdAt: user.created_at,
      lastActiveAt: user.last_active_at,
      updatedAt: user.updated_at,
    };
  }

  function finalizeUsername({ wallet: walletAddress, username, permanenceAccepted, confirmation }) {
    const user = ensureUser(walletAddress);
    if (user.username_origin !== "generated" || user.username_finalized_at) {
      fail(409, "username_already_finalized", "This username is permanent and can no longer be changed");
    }
    if (permanenceAccepted !== true || confirmation !== "CONFIRM PERMANENT USERNAME") {
      fail(400, "username_confirmation_required", "Confirm that the username is permanent");
    }
    const normalized = normalizeUsername(username);
    const timestamp = nowIso(clock);
    try {
      db.prepare(`
        UPDATE luckyme_users
        SET username = ?, display_name = ?, username_origin = 'customized',
            username_finalized_at = ?, updated_at = ?
        WHERE wallet = ?
      `).run(normalized, normalized, timestamp, timestamp, user.wallet);
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) fail(409, "username_taken", "Username is already taken");
      throw error;
    }
    audit(user.wallet, "username_finalized", "user", user.wallet, { previous: user.username, username: normalized });
    return profile(user.wallet);
  }

  function acquireAvatar({ wallet: walletAddress, avatarId }) {
    const user = ensureUser(walletAddress);
    const id = text(avatarId, "Avatar", 100);
    return transaction(db, () => {
      const avatar = db.prepare(`
        SELECT * FROM luckyme_avatar_catalog WHERE id = ? AND status = 'active'
      `).get(id);
      if (!avatar) fail(404, "avatar_not_found", "Avatar is not available");
      const currentLevel = levelState(user.xp_total ?? 0).level;
      if (currentLevel < Number(avatar.min_level)) {
        fail(403, "avatar_level_locked", `Avatar unlocks at level ${avatar.min_level}`);
      }
      const existing = db.prepare(`
        SELECT acquisition_type, points_spent FROM luckyme_avatar_ownership
        WHERE wallet = ? AND avatar_id = ?
      `).get(user.wallet, id);
      if (existing) {
        return { replayed: true, profile: profile(user.wallet) };
      }
      const price = Number(avatar.price_points);
      const timestamp = nowIso(clock);
      if (price > 0) {
        const available = pointsService.availablePoints(user.wallet);
        if (available < price) fail(409, "insufficient_lucky_points", "Not enough available Lucky Points");
        const current = pointsService.points(user.wallet);
        const next = current - price;
        const debit = db.prepare(`
          UPDATE promotional_wallet_points
          SET balance = ?, updated_at = ?
          WHERE wallet = ? AND balance - reserved_balance >= ?
        `).run(next, timestamp, user.wallet, price);
        if (debit.changes !== 1) fail(409, "insufficient_lucky_points", "Not enough available Lucky Points");
        db.prepare(`
          INSERT INTO promotional_points_ledger
            (id, wallet, delta, balance_after, reason, promotion_id, idempotency_key, created_at)
          VALUES (?, ?, ?, ?, 'avatar_purchase', NULL, ?, ?)
        `).run(
          randomUUID(),
          user.wallet,
          -price,
          next,
          `avatar:${id}:${user.wallet}`,
          timestamp,
        );
      }
      db.prepare(`
        INSERT INTO luckyme_avatar_ownership
          (wallet, avatar_id, acquisition_type, points_spent, acquired_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(user.wallet, id, price > 0 ? "points" : "level", price, timestamp);
      db.prepare(`
        INSERT INTO luckyme_active_avatars (wallet, avatar_id, updated_at)
        VALUES (?, ?, ?)
        ON CONFLICT(wallet) DO UPDATE SET
          avatar_id = excluded.avatar_id, updated_at = excluded.updated_at
      `).run(user.wallet, id, timestamp);
      audit(user.wallet, "avatar_acquired", "avatar", id, { pointsSpent: price });
      return { replayed: false, profile: profile(user.wallet) };
    });
  }

  function selectAvatar({ wallet: walletAddress, avatarId }) {
    const user = ensureUser(walletAddress);
    const id = text(avatarId, "Avatar", 100);
    const owned = db.prepare(`
      SELECT 1
      FROM luckyme_avatar_ownership o
      JOIN luckyme_avatar_catalog c ON c.id = o.avatar_id
      WHERE o.wallet = ? AND o.avatar_id = ? AND c.status = 'active'
    `).get(user.wallet, id);
    if (!owned) fail(403, "avatar_not_owned", "Acquire this avatar before selecting it");
    db.prepare(`
      INSERT INTO luckyme_active_avatars (wallet, avatar_id, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(wallet) DO UPDATE SET
        avatar_id = excluded.avatar_id, updated_at = excluded.updated_at
    `).run(user.wallet, id, nowIso(clock));
    audit(user.wallet, "avatar_selected", "avatar", id);
    return profile(user.wallet);
  }

  function seedDefaultTasks() {
    const timestamp = nowIso(clock);
    const defaults = [
      {
        id: "task-discord-community",
        slug: "join-luckyme-discord",
        title: "Join LuckyMe Discord",
        description: "Connect Discord and verify membership in the official LuckyMe community.",
        platform: "discord",
        verification: "discord_oauth",
        reward: missionRewardPreset({ platform: "discord" }),
      },
      {
        id: "task-x-community",
        slug: "verify-luckyme-x",
        title: "Verify LuckyMe on X",
        description: "Publish the one-time LuckyMe verification message and submit the post for approval.",
        platform: "x",
        verification: "manual_review",
        reward: { points: 5, xp: 10, presetKey: "x_identity" },
      },
    ];
    const insert = db.prepare(`
      INSERT OR IGNORE INTO luckyme_tasks
        (id, slug, title, description, platform, verification_type, reward_points,
         reward_xp, reward_preset_key, min_level, max_level, starts_at,
         status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 100, ?, 'active', 'system', ?, ?)
    `);
    for (const task of defaults) {
      insert.run(
        task.id, task.slug, task.title, task.description, task.platform,
        task.verification, task.reward.points, task.reward.xp, task.reward.presetKey,
        timestamp, timestamp, timestamp,
      );
    }
  }

  function seedAvatarCatalog() {
    const timestamp = nowIso(clock);
    const insert = db.prepare(`
      INSERT OR IGNORE INTO luckyme_avatar_catalog
        (id, name, asset_key, min_level, price_points, rank_key, status,
         sort_order, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `);
    AVATAR_CATALOG.forEach((avatar, index) => {
      insert.run(
        avatar.id,
        avatar.name,
        avatar.assetKey,
        avatar.minLevel,
        avatar.pricePoints,
        avatar.rankKey,
        index + 1,
        timestamp,
        timestamp,
      );
    });
  }

  function ensureStarterAvatar(walletAddress) {
    const starter = AVATAR_CATALOG[0];
    const timestamp = nowIso(clock);
    db.prepare(`
      INSERT OR IGNORE INTO luckyme_avatar_ownership
        (wallet, avatar_id, acquisition_type, points_spent, acquired_at)
      VALUES (?, ?, 'level', 0, ?)
    `).run(walletAddress, starter.id, timestamp);
    db.prepare(`
      INSERT OR IGNORE INTO luckyme_active_avatars (wallet, avatar_id, updated_at)
      VALUES (?, ?, ?)
    `).run(walletAddress, starter.id, timestamp);
  }

  function listTasks(walletAddress, { includeInactive = false } = {}) {
    seedDefaultTasks();
    const address = walletAddress ? ensureUser(walletAddress).wallet : null;
    const rows = address
      ? db.prepare(`
          SELECT t.*, s.id submission_id, s.status submission_status,
                 s.proof_url, s.submitted_at, s.reviewed_at,
                 p.progress_count, p.required_count progress_required_count,
                 p.status progress_status, p.completed_at progress_completed_at
          FROM luckyme_tasks t
          LEFT JOIN luckyme_task_submissions s
            ON s.task_id = t.id AND s.wallet = ?
            AND s.status IN ('pending_review', 'approved')
          LEFT JOIN luckyme_task_progress p
            ON p.task_id = t.id AND p.wallet = ?
          WHERE t.deleted_at IS NULL AND (? = 1 OR t.status = 'active')
          ORDER BY t.created_at, t.id
        `).all(address, address, includeInactive ? 1 : 0)
      : db.prepare(`
          SELECT t.*, NULL submission_id, NULL submission_status,
                 NULL proof_url, NULL submitted_at, NULL reviewed_at,
                 NULL progress_count, NULL progress_required_count,
                 NULL progress_status, NULL progress_completed_at
          FROM luckyme_tasks t
          WHERE t.deleted_at IS NULL AND (? = 1 OR t.status = 'active')
          ORDER BY t.created_at, t.id
        `).all(includeInactive ? 1 : 0);
    const userLevel = address
      ? levelState(db.prepare("SELECT xp_total FROM luckyme_users WHERE wallet = ?").get(address)?.xp_total ?? 0).level
      : null;
    return rows.map((row) => {
      const task = publicTask(row);
      const approvedCount = row.participant_limit == null ? 0 : Number(db.prepare(`
        SELECT COUNT(*) total FROM luckyme_task_submissions
        WHERE task_id = ? AND status = 'approved'
      `).get(row.id)?.total ?? 0);
      const levelEligible = userLevel == null ||
        (userLevel >= task.minLevel && userLevel <= task.maxLevel);
      const capacityAvailable = task.participantLimit == null ||
        approvedCount < task.participantLimit ||
        task.submission?.status === "approved";
      return {
        ...task,
        eligible: levelEligible && capacityAvailable,
        eligibility: {
          levelEligible,
          capacityAvailable,
          approvedCount,
          participantLimit: task.participantLimit,
        },
      };
    });
  }

  function createTask({
    actor,
    title,
    description,
    platform,
    status = "active",
    xAction,
    targetUrl,
    minLevel = 1,
    maxLevel = MAX_LEVEL,
    participantLimit = null,
    gameplayPoolType = null,
    gameplayRequiredCount = 1,
  }) {
    const normalizedPlatform = String(platform ?? "").trim().toLowerCase();
    if (!["discord", "x", "community"].includes(normalizedPlatform)) {
      fail(400, "invalid_task_platform", "Task platform must be Discord, X or community");
    }
    const accessMin = Number(minLevel);
    const accessMax = Number(maxLevel);
    if (!Number.isSafeInteger(accessMin) || !Number.isSafeInteger(accessMax) ||
        accessMin < 1 || accessMax > MAX_LEVEL || accessMin > accessMax) {
      fail(400, "invalid_task_level", "Task level access is invalid");
    }
    const limit = participantLimit === null || participantLimit === undefined || participantLimit === ""
      ? null
      : Number(participantLimit);
    if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000_000)) {
      fail(400, "invalid_task_limit", "Task participant limit is invalid");
    }
    const gameplayPool = gameplayPoolType
      ? String(gameplayPoolType).trim().toLowerCase()
      : null;
    if (gameplayPool && !["any", "mini", "normal", "high", "premium"].includes(gameplayPool)) {
      fail(400, "invalid_gameplay_pool", "Gameplay pool must be Any, Mini, Normal, High or Premium");
    }
    const gameplayCount = gameplayPool ? Number(gameplayRequiredCount) : null;
    if (gameplayPool && (!Number.isSafeInteger(gameplayCount) || gameplayCount < 1 || gameplayCount > 100)) {
      fail(400, "invalid_gameplay_count", "Gameplay task requires between 1 and 100 valid pools");
    }
    const normalizedStatus = ["draft", "active", "paused"].includes(status) ? status : "active";
    const xTarget = normalizedPlatform === "x" ? normalizeXTarget(xAction, targetUrl) : null;
    let reward;
    try {
      reward = missionRewardPreset({
        platform: normalizedPlatform,
        xAction: xTarget?.action,
        gameplayPoolType: gameplayPool,
        gameplayRequiredCount: gameplayCount,
      });
    } catch (error) {
      fail(400, "invalid_task_reward_preset", error.message);
    }
    const id = randomUUID();
    const timestamp = nowIso(clock);
    const baseSlug = taskSlug(title);
    let slug = baseSlug;
    let suffix = 2;
    while (db.prepare("SELECT 1 FROM luckyme_tasks WHERE slug = ?").get(slug)) {
      slug = `${baseSlug}-${suffix++}`;
    }
    db.prepare(`
      INSERT INTO luckyme_tasks
        (id, slug, title, description, platform, verification_type, action_type,
         target_url, reward_points, reward_xp, reward_preset_key, min_level, max_level,
         participant_limit, gameplay_pool_type, gameplay_required_count, starts_at,
         status, created_by, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      slug,
      text(title, "Task title", 100),
      text(description, "Task description", 1_000),
      normalizedPlatform,
      gameplayPool ? "admin_only" : normalizedPlatform === "discord" ? "discord_oauth" :
        normalizedPlatform === "x" ? "manual_review" : "admin_only",
      xTarget?.action ?? null,
      xTarget?.targetUrl ?? null,
      reward.points,
      reward.xp,
      reward.presetKey,
      accessMin,
      accessMax,
      limit,
      gameplayPool,
      gameplayCount,
      normalizedStatus === "active" ? timestamp : null,
      normalizedStatus,
      String(actor),
      timestamp,
      timestamp,
    );
    audit(actor, "task_created", "task", id, {
      title,
      platform: normalizedPlatform,
      actionType: xTarget?.action ?? null,
      targetUrl: xTarget?.targetUrl ?? null,
      rewardPoints: reward.points,
      rewardXp: reward.xp,
      rewardPresetKey: reward.presetKey,
      minLevel: accessMin,
      maxLevel: accessMax,
      participantLimit: limit,
      gameplayPoolType: gameplayPool,
      gameplayRequiredCount: gameplayCount,
    });
    return listTasks(null, { includeInactive: true }).find((task) => task.id === id);
  }

  function updateTask({ actor, taskId, status, title, description }) {
    const current = db.prepare("SELECT * FROM luckyme_tasks WHERE id = ? AND deleted_at IS NULL").get(String(taskId));
    if (!current) fail(404, "task_not_found", "Task was not found");
    const nextStatus = status === undefined ? current.status : String(status);
    if (!["draft", "active", "paused", "archived"].includes(nextStatus)) {
      fail(400, "invalid_task_status", "Task status is invalid");
    }
    const timestamp = nowIso(clock);
    db.prepare(`
      UPDATE luckyme_tasks
      SET title = ?, description = ?, status = ?,
          starts_at = CASE WHEN ? = 'active' AND starts_at IS NULL THEN ? ELSE starts_at END,
          updated_at = ?
      WHERE id = ?
    `).run(
      title === undefined ? current.title : text(title, "Task title", 100),
      description === undefined ? current.description : text(description, "Task description", 1_000),
      nextStatus,
      nextStatus,
      timestamp,
      timestamp,
      current.id,
    );
    audit(actor, "task_updated", "task", current.id, {
      status: nextStatus,
      rewardPoints: Number(current.reward_points),
      rewardXp: Number(current.reward_xp ?? 0),
      fixedPreset: current.reward_preset_key,
    });
    return listTasks(null, { includeInactive: true }).find((task) => task.id === current.id);
  }

  function deleteTask({ actor, taskId }) {
    const current = db.prepare(`
      SELECT * FROM luckyme_tasks WHERE id = ? AND deleted_at IS NULL
    `).get(String(taskId));
    if (!current) fail(404, "task_not_found", "Task was not found");
    if (current.status !== "archived") {
      fail(409, "task_must_be_closed", "Close the task before deleting it");
    }
    const pending = db.prepare(`
      SELECT COUNT(*) total FROM luckyme_task_submissions
      WHERE task_id = ? AND status = 'pending_review'
    `).get(current.id);
    if (Number(pending?.total ?? 0) > 0) {
      fail(409, "task_has_pending_submissions", "Approve or reject pending submissions before deleting this task");
    }
    const timestamp = nowIso(clock);
    db.prepare(`
      UPDATE luckyme_tasks SET deleted_at = ?, updated_at = ? WHERE id = ?
    `).run(timestamp, timestamp, current.id);
    audit(actor, "task_deleted", "task", current.id, { softDelete: true });
    return { id: current.id, deleted: true };
  }

  function activeTask(taskId, platform, walletAddress = null) {
    const task = db.prepare("SELECT * FROM luckyme_tasks WHERE id = ? AND deleted_at IS NULL").get(String(taskId));
    if (!task) fail(404, "task_not_found", "Task was not found");
    if (task.status !== "active" || task.platform !== platform) {
      fail(409, "task_not_active", `This is not an active ${platform} task`);
    }
    if (walletAddress) {
      const user = ensureUser(walletAddress);
      const level = levelState(user.xp_total ?? 0).level;
      if (level < Number(task.min_level ?? 1) || level > Number(task.max_level ?? MAX_LEVEL)) {
        fail(403, "task_level_required", `This mission is available for levels ${task.min_level ?? 1}-${task.max_level ?? MAX_LEVEL}`);
      }
      if (task.participant_limit != null) {
        const approved = Number(db.prepare(`
          SELECT COUNT(*) total FROM luckyme_task_submissions
          WHERE task_id = ? AND status = 'approved'
        `).get(task.id)?.total ?? 0);
        if (approved >= Number(task.participant_limit)) {
          fail(409, "task_participant_limit_reached", "This mission has reached its participant limit");
        }
      }
    }
    return task;
  }

  function assertTaskAvailable(taskId, walletAddress) {
    const existing = db.prepare(`
      SELECT id FROM luckyme_task_submissions
      WHERE task_id = ? AND wallet = ? AND status IN ('pending_review', 'approved')
    `).get(taskId, walletAddress);
    if (existing) fail(409, "task_already_submitted", "This task was already submitted");
  }

  function beginXVerification({ wallet: walletAddress, taskId }) {
    const user = ensureUser(walletAddress);
    const task = activeTask(taskId, "x", user.wallet);
    assertTaskAvailable(task.id, user.wallet);
    db.prepare(`
      UPDATE luckyme_social_challenges SET status = 'cancelled'
      WHERE task_id = ? AND wallet = ? AND status = 'pending'
    `).run(task.id, user.wallet);
    const id = randomUUID();
    const nonce = `LUCKYME-X-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
    const isActionTask = Boolean(task.action_type && task.target_url);
    const actionLabel = xActionLabel(task.action_type);
    const message = isActionTask ? actionLabel : `Verifying my LuckyMe identity: ${nonce}`;
    const timestamp = nowIso(clock);
    const expiresAt = new Date(clock() + 30 * 60_000).toISOString();
    db.prepare(`
      INSERT INTO luckyme_social_challenges
        (id, task_id, wallet, platform, nonce, proof_message, status, expires_at, created_at)
      VALUES (?, ?, ?, 'x', ?, ?, 'pending', ?, ?)
    `).run(id, task.id, user.wallet, nonce, message, expiresAt, timestamp);
    const openUrl = isActionTask
      ? xActionOpenUrl(task.action_type, task.target_url)
      : `https://x.com/intent/post?text=${encodeURIComponent(message)}`;
    return {
      id,
      taskId: task.id,
      message,
      mode: isActionTask ? "action" : "identity",
      actionType: task.action_type ?? null,
      actionLabel,
      targetUrl: task.target_url ?? null,
      expiresAt,
      openUrl,
      composeUrl: openUrl,
    };
  }

  function submitXVerification({ wallet: walletAddress, taskId, challengeId, handle, postUrl }) {
    const user = ensureUser(walletAddress);
    const task = activeTask(taskId, "x", user.wallet);
    assertTaskAvailable(task.id, user.wallet);
    const challenge = db.prepare(`
      SELECT * FROM luckyme_social_challenges
      WHERE id = ? AND task_id = ? AND wallet = ? AND status = 'pending'
    `).get(String(challengeId), task.id, user.wallet);
    if (!challenge) fail(409, "invalid_x_challenge", "Start a fresh X verification first");
    if (new Date(challenge.expires_at).getTime() <= clock()) {
      db.prepare("UPDATE luckyme_social_challenges SET status = 'expired' WHERE id = ?").run(challenge.id);
      fail(409, "x_challenge_expired", "The X verification code expired");
    }
    const isActionTask = Boolean(task.action_type && task.target_url);
    let proof = null;
    if (!isActionTask) {
      try {
        proof = new URL(text(postUrl, "X post URL", 500));
      } catch {
        fail(400, "invalid_x_post", "Enter a valid X post URL");
      }
      if (!X_POST_HOSTS.has(proof.hostname) || !/\/status\/\d+/.test(proof.pathname)) {
        fail(400, "invalid_x_post", "Use the direct X post URL");
      }
    }
    const social = normalizeHandle("x", handle);
    const linked = db.prepare(`
      SELECT wallet FROM luckyme_social_identities
      WHERE platform = 'x' AND normalized_handle = ?
    `).get(social.normalized);
    if (linked && linked.wallet !== user.wallet) {
      fail(409, "identity_already_linked", "This X account is linked to another LuckyMe wallet");
    }
    const id = randomUUID();
    const timestamp = nowIso(clock);
    db.prepare(`
      INSERT INTO luckyme_task_submissions
        (id, task_id, wallet, submitted_value, normalized_value, proof_url,
         proof_message, status, submitted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_review', ?)
    `).run(
      id, task.id, user.wallet, social.display, social.normalized,
      isActionTask ? task.target_url : String(proof), challenge.proof_message, timestamp,
    );
    db.prepare(`
      UPDATE luckyme_social_challenges
      SET claimed_handle = ?, proof_url = ?, status = 'submitted', submitted_at = ?
      WHERE id = ?
    `).run(social.normalized, isActionTask ? task.target_url : String(proof), timestamp, challenge.id);
    audit(user.wallet, "x_task_submitted", "task_submission", id, {
      taskId: task.id,
      actionType: task.action_type ?? null,
      proofUrl: isActionTask ? task.target_url : String(proof),
    });
    return { submissionId: id, status: "pending_review" };
  }

  function beginDiscordOAuth({ wallet: walletAddress, taskId }) {
    const user = ensureUser(walletAddress);
    const task = activeTask(taskId, "discord", user.wallet);
    assertTaskAvailable(task.id, user.wallet);
    const state = randomUUID();
    const timestamp = nowIso(clock);
    const expiresAt = new Date(clock() + 10 * 60_000).toISOString();
    db.prepare(`
      INSERT INTO luckyme_oauth_states
        (state, task_id, wallet, provider, status, expires_at, created_at)
      VALUES (?, ?, ?, 'discord', 'pending', ?, ?)
    `).run(state, task.id, user.wallet, expiresAt, timestamp);
    return { state, expiresAt };
  }

  function completeDiscordOAuth({ state, externalId, username }) {
    return transaction(db, () => {
      const oauth = db.prepare(`
        SELECT * FROM luckyme_oauth_states
        WHERE state = ? AND provider = 'discord' AND status = 'pending'
      `).get(String(state));
      if (!oauth) fail(409, "invalid_oauth_state", "Discord authorization is invalid or already used");
      if (new Date(oauth.expires_at).getTime() <= clock()) {
        db.prepare("UPDATE luckyme_oauth_states SET status = 'expired' WHERE state = ?").run(oauth.state);
        fail(409, "oauth_state_expired", "Discord authorization expired");
      }
      const task = activeTask(oauth.task_id, "discord", oauth.wallet);
      assertTaskAvailable(task.id, oauth.wallet);
      const immutableId = text(String(externalId), "Discord user id", 100);
      if (!/^\d{5,30}$/.test(immutableId)) fail(400, "invalid_discord_id", "Discord returned an invalid user id");
      const displayHandle = text(username, "Discord username", 64);
      const social = {
        display: displayHandle,
        normalized: `discord_${immutableId}`,
      };
      const existing = db.prepare(`
        SELECT wallet FROM luckyme_social_identities
        WHERE platform = 'discord' AND external_id = ?
      `).get(immutableId);
      if (existing && existing.wallet !== oauth.wallet) {
        fail(409, "identity_already_linked", "This Discord account is linked to another LuckyMe wallet");
      }
      const timestamp = nowIso(clock);
      const submissionId = randomUUID();
      const rewardKey = `task:${submissionId}:approved`;
      db.prepare(`
        INSERT INTO luckyme_social_identities
          (platform, wallet, normalized_handle, display_handle, external_id, verified_by, verified_at)
        VALUES ('discord', ?, ?, ?, ?, 'discord-oauth', ?)
        ON CONFLICT(platform, wallet) DO UPDATE SET
          normalized_handle = excluded.normalized_handle,
          display_handle = excluded.display_handle,
          external_id = excluded.external_id,
          verified_by = excluded.verified_by,
          verified_at = excluded.verified_at
      `).run(oauth.wallet, social.normalized, social.display, immutableId, timestamp);
      db.prepare(`
        INSERT INTO luckyme_task_submissions
          (id, task_id, wallet, submitted_value, normalized_value, external_id,
           status, review_note, reviewed_by, submitted_at, reviewed_at, reward_idempotency_key)
        VALUES (?, ?, ?, ?, ?, ?, 'approved', 'Verified automatically by Discord OAuth',
                'discord-oauth', ?, ?, ?)
      `).run(
        submissionId, task.id, oauth.wallet, social.display, social.normalized,
        immutableId, timestamp, timestamp, rewardKey,
      );
      if (Number(task.reward_points) > 0) {
        creditTaskPoints({
          walletAddress: oauth.wallet,
          amount: Number(task.reward_points),
          idempotencyKey: `${rewardKey}:points`,
          reason: "task_discord_approved",
        });
      }
      if (Number(task.reward_xp ?? 0) > 0) {
        creditXp({
          walletAddress: oauth.wallet,
          amount: Number(task.reward_xp),
          idempotencyKey: `${rewardKey}:xp`,
          reason: "task_discord_approved",
          sourceType: "task",
          sourceId: task.id,
        });
      }
      db.prepare(`
        UPDATE luckyme_oauth_states SET status = 'consumed', consumed_at = ? WHERE state = ?
      `).run(timestamp, oauth.state);
      audit("discord-oauth", "discord_task_approved", "task_submission", submissionId, {
        taskId: task.id,
        wallet: oauth.wallet,
      });
      return { wallet: oauth.wallet, submissionId, luckyPoints: pointsService.points(oauth.wallet) };
    });
  }

  function listSubmissions({ status = "pending_review" } = {}) {
    const normalizedStatus = ["pending_review", "approved", "rejected"].includes(status)
      ? status
      : "pending_review";
    return db.prepare(`
      SELECT s.*, t.title, t.platform, t.action_type, t.target_url,
             t.reward_points, t.reward_xp, u.username
      FROM luckyme_task_submissions s
      JOIN luckyme_tasks t ON t.id = s.task_id
      JOIN luckyme_users u ON u.wallet = s.wallet
      WHERE s.status = ?
      ORDER BY s.submitted_at DESC
      LIMIT 500
    `).all(normalizedStatus).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      title: row.title,
      platform: row.platform,
      actionType: row.action_type,
      actionLabel: xActionLabel(row.action_type),
      targetUrl: row.target_url,
      rewardPoints: Number(row.reward_points),
      rewardXp: Number(row.reward_xp ?? 0),
      wallet: row.wallet,
      username: row.username,
      submittedValue: row.submitted_value,
      proofUrl: row.proof_url,
      proofMessage: row.proof_message,
      status: row.status,
      reviewNote: row.review_note,
      submittedAt: row.submitted_at,
      reviewedAt: row.reviewed_at,
    }));
  }

  function missionHistory(walletAddress, { limit = 100 } = {}) {
    const user = ensureUser(walletAddress);
    const rowLimit = Math.max(1, Math.min(250, Number(limit) || 100));
    return db.prepare(`
      SELECT s.id, s.status, s.submitted_at, s.reviewed_at, s.review_note,
             t.id task_id, t.title, t.platform, t.action_type,
             t.reward_points, t.reward_xp
      FROM luckyme_task_submissions s
      JOIN luckyme_tasks t ON t.id = s.task_id
      WHERE s.wallet = ? AND s.status IN ('approved', 'rejected')
      ORDER BY COALESCE(s.reviewed_at, s.submitted_at) DESC
      LIMIT ?
    `).all(user.wallet, rowLimit).map((row) => ({
      id: row.id,
      taskId: row.task_id,
      title: row.title,
      platform: row.platform,
      actionType: row.action_type ?? null,
      status: row.status,
      rewardPoints: Number(row.reward_points ?? 0),
      rewardXp: Number(row.reward_xp ?? 0),
      awardedPoints: row.status === "approved" ? Number(row.reward_points ?? 0) : 0,
      awardedXp: row.status === "approved" ? Number(row.reward_xp ?? 0) : 0,
      submittedAt: row.submitted_at,
      completedAt: row.reviewed_at ?? row.submitted_at,
      note: row.review_note ?? null,
    }));
  }

  function reviewTask({ actor, submissionId, decision, note = "" }) {
    const status = decision === "approve" ? "approved" : decision === "reject" ? "rejected" : null;
    if (!status) fail(400, "invalid_decision", "Decision must be approve or reject");
    return transaction(db, () => {
      const submission = db.prepare(`
        SELECT s.*, t.platform, t.reward_points, t.reward_xp
        FROM luckyme_task_submissions s
        JOIN luckyme_tasks t ON t.id = s.task_id
        WHERE s.id = ?
      `).get(String(submissionId));
      if (!submission) fail(404, "submission_not_found", "Task submission was not found");
      if (submission.status !== "pending_review") {
        return { replayed: true, status: submission.status, luckyPoints: pointsService.points(submission.wallet) };
      }
      const timestamp = nowIso(clock);
      const rewardKey = `task:${submission.id}:approved`;
      if (status === "approved" && submission.platform === "x") {
        const linked = db.prepare(`
          SELECT wallet FROM luckyme_social_identities
          WHERE platform = 'x' AND normalized_handle = ?
        `).get(submission.normalized_value);
        if (linked && linked.wallet !== submission.wallet) {
          fail(409, "identity_already_linked", "This X account is linked to another LuckyMe wallet");
        }
        db.prepare(`
          INSERT INTO luckyme_social_identities
            (platform, wallet, normalized_handle, display_handle, verified_by, verified_at)
          VALUES ('x', ?, ?, ?, ?, ?)
          ON CONFLICT(platform, wallet) DO UPDATE SET
            normalized_handle = excluded.normalized_handle,
            display_handle = excluded.display_handle,
            verified_by = excluded.verified_by,
            verified_at = excluded.verified_at
        `).run(
          submission.wallet,
          submission.normalized_value,
          submission.submitted_value,
          String(actor),
          timestamp,
        );
      }
      db.prepare(`
        UPDATE luckyme_task_submissions
        SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = ?,
            reward_idempotency_key = ?
        WHERE id = ?
      `).run(
        status,
        String(note ?? "").slice(0, 500),
        String(actor),
        timestamp,
        status === "approved" ? rewardKey : null,
        submission.id,
      );
      if (submission.platform === "x") {
        db.prepare(`
          UPDATE luckyme_social_challenges
          SET status = ?, verified_at = ?
          WHERE task_id = ? AND wallet = ? AND status = 'submitted'
        `).run(status === "approved" ? "verified" : "cancelled", timestamp, submission.task_id, submission.wallet);
      }
      if (status === "approved" && Number(submission.reward_points) > 0) {
        creditTaskPoints({
          walletAddress: submission.wallet,
          amount: Number(submission.reward_points),
          idempotencyKey: `${rewardKey}:points`,
          reason: "task_x_approved",
        });
      }
      if (status === "approved" && Number(submission.reward_xp ?? 0) > 0) {
        creditXp({
          walletAddress: submission.wallet,
          amount: Number(submission.reward_xp),
          idempotencyKey: `${rewardKey}:xp`,
          reason: "task_x_approved",
          sourceType: "task",
          sourceId: submission.task_id,
        });
      }
      audit(actor, `task_${status}`, "task_submission", submission.id, {
        taskId: submission.task_id,
        wallet: submission.wallet,
      });
      return { replayed: false, status, luckyPoints: pointsService.points(submission.wallet) };
    });
  }

  function recordValidPoolParticipation({
    wallet: walletAddress,
    poolType,
    roundId,
    settlementSignature = null,
    settledAt = nowIso(clock),
  }) {
    const pool = String(poolType ?? "").trim().toLowerCase();
    const baseReward = POOL_PARTICIPATION_REWARDS[pool];
    if (!baseReward) fail(400, "invalid_pool_type", "Pool must be Mini, Normal, High or Premium");
    const round = Number(roundId);
    if (!Number.isSafeInteger(round) || round < 1) fail(400, "invalid_round", "Round id is invalid");
    const user = ensureUser(walletAddress);
    const eventKey = `valid-pool:${pool}:${round}:${user.wallet}`;
    return transaction(db, () => {
      const replay = db.prepare(`
        SELECT id FROM luckyme_gameplay_events WHERE idempotency_key = ?
      `).get(eventKey);
      if (replay) {
        return {
          replayed: true,
          profile: profile(user.wallet),
          completedTasks: [],
        };
      }
      const eventId = randomUUID();
      const timestamp = nowIso(clock);
      db.prepare(`
        INSERT INTO luckyme_gameplay_events
          (id, wallet, pool_type, round_id, settlement_signature, idempotency_key,
           settled_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        eventId,
        user.wallet,
        pool,
        round,
        settlementSignature ? String(settlementSignature) : null,
        eventKey,
        String(settledAt),
        timestamp,
      );
      creditTaskPoints({
        walletAddress: user.wallet,
        amount: baseReward.points,
        idempotencyKey: `${eventKey}:points`,
        reason: `valid_${pool}_participation`,
      });
      creditXp({
        walletAddress: user.wallet,
        amount: baseReward.xp,
        idempotencyKey: `${eventKey}:xp`,
        reason: `valid_${pool}_participation`,
        sourceType: "pool_round",
        sourceId: `${pool}:${round}`,
      });
      const currentLevel = levelState(
        db.prepare("SELECT xp_total FROM luckyme_users WHERE wallet = ?").get(user.wallet)?.xp_total ?? 0,
      ).level;
      const tasks = db.prepare(`
        SELECT * FROM luckyme_tasks
        WHERE status = 'active' AND deleted_at IS NULL
          AND gameplay_pool_type IS NOT NULL
          AND starts_at IS NOT NULL AND starts_at <= ?
          AND (gameplay_pool_type = 'any' OR gameplay_pool_type = ?)
          AND min_level <= ? AND max_level >= ?
        ORDER BY created_at, id
      `).all(String(settledAt), pool, currentLevel, currentLevel);
      const completedTasks = [];
      for (const task of tasks) {
        const alreadyRewarded = db.prepare(`
          SELECT id FROM luckyme_task_submissions
          WHERE task_id = ? AND wallet = ? AND status = 'approved'
        `).get(task.id, user.wallet);
        if (alreadyRewarded) continue;
        const limitReached = task.participant_limit != null && Number(db.prepare(`
          SELECT COUNT(*) total FROM luckyme_task_submissions
          WHERE task_id = ? AND status = 'approved'
        `).get(task.id)?.total ?? 0) >= Number(task.participant_limit);
        if (limitReached) continue;
        db.prepare(`
          INSERT OR IGNORE INTO luckyme_task_progress
            (task_id, wallet, progress_count, required_count, status, started_at)
          VALUES (?, ?, 0, ?, 'active', ?)
        `).run(task.id, user.wallet, Number(task.gameplay_required_count), task.starts_at);
        const progress = Number(db.prepare(`
          SELECT COUNT(*) total FROM luckyme_gameplay_events
          WHERE wallet = ? AND settled_at >= ?
            AND (? = 'any' OR pool_type = ?)
        `).get(user.wallet, task.starts_at, task.gameplay_pool_type, task.gameplay_pool_type)?.total ?? 0);
        const required = Number(task.gameplay_required_count);
        const completed = progress >= required;
        db.prepare(`
          UPDATE luckyme_task_progress
          SET progress_count = ?, status = ?, last_event_at = ?,
              completed_at = CASE WHEN ? = 1 THEN COALESCE(completed_at, ?) ELSE completed_at END
          WHERE task_id = ? AND wallet = ?
        `).run(
          Math.min(progress, required),
          completed ? "completed" : "active",
          timestamp,
          completed ? 1 : 0,
          timestamp,
          task.id,
          user.wallet,
        );
        if (!completed) continue;
        const submissionId = randomUUID();
        const rewardKey = `task:${task.id}:${user.wallet}:gameplay`;
        db.prepare(`
          INSERT INTO luckyme_task_submissions
            (id, task_id, wallet, submitted_value, normalized_value, status,
             review_note, reviewed_by, submitted_at, reviewed_at, reward_idempotency_key)
          VALUES (?, ?, ?, ?, ?, 'approved',
                  'Completed automatically from valid settled pool rounds',
                  'gameplay-counter', ?, ?, ?)
        `).run(
          submissionId,
          task.id,
          user.wallet,
          `${required} valid ${task.gameplay_pool_type} pools`,
          `${task.gameplay_pool_type}:${required}`,
          timestamp,
          timestamp,
          rewardKey,
        );
        if (Number(task.reward_points) > 0) {
          creditTaskPoints({
            walletAddress: user.wallet,
            amount: Number(task.reward_points),
            idempotencyKey: `${rewardKey}:points`,
            reason: "task_gameplay_completed",
          });
        }
        if (Number(task.reward_xp ?? 0) > 0) {
          creditXp({
            walletAddress: user.wallet,
            amount: Number(task.reward_xp),
            idempotencyKey: `${rewardKey}:xp`,
            reason: "task_gameplay_completed",
            sourceType: "task",
            sourceId: task.id,
          });
        }
        db.prepare(`
          UPDATE luckyme_task_progress
          SET status = 'rewarded', rewarded_at = ?
          WHERE task_id = ? AND wallet = ?
        `).run(timestamp, task.id, user.wallet);
        completedTasks.push(task.id);
      }
      audit("settlement-archive", "valid_pool_participation_recorded", "pool_round", `${pool}:${round}`, {
        wallet: user.wallet,
        completedTasks,
      });
      return {
        replayed: false,
        profile: profile(user.wallet),
        completedTasks,
      };
    });
  }

  function syncValidPoolParticipations(
    walletAddress,
    archivePath = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH,
  ) {
    if (!archivePath) return { scanned: 0, matched: 0, recorded: 0 };
    const address = wallet(walletAddress);
    const records = readSettlementArchive(archivePath);
    let matched = 0;
    let recorded = 0;
    for (const record of records) {
      if (
        record?.settled !== true ||
        record?.roundOutcome !== "settled" ||
        !POOL_PARTICIPATION_REWARDS[String(record.pool ?? "").toLowerCase()] ||
        !Number.isSafeInteger(Number(record.roundId)) ||
        !Array.isArray(record.entries) ||
        !record.entries.some((entry) => entry?.player === address)
      ) {
        continue;
      }
      matched += 1;
      const result = recordValidPoolParticipation({
        wallet: address,
        poolType: record.pool,
        roundId: Number(record.roundId),
        settlementSignature: record.settlementSignature ?? null,
        settledAt: record.archivedAt ?? new Date(clock()).toISOString(),
      });
      if (!result.replayed) recorded += 1;
    }
    return { scanned: records.length, matched, recorded };
  }

  function activeAudience({ days = 30 } = {}) {
    const lookback = Math.min(Math.max(Number(days) || 30, 1), 365);
    const cutoff = new Date(clock() - lookback * 86_400_000).toISOString();
    const eligible = Number(db.prepare(`
      SELECT COUNT(*) total FROM luckyme_users
      WHERE status = 'active' AND is_internal = 0
        AND last_active_at IS NOT NULL AND last_active_at >= ?
    `).get(cutoff)?.total ?? 0);
    const participants = Number(db.prepare(`
      SELECT COUNT(DISTINCT e.wallet) total
      FROM promotional_pool_entries e
      JOIN luckyme_users u ON u.wallet = e.wallet
      WHERE e.status IN ('confirmed', 'closed')
        AND u.status = 'active' AND u.is_internal = 0
        AND e.created_at >= ?
    `).get(cutoff)?.total ?? 0);
    return {
      windowDays: lookback,
      eligibleActiveUsers: eligible,
      historicalParticipants: participants,
      historicalConversionRate: eligible > 0
        ? Math.min(1, Math.max(0.01, participants / eligible))
        : 0.25,
      cutoff,
    };
  }

  function listUsers({ search = "", limit = 500 } = {}) {
    const query = `%${String(search ?? "").trim()}%`;
    const rows = db.prepare(`
      SELECT u.*,
             COALESCE(p.balance, 0) lucky_points,
             COALESCE(p.reserved_balance, 0) reserved_points,
             SUM(CASE WHEN s.status = 'approved' THEN 1 ELSE 0 END) completed_tasks,
             SUM(CASE WHEN s.status = 'pending_review' THEN 1 ELSE 0 END) pending_tasks
      FROM luckyme_users u
      LEFT JOIN promotional_wallet_points p ON p.wallet = u.wallet
      LEFT JOIN luckyme_task_submissions s ON s.wallet = u.wallet
      WHERE u.username LIKE ? COLLATE NOCASE OR u.wallet LIKE ?
      GROUP BY u.wallet
      ORDER BY u.created_at DESC
      LIMIT ?
    `).all(query, query, Math.min(Math.max(Number(limit) || 100, 1), 500));
    return rows.map((row) => ({
      ...levelState(row.xp_total ?? 0),
      wallet: row.wallet,
      username: row.username,
      displayName: row.display_name,
      status: row.status,
      luckyPoints: Number(row.lucky_points),
      reservedPoints: Number(row.reserved_points),
      completedTasks: Number(row.completed_tasks ?? 0),
      pendingTasks: Number(row.pending_tasks ?? 0),
      xpTotal: Number(row.xp_total ?? 0),
      level: levelState(row.xp_total ?? 0).level,
      rankKey: levelState(row.xp_total ?? 0).rankKey,
      rankTitle: levelState(row.xp_total ?? 0).rankTitle,
      lastActiveAt: row.last_active_at,
      internal: Boolean(row.is_internal),
      usernameFinalizedAt: row.username_finalized_at,
      createdAt: row.created_at,
    }));
  }

  function userDetails(walletAddress) {
    const result = profile(walletAddress, { allowSuspended: true });
    const ledger = db.prepare(`
      SELECT delta, balance_after, reason, promotion_id, created_at
      FROM promotional_points_ledger WHERE wallet = ?
      ORDER BY created_at DESC LIMIT 200
    `).all(result.wallet).map((row) => ({
      delta: Number(row.delta),
      balanceAfter: Number(row.balance_after),
      reason: row.reason,
      promotionId: row.promotion_id,
      createdAt: row.created_at,
    }));
    const xpLedger = db.prepare(`
      SELECT delta, xp_after, reason, source_type, source_id, created_at
      FROM luckyme_xp_ledger WHERE wallet = ?
      ORDER BY created_at DESC LIMIT 200
    `).all(result.wallet).map((row) => ({
      delta: Number(row.delta),
      xpAfter: Number(row.xp_after),
      reason: row.reason,
      sourceType: row.source_type,
      sourceId: row.source_id,
      createdAt: row.created_at,
    }));
    const submissions = db.prepare(`
      SELECT s.*, t.title, t.platform, t.reward_points, t.reward_xp
      FROM luckyme_task_submissions s
      JOIN luckyme_tasks t ON t.id = s.task_id
      WHERE s.wallet = ? ORDER BY s.submitted_at DESC
    `).all(result.wallet);
    const entries = db.prepare(`
      SELECT e.status, e.entry_index, e.entry_signature, e.created_at, p.title promotion_title
      FROM promotional_pool_entries e
      JOIN promotional_pools p ON p.id = e.promotion_id
      WHERE e.wallet = ? ORDER BY e.created_at DESC
    `).all(result.wallet);
    const gameplay = db.prepare(`
      SELECT pool_type, round_id, settlement_signature, settled_at
      FROM luckyme_gameplay_events WHERE wallet = ?
      ORDER BY settled_at DESC LIMIT 200
    `).all(result.wallet).map((row) => ({
      poolType: row.pool_type,
      roundId: Number(row.round_id),
      settlementSignature: row.settlement_signature,
      settledAt: row.settled_at,
    }));
    return {
      ...result,
      ledger,
      xpLedger,
      submissions,
      promotionEntries: entries,
      gameplay,
    };
  }

  function setUserStatus({ actor, wallet: walletAddress, status }) {
    const address = wallet(walletAddress);
    if (!["active", "suspended"].includes(status)) fail(400, "invalid_user_status", "User status is invalid");
    const result = db.prepare(`
      UPDATE luckyme_users SET status = ?, updated_at = ? WHERE wallet = ?
    `).run(status, nowIso(clock), address);
    if (result.changes !== 1) fail(404, "user_not_found", "User was not found");
    audit(actor, "user_status_updated", "user", address, { status });
    return db.prepare("SELECT * FROM luckyme_users WHERE wallet = ?").get(address);
  }

  function beginPromotionNotification(promotionId) {
    const timestamp = nowIso(clock);
    const existing = db.prepare(`
      SELECT status FROM luckyme_promotion_notifications WHERE promotion_id = ?
    `).get(String(promotionId));
    if (existing?.status === "sent" || existing?.status === "sending") return false;
    db.prepare(`
      INSERT INTO luckyme_promotion_notifications
        (promotion_id, status, recipients, error, created_at, updated_at)
      VALUES (?, 'sending', 0, NULL, ?, ?)
      ON CONFLICT(promotion_id) DO UPDATE SET
        status = 'sending', error = NULL, updated_at = excluded.updated_at
    `).run(String(promotionId), timestamp, timestamp);
    return true;
  }

  function finishPromotionNotification(promotionId, { recipients = 0, error = null } = {}) {
    db.prepare(`
      UPDATE luckyme_promotion_notifications
      SET status = ?, recipients = ?, error = ?, updated_at = ?
      WHERE promotion_id = ?
    `).run(error ? "failed" : "sent", Number(recipients), error ? String(error).slice(0, 500) : null, nowIso(clock), String(promotionId));
  }

  seedAvatarCatalog();
  seedDefaultTasks();

  return {
    ensureUser,
    profile,
    finalizeUsername,
    acquireAvatar,
    selectAvatar,
    listTasks,
    createTask,
    updateTask,
    deleteTask,
    beginXVerification,
    submitXVerification,
    beginDiscordOAuth,
    completeDiscordOAuth,
    listSubmissions,
    missionHistory,
    reviewTask,
    recordValidPoolParticipation,
    syncValidPoolParticipations,
    activeAudience,
    listUsers,
    userDetails,
    setUserStatus,
    beginPromotionNotification,
    finishPromotionNotification,
  };
}
