import { createHash, randomBytes } from "node:crypto";
import { createRequire } from "node:module";

import {
  fetchTreeConfig,
  findLeafAssetIdPda,
  mintV2,
  mplBubblegum,
} from "@metaplex-foundation/mpl-bubblegum";
import { fetchCollectionV1, mplCore } from "@metaplex-foundation/mpl-core";
import { createNoopSigner, publicKey, signerIdentity, some } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Connection, PublicKey, Transaction, TransactionInstruction, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

const require = createRequire(import.meta.url);
const { TldParser } = require("@onsol/tldparser");

export const ADMIN_CNFT_CLUSTER = "mainnet-beta";
export const ADMIN_CNFT_AUTHORITY = "6p8dv8FaqjdoJ2MQHwrYADdP65FKcyyGX3a7kqKtf24H";
export const ADMIN_CNFT_TREE = "6MaEv559doM7sUkL1tFWRQST9JKRskSd64DzdkL3B22k";
export const ADMIN_CNFT_TREE_CONFIG = "7SGHPHpnGXQkQekM9XQvRZKaNiHHRgh4yFZxPc2p4NNv";
export const ADMIN_CNFT_COLLECTION = "HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J";
export const ADMIN_CNFT_NAME = "LuckyMe Seeker Pass";
export const ADMIN_CNFT_URI = "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.json";
export const ADMIN_CNFT_IMAGE = "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.png";
export const MAX_ADMIN_CNFT_RECIPIENTS = 1_000;
export const MAX_MINTS_PER_TRANSACTION = 3;
export const MAX_MINTS_PER_WALLET_APPROVAL = 50;
export const MIN_BLOCKHASH_VALIDITY_BLOCKS = 75;
export const BATCH_SIGN_TEST_COUNTS = Object.freeze([5, 20, 50, 100]);
const MEMO_PROGRAM_ID = new PublicKey("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr");
const COMPUTE_BUDGET_PROGRAM_ID = "ComputeBudget111111111111111111111111111111";
const LIGHTHOUSE_PROGRAM_ID = "L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95";
const MAX_WALLET_COMPUTE_UNIT_LIMIT = 1_400_000;
const MAX_WALLET_COMPUTE_UNIT_PRICE_MICROLAMPORTS = 1_000_000n;
const MAX_WALLET_ADDITIONAL_FEE_LAMPORTS = 1_000_000;
const MAX_DEBIT_PER_MINT_LAMPORTS = 250_000;
export const SKR_RESOLUTION_CONCURRENCY = 3;
export const SKR_RESOLUTION_MAX_ATTEMPTS = 4;
const SKR_RESOLUTION_RETRY_BASE_MS = 350;
const SKR_RESOLUTION_MIN_INTERVAL_MS = 200;
const SKR_RESOLUTION_EMPTY_CONFIRMATIONS = 2;
const SKR_RESOLUTION_CACHE_TTL_MS = 15 * 60 * 1_000;
const RPC_MAX_ATTEMPTS = 6;
const RPC_RETRY_BASE_MS = 500;
const SIMULATION_MIN_INTERVAL_MS = 300;
const SKR_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}\.skr$/;

function assert(condition, message, status = 400) {
  if (!condition) throw Object.assign(new Error(message), { status });
}

function normalizeName(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/^@+/, "");
}

export function buildBatchSigningDiagnosticTransactions({ recentBlockhash, count } = {}) {
  assert(BATCH_SIGN_TEST_COUNTS.includes(count), `Batch signing test count must be one of: ${BATCH_SIGN_TEST_COUNTS.join(", ")}`);
  assert(typeof recentBlockhash === "string" && recentBlockhash.length >= 32, "A recent Solana blockhash is required", 503);
  const authority = new PublicKey(ADMIN_CNFT_AUTHORITY);
  return Array.from({ length: count }, (_, index) => {
    const transaction = new Transaction({ feePayer: authority, recentBlockhash });
    transaction.add(new TransactionInstruction({
      programId: MEMO_PROGRAM_ID,
      keys: [],
      data: Buffer.from(`LuckyMe batch-sign diagnostic ${index + 1}/${count} - DO NOT BROADCAST`, "utf8"),
    }));
    return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).toString("base64");
  });
}

