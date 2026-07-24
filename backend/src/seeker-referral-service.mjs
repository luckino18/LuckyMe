import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PublicKey, Connection } from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getMetadataPointerState,
  getTokenGroupMemberState,
  unpackMint,
} from "@solana/spl-token";
import {
  parseSignInMessage,
  verifySignIn,
} from "@solana/wallet-standard-util";
import { readSettlementArchive } from "../../scripts/settlement-archive.mjs";
import { createRpcFailoverFetch } from "../../scripts/rpc-failover.mjs";
import { referralQualificationProgress } from "./referral-eligibility.mjs";

export const SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
export const SGT_METADATA_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
export const SGT_GROUP_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
export const REFERRAL_SEASON_ID = "seeker-referral-test-2026";
export const REFERRAL_SEASON_NAME = "Seeker Referral League — Test Season";
export const REFERRAL_SEASON_CLOSES_AT = "2026-09-30T23:59:59.000Z";
export const MONTHLY_REFERRAL_PRIZE_SKr = 10_000;
export const SEEKER_PASS_COLLECTION = "HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J";
export const SEEKER_PASS_TREE = "6MaEv559doM7sUkL1tFWRQST9JKRskSd64DzdkL3B22k";
export const SEEKER_PASS_VERIFIED_CREATOR = "6p8dv8FaqjdoJ2MQHwrYADdP65FKcyyGX3a7kqKtf24H";
export const LUCKYME_NFT_COLLECTIONS = Object.freeze([
  Object.freeze({
    id: "seeker-pass",
    name: "LuckyMe Seeker Pass",
    collection: SEEKER_PASS_COLLECTION,
    tree: SEEKER_PASS_TREE,
    verifiedCreator: SEEKER_PASS_VERIFIED_CREATOR,
  }),
]);
export const SEEKER_PASS_CAMPAIGN_ID = "luckyme-seeker-pass-3-sol-1000-2026";
export const SEEKER_PASS_CAMPAIGN_NAME = "LuckyMe Seeker Pass — 3 SOL Draw";
export const SEEKER_PASS_ENTRY_THRESHOLD = 1_000;
export const SEEKER_PASS_WINNER_COUNT = 20;
export const SEEKER_PASS_PRIZE_LAMPORTS = 3_000_000_000;
export const SEEKER_PASS_RANDOMNESS_SLOT_DELAY = 32;
export const SEEKER_PASS_PRIZES_LAMPORTS = Object.freeze([
  580_000_000,
  350_000_000,
  270_000_000,
  220_000_000,
  190_000_000,
  170_000_000,
  150_000_000,
  140_000_000,
  130_000_000,
  120_000_000,
  110_000_000,
  100_000_000,
  90_000_000,
  80_000_000,
  50_000_000,
  50_000_000,
  50_000_000,
  50_000_000,
  50_000_000,
  50_000_000,
]);

const DEFAULT_DOMAIN = "www.lucky-me.app";
const DEFAULT_URI = "https://www.lucky-me.app";
const NONCE_TTL_MS = 5 * 60_000;
const SESSION_TTL_MS = 15 * 60_000;
const RPC_TIMEOUT_MS = 12_000;
const MAX_STRING = 512;
const CODE_RE = /^LM-[A-HJ-NP-Z2-9]{6}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9._:-]{12,120}$/;
const MAINNET_BLOCKLIST_RE = /devnet|testnet|localhost|127\.0\.0\.1|0\.0\.0\.0|192\.168\.|10\./i;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const INSTALL_ID_RE = /^[a-f0-9]{32}$/;
const APP_VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z._-]{0,31}$/;

if (SEEKER_PASS_PRIZES_LAMPORTS.length !== SEEKER_PASS_WINNER_COUNT ||
    SEEKER_PASS_PRIZES_LAMPORTS.reduce((total, amount) => total + amount, 0) !== SEEKER_PASS_PRIZE_LAMPORTS) {
  throw new Error("LuckyMe Seeker Pass prize schedule is invalid");
}

export class ReferralHttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ReferralHttpError";
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) {
  throw new ReferralHttpError(status, code, message);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function nowIso(clock) {
  return new Date(clock()).toISOString();
}

function productionSeason(clock) {
  const now = new Date(clock());
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const monthNumber = String(month + 1).padStart(2, "0");
  const label = new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(now);
  return {
    id: `seeker-referral-${year}-${monthNumber}`,
    name: `Seeker Referral League — ${label}`,
    closesAt: new Date(Date.UTC(year, month + 1, 1)).toISOString(),
    testOnly: false,
  };
}

function mask(value, left = 4, right = 4) {
  if (!value || value.length <= left + right) return value ?? "";
  return `${value.slice(0, left)}…${value.slice(-right)}`;
}

function parseIso(value, field) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) fail(400, "invalid_siws", `${field} is invalid`);
  return timestamp;
}

function stringField(value, field, { max = MAX_STRING, pattern } = {}) {
  if (typeof value !== "string" || value.length === 0 || value.length > max) {
    fail(400, "invalid_input", `${field} is invalid`);
  }
  if (pattern && !pattern.test(value)) fail(400, "invalid_input", `${field} is invalid`);
  return value;
}

function booleanField(value, field) {
  if (value === undefined) return false;
  if (typeof value !== "boolean") fail(400, "invalid_input", `${field} is invalid`);
  return value;
}

function decodeBase64(value, field, expectedLength) {
  stringField(value, field, { max: 16_384 });
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value) || value.length % 4 === 1) {
    fail(400, "invalid_siws", `${field} is not valid base64`);
  }
  const bytes = Buffer.from(value, "base64");
  if (expectedLength && bytes.length !== expectedLength) {
    fail(400, "invalid_siws", `${field} has an invalid length`);
  }
  return new Uint8Array(bytes);
}

function withTimeout(promise, timeoutMs, code = "backend_timeout") {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new ReferralHttpError(503, code, "The verification service timed out")),
        timeoutMs,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

function inTransaction(db, action) {
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

function sqliteConflict(error) {
  return error?.code === "ERR_SQLITE_ERROR" && /UNIQUE constraint failed/i.test(error.message);
}

function migrateReferralBindingStatuses(db) {
  const table = db.prepare(`
    SELECT sql FROM sqlite_master
    WHERE type = 'table' AND name = 'referral_bindings'
  `).get();
  if (!table?.sql || /['"]qualified['"]/.test(table.sql)) return;

  inTransaction(db, () => {
    db.exec(`
      ALTER TABLE referral_bindings RENAME TO referral_bindings_legacy;
      CREATE TABLE referral_bindings (
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
      INSERT INTO referral_bindings
        (id, referrer_sgt_mint, referred_sgt_mint, referral_code, status,
         bound_at, qualified_at, invalidated_at, invalidation_reason)
      SELECT id, referrer_sgt_mint, referred_sgt_mint, referral_code, status,
             bound_at, qualified_at, invalidated_at, invalidation_reason
      FROM referral_bindings_legacy;
      DROP TABLE referral_bindings_legacy;
      CREATE INDEX referral_bindings_referrer_idx
        ON referral_bindings(referrer_sgt_mint, status);
    `);
  });
}

function randomReferralCode() {
  const bytes = randomBytes(6);
  let suffix = "";
  for (const byte of bytes) suffix += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  return `LM-${suffix}`;
}

function makeReferralCode(db) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const code = randomReferralCode();
    if (!db.prepare("SELECT 1 FROM referral_profiles WHERE referral_code = ?").get(code)) return code;
  }
  fail(503, "code_generation_failed", "Could not allocate a referral code");
}

function assertMainnetRpcUrl(rpcUrl) {
  let url;
  try {
    url = new URL(rpcUrl);
  } catch {
    fail(500, "invalid_rpc_configuration", "Referral RPC URL is invalid");
  }
  if (url.protocol !== "https:" || MAINNET_BLOCKLIST_RE.test(rpcUrl)) {
    fail(500, "invalid_rpc_configuration", "Referral verification requires an HTTPS mainnet RPC URL");
  }
}

export function isAuthenticSgtMint(candidate) {
  return candidate.ownerProgram === TOKEN_2022_PROGRAM_ID.toBase58() &&
    candidate.decimals === 0 &&
    candidate.supply === "1" &&
    candidate.mintAuthority === SGT_MINT_AUTHORITY &&
    candidate.metadataAuthority === SGT_MINT_AUTHORITY &&
    candidate.metadataAddress === SGT_METADATA_ADDRESS &&
    candidate.groupAddress === SGT_GROUP_ADDRESS;
}

export function createMainnetSgtVerifier({ rpcUrl, timeoutMs = RPC_TIMEOUT_MS } = {}) {
  const endpoint = rpcUrl ?? process.env.SEEKER_SGT_RPC_URL ?? process.env.ANCHOR_PROVIDER_URL;
  if (!endpoint) fail(500, "missing_rpc_configuration", "SEEKER_SGT_RPC_URL is required");
  assertMainnetRpcUrl(endpoint);
  const connection = new Connection(endpoint, {
    commitment: "confirmed",
    fetch: createRpcFailoverFetch({ primaryUrl: endpoint }),
  });
  const endpointUrl = new URL(endpoint);
  const useHeliusV2 = endpointUrl.hostname.endsWith("helius-rpc.com");

  async function fetchHeliusTokenAccounts(walletAddress) {
    const accounts = [];
    let paginationKey;
    for (let page = 0; page < 20; page += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let response;
      try {
        response = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: `sgt-${page + 1}`,
            method: "getTokenAccountsByOwnerV2",
            params: [
              walletAddress,
              { programId: TOKEN_2022_PROGRAM_ID.toBase58() },
              { encoding: "jsonParsed", limit: 1_000, ...(paginationKey ? { paginationKey } : {}) },
            ],
          }),
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new ReferralHttpError(503, "sgt_rpc_unavailable", "SGT RPC request failed");
      const data = await response.json();
      if (data?.error) throw new ReferralHttpError(503, "sgt_rpc_unavailable", "SGT RPC request failed");
      const pageAccounts = data?.result?.value?.accounts;
      if (!Array.isArray(pageAccounts)) throw new ReferralHttpError(503, "sgt_rpc_invalid", "SGT RPC response was invalid");
      accounts.push(...pageAccounts);
      paginationKey = data?.result?.paginationKey;
      if (!paginationKey) return accounts;
    }
    throw new ReferralHttpError(503, "sgt_rpc_pagination_limit", "SGT RPC pagination limit was exceeded");
  }

  async function fetchTokenAccounts(walletAddress, owner) {
    if (useHeliusV2) {
      try {
        return await fetchHeliusTokenAccounts(walletAddress);
      } catch (error) {
        if (process.env.SEEKER_SGT_ALLOW_STANDARD_FALLBACK === "false") throw error;
      }
    }
    const response = await withTimeout(
      connection.getParsedTokenAccountsByOwner(owner, { programId: TOKEN_2022_PROGRAM_ID }, "confirmed"),
      timeoutMs,
      "sgt_rpc_timeout",
    );
    return response.value;
  }

  return async function verifySgtOwnership(walletAddress) {
    const owner = new PublicKey(walletAddress);
    const tokenAccounts = await fetchTokenAccounts(walletAddress, owner);
    const mintAddresses = [...new Set(tokenAccounts.flatMap(({ account }) => {
      const info = account.data?.parsed?.info;
      const tokenAmount = info?.tokenAmount;
      if (info?.owner !== walletAddress || tokenAmount?.amount !== "1" || tokenAmount?.decimals !== 0) {
        return [];
      }
      return typeof info.mint === "string" ? [info.mint] : [];
    }))];

    for (let offset = 0; offset < mintAddresses.length; offset += 100) {
      const batch = mintAddresses.slice(offset, offset + 100).map((address) => new PublicKey(address));
      const infos = await withTimeout(connection.getMultipleAccountsInfo(batch, "confirmed"), timeoutMs, "sgt_rpc_timeout");
      for (let index = 0; index < infos.length; index += 1) {
        const info = infos[index];
        if (!info || !info.owner.equals(TOKEN_2022_PROGRAM_ID)) continue;
        try {
          const mintAddress = batch[index];
          const mint = unpackMint(mintAddress, info, TOKEN_2022_PROGRAM_ID);
          const metadata = getMetadataPointerState(mint);
          const member = getTokenGroupMemberState(mint);
          const candidate = {
            ownerProgram: info.owner.toBase58(),
            decimals: mint.decimals,
            supply: mint.supply.toString(),
            mintAuthority: mint.mintAuthority?.toBase58() ?? null,
            metadataAuthority: metadata?.authority?.toBase58() ?? null,
            metadataAddress: metadata?.metadataAddress?.toBase58() ?? null,
            groupAddress: member?.group?.toBase58() ?? null,
          };
          if (isAuthenticSgtMint(candidate)) return mintAddress.toBase58();
        } catch {
          // Unpack failures are rejected candidates, never eligibility fallbacks.
        }
      }
    }
    return null;
  };
}

