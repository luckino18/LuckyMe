import { createHash } from "node:crypto";
import { PublicKey } from "@solana/web3.js";

export const SGT_GROUP_ADDRESS = "GT22s89nU4iWFkNXj1Bw6uYhJJWDRPpShHt4Bk8f99Te";
export const SGT_MINT_AUTHORITY = "GT2zuHVaZQYZSyQMgJPLzvkmyztfyXg2NJunqFp4p3A4";
export const TOKEN_2022_PROGRAM_ADDRESS = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
export const DEFAULT_TREE_CAPACITY = 16_384;
export const DEFAULT_RECIPIENT_LIMIT = 10_000;
export const BASE_SIGNATURE_FEE_LAMPORTS = 5_000;

function nonNegativeInteger(value, field) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new Error(`${field} must be a non-negative integer`);
  }
  return number;
}

function address(value, field) {
  if (typeof value !== "string") throw new Error(`${field} must be a Solana address`);
  try {
    return new PublicKey(value).toBase58();
  } catch {
    throw new Error(`${field} must be a Solana address`);
  }
}

async function rpcRequest({ rpcUrl, method, params, fetchImpl }) {
  let response;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `luckyme-${method}`, method, params }),
    });
    if (response.status !== 429) break;
    if (attempt === 7) throw new Error(`${method} remained rate limited after retries`);
    await new Promise((resolve) => setTimeout(resolve, Math.min(10_000, (attempt + 1) * 1_000)));
  }
  if (!response.ok) throw new Error(`${method} failed with HTTP ${response.status}`);
  const payload = await response.json();
  if (payload?.error) throw new Error(`${method} failed: ${payload.error.message ?? "RPC error"}`);
  if (!payload?.result || typeof payload.result !== "object") {
    throw new Error(`${method} returned an invalid response`);
  }
  return payload.result;
}

async function readProgramAccountPages({ rpcUrl, fetchImpl, config, maxPages }) {
  const accounts = [];
  let paginationKey;
  let pagesRead = 0;
  let contextSlot = 0;
  do {
    const result = await rpcRequest({
      rpcUrl,
      fetchImpl,
      method: "getProgramAccountsV2",
      params: [TOKEN_2022_PROGRAM_ADDRESS, {
        ...config,
        withContext: true,
        ...(paginationKey ? { paginationKey } : {}),
      }],
    });
    const value = result.value ?? result;
    if (!Array.isArray(value.accounts)) throw new Error("getProgramAccountsV2 returned invalid accounts");
    accounts.push(...value.accounts);
    paginationKey = value.paginationKey ?? null;
    pagesRead += 1;
    contextSlot = Math.max(contextSlot, nonNegativeInteger(result.context?.slot, "context slot"));
    if (paginationKey && pagesRead >= maxPages) {
      throw new Error(`SGT discovery exceeded ${maxPages} pages`);
    }
  } while (paginationKey);
  return { accounts, pagesRead, contextSlot };
}

export async function discoverSgtHolders({
  rpcUrl,
  fetchImpl = fetch,
  groupAddress = SGT_GROUP_ADDRESS,
  pageSize = 100,
  maxPages = 100_000,
} = {}) {
  if (typeof rpcUrl !== "string" || !rpcUrl.startsWith("https://")) {
    throw new Error("A HTTPS Helius RPC URL is required");
  }
  address(groupAddress, "SGT group");
  const safePageSize = nonNegativeInteger(pageSize, "pageSize");
  if (safePageSize < 1 || safePageSize > 1_000) throw new Error("pageSize must be between 1 and 1000");

  const mintResult = await readProgramAccountPages({
    rpcUrl,
    fetchImpl,
    maxPages,
    config: {
      encoding: "base64",
      commitment: "finalized",
      limit: safePageSize,
      dataSlice: { offset: 0, length: 0 },
      filters: [
        { dataSize: 450 },
        { memcmp: { offset: 4, bytes: SGT_MINT_AUTHORITY } },
        { memcmp: { offset: 202, bytes: groupAddress } },
        { memcmp: { offset: 410, bytes: groupAddress } },
      ],
    },
  });
  const mints = new Map();
  for (const row of mintResult.accounts) {
    try {
      const mint = address(row.pubkey, "SGT mint");
      mints.set(new PublicKey(mint).toBuffer().toString("hex"), mint);
    } catch {
      // Invalid RPC rows are rejected rather than becoming campaign recipients.
    }
  }

  const tokenResult = await readProgramAccountPages({
    rpcUrl,
    fetchImpl,
    maxPages,
    config: {
      encoding: "base64",
      commitment: "finalized",
      limit: safePageSize,
      dataSlice: { offset: 0, length: 72 },
      filters: [{ dataSize: 170 }],
    },
  });
  const byWallet = new Map();
  let matchedTokenAccounts = 0;
  for (const row of tokenResult.accounts) {
    const encoded = row.account?.data?.[0];
    if (typeof encoded !== "string") continue;
    const data = Buffer.from(encoded, "base64");
    if (data.length < 72 || data.readBigUInt64LE(64) !== 1n) continue;
    const mint = mints.get(data.subarray(0, 32).toString("hex"));
    if (!mint) continue;
    const wallet = new PublicKey(data.subarray(32, 64)).toBase58();
    const holder = byWallet.get(wallet) ?? { wallet, sgtMints: [] };
    holder.sgtMints.push(mint);
    byWallet.set(wallet, holder);
    matchedTokenAccounts += 1;
  }
  const holders = [...byWallet.values()]
    .map((row) => ({ ...row, sgtMints: row.sgtMints.sort() }))
    .sort((a, b) => a.wallet.localeCompare(b.wallet));

  return {
    source: "helius-rpc:getProgramAccountsV2",
    groupAddress,
    lastIndexedSlot: Math.max(mintResult.contextSlot, tokenResult.contextSlot),
    reportedAssets: mints.size,
    validAssets: mints.size,
    matchedTokenAccounts,
    tokenAccountsScanned: tokenResult.accounts.length,
    uniqueWallets: holders.length,
    pagesRead: mintResult.pagesRead + tokenResult.pagesRead,
    holders,
  };
}