export async function prepareBatchSigningDiagnostic({ rpcUrl, count } = {}) {
  assert(typeof rpcUrl === "string" && rpcUrl.startsWith("https://"), "A HTTPS mainnet RPC URL is required", 500);
  const connection = new Connection(rpcUrl, "confirmed");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  return {
    cluster: ADMIN_CNFT_CLUSTER,
    authority: ADMIN_CNFT_AUTHORITY,
    count,
    lastValidBlockHeight,
    transactions: buildBatchSigningDiagnosticTransactions({ recentBlockhash: blockhash, count }),
  };
}

export function normalizeSkrBatch(values, { limit = MAX_ADMIN_CNFT_RECIPIENTS } = {}) {
  assert(Array.isArray(values), "names must be an array");
  assert(values.length <= limit, `A batch can contain at most ${limit} usernames`);
  const seen = new Set();
  return values.map((value, index) => {
    const name = normalizeName(value);
    const duplicate = seen.has(name);
    if (name) seen.add(name);
    return {
      index,
      input: String(value ?? ""),
      name,
      validFormat: SKR_PATTERN.test(name),
      duplicate,
    };
  });
}

export function createSkrResolver({
  rpcUrl,
  commitment = "confirmed",
  lookupRecord,
  concurrency = SKR_RESOLUTION_CONCURRENCY,
  maxAttempts = SKR_RESOLUTION_MAX_ATTEMPTS,
  minLookupIntervalMs = SKR_RESOLUTION_MIN_INTERVAL_MS,
  cacheTtlMs = SKR_RESOLUTION_CACHE_TTL_MS,
  now = () => Date.now(),
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
} = {}) {
  assert(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 10, "Invalid SKR resolution concurrency", 500);
  assert(Number.isInteger(maxAttempts) && maxAttempts >= 1 && maxAttempts <= 8, "Invalid SKR resolution retry count", 500);
  assert(Number.isInteger(minLookupIntervalMs) && minLookupIntervalMs >= 0 && minLookupIntervalMs <= 2_000, "Invalid SKR resolution pacing", 500);
  assert(Number.isInteger(cacheTtlMs) && cacheTtlMs >= 0 && cacheTtlMs <= 60 * 60 * 1_000, "Invalid SKR resolution cache lifetime", 500);
  let lookup = lookupRecord;
  if (!lookup) {
    assert(typeof rpcUrl === "string" && rpcUrl.startsWith("https://"), "A HTTPS mainnet RPC URL is required", 500);
    const connection = new Connection(rpcUrl, commitment);
    const parser = new TldParser(connection);
    lookup = (name) => parser.getNameRecordFromDomainTld(name);
  }

  let nextLookupStartedAt = 0;
  const cache = new Map();
  async function waitForLookupSlot() {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextLookupStartedAt);
    nextLookupStartedAt = scheduledAt + minLookupIntervalMs;
    if (scheduledAt > now) await sleep(scheduledAt - now);
  }

  async function lookupWithRetry(name, index) {
    const cached = cache.get(name);
    if (cached && cached.expiresAt > now()) return { ...cached.result, attempts: 0, cached: true };
    if (cached) cache.delete(name);
    let emptyResponses = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        await waitForLookupSlot();
        const record = await lookup(name);
        if (record) {
          const result = { record, attempts: attempt, temporaryFailure: false };
          if (cacheTtlMs > 0) cache.set(name, { expiresAt: now() + cacheTtlMs, result });
          return result;
        }
        emptyResponses += 1;
        if (emptyResponses >= SKR_RESOLUTION_EMPTY_CONFIRMATIONS || attempt === maxAttempts) {
          const result = { record: null, attempts: attempt, temporaryFailure: false };
          if (cacheTtlMs > 0) cache.set(name, { expiresAt: now() + cacheTtlMs, result });
          return result;
        }
      } catch {
        if (attempt === maxAttempts) return { record: null, attempts: attempt, temporaryFailure: true };
      }
      const backoff = SKR_RESOLUTION_RETRY_BASE_MS * (2 ** (attempt - 1));
      const jitter = (index % 7) * 35;
      await sleep(backoff + jitter);
    }
    return { record: null, attempts: maxAttempts, temporaryFailure: true };
  }

  return async function resolveSkrBatch(values) {
    const normalized = normalizeSkrBatch(values);
    const rows = new Array(normalized.length);
    let nextIndex = 0;
    async function resolveNext() {
      while (nextIndex < normalized.length) {
        const index = nextIndex;
        nextIndex += 1;
        const row = normalized[index];
        if (!row.name || !row.validFormat || row.duplicate) {
          rows[index] = { ...row, status: row.duplicate ? "duplicate" : "invalid", wallet: null };
          continue;
        }
        try {
          let resolvedName = row.name;
          let correctedFrom = null;
          let { record, attempts, temporaryFailure } = await lookupWithRetry(row.name, index);
          if (temporaryFailure) {
            rows[index] = { ...row, status: "lookup_error", wallet: null, attempts };
            continue;
          }
          if (!record && /^[il]/.test(row.name)) {
            const alternateName = `${row.name[0] === "i" ? "l" : "i"}${row.name.slice(1)}`;
            const alternate = await lookupWithRetry(alternateName, index);
            attempts += alternate.attempts;
            if (alternate.temporaryFailure) {
              rows[index] = { ...row, status: "lookup_error", wallet: null, attempts };
              continue;
            }
            if (alternate.record) {
              record = alternate.record;
              resolvedName = alternateName;
              correctedFrom = row.name;
            }
          }
          const owner = record?.isValid && record?.owner ? new PublicKey(record.owner).toBase58() : null;
          rows[index] = {
            ...row,
            name: resolvedName,
            status: owner ? "resolved" : "not_found",
            wallet: owner,
            attempts,
            correctedFrom,
            expiresAt: record?.expiresAt instanceof Date ? record.expiresAt.toISOString() : null,
            nonTransferable: record?.nonTransferable === true,
          };
        } catch {
          rows[index] = { ...row, status: "lookup_error", wallet: null, attempts: maxAttempts };
        }
      }
    }
    await Promise.all(Array.from(
      { length: Math.min(concurrency, normalized.length) },
      () => resolveNext(),
    ));
    const walletSeen = new Set();
    for (const row of rows) {
      if (!row.wallet) continue;
      if (walletSeen.has(row.wallet)) {
        row.status = "duplicate_wallet";
      } else {
        walletSeen.add(row.wallet);
      }
    }
    return rows;
  };
}