function isEligibleSeekerPassAsset(asset, walletAddress) {
  if (!asset || typeof asset !== "object") return false;
  if (asset.burnt === true || asset.compression?.compressed !== true) return false;
  if (asset.compression?.tree !== SEEKER_PASS_TREE) return false;
  if (asset.ownership?.owner !== walletAddress || asset.ownership?.ownership_model !== "single") return false;
  const grouped = Array.isArray(asset.grouping) && asset.grouping.some((group) =>
    group?.group_key === "collection" && group?.group_value === SEEKER_PASS_COLLECTION);
  const creator = Array.isArray(asset.creators) && asset.creators.some((item) =>
    item?.address === SEEKER_PASS_VERIFIED_CREATOR && item?.verified === true);
  if (!grouped || !creator) return false;
  try {
    new PublicKey(asset.id);
    return true;
  } catch {
    return false;
  }
}

export function createMainnetSeekerPassVerifier({
  rpcUrl,
  timeoutMs = RPC_TIMEOUT_MS,
  env = process.env,
} = {}) {
  const endpoints = seekerPassDasEndpoints(rpcUrl, env);
  if (endpoints.length === 0) {
    fail(500, "missing_rpc_configuration", "A supported Seeker Pass DAS RPC URL is required");
  }
  return async function verifySeekerPassOwnership(walletAddress) {
    const owner = new PublicKey(walletAddress).toBase58();
    const results = await Promise.allSettled(
      endpoints.map((endpoint) => fetchSeekerPassAssets(endpoint, owner, timeoutMs)),
    );
    const validResults = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    if (validResults.length === 0) {
      fail(503, "seeker_pass_rpc_unavailable", "Seeker Pass verification is temporarily unavailable");
    }
    const asset = validResults
      .flat()
      .find((item) => isEligibleSeekerPassAsset(item, owner));
    if (!asset) return null;
    return {
      assetId: new PublicKey(asset.id).toBase58(),
      tree: SEEKER_PASS_TREE,
      leafId: Number.isSafeInteger(Number(asset.compression?.leaf_id)) ? Number(asset.compression.leaf_id) : null,
    };
  };
}

