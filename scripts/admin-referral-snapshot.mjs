import { DatabaseSync } from "node:sqlite";
import { referralQualificationProgress } from "../backend/src/referral-eligibility.mjs";
import { readSettlementArchive } from "./settlement-archive.mjs";

// Keep the read-only monitor independent from the referral API's Solana dependencies.
const SEEKER_PASS_CAMPAIGN_ID = "luckyme-seeker-pass-3-sol-1000-2026";
const SEEKER_PASS_PRIZES_LAMPORTS = Object.freeze([
  580_000_000, 350_000_000, 270_000_000, 220_000_000, 190_000_000,
  170_000_000, 150_000_000, 140_000_000, 130_000_000, 120_000_000,
  110_000_000, 100_000_000, 90_000_000, 80_000_000, 50_000_000,
  50_000_000, 50_000_000, 50_000_000, 50_000_000, 50_000_000,
]);

export function buildReferralAdminSnapshot({ dbPath, settlementArchivePath } = {}) {
  if (!dbPath) throw new Error("Referral database path is not configured");
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const archive = settlementArchivePath
      ? readSettlementArchive(settlementArchivePath, { strict: true })
      : [];
    const profiles = Number(db.prepare("SELECT COUNT(*) AS count FROM referral_profiles").get().count ?? 0);
    const verifiedIdentities = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM seeker_identities WHERE status = 'verified'
    `).get().count ?? 0);
    const appAnalytics = readAppAnalytics(db);
    const promotions = readPromotions(db);
    const rows = db.prepare(`
      SELECT b.id, b.referral_code, b.status, b.bound_at, b.qualified_at,
             b.invalidation_reason,
             referrer.sgt_mint AS referrer_sgt_mint,
             referrer.current_wallet AS referrer_wallet,
             referred.sgt_mint AS referred_sgt_mint,
             referred.current_wallet AS referred_wallet,
             referred.last_verified_at AS referred_last_verified_at
      FROM referral_bindings b
      JOIN seeker_identities referrer ON referrer.sgt_mint = b.referrer_sgt_mint
      JOIN seeker_identities referred ON referred.sgt_mint = b.referred_sgt_mint
      ORDER BY b.bound_at DESC, b.id DESC
    `).all();

    const bindings = rows.map((row) => {
      const wallets = walletHistory(db, row.referred_sgt_mint, row.referred_wallet);
      const activity = db.prepare(`
        SELECT activity_date FROM referral_activity_days
        WHERE sgt_mint = ? ORDER BY activity_date ASC
      `).all(row.referred_sgt_mint).map((item) => item.activity_date);
      const progress = referralQualificationProgress({
        wallet: row.referred_wallet,
        wallets,
        settlementArchive: archive,
        activityDates: activity,
      });
      return {
        id: Number(row.id),
        referralCode: row.referral_code,
        status: row.status === "pending" && progress.eligible ? "ready_to_qualify" : row.status,
        storedStatus: row.status,
        boundAt: row.bound_at,
        qualifiedAt: row.qualified_at,
        invalidationReason: row.invalidation_reason,
        referrer: { sgtMint: row.referrer_sgt_mint, wallet: row.referrer_wallet },
        referred: {
          sgtMint: row.referred_sgt_mint,
          wallet: row.referred_wallet,
          lastVerifiedAt: row.referred_last_verified_at,
        },
        progress,
        lastActivityDate: activity.at(-1) ?? null,
      };
    });

    const counts = Object.fromEntries(
      ["pending", "qualified", "qualified_test", "invalidated", "ready_to_qualify"]
        .map((status) => [status, bindings.filter((item) => item.status === status).length]),
    );
    return {
      ok: true,
      profiles,
      verifiedIdentities,
      appAnalytics,
      promotions,
      bindings,
      counts,
      updatedAt: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
}

function readPromotions(db) {
  const hasTable = db.prepare(`
    SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'promotions'
  `).get();
  if (!hasTable) return [];
  return db.prepare(`
    SELECT p.*,
      (SELECT COUNT(*) FROM promotion_entries e WHERE e.campaign_id = p.campaign_id) AS entry_count
    FROM promotions p ORDER BY p.created_at DESC
  `).all().map((promotion) => {
    const winners = db.prepare(`
      SELECT rank, wallet, asset_id, prize_lamports, ownership_status, payout_status, payout_signature
      FROM promotion_winners WHERE campaign_id = ? ORDER BY rank ASC
    `).all(promotion.campaign_id).map((winner) => ({
      rank: Number(winner.rank),
      wallet: winner.wallet,
      assetId: winner.asset_id,
      prizeLamports: String(winner.prize_lamports),
      prizeSol: Number(winner.prize_lamports) / 1_000_000_000,
      ownershipStatus: winner.ownership_status,
      payoutStatus: winner.payout_status,
      payoutSignature: winner.payout_signature,
    }));
    const entryCount = Number(promotion.entry_count ?? 0);
    const threshold = Number(promotion.entry_threshold);
    return {
      campaignId: promotion.campaign_id,
      name: promotion.name,
      status: promotion.status,
      entryCount,
      entryThreshold: threshold,
      entriesRemaining: Math.max(0, threshold - entryCount),
      progressPercent: Math.min(100, Number(((entryCount / threshold) * 100).toFixed(1))),
      winnerCount: Number(promotion.winner_count),
      prizeLamports: String(promotion.prize_lamports),
      prizeSol: Number(promotion.prize_lamports) / 1_000_000_000,
      funded: promotion.funded === 1,
      payoutEnabled: promotion.payout_enabled === 1,
      collection: promotion.collection_address,
      tree: promotion.tree_address,
      verifiedCreator: promotion.verified_creator,
      frozenAt: promotion.frozen_at,
      entryCommitment: promotion.entry_commitment,
      targetSlot: promotion.target_slot === null ? null : Number(promotion.target_slot),
      resolvedSlot: promotion.resolved_slot === null ? null : Number(promotion.resolved_slot),
      randomnessBlockhash: promotion.randomness_blockhash,
      randomnessHash: promotion.randomness_hash,
      drawnAt: promotion.drawn_at,
      prizes: promotion.campaign_id === SEEKER_PASS_CAMPAIGN_ID
        ? SEEKER_PASS_PRIZES_LAMPORTS.map((amount, index) => ({ rank: index + 1, prizeSol: amount / 1_000_000_000 }))
        : [],
      winners,
    };
  });
}

function readAppAnalytics(db) {
  const hasTable = db.prepare(`
    SELECT 1 AS present FROM sqlite_master
    WHERE type = 'table' AND name = 'app_installations'
  `).get();
  if (!hasTable) return { enabled: false, uniqueActivations: 0, activeToday: 0, launches: 0, versions: [] };
  const totals = db.prepare(`
    SELECT COUNT(*) AS unique_activations, COALESCE(SUM(launch_count), 0) AS launches
    FROM app_installations WHERE channel = 'solana-dapp-store'
  `).get();
  const activeToday = db.prepare(`
    SELECT COUNT(*) AS count FROM app_installation_activity_days WHERE activity_date = ?
  `).get(new Date().toISOString().slice(0, 10));
  const versions = db.prepare(`
    SELECT app_version, version_code, COUNT(*) AS unique_activations,
           COALESCE(SUM(launch_count), 0) AS launches
    FROM app_installations
    WHERE channel = 'solana-dapp-store'
    GROUP BY app_version, version_code
    ORDER BY version_code DESC
  `).all().map((row) => ({
    appVersion: row.app_version,
    versionCode: Number(row.version_code),
    uniqueActivations: Number(row.unique_activations),
    launches: Number(row.launches),
  }));
  return {
    enabled: true,
    uniqueActivations: Number(totals.unique_activations),
    activeToday: Number(activeToday.count),
    launches: Number(totals.launches),
    versions,
  };
}

function walletHistory(db, sgtMint, currentWallet) {
  try {
    return db.prepare(`
      SELECT wallet FROM seeker_identity_wallets
      WHERE sgt_mint = ? ORDER BY first_verified_at ASC
    `).all(sgtMint).map((row) => row.wallet);
  } catch {
    return [currentWallet];
  }
}