async function dasRequest(rpcUrl, method, params, {
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = 4,
} = {}) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: `admin-cnft-${randomBytes(6).toString("hex")}`, method, params }),
    });
    if ((response.status === 429 || response.status >= 500) && attempt < maxAttempts) {
      const retryAfterSeconds = Number(response.headers?.get?.("retry-after"));
      const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
        ? Math.min(retryAfterSeconds * 1_000, 10_000)
        : 500 * (2 ** (attempt - 1));
      await sleep(delay);
      continue;
    }
    assert(response.ok, "DAS verification is unavailable", 503);
    const payload = await response.json().catch(() => null);
    assert(payload && !payload.error, "DAS verification returned an invalid response", 503);
    return payload.result;
  }
  throw Object.assign(new Error("DAS verification is unavailable"), { status: 503 });
}

function isOfficialPassAsset(item, requestedOwners) {
  const owner = item?.ownership?.owner;
  return requestedOwners.has(owner) &&
    item?.burnt !== true &&
    item?.ownership?.ownership_model === "single" &&
    item?.compression?.compressed === true &&
    item?.creators?.some((creator) => creator?.address === ADMIN_CNFT_AUTHORITY && creator?.verified === true) &&
    item?.grouping?.some((group) => group?.group_key === "collection" && group?.group_value === ADMIN_CNFT_COLLECTION);
}

export function createExistingPassBatchChecker({ dasRpcUrl, fetchImpl = fetch, sleep } = {}) {
  assert(typeof dasRpcUrl === "string" && /helius-rpc\.com/i.test(dasRpcUrl), "A Helius DAS RPC URL is required", 500);
  return async function findExistingPasses(wallets) {
    assert(Array.isArray(wallets) && wallets.length > 0, "At least one wallet is required");
    const owners = new Set(wallets.map((wallet) => new PublicKey(wallet).toBase58()));
    const existingByOwner = new Map();
    let after;
    for (let page = 0; page < 25 && existingByOwner.size < owners.size; page += 1) {
      const params = {
        compressed: true,
        grouping: ["collection", ADMIN_CNFT_COLLECTION],
        limit: 1_000,
        sortBy: { sortBy: "id", sortDirection: "asc" },
      };
      if (after) params.after = after;
      const result = await dasRequest(dasRpcUrl, "searchAssets", params, { fetchImpl, sleep });
      const items = Array.isArray(result?.items) ? result.items : [];
      for (const item of items) {
        if (!isOfficialPassAsset(item, owners) || !item?.id) continue;
        existingByOwner.set(item.ownership.owner, new PublicKey(item.id).toBase58());
      }
      if (items.length < params.limit) break;
      const nextAfter = items.at(-1)?.id;
      if (!nextAfter || nextAfter === after) break;
      after = nextAfter;
    }
    return wallets.map((wallet) => {
      const owner = new PublicKey(wallet).toBase58();
      return { wallet: owner, assetId: existingByOwner.get(owner) ?? null };
    });
  };
}

