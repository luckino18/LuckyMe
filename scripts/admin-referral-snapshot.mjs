import { DatabaseSync } from "node:sqlite";
import { referralQualificationProgress } from "../backend/src/referral-eligibility.mjs";
import { readSettlementArchive } from "./settlement-archive.mjs";

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
      bindings,
      counts,
      updatedAt: new Date().toISOString(),
    };
  } finally {
    db.close();
  }
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