export function rankActiveHolders({ holders, activity, limit = DEFAULT_RECIPIENT_LIMIT } = {}) {
  if (!Array.isArray(holders) || !Array.isArray(activity)) throw new Error("holders and activity must be arrays");
  const cappedLimit = nonNegativeInteger(limit, "limit");
  const activityByWallet = new Map(activity.map((row) => {
    const wallet = address(row.wallet, "activity wallet");
    return [wallet, {
      activeDays: nonNegativeInteger(row.activeDays, "activeDays"),
      successfulSignerTransactions: nonNegativeInteger(
        row.successfulSignerTransactions,
        "successfulSignerTransactions",
      ),
      lastActiveSlot: nonNegativeInteger(row.lastActiveSlot, "lastActiveSlot"),
    }];
  }));

  return holders.map((holder) => {
    const wallet = address(holder.wallet, "holder wallet");
    const metrics = activityByWallet.get(wallet) ?? {
      activeDays: 0,
      successfulSignerTransactions: 0,
      lastActiveSlot: 0,
    };
    return {
      wallet,
      sgtMints: [...new Set(holder.sgtMints.map((mint) => address(mint, "SGT mint")))].sort(),
      ...metrics,
    };
  }).sort((a, b) =>
    b.activeDays - a.activeDays ||
    b.successfulSignerTransactions - a.successfulSignerTransactions ||
    b.lastActiveSlot - a.lastActiveSlot ||
    a.wallet.localeCompare(b.wallet)
  ).slice(0, cappedLimit).map((row, index) => ({ rank: index + 1, ...row }));
}

export function buildMintQueue(recipients, { mintsPerTransaction = 3 } = {}) {
  if (!Array.isArray(recipients)) throw new Error("recipients must be an array");
  const batchSize = nonNegativeInteger(mintsPerTransaction, "mintsPerTransaction");
  if (batchSize < 1 || batchSize > 3) throw new Error("mintsPerTransaction must be between 1 and 3");
  const wallets = [...new Set(recipients.map((row) => address(row.wallet, "recipient wallet")))];
  if (wallets.length > DEFAULT_TREE_CAPACITY) throw new Error("recipient count exceeds tree capacity");
  const transactions = [];
  for (let offset = 0; offset < wallets.length; offset += batchSize) {
    transactions.push({
      sequence: transactions.length + 1,
      recipients: wallets.slice(offset, offset + batchSize),
    });
  }
  const baseFeeLamports = transactions.length * BASE_SIGNATURE_FEE_LAMPORTS;
  return {
    mode: "dry-run-only",
    recipientCount: wallets.length,
    mintsPerTransaction: batchSize,
    transactionCount: transactions.length,
    baseFeeLamports,
    baseFeeSol: baseFeeLamports / 1_000_000_000,
    transactions,
  };
}

export function canonicalSnapshotHash(value) {
  const canonicalize = (item) => {
    if (Array.isArray(item)) return item.map(canonicalize);
    if (item && typeof item === "object") {
      return Object.fromEntries(
        Object.keys(item).sort().map((key) => [key, canonicalize(item[key])]),
      );
    }
    return item;
  };
  const canonical = JSON.stringify(canonicalize(value));
  return createHash("sha256").update(canonical).digest("hex");
}