export function createExistingPassChecker(options = {}) {
  const findExistingPasses = createExistingPassBatchChecker(options);
  return async function findExistingPass(wallet) {
    const [result] = await findExistingPasses([wallet]);
    return result.assetId;
  };
}

function chunk(values, size) {
  const result = [];
  for (let offset = 0; offset < values.length; offset += size) result.push(values.slice(offset, offset + size));
  return result;
}

export async function runPacedMintSimulations({
  candidates,
  simulateCandidate,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  intervalMs = SIMULATION_MIN_INTERVAL_MS,
} = {}) {
  assert(Array.isArray(candidates), "Mint simulation candidates are required", 500);
  assert(typeof simulateCandidate === "function", "Mint simulation callback is required", 500);
  const prepared = [];
  for (let index = 0; index < candidates.length; index += 1) {
    if (index > 0 && intervalMs > 0) await sleep(intervalMs);
    prepared.push({
      ...candidates[index],
      simulation: await simulateCandidate(candidates[index], index),
    });
  }
  return prepared;
}

function base58Encode(bytes) {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  if (!bytes?.length) return "";
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index] << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let result = "";
  for (const byte of bytes) {
    if (byte !== 0) break;
    result += alphabet[0];
  }
  for (let index = digits.length - 1; index >= 0; index -= 1) result += alphabet[digits[index]];
  return result;
}

export function signedTransactionSignature(transactionBase64) {
  let transaction;
  try {
    transaction = VersionedTransaction.deserialize(Buffer.from(String(transactionBase64), "base64"));
  } catch {
    throw Object.assign(new Error("Signed transaction is invalid"), { status: 400 });
  }
  const signature = transaction.signatures?.[0];
  assert(signature && signature.length === 64 && signature.some((byte) => byte !== 0), "Signed transaction is missing its authority signature", 409);
  return base58Encode(signature);
}

function isRetryableRpcFailure(response, payload) {
  const code = Number(payload?.error?.code);
  const message = String(payload?.error?.message ?? "").toLocaleLowerCase("en-US");
  return response?.status === 429 || response?.status >= 500 ||
    [-32429, -32005, -32004, -32002].includes(code) ||
    /rate|too many|temporar|timeout|unavailable|node is behind/.test(message);
}

export async function simulateSerialized({
  rpcUrl,
  serialized,
  recipientCount,
  payerBalanceBefore,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  maxAttempts = RPC_MAX_ATTEMPTS,
} = {}) {
  let payload = null;
  let response = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      response = await fetchImpl(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `admin-cnft-sim-${randomBytes(6).toString("hex")}`,
          method: "simulateTransaction",
          params: [Buffer.from(serialized).toString("base64"), {
            encoding: "base64",
            sigVerify: false,
            commitment: "processed",
            accounts: { encoding: "base64", addresses: [ADMIN_CNFT_AUTHORITY] },
          }],
        }),
      });
      payload = await response.json().catch(() => null);
    } catch (error) {
      if (attempt === maxAttempts) {
        throw Object.assign(new Error("Transaction simulation RPC failed"), { status: 503, cause: error });
      }
      await sleep(RPC_RETRY_BASE_MS * (2 ** (attempt - 1)));
      continue;
    }
    if (response.ok && payload && !payload.error) break;
    if (!isRetryableRpcFailure(response, payload) || attempt === maxAttempts) {
      throw Object.assign(new Error("Transaction simulation RPC failed"), { status: 503 });
    }
    const retryAfterSeconds = Number(response.headers?.get?.("retry-after"));
    const delay = Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
      ? Math.min(retryAfterSeconds * 1_000, 15_000)
      : RPC_RETRY_BASE_MS * (2 ** (attempt - 1));
    await sleep(delay);
  }
  assert(response?.ok && payload && !payload.error, "Transaction simulation RPC failed", 503);
  const result = payload.result?.value;
  assert(result && !result.err, `Transaction simulation failed: ${JSON.stringify(result?.err ?? "unknown")}`, 409);
  const payerPost = result.accounts?.[0]?.lamports;
  assert(Number.isSafeInteger(payerPost), "Transaction simulation did not return the payer balance", 503);
  const maxDebitLamports = recipientCount * MAX_DEBIT_PER_MINT_LAMPORTS;
  const payerDebitLamports = payerBalanceBefore - payerPost;
  assert(payerDebitLamports >= 0, "Transaction simulation returned an invalid authority balance", 503);
  assert(payerDebitLamports <= maxDebitLamports, `Transaction simulation exceeds the ${maxDebitLamports} lamport safety limit`, 409);
  return { payerPost, payerDebitLamports, unitsConsumed: Number(result.unitsConsumed ?? 0), maxDebitLamports };
}