function luckyMeNftImage(asset) {
  const direct = asset?.content?.links?.image;
  if (typeof direct === "string" && /^https:\/\//i.test(direct)) return direct;
  const file = asset?.content?.files?.find((item) =>
    typeof item?.uri === "string" && /^https:\/\//i.test(item.uri) &&
    (!item?.mime || String(item.mime).startsWith("image/")));
  return file?.uri ?? null;
}

function isEligibleLuckyMeNftAsset(asset, walletAddress, collection) {
  if (!asset || typeof asset !== "object" || asset.burnt === true) return false;
  if (asset.ownership?.owner !== walletAddress || asset.ownership?.ownership_model !== "single") return false;
  if (collection.tree && asset.compression?.tree !== collection.tree) return false;
  const grouped = Array.isArray(asset.grouping) && asset.grouping.some((group) =>
    group?.group_key === "collection" && group?.group_value === collection.collection);
  const creator = Array.isArray(asset.creators) && asset.creators.some((item) =>
    item?.address === collection.verifiedCreator && item?.verified === true);
  if (!grouped || !creator) return false;
  try {
    new PublicKey(asset.id);
    return true;
  } catch {
    return false;
  }
}

export function createMainnetLuckyMeNftVerifier({
  rpcUrl,
  timeoutMs = RPC_TIMEOUT_MS,
  env = process.env,
  collections = LUCKYME_NFT_COLLECTIONS,
} = {}) {
  const endpoints = seekerPassDasEndpoints(rpcUrl, env);
  if (endpoints.length === 0) {
    fail(500, "missing_rpc_configuration", "A supported LuckyMe NFT DAS RPC URL is required");
  }
  return async function listLuckyMeNfts(walletAddress) {
    const owner = new PublicKey(walletAddress).toBase58();
    const requests = collections.flatMap((collection) =>
      endpoints.map(async (endpoint) => ({
        collection,
        assets: await fetchSeekerPassAssets(endpoint, owner, timeoutMs, collection.collection),
      })));
    const results = await Promise.allSettled(requests);
    const fulfilled = results
      .filter((result) => result.status === "fulfilled")
      .map((result) => result.value);
    if (fulfilled.length === 0) {
      fail(503, "luckyme_nft_rpc_unavailable", "LuckyMe NFT verification is temporarily unavailable");
    }
    const seen = new Set();
    const assets = [];
    for (const { collection, assets: candidates } of fulfilled) {
      for (const asset of candidates) {
        if (!isEligibleLuckyMeNftAsset(asset, owner, collection) || seen.has(asset.id)) continue;
        seen.add(asset.id);
        assets.push({
          assetId: new PublicKey(asset.id).toBase58(),
          name: String(asset?.content?.metadata?.name ?? collection.name).slice(0, 120),
          image: luckyMeNftImage(asset),
          collectionId: collection.id,
          collectionName: collection.name,
          collectionAddress: collection.collection,
          compressed: asset.compression?.compressed === true,
          tree: typeof asset.compression?.tree === "string" ? asset.compression.tree : null,
          leafId: Number.isSafeInteger(Number(asset.compression?.leaf_id))
            ? Number(asset.compression.leaf_id)
            : null,
        });
      }
    }
    return {
      wallet: owner,
      collections: collections.map(({ id, name, collection }) => ({
        id,
        name,
        address: collection,
      })),
      assets,
    };
  };
}

function seekerPassDasEndpoints(explicitRpcUrl, env) {
  const configured = [
    explicitRpcUrl,
    env.SEEKER_PASS_DAS_RPC_URL,
    ...String(env.SEEKER_PASS_DAS_RPC_URLS ?? "").split(/[\n,]/),
    env.LUCKYME_RPC_QUICKNODE_DAS_URL,
    env.LUCKYME_RPC_SHYFT_URL,
  ];
  const seen = new Set();
  return configured.flatMap((rawUrl) => {
    const endpoint = String(rawUrl ?? "").trim();
    if (!endpoint || seen.has(endpoint)) return [];
    assertMainnetRpcUrl(endpoint);
    const hostname = new URL(endpoint).hostname.toLowerCase();
    const supported = ["helius-rpc.com", "quiknode.pro", "shyft.to"]
      .some((suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`));
    if (!supported) return [];
    seen.add(endpoint);
    return [endpoint];
  });
}

async function fetchSeekerPassAssets(
  endpoint,
  owner,
  timeoutMs,
  collectionAddress = SEEKER_PASS_COLLECTION,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `seeker-pass-${randomBytes(6).toString("hex")}`,
        method: "searchAssets",
        params: {
          ownerAddress: owner,
          grouping: ["collection", collectionAddress],
          page: 1,
          limit: 10,
        },
      }),
    });
    if (!response.ok) throw new Error("DAS HTTP request failed");
    const data = await response.json().catch(() => null);
    if (data?.error || !Array.isArray(data?.result?.items)) {
      throw new Error("DAS response was invalid");
    }
    return data.result.items;
  } finally {
    clearTimeout(timer);
  }
}

async function promotionRpc(endpoint, method, params, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `seeker-pass-draw-${randomBytes(6).toString("hex")}`,
        method,
        params,
      }),
    });
    if (!response.ok) fail(503, "promotion_rpc_unavailable", "Promotion randomness RPC request failed");
    const payload = await response.json().catch(() => null);
    if (!payload || payload.error) {
      if (method === "getBlock" && [-32004, -32007, -32009].includes(Number(payload?.error?.code))) return null;
      fail(503, "promotion_rpc_unavailable", "Promotion randomness RPC response was invalid");
    }
    return payload.result;
  } catch (error) {
    if (error instanceof ReferralHttpError) throw error;
    fail(503, "promotion_rpc_unavailable", "Promotion randomness RPC is temporarily unavailable");
  } finally {
    clearTimeout(timer);
  }
}

export function createMainnetPromotionRandomnessProvider({ rpcUrl, timeoutMs = RPC_TIMEOUT_MS } = {}) {
  const endpoint = rpcUrl ?? process.env.SEEKER_PASS_RANDOMNESS_RPC_URL ??
    process.env.ANCHOR_PROVIDER_URL;
  if (!endpoint) fail(500, "missing_rpc_configuration", "SEEKER_PASS_RANDOMNESS_RPC_URL is required");
  assertMainnetRpcUrl(endpoint);
  return {
    async currentFinalizedSlot() {
      const slot = Number(await promotionRpc(endpoint, "getSlot", [{ commitment: "finalized" }], timeoutMs));
      if (!Number.isSafeInteger(slot) || slot < 1) {
        fail(503, "promotion_rpc_invalid", "Promotion randomness slot was invalid");
      }
      return slot;
    },
    async finalizedBlockAtOrAfter(targetSlot) {
      const currentSlot = await this.currentFinalizedSlot();
      if (currentSlot < targetSlot) return null;
      const lastCandidate = Math.min(currentSlot, targetSlot + 64);
      for (let slot = targetSlot; slot <= lastCandidate; slot += 1) {
        const block = await promotionRpc(endpoint, "getBlock", [slot, {
          commitment: "finalized",
          transactionDetails: "none",
          rewards: false,
          maxSupportedTransactionVersion: 0,
        }], timeoutMs);
        if (!block) continue;
        try {
          new PublicKey(block.blockhash);
        } catch {
          fail(503, "promotion_rpc_invalid", "Promotion randomness blockhash was invalid");
        }
        return {
          slot,
          blockhash: block.blockhash,
          blockTime: Number.isSafeInteger(Number(block.blockTime)) ? Number(block.blockTime) : null,
        };
      }
      return null;
    },
  };
}

export function seekerPassEntryCommitment(entries) {
  const lines = entries.map((entry, index) => [
    index + 1,
    Number(entry.id),
    new PublicKey(entry.wallet).toBase58(),
    new PublicKey(entry.asset_id ?? entry.assetId).toBase58(),
  ].join(":"));
  return sha256(`${SEEKER_PASS_CAMPAIGN_ID}\n${lines.join("\n")}`);
}

export function selectSeekerPassWinnerIndexes(randomnessHex, entryCount, winnerCount = SEEKER_PASS_WINNER_COUNT) {
  if (!/^[a-f0-9]{64}$/.test(randomnessHex)) throw new Error("randomnessHex must contain 32 bytes");
  if (!Number.isSafeInteger(entryCount) || entryCount < winnerCount || winnerCount < 1) {
    throw new Error("entryCount and winnerCount are invalid");
  }
  const range = BigInt(entryCount);
  const space = 1n << 256n;
  const unbiasedLimit = space - (space % range);
  const selected = [];
  const used = new Set();
  for (let counter = 0; selected.length < winnerCount; counter += 1) {
    const digest = createHash("sha256")
      .update(Buffer.from(randomnessHex, "hex"))
      .update("luckyme-seeker-pass-winner-v1")
      .update(Buffer.from(String(counter)))
      .digest();
    const value = BigInt(`0x${digest.toString("hex")}`);
    if (value >= unbiasedLimit) continue;
    const index = Number(value % range);
    if (used.has(index)) continue;
    used.add(index);
    selected.push(index);
  }
  return selected;
}

function defaultLogger(event, details) {
  console.info(`[seeker-referral] ${event}`, details);
}

export function createSeekerReferralService({
  dbPath = process.env.SEEKER_REFERRAL_DB_PATH ?? ":memory:",
  domain = process.env.SEEKER_SIWS_DOMAIN ?? DEFAULT_DOMAIN,
  uri = process.env.SEEKER_SIWS_URI ?? DEFAULT_URI,
  testMode = process.env.REFERRAL_TEST_MODE === "true",
  sgtVerifier,
  clock = Date.now,
  logger = defaultLogger,
  sessionTtlMs = SESSION_TTL_MS,
  nonceTtlMs = NONCE_TTL_MS,
  settlementArchivePath = process.env.LUCKYME_SETTLEMENT_ARCHIVE_PATH,
  appAnalyticsEnabled = process.env.APP_ANALYTICS_ENABLED === "true",
  appAnalyticsHashKey = process.env.APP_ANALYTICS_HASH_KEY ?? "",
  seekerPassVerifier,
  luckyMeNftVerifier,
  seekerPassPromotionEnabled = process.env.SEEKER_PASS_PROMOTION_ENABLED === "true",
  promotionRandomnessProvider,
} = {}) {
  if (domain !== DEFAULT_DOMAIN || uri !== DEFAULT_URI) {
    if (process.env.NODE_ENV === "production") {
      fail(500, "invalid_siws_configuration", "Production SIWS domain or URI is invalid");
    }
  }
  if (appAnalyticsEnabled && process.env.NODE_ENV === "production" && appAnalyticsHashKey.length < 32) {
    fail(500, "invalid_analytics_configuration", "APP_ANALYTICS_HASH_KEY must contain at least 32 characters");
  }
  const db = new DatabaseSync(dbPath);
  db.exec(readFileSync(new URL("../migrations/001_seeker_referral.sql", import.meta.url), "utf8"));
  migrateReferralBindingStatuses(db);
  const createdAt = nowIso(clock);
  const season = testMode
    ? {
        id: REFERRAL_SEASON_ID,
        name: REFERRAL_SEASON_NAME,
        closesAt: REFERRAL_SEASON_CLOSES_AT,
        testOnly: true,
      }
    : productionSeason(clock);
  db.prepare(`
    INSERT INTO referral_seasons (id, name, closes_at, test_only, created_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      closes_at = excluded.closes_at,
      test_only = excluded.test_only
  `).run(season.id, season.name, season.closesAt, season.testOnly ? 1 : 0, createdAt);

  db.prepare(`
    INSERT INTO promotions
      (campaign_id, name, status, entry_threshold, winner_count, prize_lamports,
       collection_address, tree_address, verified_creator, funded, payout_enabled, created_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?, ?, ?, 0, 0, ?)
    ON CONFLICT(campaign_id) DO UPDATE SET
      name = excluded.name,
      entry_threshold = excluded.entry_threshold,
      winner_count = excluded.winner_count,
      prize_lamports = excluded.prize_lamports,
      collection_address = excluded.collection_address,
      tree_address = excluded.tree_address,
      verified_creator = excluded.verified_creator
  `).run(
    SEEKER_PASS_CAMPAIGN_ID,
    SEEKER_PASS_CAMPAIGN_NAME,
    SEEKER_PASS_ENTRY_THRESHOLD,
    SEEKER_PASS_WINNER_COUNT,
    SEEKER_PASS_PRIZE_LAMPORTS,
    SEEKER_PASS_COLLECTION,
    SEEKER_PASS_TREE,
    SEEKER_PASS_VERIFIED_CREATOR,
    createdAt,
  );

  const verifySgt = sgtVerifier ?? createMainnetSgtVerifier({});
  let verifySeekerPass = seekerPassVerifier;
  let listVerifiedLuckyMeNfts = luckyMeNftVerifier;
  let promotionRandomness = promotionRandomnessProvider;
  let promotionAdvancePromise = null;
  const rateBuckets = new Map();

  function qualificationFor(row) {
    const activityDates = db.prepare(`
      SELECT activity_date FROM referral_activity_days
      WHERE sgt_mint = ? ORDER BY activity_date ASC
    `).all(row.sgt_mint).map((item) => item.activity_date);
    let settlementArchive = [];
    try {
      settlementArchive = readSettlementArchive(settlementArchivePath);
    } catch {
      settlementArchive = [];
    }
    const wallets = db.prepare(`
      SELECT wallet FROM seeker_identity_wallets
      WHERE sgt_mint = ? ORDER BY first_verified_at ASC
    `).all(row.sgt_mint).map((item) => item.wallet);
    return referralQualificationProgress({
      wallet: row.current_wallet,
      wallets,
      settlementArchive,
      activityDates,
    });
  }

  function refreshReferralQualifications() {
    if (testMode) return { qualified: 0 };
    const pending = db.prepare(`
      SELECT b.id, b.referrer_sgt_mint, b.referred_sgt_mint,
             i.current_wallet, i.sgt_mint
      FROM referral_bindings b
      JOIN seeker_identities i ON i.sgt_mint = b.referred_sgt_mint
      WHERE b.status = 'pending' AND i.status = 'verified'
      ORDER BY b.bound_at ASC
    `).all();
    let qualified = 0;
    for (const binding of pending) {
      const progress = qualificationFor(binding);
      if (!progress.eligible) continue;
      const timestamp = nowIso(clock);
      inTransaction(db, () => {
        const update = db.prepare(`
          UPDATE referral_bindings SET status = 'qualified', qualified_at = ?
          WHERE id = ? AND status = 'pending'
        `).run(timestamp, binding.id);
        if (update.changes !== 1) return;
        db.prepare(`
          UPDATE referral_profiles SET points = points + 1, updated_at = ?
          WHERE sgt_mint = ?
        `).run(timestamp, binding.referrer_sgt_mint);
        db.prepare(`
          INSERT OR IGNORE INTO referral_events
            (idempotency_key, event_type, referrer_sgt_mint, referred_sgt_mint, season_id, metadata, created_at)
          VALUES (?, 'qualified_referral', ?, ?, ?, ?, ?)
        `).run(
          `qualified:${binding.id}`,
          binding.referrer_sgt_mint,
          binding.referred_sgt_mint,
          season.id,
          JSON.stringify({ progress }),
          timestamp,
        );
        db.prepare(`
          INSERT INTO referral_audit_log
            (actor, action, target, new_value, reason, created_at)
          VALUES ('qualification-engine', 'qualified_referral', ?, ?,
                  'three settled rounds on three days and seven active days', ?)
        `).run(mask(binding.referred_sgt_mint), JSON.stringify({ progress }), timestamp);
        qualified += 1;
      });
    }
    return { qualified };
  }

  function rateLimit(scope, key, max, windowMs) {
    const cleanKey = `${scope}:${sha256(String(key)).slice(0, 24)}`;
    const now = clock();
    const bucket = rateBuckets.get(cleanKey);
    if (!bucket || bucket.resetAt <= now) {
      rateBuckets.set(cleanKey, { count: 1, resetAt: now + windowMs });
      return;
    }
    bucket.count += 1;
    if (bucket.count > max) fail(429, "rate_limited", "Too many requests");
  }

  function purgeExpired() {
    const now = nowIso(clock);
    db.prepare("DELETE FROM siws_nonces WHERE expires_at < ? AND consumed_at IS NOT NULL").run(now);
    db.prepare("DELETE FROM referral_sessions WHERE expires_at < ? OR revoked_at IS NOT NULL").run(now);
  }

  function issueNonce({ ip = "unknown" } = {}) {
    rateLimit("nonce-ip", ip, 20, 10 * 60_000);
    purgeExpired();
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = nowIso(clock);
    const expirationTime = new Date(clock() + nonceTtlMs).toISOString();
    db.prepare(`
      INSERT INTO siws_nonces
        (nonce_hash, domain, uri, issued_at, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sha256(nonce), domain, uri, issuedAt, expirationTime, issuedAt);
    return {
      payload: {
        domain,
        statement: "Sign in to verify Seeker ownership for LuckyMe Referral Test",
        uri,
        version: "1",
        chainId: "mainnet",
        nonce,
        issuedAt,
        expirationTime,
        requestId: randomBytes(12).toString("hex"),
      },
      expiresAt: expirationTime,
    };
  }

  function seekerPassPromotionStatus({ includeWinnerWallets = false } = {}) {
    const campaign = db.prepare("SELECT * FROM promotions WHERE campaign_id = ?").get(SEEKER_PASS_CAMPAIGN_ID);
    const entryCount = Number(db.prepare(`
      SELECT COUNT(*) AS count FROM promotion_entries WHERE campaign_id = ?
    `).get(SEEKER_PASS_CAMPAIGN_ID).count ?? 0);
    const winners = db.prepare(`
      SELECT rank, wallet, asset_id, prize_lamports, ownership_status, payout_status, payout_signature
      FROM promotion_winners WHERE campaign_id = ? ORDER BY rank ASC
    `).all(SEEKER_PASS_CAMPAIGN_ID).map((winner) => ({
      rank: Number(winner.rank),
      wallet: includeWinnerWallets ? winner.wallet : mask(winner.wallet),
      assetId: includeWinnerWallets ? winner.asset_id : mask(winner.asset_id),
      prizeLamports: String(winner.prize_lamports),
      prizeSol: Number(winner.prize_lamports) / 1_000_000_000,
      ownershipStatus: winner.ownership_status,
      payoutStatus: winner.payout_status,
      payoutSignature: includeWinnerWallets ? winner.payout_signature : null,
    }));
    return {
      campaignId: campaign.campaign_id,
      name: campaign.name,
      enabled: seekerPassPromotionEnabled,
      status: campaign.status,
      entryCount,
      entryThreshold: Number(campaign.entry_threshold),
      entriesRemaining: Math.max(0, Number(campaign.entry_threshold) - entryCount),
      progressPercent: Math.min(100, Number(((entryCount / Number(campaign.entry_threshold)) * 100).toFixed(1))),
      winnerCount: Number(campaign.winner_count),
      prizeLamports: String(campaign.prize_lamports),
      prizeSol: Number(campaign.prize_lamports) / 1_000_000_000,
      prizes: SEEKER_PASS_PRIZES_LAMPORTS.map((amount, index) => ({
        rank: index + 1,
        prizeLamports: String(amount),
        prizeSol: amount / 1_000_000_000,
      })),
      funded: campaign.funded === 1,
      payoutEnabled: campaign.payout_enabled === 1,
      payoutState: campaign.status === "paid" ? "paid" : campaign.funded === 1 ? "funded_locked" : "not_funded",
      frozenAt: campaign.frozen_at,
      entryCommitment: campaign.entry_commitment,
      targetSlot: campaign.target_slot === null ? null : Number(campaign.target_slot),
      resolvedSlot: campaign.resolved_slot === null ? null : Number(campaign.resolved_slot),
      randomnessBlockhash: campaign.randomness_blockhash,
      randomnessHash: campaign.randomness_hash,
      drawnAt: campaign.drawn_at,
      winners,
      collection: SEEKER_PASS_COLLECTION,
      tree: SEEKER_PASS_TREE,
      entryIsFree: true,
      entryRequiresTransaction: false,
    };
  }

  function registerSeekerPassEntry(wallet, pass) {
    const timestamp = nowIso(clock);
    return inTransaction(db, () => {
      const campaign = db.prepare("SELECT status, entry_threshold FROM promotions WHERE campaign_id = ?")
        .get(SEEKER_PASS_CAMPAIGN_ID);
      const byWallet = db.prepare(`
        SELECT id, wallet, asset_id FROM promotion_entries WHERE campaign_id = ? AND wallet = ?
      `).get(SEEKER_PASS_CAMPAIGN_ID, wallet);
      const byAsset = db.prepare(`
        SELECT id, wallet, asset_id FROM promotion_entries WHERE campaign_id = ? AND asset_id = ?
      `).get(SEEKER_PASS_CAMPAIGN_ID, pass.assetId);
      const existing = byWallet ?? byAsset;
      if (existing) {
        if (existing.wallet !== wallet || existing.asset_id !== pass.assetId) {
          fail(409, "promotion_entry_conflict", "This wallet or Seeker Pass is already registered to another entry");
        }
        const position = Number(db.prepare(`
          SELECT COUNT(*) AS count FROM promotion_entries WHERE campaign_id = ? AND id <= ?
        `).get(SEEKER_PASS_CAMPAIGN_ID, existing.id).count);
        return { registered: true, alreadyRegistered: true, entryNumber: position, campaignFrozen: campaign.status !== "open" };
      }
      if (campaign.status !== "open") {
        fail(409, "promotion_closed", "The promotion entry threshold has already been reached");
      }
      const before = Number(db.prepare(`
        SELECT COUNT(*) AS count FROM promotion_entries WHERE campaign_id = ?
      `).get(SEEKER_PASS_CAMPAIGN_ID).count ?? 0);
      if (before >= Number(campaign.entry_threshold)) {
        fail(409, "promotion_closed", "The promotion entry threshold has already been reached");
      }
      const result = db.prepare(`
        INSERT INTO promotion_entries
          (campaign_id, wallet, asset_id, tree_address, leaf_id, verified_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(SEEKER_PASS_CAMPAIGN_ID, wallet, pass.assetId, pass.tree, pass.leafId, timestamp);
      const entryNumber = before + 1;
      let campaignFrozen = false;
      if (entryNumber === Number(campaign.entry_threshold)) {
        const entries = db.prepare(`
          SELECT id, wallet, asset_id FROM promotion_entries
          WHERE campaign_id = ? ORDER BY id ASC
        `).all(SEEKER_PASS_CAMPAIGN_ID);
        const commitment = seekerPassEntryCommitment(entries);
        const update = db.prepare(`
          UPDATE promotions SET status = 'commitment_frozen', frozen_at = ?, entry_commitment = ?
          WHERE campaign_id = ? AND status = 'open'
        `).run(timestamp, commitment, SEEKER_PASS_CAMPAIGN_ID);
        if (update.changes !== 1) fail(409, "promotion_closed", "The promotion was frozen by another request");
        campaignFrozen = true;
      }
      return {
        registered: true,
        alreadyRegistered: false,
        entryId: Number(result.lastInsertRowid),
        entryNumber,
        campaignFrozen,
      };
    });
  }

  async function advanceSeekerPassPromotionOnce() {
    let campaign = db.prepare("SELECT * FROM promotions WHERE campaign_id = ?").get(SEEKER_PASS_CAMPAIGN_ID);
    if (!seekerPassPromotionEnabled || !["commitment_frozen", "randomness_pending"].includes(campaign.status)) {
      return seekerPassPromotionStatus();
    }
    promotionRandomness ??= createMainnetPromotionRandomnessProvider({});
    if (campaign.status === "commitment_frozen") {
      const currentSlot = await promotionRandomness.currentFinalizedSlot();
      const targetSlot = currentSlot + SEEKER_PASS_RANDOMNESS_SLOT_DELAY;
      inTransaction(db, () => {
        const update = db.prepare(`
          UPDATE promotions SET status = 'randomness_pending', target_slot = ?
          WHERE campaign_id = ? AND status = 'commitment_frozen' AND target_slot IS NULL
        `).run(targetSlot, SEEKER_PASS_CAMPAIGN_ID);
        if (update.changes !== 1) return;
        logger("seeker_pass_commitment_frozen", {
          campaignId: SEEKER_PASS_CAMPAIGN_ID,
          targetSlot,
          commitment: campaign.entry_commitment,
        });
      });
      campaign = db.prepare("SELECT * FROM promotions WHERE campaign_id = ?").get(SEEKER_PASS_CAMPAIGN_ID);
    }
    if (campaign.status !== "randomness_pending" || !Number.isSafeInteger(Number(campaign.target_slot))) {
      return seekerPassPromotionStatus();
    }
    const block = await promotionRandomness.finalizedBlockAtOrAfter(Number(campaign.target_slot));
    if (!block) return seekerPassPromotionStatus();
    inTransaction(db, () => {
      const current = db.prepare("SELECT * FROM promotions WHERE campaign_id = ?").get(SEEKER_PASS_CAMPAIGN_ID);
      if (current.status !== "randomness_pending" || Number(current.target_slot) !== Number(campaign.target_slot)) return;
      const entries = db.prepare(`
        SELECT id, wallet, asset_id FROM promotion_entries WHERE campaign_id = ? ORDER BY id ASC
      `).all(SEEKER_PASS_CAMPAIGN_ID);
      if (entries.length !== SEEKER_PASS_ENTRY_THRESHOLD) {
        fail(500, "promotion_entry_count_invalid", "Frozen promotion entry count is invalid");
      }
      const commitment = seekerPassEntryCommitment(entries);
      if (commitment !== current.entry_commitment) {
        fail(500, "promotion_commitment_mismatch", "Frozen promotion commitment does not match its entries");
      }
      const randomnessHash = sha256([
        SEEKER_PASS_CAMPAIGN_ID,
        commitment,
        block.slot,
        block.blockhash,
      ].join(":"));
      const indexes = selectSeekerPassWinnerIndexes(randomnessHash, entries.length, SEEKER_PASS_WINNER_COUNT);
      const created = nowIso(clock);
      const insert = db.prepare(`
        INSERT INTO promotion_winners
          (campaign_id, rank, entry_id, wallet, asset_id, prize_lamports,
           ownership_status, payout_status, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 'pending', 'locked_unfunded', ?)
      `);
      indexes.forEach((entryIndex, rankIndex) => {
        const entry = entries[entryIndex];
        insert.run(
          SEEKER_PASS_CAMPAIGN_ID,
          rankIndex + 1,
          entry.id,
          entry.wallet,
          entry.asset_id,
          SEEKER_PASS_PRIZES_LAMPORTS[rankIndex],
          created,
        );
      });
      db.prepare(`
        UPDATE promotions SET status = 'drawn_unfunded', resolved_slot = ?,
          randomness_blockhash = ?, randomness_hash = ?, drawn_at = ?
        WHERE campaign_id = ? AND status = 'randomness_pending'
      `).run(block.slot, block.blockhash, randomnessHash, created, SEEKER_PASS_CAMPAIGN_ID);
      logger("seeker_pass_draw_completed", {
        campaignId: SEEKER_PASS_CAMPAIGN_ID,
        resolvedSlot: block.slot,
        winnerCount: indexes.length,
        funded: false,
      });
    });
    return seekerPassPromotionStatus();
  }

  function advanceSeekerPassPromotion() {
    if (promotionAdvancePromise) return promotionAdvancePromise;
    promotionAdvancePromise = advanceSeekerPassPromotionOnce()
      .finally(() => { promotionAdvancePromise = null; });
    return promotionAdvancePromise;
  }

  function issueSeekerPassNonce({ ip = "unknown" } = {}) {
    rateLimit("seeker-pass-nonce-ip", ip, 20, 10 * 60_000);
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = nowIso(clock);
    const expirationTime = new Date(clock() + nonceTtlMs).toISOString();
    const requestId = randomBytes(12).toString("hex");
    const statement = seekerPassPromotionEnabled
      ? "Register this wallet once for the LuckyMe Seeker Pass 3 SOL promotion. This is not a transaction and does not authorize any transfer."
      : "Verify this wallet for the LuckyMe Seeker Pass eligibility test. This is not a transaction and does not authorize any transfer.";
    db.prepare(`
      INSERT INTO seeker_pass_nonces
        (nonce_hash, domain, uri, statement, issued_at, expires_at, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sha256(nonce), domain, uri, statement, issuedAt, expirationTime, requestId, issuedAt);
    return {
      payload: {
        domain,
        statement,
        uri,
        version: "1",
        chainId: "mainnet",
        nonce,
        issuedAt,
        expirationTime,
        requestId,
      },
      expiresAt: expirationTime,
      campaignId: SEEKER_PASS_CAMPAIGN_ID,
      testOnly: !seekerPassPromotionEnabled,
      promotion: seekerPassPromotionStatus(),
    };
  }

  function issueLuckyMeNftNonce({ ip = "unknown" } = {}) {
    rateLimit("luckyme-nft-nonce-ip", ip, 20, 10 * 60_000);
    const nonce = randomBytes(16).toString("hex");
    const issuedAt = nowIso(clock);
    const expirationTime = new Date(clock() + nonceTtlMs).toISOString();
    const requestId = randomBytes(12).toString("hex");
    const statement = "Verify this wallet to display its LuckyMe NFT collection. This is not a transaction and does not authorize any transfer.";
    db.prepare(`
      INSERT INTO seeker_pass_nonces
        (nonce_hash, domain, uri, statement, issued_at, expires_at, request_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(sha256(nonce), domain, uri, statement, issuedAt, expirationTime, requestId, issuedAt);
    return {
      payload: {
        domain,
        statement,
        uri,
        version: "1",
        chainId: "mainnet",
        nonce,
        issuedAt,
        expirationTime,
        requestId,
      },
      expiresAt: expirationTime,
      collections: LUCKYME_NFT_COLLECTIONS.map(({ id, name, collection }) => ({
        id,
        name,
        address: collection,
      })),
    };
  }

  function consumeSeekerPassNonce(payload, wallet) {
    return inTransaction(db, () => {
      const row = db.prepare("SELECT * FROM seeker_pass_nonces WHERE nonce_hash = ?").get(sha256(payload.nonce));
      if (!row) fail(401, "invalid_siws", "Eligibility nonce is unknown");
      if (row.consumed_at) fail(409, "nonce_reused", "Eligibility nonce was already used");
      if (Date.parse(row.expires_at) < clock()) fail(401, "nonce_expired", "Eligibility nonce has expired");
      if (row.domain !== payload.domain || row.uri !== payload.uri || row.statement !== payload.statement ||
          row.issued_at !== payload.issuedAt || row.expires_at !== payload.expirationTime ||
          row.request_id !== payload.requestId) {
        fail(401, "invalid_siws", "Signed eligibility message does not match the issued nonce");
      }
      const result = db.prepare(`
        UPDATE seeker_pass_nonces SET consumed_at = ?, wallet = ?
        WHERE nonce_hash = ? AND consumed_at IS NULL
      `).run(nowIso(clock), wallet, sha256(payload.nonce));
      if (result.changes !== 1) fail(409, "nonce_reused", "Eligibility nonce was already used");
    });
  }

  async function verifySeekerPassSiws({ payload, output, ip = "unknown" } = {}) {
    rateLimit("seeker-pass-verify-ip", ip, 30, 10 * 60_000);
    const input = validateSiwsPayload(payload);
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      fail(400, "invalid_siws", "SIWS output is invalid");
    }
    const publicKey = decodeBase64(output.publicKey, "publicKey", 32);
    const signature = decodeBase64(output.signature, "signature", 64);
    const signedMessage = decodeBase64(output.signedMessage, "signedMessage");
    if (signedMessage.length < 80 || signedMessage.length > 8_192) {
      fail(400, "invalid_siws", "Signed SIWS message has an invalid length");
    }
    const parsed = parseSignInMessage(signedMessage);
    let wallet;
    try {
      wallet = new PublicKey(parsed?.address);
    } catch {
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    if (!wallet.toBytes().every((byte, index) => byte === publicKey[index])) {
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    const walletAddress = wallet.toBase58();
    rateLimit("seeker-pass-wallet", walletAddress, 10, 10 * 60_000);
    const verified = verifySignIn({ ...input, address: walletAddress }, {
      account: { publicKey },
      signature,
      signedMessage,
    });
    if (!verified) fail(401, "invalid_siws", "Wallet ownership verification failed");
    consumeSeekerPassNonce(input, walletAddress);
    verifySeekerPass ??= createMainnetSeekerPassVerifier({});
    const pass = await withTimeout(
      Promise.resolve(verifySeekerPass(walletAddress)),
      RPC_TIMEOUT_MS,
      "seeker_pass_rpc_timeout",
    );
    const registration = pass && seekerPassPromotionEnabled
      ? registerSeekerPassEntry(walletAddress, pass)
      : { registered: false, alreadyRegistered: false, entryNumber: null, campaignFrozen: false };
    if (registration.campaignFrozen) {
      void advanceSeekerPassPromotion().catch((error) => logger("seeker_pass_draw_advance_failed", {
        campaignId: SEEKER_PASS_CAMPAIGN_ID,
        code: error?.code ?? "unknown",
      }));
    }
    logger(seekerPassPromotionEnabled ? "seeker_pass_registration_checked" : "seeker_pass_tested", {
      wallet: mask(walletAddress),
      eligible: Boolean(pass),
      assetId: pass?.assetId ? mask(pass.assetId) : null,
      registered: registration.registered,
      entryNumber: registration.entryNumber,
    });
    return {
      campaignId: SEEKER_PASS_CAMPAIGN_ID,
      testOnly: !seekerPassPromotionEnabled,
      registered: registration.registered,
      alreadyRegistered: registration.alreadyRegistered,
      entryNumber: registration.entryNumber,
      eligible: Boolean(pass),
      wallet: walletAddress,
      collection: SEEKER_PASS_COLLECTION,
      asset: pass ?? null,
      promotion: seekerPassPromotionStatus(),
      message: pass && registration.registered
        ? registration.alreadyRegistered
          ? `This LuckyMe Seeker Pass is already registered as entry #${registration.entryNumber}.`
          : `LuckyMe Seeker Pass verified and registered as entry #${registration.entryNumber}.`
        : pass
          ? "LuckyMe Seeker Pass ownership verified. Registration is not enabled in this build."
        : "No eligible LuckyMe Seeker Pass was found in this wallet.",
    };
  }

  async function verifyLuckyMeNftSiws({ payload, output, ip = "unknown" } = {}) {
    rateLimit("luckyme-nft-verify-ip", ip, 30, 10 * 60_000);
    const input = validateSiwsPayload(payload);
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      fail(400, "invalid_siws", "SIWS output is invalid");
    }
    const publicKey = decodeBase64(output.publicKey, "publicKey", 32);
    const signature = decodeBase64(output.signature, "signature", 64);
    const signedMessage = decodeBase64(output.signedMessage, "signedMessage");
    if (signedMessage.length < 80 || signedMessage.length > 8_192) {
      fail(400, "invalid_siws", "Signed SIWS message has an invalid length");
    }
    const parsed = parseSignInMessage(signedMessage);
    let wallet;
    try {
      wallet = new PublicKey(parsed?.address);
    } catch {
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    if (!wallet.toBytes().every((byte, index) => byte === publicKey[index])) {
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    const walletAddress = wallet.toBase58();
    rateLimit("luckyme-nft-wallet", walletAddress, 10, 10 * 60_000);
    const verified = verifySignIn({ ...input, address: walletAddress }, {
      account: { publicKey },
      signature,
      signedMessage,
    });
    if (!verified) fail(401, "invalid_siws", "Wallet ownership verification failed");
    consumeSeekerPassNonce(input, walletAddress);
    listVerifiedLuckyMeNfts ??= createMainnetLuckyMeNftVerifier({});
    const result = await withTimeout(
      Promise.resolve(listVerifiedLuckyMeNfts(walletAddress)),
      RPC_TIMEOUT_MS,
      "luckyme_nft_rpc_timeout",
    );
    logger("luckyme_nft_wallet_checked", {
      wallet: mask(walletAddress),
      assetCount: result.assets.length,
      collectionCount: result.collections.length,
    });
    return result;
  }

  function recordAppActivation({ installId, channel, platform, appVersion, versionCode } = {}, { ip = "unknown" } = {}) {
    if (!appAnalyticsEnabled) fail(404, "not_found", "Not found");
    rateLimit("app-activation-ip", ip, 30, 60 * 60_000);
    const normalizedInstallId = stringField(installId, "installId", { pattern: INSTALL_ID_RE });
    const normalizedChannel = stringField(channel, "channel", { max: 32 });
    const normalizedPlatform = stringField(platform, "platform", { max: 16 });
    const normalizedAppVersion = stringField(appVersion, "appVersion", { pattern: APP_VERSION_RE });
    const normalizedVersionCode = Number(versionCode);
    if (normalizedChannel !== "solana-dapp-store" || normalizedPlatform !== "android") {
      fail(400, "invalid_input", "channel or platform is invalid");
    }
    if (!Number.isSafeInteger(normalizedVersionCode) || normalizedVersionCode < 1 || normalizedVersionCode > 2_147_483_647) {
      fail(400, "invalid_input", "versionCode is invalid");
    }
    const hashKey = appAnalyticsHashKey || "luckyme-local-app-analytics-test-key";
    const installHash = createHmac("sha256", hashKey).update(normalizedInstallId).digest("hex");
    const timestamp = nowIso(clock);
    const activityDate = timestamp.slice(0, 10);
    const existing = db.prepare("SELECT first_seen_at FROM app_installations WHERE install_hash = ?").get(installHash);
    inTransaction(db, () => {
      db.prepare(`
        INSERT INTO app_installations
          (install_hash, channel, platform, app_version, version_code, first_seen_at, last_seen_at, launch_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1)
        ON CONFLICT(install_hash) DO UPDATE SET
          channel = excluded.channel,
          platform = excluded.platform,
          app_version = excluded.app_version,
          version_code = excluded.version_code,
          last_seen_at = excluded.last_seen_at,
          launch_count = app_installations.launch_count + 1
      `).run(
        installHash,
        normalizedChannel,
        normalizedPlatform,
        normalizedAppVersion,
        normalizedVersionCode,
        timestamp,
        timestamp,
      );
      db.prepare(`
        INSERT OR IGNORE INTO app_installation_activity_days
          (install_hash, activity_date, recorded_at)
        VALUES (?, ?, ?)
      `).run(installHash, activityDate, timestamp);
    });
    return {
      accepted: true,
      firstActivation: !existing,
      firstSeenAt: existing?.first_seen_at ?? timestamp,
    };
  }

  function validateSiwsPayload(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      fail(400, "invalid_siws", "SIWS payload is invalid");
    }
    const normalized = {
      domain: stringField(payload.domain, "domain"),
      statement: stringField(payload.statement, "statement"),
      uri: stringField(payload.uri, "uri"),
      version: stringField(payload.version, "version"),
      chainId: stringField(payload.chainId, "chainId"),
      nonce: stringField(payload.nonce, "nonce", { max: 128, pattern: /^[A-Za-z0-9]{8,128}$/ }),
      issuedAt: stringField(payload.issuedAt, "issuedAt"),
      expirationTime: stringField(payload.expirationTime, "expirationTime"),
      requestId: stringField(payload.requestId, "requestId", { max: 128 }),
    };
    if (normalized.domain !== domain || normalized.uri !== uri ||
        normalized.version !== "1" || normalized.chainId !== "mainnet") {
      fail(401, "invalid_siws", "SIWS domain, URI, version, or chain is invalid");
    }
    const issued = parseIso(normalized.issuedAt, "issuedAt");
    const expires = parseIso(normalized.expirationTime, "expirationTime");
    if (expires <= issued || expires - issued > nonceTtlMs + 1_000 || clock() > expires) {
      fail(401, "nonce_expired", "SIWS nonce has expired");
    }
    if (issued > clock() + 30_000) fail(401, "invalid_siws", "SIWS issued-at is in the future");
    return normalized;
  }

  function consumeNonce(payload, wallet) {
    return inTransaction(db, () => {
      const row = db.prepare("SELECT * FROM siws_nonces WHERE nonce_hash = ?").get(sha256(payload.nonce));
      if (!row) fail(401, "invalid_siws", "SIWS nonce is unknown");
      if (row.consumed_at) fail(409, "nonce_reused", "SIWS nonce was already used");
      if (Date.parse(row.expires_at) < clock()) fail(401, "nonce_expired", "SIWS nonce has expired");
      if (row.domain !== payload.domain || row.uri !== payload.uri ||
          row.issued_at !== payload.issuedAt || row.expires_at !== payload.expirationTime) {
        fail(401, "invalid_siws", "SIWS payload does not match the issued nonce");
      }
      const result = db.prepare(`
        UPDATE siws_nonces SET consumed_at = ?, wallet = ?
        WHERE nonce_hash = ? AND consumed_at IS NULL
      `).run(nowIso(clock), wallet, sha256(payload.nonce));
      if (result.changes !== 1) fail(409, "nonce_reused", "SIWS nonce was already used");
    });
  }

  function createSession(sgtMint, wallet) {
    const token = randomBytes(32).toString("base64url");
    const now = nowIso(clock);
    db.prepare(`
      INSERT INTO referral_sessions
        (token_hash, sgt_mint, wallet, expires_at, created_at, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(sha256(token), sgtMint, wallet, new Date(clock() + sessionTtlMs).toISOString(), now, now);
    return token;
  }

  function session(token) {
    stringField(token, "session token", { max: 256 });
    const row = db.prepare(`
      SELECT s.*, i.status AS identity_status, p.referral_code, p.status AS profile_status
      FROM referral_sessions s
      JOIN seeker_identities i ON i.sgt_mint = s.sgt_mint
      JOIN referral_profiles p ON p.sgt_mint = s.sgt_mint
      WHERE s.token_hash = ?
    `).get(sha256(token));
    if (!row || row.revoked_at || Date.parse(row.expires_at) <= clock() || row.identity_status !== "verified") {
      fail(401, "invalid_session", "Session is missing, expired, or revoked");
    }
    db.prepare("UPDATE referral_sessions SET last_seen_at = ? WHERE token_hash = ?")
      .run(nowIso(clock), sha256(token));
    return row;
  }

  function authenticate(token) {
    const auth = session(token);
    return {
      wallet: auth.wallet,
      sgtMint: auth.sgt_mint,
    };
  }

  function profileForSgt(sgtMint) {
    refreshReferralQualifications();
    const row = db.prepare(`
      SELECT i.sgt_mint, i.current_wallet, i.skr_domain, i.verified_at, i.last_verified_at,
             i.status, p.referral_code, p.points, p.status AS profile_status,
             p.season_id, p.created_at
      FROM seeker_identities i
      JOIN referral_profiles p ON p.sgt_mint = i.sgt_mint
      WHERE i.sgt_mint = ?
    `).get(sgtMint);
    if (!row) fail(404, "profile_not_found", "Referral profile was not found");
    const counts = db.prepare(`
      SELECT
        SUM(CASE WHEN status IN ('qualified_test', 'qualified') THEN 1 ELSE 0 END) AS qualified,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
        SUM(CASE WHEN status = 'invalidated' THEN 1 ELSE 0 END) AS invalidated
      FROM referral_bindings WHERE referrer_sgt_mint = ?
    `).get(sgtMint);
    const hasLuckyMeUsers = Boolean(db.prepare(`
      SELECT 1 FROM sqlite_master
      WHERE type = 'table' AND name = 'luckyme_users'
    `).get());
    const invitedRows = hasLuckyMeUsers
      ? db.prepare(`
          SELECT b.status, b.bound_at, b.qualified_at,
                 i.current_wallet, i.skr_domain,
                 u.username, u.display_name
          FROM referral_bindings b
          JOIN seeker_identities i ON i.sgt_mint = b.referred_sgt_mint
          LEFT JOIN luckyme_users u ON u.wallet = i.current_wallet
          WHERE b.referrer_sgt_mint = ?
          ORDER BY b.bound_at DESC
        `).all(sgtMint)
      : db.prepare(`
          SELECT b.status, b.bound_at, b.qualified_at,
                 i.current_wallet, i.skr_domain,
                 NULL username, NULL display_name
          FROM referral_bindings b
          JOIN seeker_identities i ON i.sgt_mint = b.referred_sgt_mint
          WHERE b.referrer_sgt_mint = ?
          ORDER BY b.bound_at DESC
        `).all(sgtMint);
    const qualification = qualificationFor(row);
    return {
      state: "VERIFIED",
      walletMasked: mask(row.current_wallet),
      skrDomain: row.skr_domain,
      sgtMintMasked: mask(row.sgt_mint),
      verifiedAt: row.last_verified_at,
      referralCode: row.referral_code,
      profileStatus: row.profile_status,
      season: {
        id: season.id,
        name: season.name,
        closesAt: season.closesAt,
        testOnly: season.testOnly,
      },
      stats: {
        qualifiedReferrals: Number(counts.qualified ?? 0),
        pendingReferrals: Number(counts.pending ?? 0),
        invalidatedReferrals: Number(counts.invalidated ?? 0),
        totalPoints: Number(row.points),
      },
      invitedUsers: invitedRows.map((invited) => ({
        username: invited.username ?? null,
        displayName: invited.display_name ?? null,
        walletMasked: mask(invited.current_wallet),
        skrDomain: invited.skr_domain ?? null,
        status: invited.status,
        accepted: invited.status === "qualified" || invited.status === "qualified_test",
        boundAt: invited.bound_at,
        qualifiedAt: invited.qualified_at ?? null,
      })),
      qualification,
      prizePreview: testMode ? "Fictitious test preview only" : "Up to 10,000 SKR distributed monthly",
      disclaimer: testMode
        ? "TEST DATA — NO SKR WILL BE DISTRIBUTED"
        : "Only verified SGT-to-SGT referrals that complete every published requirement are ranked.",
    };
  }

  async function verifySiws({ payload, output, hasPendingReferral, ip = "unknown" } = {}) {
    rateLimit("verify-ip", ip, 30, 10 * 60_000);
    const input = validateSiwsPayload(payload);
    if (!output || typeof output !== "object" || Array.isArray(output)) {
      fail(400, "invalid_siws", "SIWS output is invalid");
    }
    const publicKey = decodeBase64(output.publicKey, "publicKey", 32);
    const signature = decodeBase64(output.signature, "signature", 64);
    const signedMessage = decodeBase64(output.signedMessage, "signedMessage");
    if (signedMessage.length < 80 || signedMessage.length > 8_192) {
      fail(400, "invalid_siws", "Signed SIWS message has an invalid length");
    }
    const parsed = parseSignInMessage(signedMessage);
    if (!parsed?.address) {
      logger("siws_rejected", { reason: "message_parse_failed" });
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    let wallet;
    try {
      wallet = new PublicKey(parsed.address);
    } catch {
      logger("siws_rejected", { reason: "message_address_invalid" });
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    if (!wallet.toBytes().every((byte, index) => byte === publicKey[index])) {
      logger("siws_rejected", { reason: "wallet_address_mismatch" });
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    rateLimit("verify-wallet", wallet.toBase58(), 10, 10 * 60_000);
    const verified = verifySignIn({ ...input, address: wallet.toBase58() }, {
      account: { publicKey },
      signature,
      signedMessage,
    });
    if (!verified) {
      logger("siws_rejected", { reason: "signature_or_payload_mismatch", wallet: mask(wallet.toBase58()) });
      fail(401, "invalid_siws", "Wallet ownership verification failed");
    }
    consumeNonce(input, wallet.toBase58());

    let sgtMint;
    try {
      sgtMint = await withTimeout(Promise.resolve(verifySgt(wallet.toBase58())), RPC_TIMEOUT_MS, "sgt_rpc_timeout");
    } catch (error) {
      if (error instanceof ReferralHttpError) throw error;
      fail(503, "sgt_verification_unavailable", "Seeker verification is temporarily unavailable");
    }
    if (!sgtMint) fail(403, "no_sgt", "No valid Seeker Genesis Token was found in the connected wallet.");
    try {
      sgtMint = new PublicKey(sgtMint).toBase58();
    } catch {
      fail(503, "invalid_sgt_response", "Seeker verification returned an invalid mint");
    }
    rateLimit("verify-sgt", sgtMint, 10, 10 * 60_000);
    const pending = booleanField(hasPendingReferral, "hasPendingReferral");
    const verifiedAt = nowIso(clock);

    const result = inTransaction(db, () => {
      const identity = db.prepare("SELECT * FROM seeker_identities WHERE sgt_mint = ?").get(sgtMint);
      if (identity) {
        if (identity.status !== "verified") fail(403, "sgt_unavailable", "This Seeker Genesis Token is not active");
        if (identity.current_wallet !== wallet.toBase58()) {
          db.prepare(`
            UPDATE referral_sessions SET revoked_at = ?
            WHERE sgt_mint = ? AND revoked_at IS NULL
          `).run(verifiedAt, sgtMint);
        }
        db.prepare(`
          UPDATE seeker_identities SET current_wallet = ?, last_verified_at = ?, updated_at = ?
          WHERE sgt_mint = ?
        `).run(wallet.toBase58(), verifiedAt, verifiedAt, sgtMint);
      } else {
        db.prepare(`
          INSERT INTO seeker_identities
            (sgt_mint, current_wallet, verified_at, last_verified_at, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'verified', ?, ?)
        `).run(sgtMint, wallet.toBase58(), verifiedAt, verifiedAt, verifiedAt, verifiedAt);
      }

      db.prepare(`
        INSERT INTO seeker_identity_wallets
          (sgt_mint, wallet, first_verified_at, last_verified_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(sgt_mint, wallet) DO UPDATE SET
          last_verified_at = excluded.last_verified_at
      `).run(sgtMint, wallet.toBase58(), verifiedAt, verifiedAt);

      let profile = db.prepare("SELECT * FROM referral_profiles WHERE sgt_mint = ?").get(sgtMint);
      if (!profile) {
        const code = makeReferralCode(db);
        db.prepare(`
          INSERT INTO referral_profiles
            (sgt_mint, referral_code, season_id, points, status, created_at, updated_at)
          VALUES (?, ?, ?, 0, ?, ?, ?)
        `).run(sgtMint, code, season.id, pending ? "pending_activation" : "active", verifiedAt, verifiedAt);
        profile = db.prepare("SELECT * FROM referral_profiles WHERE sgt_mint = ?").get(sgtMint);
      } else if (profile.status === "pending_activation" && !pending) {
        const binding = db.prepare("SELECT 1 FROM referral_bindings WHERE referred_sgt_mint = ?").get(sgtMint);
        if (!binding) {
          db.prepare("UPDATE referral_profiles SET status = 'active', updated_at = ? WHERE sgt_mint = ?")
            .run(verifiedAt, sgtMint);
          profile = db.prepare("SELECT * FROM referral_profiles WHERE sgt_mint = ?").get(sgtMint);
        }
      }

      db.prepare(`
        INSERT INTO referral_audit_log
          (actor, action, target, previous_value, new_value, reason, created_at)
        VALUES ('siws', ?, ?, ?, ?, 'verified SIWS and authentic SGT ownership', ?)
      `).run(identity ? "identity_reverified" : "identity_created", mask(sgtMint),
        identity ? JSON.stringify({ wallet: mask(identity.current_wallet) }) : null,
        JSON.stringify({ wallet: mask(wallet.toBase58()) }), verifiedAt);
      return { profile, token: createSession(sgtMint, wallet.toBase58()) };
    });

    logger("siws_verified", { wallet: mask(wallet.toBase58()), sgtMint: mask(sgtMint) });
    return { sessionToken: result.token, expiresInSeconds: Math.floor(sessionTtlMs / 1_000), profile: profileForSgt(sgtMint) };
  }

  function getProfile(token) {
    const auth = session(token);
    return profileForSgt(auth.sgt_mint);
  }

  function recordActivity(token) {
    const auth = session(token);
    const timestamp = nowIso(clock);
    const activityDate = timestamp.slice(0, 10);
    db.prepare(`
      INSERT OR IGNORE INTO referral_activity_days (sgt_mint, activity_date, recorded_at)
      VALUES (?, ?, ?)
    `).run(auth.sgt_mint, activityDate, timestamp);
    return profileForSgt(auth.sgt_mint);
  }

  function previewReferral(token, referralCode) {
    session(token);
    const code = stringField(referralCode?.toUpperCase(), "referralCode", { pattern: CODE_RE });
    const row = db.prepare(`
      SELECT p.referral_code, i.current_wallet, p.status
      FROM referral_profiles p JOIN seeker_identities i ON i.sgt_mint = p.sgt_mint
      WHERE p.referral_code = ?
    `).get(code);
    if (!row || row.status !== "active") fail(404, "referral_code_not_found", "Referral code does not exist or is inactive");
    return { referralCode: row.referral_code, referrerMasked: mask(row.current_wallet) };
  }

  function wouldCreateCycle(referrerSgt, referredSgt) {
    return Boolean(db.prepare(`
      WITH RECURSIVE descendants(sgt) AS (
        SELECT referred_sgt_mint FROM referral_bindings WHERE referrer_sgt_mint = ?
        UNION
        SELECT b.referred_sgt_mint FROM referral_bindings b
        JOIN descendants d ON b.referrer_sgt_mint = d.sgt
      )
      SELECT 1 FROM descendants WHERE sgt = ? LIMIT 1
    `).get(referredSgt, referrerSgt));
  }

  function bindReferral(token, { referralCode, idempotencyKey } = {}) {
    const auth = session(token);
    const code = stringField(referralCode?.toUpperCase(), "referralCode", { pattern: CODE_RE });
    const key = stringField(idempotencyKey, "idempotencyKey", { pattern: IDEMPOTENCY_RE });
    rateLimit("bind-sgt", auth.sgt_mint, 15, 10 * 60_000);

    return inTransaction(db, () => {
      const priorEvent = db.prepare("SELECT * FROM referral_events WHERE idempotency_key = ?").get(key);
      if (priorEvent) {
        if (priorEvent.referred_sgt_mint !== auth.sgt_mint || priorEvent.event_type !== "referral_bound") {
          fail(409, "idempotency_conflict", "Idempotency key was already used for another operation");
        }
        return { binding: db.prepare("SELECT * FROM referral_bindings WHERE referred_sgt_mint = ?").get(auth.sgt_mint), idempotent: true };
      }
      const referrer = db.prepare(`
        SELECT p.*, i.status AS identity_status FROM referral_profiles p
        JOIN seeker_identities i ON i.sgt_mint = p.sgt_mint
        WHERE p.referral_code = ?
      `).get(code);
      if (!referrer) {
        fail(404, "referral_code_not_found", "Referral code does not exist or is inactive");
      }
      if (referrer.sgt_mint === auth.sgt_mint) fail(409, "self_referral", "Self-referral is not allowed");
      const existing = db.prepare("SELECT * FROM referral_bindings WHERE referred_sgt_mint = ?").get(auth.sgt_mint);
      if (existing) {
        if (existing.referrer_sgt_mint === referrer.sgt_mint && existing.referral_code === code) {
          return { binding: existing, idempotent: true };
        }
        fail(409, "sgt_already_bound", "This Seeker Genesis Token is already registered.");
      }
      const referredProfile = db.prepare("SELECT * FROM referral_profiles WHERE sgt_mint = ?").get(auth.sgt_mint);
      if (!referredProfile || referredProfile.status !== "pending_activation") {
        fail(409, "already_registered", "This Seeker identity was already activated before referral binding");
      }
      if (referrer.status !== "active" || referrer.identity_status !== "verified") {
        fail(404, "referral_code_not_found", "Referral code does not exist or is inactive");
      }
      if (wouldCreateCycle(referrer.sgt_mint, auth.sgt_mint)) {
        fail(409, "circular_referral", "Circular referrals are not allowed");
      }
      const timestamp = nowIso(clock);
      try {
        db.prepare(`
          INSERT INTO referral_bindings
            (referrer_sgt_mint, referred_sgt_mint, referral_code, status, bound_at)
          VALUES (?, ?, ?, 'pending', ?)
        `).run(referrer.sgt_mint, auth.sgt_mint, code, timestamp);
        db.prepare(`
          INSERT INTO referral_events
            (idempotency_key, event_type, referrer_sgt_mint, referred_sgt_mint, season_id, metadata, created_at)
          VALUES (?, 'referral_bound', ?, ?, ?, '{}', ?)
        `).run(key, referrer.sgt_mint, auth.sgt_mint, season.id, timestamp);
        db.prepare("UPDATE referral_profiles SET status = 'active', updated_at = ? WHERE sgt_mint = ?")
          .run(timestamp, auth.sgt_mint);
        db.prepare(`
          INSERT INTO referral_audit_log
            (actor, action, target, new_value, reason, created_at)
          VALUES (?, 'referral_bound', ?, ?, 'user-confirmed immutable referral binding', ?)
        `).run(mask(auth.sgt_mint), mask(auth.sgt_mint), JSON.stringify({ referralCode: code, referrer: mask(referrer.sgt_mint) }), timestamp);
      } catch (error) {
        if (sqliteConflict(error)) fail(409, "sgt_already_bound", "This Seeker Genesis Token is already registered.");
        throw error;
      }
      return { binding: db.prepare("SELECT * FROM referral_bindings WHERE referred_sgt_mint = ?").get(auth.sgt_mint), idempotent: false };
    });
  }

  function referralMe(token) {
    const auth = session(token);
    const profile = profileForSgt(auth.sgt_mint);
    const binding = db.prepare(`
      SELECT referral_code, status, bound_at, qualified_at
      FROM referral_bindings WHERE referred_sgt_mint = ?
    `).get(auth.sgt_mint) ?? null;
    return { ...profile, binding };
  }

  function activateProfile(token) {
    const auth = session(token);
    rateLimit("activate-sgt", auth.sgt_mint, 10, 10 * 60_000);
    return inTransaction(db, () => {
      const existingBinding = db.prepare("SELECT 1 FROM referral_bindings WHERE referred_sgt_mint = ?")
        .get(auth.sgt_mint);
      if (existingBinding) fail(409, "referral_already_bound", "The referral is already bound");
      const profile = db.prepare("SELECT status FROM referral_profiles WHERE sgt_mint = ?").get(auth.sgt_mint);
      if (!profile) fail(404, "profile_not_found", "Referral profile was not found");
      if (profile.status === "active") return { activated: true, idempotent: true };
      if (profile.status !== "pending_activation") fail(409, "profile_not_activatable", "Profile cannot be activated");
      const timestamp = nowIso(clock);
      db.prepare("UPDATE referral_profiles SET status = 'active', updated_at = ? WHERE sgt_mint = ?")
        .run(timestamp, auth.sgt_mint);
      db.prepare(`
        INSERT INTO referral_audit_log
          (actor, action, target, new_value, reason, created_at)
        VALUES (?, 'profile_activated_without_referral', ?, '{"status":"active"}', 'user explicitly continued without referral', ?)
      `).run(mask(auth.sgt_mint), mask(auth.sgt_mint), timestamp);
      return { activated: true, idempotent: false };
    });
  }

  function leaderboard(token) {
    session(token);
    refreshReferralQualifications();
    return {
      season: { id: season.id, name: season.name, closesAt: season.closesAt, testOnly: season.testOnly },
      disclaimer: testMode
        ? "TEST DATA — NO SKR WILL BE DISTRIBUTED"
        : "Only qualified referrals are included in the monthly ranking.",
      entries: db.prepare(`
        SELECT p.referral_code,
               (SELECT COUNT(*) FROM referral_events e
                WHERE e.referrer_sgt_mint = p.sgt_mint
                  AND e.season_id = ?
                  AND e.event_type IN ('qualified_test_referral', 'qualified_referral')) AS total_points,
               (SELECT COUNT(*) FROM referral_events e
                WHERE e.referrer_sgt_mint = p.sgt_mint
                  AND e.season_id = ?
                  AND e.event_type IN ('qualified_test_referral', 'qualified_referral')) AS qualified_referrals,
               (SELECT COUNT(*) FROM referral_bindings b
                WHERE b.referrer_sgt_mint = p.sgt_mint AND b.status = 'pending') AS pending_referrals,
               (SELECT COUNT(*) FROM referral_bindings b
                WHERE b.referrer_sgt_mint = p.sgt_mint AND b.status = 'invalidated') AS invalidated_referrals
        FROM referral_profiles p
        WHERE p.status = 'active'
        ORDER BY total_points DESC, p.created_at ASC
        LIMIT 100
      `).all(season.id, season.id).map((row, index) => ({
        rank: index + 1,
        referralCode: row.referral_code,
        qualifiedReferrals: Number(row.qualified_referrals ?? 0),
        pendingReferrals: Number(row.pending_referrals ?? 0),
        invalidatedReferrals: Number(row.invalidated_referrals ?? 0),
        totalPoints: Number(row.total_points),
        prizePreview: testMode ? "Fictitious test preview only" : "Monthly SKR ranking",
      })),
    };
  }

  function simulateQualification(token, { idempotencyKey } = {}) {
    if (!testMode) fail(404, "not_found", "Not found");
    const auth = session(token);
    const key = stringField(idempotencyKey, "idempotencyKey", { pattern: IDEMPOTENCY_RE });
    rateLimit("simulate-sgt", auth.sgt_mint, 10, 10 * 60_000);

    return inTransaction(db, () => {
      const prior = db.prepare("SELECT * FROM referral_events WHERE idempotency_key = ?").get(key);
      if (prior) return { qualified: true, idempotent: true };
      const binding = db.prepare(`
        SELECT * FROM referral_bindings
        WHERE status = 'pending' AND (referred_sgt_mint = ? OR referrer_sgt_mint = ?)
        ORDER BY bound_at ASC LIMIT 1
      `).get(auth.sgt_mint, auth.sgt_mint);
      if (!binding) fail(409, "no_pending_referral", "No pending referral can be qualified");
      const timestamp = nowIso(clock);
      const update = db.prepare(`
        UPDATE referral_bindings SET status = 'qualified_test', qualified_at = ?
        WHERE id = ? AND status = 'pending'
      `).run(timestamp, binding.id);
      if (update.changes !== 1) fail(409, "already_qualified", "Referral was already qualified");
      db.prepare("UPDATE referral_profiles SET points = points + 1, updated_at = ? WHERE sgt_mint = ?")
        .run(timestamp, binding.referrer_sgt_mint);
      db.prepare(`
        INSERT INTO referral_events
          (idempotency_key, event_type, referrer_sgt_mint, referred_sgt_mint, season_id, metadata, created_at)
        VALUES (?, 'qualified_test_referral', ?, ?, ?, '{"testOnly":true}', ?)
      `).run(key, binding.referrer_sgt_mint, binding.referred_sgt_mint, season.id, timestamp);
      db.prepare(`
        INSERT INTO referral_audit_log
          (actor, action, target, new_value, reason, created_at)
        VALUES ('test-mode', 'qualified_test_referral', ?, '{"points":1}', 'REFERRAL_TEST_MODE=true; no payment or transaction', ?)
      `).run(mask(binding.referred_sgt_mint), timestamp);
      return { qualified: true, idempotent: false, pointsAwarded: 1, testOnly: true };
    });
  }

  function logout(token) {
    const hash = sha256(stringField(token, "session token", { max: 256 }));
    db.prepare("UPDATE referral_sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL")
      .run(nowIso(clock), hash);
    return { loggedOut: true };
  }

  function close() {
    db.close();
  }

  return {
    advanceSeekerPassPromotion,
    appAnalyticsEnabled,
    activateProfile,
    bindReferral,
    close,
    authenticate,
    db,
    getProfile,
    issueLuckyMeNftNonce,
    issueSeekerPassNonce,
    issueNonce,
    leaderboard,
    logout,
    previewReferral,
    recordAppActivation,
    recordActivity,
    refreshReferralQualifications,
    referralMe,
    simulateQualification,
    seekerPassPromotionEnabled,
    seekerPassPromotionStatus,
    testMode,
    verifyLuckyMeNftSiws,
    verifySeekerPassSiws,
    verifySiws,
  };
}