export async function prepareAdminCnftTransactions({
  rpcUrl,
  recipients,
  fetchImpl = fetch,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  simulationIntervalMs = SIMULATION_MIN_INTERVAL_MS,
} = {}) {
  assert(typeof rpcUrl === "string" && rpcUrl.startsWith("https://"), "A HTTPS mainnet RPC URL is required", 500);
  assert(Array.isArray(recipients) && recipients.length > 0, "At least one resolved recipient is required");
  assert(recipients.length <= MAX_ADMIN_CNFT_RECIPIENTS, `A batch can contain at most ${MAX_ADMIN_CNFT_RECIPIENTS} recipients`);
  const wallets = new Set();
  const safeRecipients = recipients.map((row) => {
    assert(SKR_PATTERN.test(row?.name ?? ""), "Every recipient must be a valid .skr username");
    const wallet = new PublicKey(row.wallet).toBase58();
    assert(!wallets.has(wallet), `Two usernames resolve to the same wallet: ${wallet}`);
    wallets.add(wallet);
    return { name: row.name, wallet };
  });

  const payer = createNoopSigner(publicKey(ADMIN_CNFT_AUTHORITY));
  const connection = new Connection(rpcUrl, "confirmed");
  const umi = createUmi(rpcUrl).use(mplCore()).use(mplBubblegum()).use(signerIdentity(payer, true));
  const tree = publicKey(ADMIN_CNFT_TREE);
  const treeConfigAddress = publicKey(ADMIN_CNFT_TREE_CONFIG);
  const collection = publicKey(ADMIN_CNFT_COLLECTION);
  const [treeConfig, coreCollection, payerBalanceBefore, recentBlockhash] = await Promise.all([
    fetchTreeConfig(umi, treeConfigAddress),
    fetchCollectionV1(umi, collection),
    connection.getBalance(new PublicKey(ADMIN_CNFT_AUTHORITY), "confirmed"),
    umi.rpc.getLatestBlockhash({ commitment: "confirmed" }),
  ]);
  assert(treeConfig.treeCreator.toString() === ADMIN_CNFT_AUTHORITY, "Tree creator does not match the approved authority", 409);
  assert(treeConfig.treeDelegate.toString() === ADMIN_CNFT_AUTHORITY, "Tree delegate does not match the approved authority", 409);
  assert(coreCollection.updateAuthority.toString() === ADMIN_CNFT_AUTHORITY, "Collection authority does not match", 409);
  assert(treeConfig.numMinted === BigInt(coreCollection.currentSize), "Tree and collection counters do not match", 409);
  assert(treeConfig.numMinted + BigInt(safeRecipients.length) <= treeConfig.totalMintCapacity, "The cNFT tree has insufficient capacity", 409);

  let nextLeafIndex = treeConfig.numMinted;
  const candidates = [];
  for (const group of chunk(safeRecipients, MAX_MINTS_PER_TRANSACTION)) {
    let builder;
    const assets = [];
    for (const recipient of group) {
      const leafOwner = publicKey(recipient.wallet);
      const assetId = findLeafAssetIdPda(umi, { merkleTree: tree, leafIndex: nextLeafIndex })[0].toString();
      const instruction = mintV2(umi, {
        collectionAuthority: payer,
        leafOwner,
        leafDelegate: leafOwner,
        merkleTree: tree,
        coreCollection: collection,
        metadata: {
          name: ADMIN_CNFT_NAME,
          uri: ADMIN_CNFT_URI,
          sellerFeeBasisPoints: 0,
          collection: some(collection),
          creators: [{ address: publicKey(ADMIN_CNFT_AUTHORITY), verified: true, share: 100 }],
        },
      });
      builder = builder ? builder.add(instruction) : instruction;
      assets.push({ ...recipient, assetId, leafIndex: nextLeafIndex.toString() });
      nextLeafIndex += 1n;
    }
    const umiTransaction = await builder.setBlockhash(recentBlockhash).buildAndSign(umi);
    const serialized = umi.transactions.serialize(umiTransaction);
    candidates.push({
      builder,
      serialized,
      sequence: candidates.length + 1,
      recipientCount: group.length,
      assets,
    });
  }
  const preparedGroups = await runPacedMintSimulations({
    candidates,
    sleep,
    intervalMs: simulationIntervalMs,
    simulateCandidate: (candidate) => simulateSerialized({
      rpcUrl,
      serialized: candidate.serialized,
      recipientCount: candidate.recipientCount,
      payerBalanceBefore,
      fetchImpl,
      sleep,
    }),
  });

  // Simulations above can take long enough for their shared blockhash to age.
  // Rebuild the exact same reviewed instruction plans with one fresh blockhash
  // immediately before returning them to the wallet for its single approval.
  const freshBlockhash = await umi.rpc.getLatestBlockhash({ commitment: "confirmed" });
  const transactions = [];
  for (const prepared of preparedGroups) {
    const freshTransaction = await prepared.builder.setBlockhash(freshBlockhash).buildAndSign(umi);
    const serialized = umi.transactions.serialize(freshTransaction);
    transactions.push({
      sequence: prepared.sequence,
      recipientCount: prepared.recipientCount,
      assets: prepared.assets,
      transactionBase64: Buffer.from(serialized).toString("base64"),
      unitsConsumed: prepared.simulation.unitsConsumed,
      payerDebitLamports: prepared.simulation.payerDebitLamports,
      maxDebitLamports: prepared.simulation.maxDebitLamports,
    });
  }

  const plan = {
    cluster: ADMIN_CNFT_CLUSTER,
    authority: ADMIN_CNFT_AUTHORITY,
    collection: ADMIN_CNFT_COLLECTION,
    tree: ADMIN_CNFT_TREE,
    treeNumMintedBefore: treeConfig.numMinted.toString(),
    recipientCount: safeRecipients.length,
    transactionCount: transactions.length,
    preparedAt: new Date().toISOString(),
    lastValidBlockHeight: Number(freshBlockhash.lastValidBlockHeight),
    transactions,
  };
  plan.planHash = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  return plan;
}

export function validateSignedPlanTransactions({ plan, signedTransactionsBase64, authorityAddress = ADMIN_CNFT_AUTHORITY } = {}) {
  assert(plan && Array.isArray(plan.transactions), "A prepared mint plan is required", 500);
  assert(Array.isArray(signedTransactionsBase64), "Signed transactions are required");
  assert(signedTransactionsBase64.length === plan.transactions.length, `Expected ${plan.transactions.length} signed transactions`);
  const normalizeMessagePlan = (message) => ({
    header: message.header,
    staticAccountKeys: (message.staticAccountKeys ?? message.accountKeys ?? []).map((key) => key.toBase58()),
    compiledInstructions: (message.compiledInstructions ?? message.instructions ?? []).map((instruction) => ({
      programIdIndex: instruction.programIdIndex,
      accountKeyIndexes: [...(instruction.accountKeyIndexes ?? instruction.accounts ?? [])],
      data: typeof instruction.data === "string" ? instruction.data : Buffer.from(instruction.data).toString("base64"),
    })),
    addressTableLookups: (message.addressTableLookups ?? []).map((lookup) => ({
      accountKey: lookup.accountKey.toBase58(),
      writableIndexes: [...lookup.writableIndexes],
      readonlyIndexes: [...lookup.readonlyIndexes],
    })),
  });
  const effectiveInstructionPlan = (message) => {
    const staticKeys = message.staticAccountKeys ?? message.accountKeys ?? [];
    const lookups = message.addressTableLookups ?? [];
    assert(lookups.length === 0, "Address-table mint transactions are not supported by the Admin verifier", 409);
    const header = message.header;
    const signerCount = Number(header.numRequiredSignatures);
    const readonlySignerStart = signerCount - Number(header.numReadonlySignedAccounts);
    const readonlyUnsignedStart = staticKeys.length - Number(header.numReadonlyUnsignedAccounts);
    const accountMeta = (index) => {
      assert(index >= 0 && index < staticKeys.length, "A mint instruction references an unresolved account", 409);
      const isSigner = index < signerCount;
      const isWritable = isSigner ? index < readonlySignerStart : index < readonlyUnsignedStart;
      return { pubkey: staticKeys[index].toBase58(), isSigner, isWritable };
    };
    return (message.compiledInstructions ?? message.instructions ?? []).map((instruction) => {
      const program = accountMeta(instruction.programIdIndex).pubkey;
      return {
        program,
        accounts: [...(instruction.accountKeyIndexes ?? instruction.accounts ?? [])].map(accountMeta),
        data: typeof instruction.data === "string" ? instruction.data : Buffer.from(instruction.data).toString("base64"),
      };
    });
  };
  const instructionFingerprint = (instruction) => JSON.stringify(instruction);
  const isSafeWalletComputeBudgetInstruction = (instruction) => {
    if (instruction.program !== COMPUTE_BUDGET_PROGRAM_ID || instruction.accounts.length !== 0) return false;
    const data = Buffer.from(instruction.data, "base64");
    if (data.length < 1) return false;
    if (data[0] === 0 && data.length === 9) {
      return data.readUInt32LE(1) <= MAX_WALLET_COMPUTE_UNIT_LIMIT
        && data.readUInt32LE(5) <= MAX_WALLET_ADDITIONAL_FEE_LAMPORTS;
    }
    if (data[0] === 1 && data.length === 5) return data.readUInt32LE(1) <= 262_144;
    if (data[0] === 2 && data.length === 5) return data.readUInt32LE(1) <= MAX_WALLET_COMPUTE_UNIT_LIMIT;
    if (data[0] === 3 && data.length === 9) return data.readBigUInt64LE(1) <= MAX_WALLET_COMPUTE_UNIT_PRICE_MICROLAMPORTS;
    if (data[0] === 4 && data.length === 5) return data.readUInt32LE(1) <= 64 * 1024 * 1024;
    return false;
  };
  const isSafeWalletLighthouseInstruction = (instruction) => {
    if (instruction.program !== LIGHTHOUSE_PROGRAM_ID) return false;
    const data = Buffer.from(instruction.data, "base64");
    return data.length > 0 && data.length <= 1_024 && instruction.accounts.length <= 64;
  };
  const semanticFingerprint = (message, { allowWalletAdditions = false } = {}) => {
    const instructions = effectiveInstructionPlan(message);
    let start = 0;
    let end = instructions.length;
    if (allowWalletAdditions) {
      let computeBudgetCount = 0;
      while (start < end && isSafeWalletComputeBudgetInstruction(instructions[start])) {
        computeBudgetCount += 1;
        assert(computeBudgetCount <= 2, "The wallet added too many compute-budget instructions", 409);
        start += 1;
      }
      let lighthouseCount = 0;
      while (end > start && isSafeWalletLighthouseInstruction(instructions[end - 1])) {
        lighthouseCount += 1;
        assert(lighthouseCount <= 2, "The wallet added too many Lighthouse protection instructions", 409);
        end -= 1;
      }
    }
    const required = instructions.slice(start, end).map(instructionFingerprint);
    return JSON.stringify({ feePayer: (message.staticAccountKeys ?? message.accountKeys ?? [])[0]?.toBase58(), required });
  };
  const plannedTransactions = plan.transactions.map((transaction, index) => {
    try {
      const planned = VersionedTransaction.deserialize(Buffer.from(transaction.transactionBase64, "base64"));
      return {
        index,
        fingerprint: JSON.stringify(normalizeMessagePlan(planned.message)),
        semanticFingerprint: semanticFingerprint(planned.message),
      };
    } catch {
      throw Object.assign(new Error(`Prepared transaction ${index + 1} is invalid`), { status: 500 });
    }
  });
  const unmatchedPlans = new Map();
  const unmatchedSemanticPlans = new Map();
  for (const planned of plannedTransactions) {
    const matches = unmatchedPlans.get(planned.fingerprint) ?? [];
    matches.push(planned.index);
    unmatchedPlans.set(planned.fingerprint, matches);
    const semanticMatches = unmatchedSemanticPlans.get(planned.semanticFingerprint) ?? [];
    semanticMatches.push(planned.index);
    unmatchedSemanticPlans.set(planned.semanticFingerprint, semanticMatches);
  }
  const orderedSignedTransactions = new Array(plan.transactions.length);
  signedTransactionsBase64.forEach((signedBase64, returnedIndex) => {
    let signed;
    try {
      signed = VersionedTransaction.deserialize(Buffer.from(String(signedBase64), "base64"));
    } catch {
      throw Object.assign(new Error(`Signed transaction ${returnedIndex + 1} is invalid`), { status: 400 });
    }
    const fingerprint = JSON.stringify(normalizeMessagePlan(signed.message));
    let matchingPlanIndexes = unmatchedPlans.get(fingerprint);
    let matchedFingerprint = fingerprint;
    let semanticMatch = false;
    if (!matchingPlanIndexes?.length) {
      matchedFingerprint = semanticFingerprint(signed.message, { allowWalletAdditions: true });
      matchingPlanIndexes = unmatchedSemanticPlans.get(matchedFingerprint);
      semanticMatch = true;
    }
    if (!matchingPlanIndexes?.length) {
      const signedInstructions = effectiveInstructionPlan(signed.message);
      const error = Object.assign(new Error(`Signed transaction ${returnedIndex + 1} does not match the reviewed mint plan`), {
        status: 409,
        diagnostic: {
          returnedIndex: returnedIndex + 1,
          feePayer: (signed.message.staticAccountKeys ?? signed.message.accountKeys ?? [])[0]?.toBase58() ?? null,
          instructionPrograms: signedInstructions.map((instruction) => instruction.program),
          instructionCount: signedInstructions.length,
          safeComputeBudgetCount: signedInstructions.filter(isSafeWalletComputeBudgetInstruction).length,
          safeLighthouseCount: signedInstructions.filter(isSafeWalletLighthouseInstruction).length,
          planInstructionCounts: plannedTransactions.map((planned) => JSON.parse(planned.semanticFingerprint).required.length),
        },
      });
      throw error;
    }
    const plannedIndex = matchingPlanIndexes.shift();
    if (semanticMatch) {
      if (!matchingPlanIndexes.length) unmatchedSemanticPlans.delete(matchedFingerprint);
      const exactMatches = unmatchedPlans.get(plannedTransactions[plannedIndex].fingerprint);
      if (exactMatches) {
        const position = exactMatches.indexOf(plannedIndex);
        if (position >= 0) exactMatches.splice(position, 1);
        if (!exactMatches.length) unmatchedPlans.delete(plannedTransactions[plannedIndex].fingerprint);
      }
    } else {
      if (!matchingPlanIndexes.length) unmatchedPlans.delete(fingerprint);
      const semanticMatches = unmatchedSemanticPlans.get(plannedTransactions[plannedIndex].semanticFingerprint);
      if (semanticMatches) {
        const position = semanticMatches.indexOf(plannedIndex);
        if (position >= 0) semanticMatches.splice(position, 1);
        if (!semanticMatches.length) unmatchedSemanticPlans.delete(plannedTransactions[plannedIndex].semanticFingerprint);
      }
    }
    const signedMessage = Buffer.from(signed.message.serialize());
    const authority = (signed.message.staticAccountKeys ?? signed.message.accountKeys ?? [])[0];
    assert(authority?.toBase58() === authorityAddress, `Signed transaction ${returnedIndex + 1} has the wrong fee payer`, 409);
    const signature = signed.signatures[0];
    assert(signature && signature.some((byte) => byte !== 0), `Signed transaction ${returnedIndex + 1} is missing the authority signature`, 409);
    assert(nacl.sign.detached.verify(signedMessage, signature, authority.toBytes()), `Signed transaction ${returnedIndex + 1} has an invalid authority signature`, 409);
    orderedSignedTransactions[plannedIndex] = Buffer.from(signed.serialize()).toString("base64");
  });
  assert(orderedSignedTransactions.every(Boolean), "The signed batch is incomplete", 409);
  return orderedSignedTransactions;
}
