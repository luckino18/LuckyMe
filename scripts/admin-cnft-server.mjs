import { randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import http from "node:http";
import { dirname } from "node:path";
import { URL } from "node:url";

import { createSkrRegistry, SKR_EXPORT_SIZES } from "./admin-skr-registry.mjs";

import {
  ADMIN_CNFT_AUTHORITY,
  ADMIN_CNFT_COLLECTION,
  ADMIN_CNFT_TREE,
  BATCH_SIGN_TEST_COUNTS,
  MAX_ADMIN_CNFT_RECIPIENTS,
  MIN_BLOCKHASH_VALIDITY_BLOCKS,
  MAX_MINTS_PER_TRANSACTION,
  MAX_MINTS_PER_WALLET_APPROVAL,
  createExistingPassBatchChecker,
  createSkrResolver,
  prepareBatchSigningDiagnostic,
  prepareAdminCnftTransactions,
  signedTransactionSignature,
  validateSignedPlanTransactions,
} from "./admin-cnft-tool.mjs";

const HOST = process.env.LUCKYME_ADMIN_CNFT_HOST ?? "127.0.0.1";
const PORT = Number(process.env.LUCKYME_ADMIN_CNFT_PORT ?? 8792);
const RPC_URL = process.env.LUCKYME_ADMIN_CNFT_RPC_URL ?? "https://api.mainnet-beta.solana.com";
const DAS_RPC_URL = process.env.LUCKYME_ADMIN_CNFT_DAS_RPC_URL ?? "";
const EXECUTION_ENABLED = process.env.LUCKYME_ADMIN_CNFT_EXECUTION_ENABLED === "true";
const SKR_REGISTRY_PATH = process.env.LUCKYME_ADMIN_SKR_REGISTRY_PATH ?? "/var/lib/luckyme/admin-skr-registry.json";
const JOB_STORE_PATH = process.env.LUCKYME_ADMIN_CNFT_JOB_STORE_PATH ?? "/var/lib/luckyme/admin-cnft-jobs.json";
const MAX_BODY_BYTES = 512 * 1_024;
const JOB_TTL_MS = 10 * 60 * 1_000;
const MIN_REMAINING_BLOCKS_PER_BROADCAST = 8;

let nftNonce = freshNonce();
const jobs = loadJobs();
const resolveSkrBatch = createSkrResolver({ rpcUrl: RPC_URL });

function applyResolvedSkrCorrections(rows) {
  for (const row of rows) {
    if (row?.status !== "resolved" || !row.correctedFrom || !row.name) continue;
    skrRegistry.correctName(row.correctedFrom, row.name, { wallet: row.wallet });
  }
}
const findExistingPasses = DAS_RPC_URL ? createExistingPassBatchChecker({ dasRpcUrl: DAS_RPC_URL }) : null;
const skrRegistry = createSkrRegistry({ filePath: SKR_REGISTRY_PATH });

function freshNonce() {
  return randomBytes(24).toString("base64url");
}

function loadJobs() {
  try {
    const payload = JSON.parse(readFileSync(JOB_STORE_PATH, "utf8"));
    const rows = Array.isArray(payload?.jobs) ? payload.jobs : [];
    return new Map(rows.filter((row) => Array.isArray(row) && row.length === 2 && typeof row[0] === "string" && row[1]?.plan));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.error(JSON.stringify({ event: "luckyme_admin_cnft_job_store_read_failed", message: error.message }));
    }
    return new Map();
  }
}

function persistJobs() {
  mkdirSync(dirname(JOB_STORE_PATH), { recursive: true, mode: 0o750 });
  const temporaryPath = `${JOB_STORE_PATH}.${process.pid}.tmp`;
  writeFileSync(temporaryPath, `${JSON.stringify({ version: 1, jobs: [...jobs] }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporaryPath, JOB_STORE_PATH);
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}

function proxyIdentity(req) {
  if (req.headers["x-luckyme-admin-proxy"] !== "1") return null;
  const username = String(req.headers["x-luckyme-admin-user"] ?? "").trim();
  return username && username.length <= 128 ? username : null;
}

function json(res, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function requireAdminPost(req, res) {
  if (req.headers["x-luckyme-admin-request"] === "1") return true;
  json(res, 403, { error: "admin_request_header_required" });
  return false;
}

async function mapWithConcurrency(values, concurrency, worker) {
  const results = new Array(values.length);
  let cursor = 0;
  async function run() {
    while (cursor < values.length) {
      const index = cursor++;
      results[index] = await worker(values[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, run));
  return results;
}

function audit(event) {
  console.log(JSON.stringify({ event: "luckyme_admin_cnft_audit", timestamp: new Date().toISOString(), ...event }));
}

function cleanJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  let changed = false;
  for (const [jobId, job] of jobs) {
    if (job.createdAt >= cutoff) continue;
    const attempted = (job.attemptedSignatures ?? job.broadcasts ?? []).filter(Boolean);
    if (attempted.length) continue;
    const names = job.plan.transactions.flatMap((transaction) => transaction.assets.map((asset) => asset.name));
    const released = skrRegistry.releaseNames(names);
    audit({ username: job.username, action: "cnft_unsigned_job_expired", jobId, released: released.length });
    jobs.delete(jobId);
    changed = true;
  }
  if (changed) persistJobs();
}

function persistentMintJobForName(name) {
  for (const [jobId, job] of jobs) {
    const found = job.plan.transactions.some((transaction) =>
      transaction.assets.some((asset) => asset.name === name)
    );
    if (found) return jobId;
  }
  return null;
}

async function signatureStatuses(signatures) {
  const rpcUrls = [...new Set([RPC_URL, "https://api.mainnet-beta.solana.com"])];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const rpcUrl = rpcUrls[attempt % rpcUrls.length];
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `admin-cnft-confirm-${randomBytes(6).toString("hex")}`,
          method: "getSignatureStatuses",
          params: [signatures, { searchTransactionHistory: true }],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && !payload?.error && Array.isArray(payload?.result?.value) && payload.result.value.length === signatures.length) {
        return payload.result.value;
      }
    } catch {
      // Retry the confirmation read only. Never rebroadcast a signed transaction here.
    }
    if (attempt < 7) await new Promise((resolve) => setTimeout(resolve, Math.min(4_000, 500 * (attempt + 1))));
  }
  throw Object.assign(new Error("Solana confirmation is temporarily unavailable"), { status: 503 });
}

async function currentBlockHeight() {
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `admin-cnft-height-${randomBytes(6).toString("hex")}`,
          method: "getBlockHeight",
          params: [{ commitment: "confirmed" }],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && Number.isSafeInteger(payload?.result)) return payload.result;
    } catch {
      // A stale signed plan must never be broadcast just because this safety read failed.
    }
    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
  }
  throw Object.assign(new Error("Solana blockhash freshness check is temporarily unavailable"), { status: 503 });
}

async function broadcastSignedTransaction(transactionBase64) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(RPC_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `admin-cnft-send-${randomBytes(6).toString("hex")}`,
          method: "sendTransaction",
          // The exact transaction instruction plan was already simulated and then
          // cryptographically compared with the wallet-signed bytes. Re-simulating
          // every transaction here ages the shared blockhash without adding safety.
          params: [transactionBase64, { encoding: "base64", skipPreflight: true, maxRetries: 3 }],
        }),
      });
      const payload = await response.json().catch(() => null);
      if (response.ok && typeof payload?.result === "string") return payload.result;
      const retryable = response.status === 429 || response.status >= 500 ||
        /rate|too many|temporar|timeout|unavailable|node is behind/i.test(String(payload?.error?.message ?? ""));
      if (!retryable || attempt === 6) {
        throw Object.assign(new Error(payload?.error?.message || "Signed transaction broadcast failed"), { status: retryable ? 503 : 409 });
      }
    } catch (error) {
      if (error?.status || attempt === 6) throw error?.status ? error : Object.assign(new Error("Signed transaction broadcast failed"), { status: 503, cause: error });
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * (2 ** (attempt - 1))));
  }
  throw Object.assign(new Error("Signed transaction broadcast failed"), { status: 503 });
}

async function waitForConfirmedSignature(signature, lastValidBlockHeight) {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const [status] = await signatureStatuses([signature]);
    if (status?.err) {
      throw Object.assign(new Error(`Solana rejected signed transaction ${signature}: ${JSON.stringify(status.err)}`), { status: 409 });
    }
    if (["confirmed", "finalized"].includes(status?.confirmationStatus)) return status.confirmationStatus;
    const blockHeight = await currentBlockHeight();
    if (Number.isSafeInteger(lastValidBlockHeight) && blockHeight > lastValidBlockHeight) {
      throw Object.assign(new Error(`Signed transaction ${signature} expired before confirmation`), { status: 409 });
    }
    await new Promise((resolve) => setTimeout(resolve, 800));
  }
  throw Object.assign(new Error(`Confirmation is still pending for signed transaction ${signature}`), { status: 503 });
}

async function reconcileJob(jobId, job, username) {
  const attempts = (job.attemptedSignatures ?? job.broadcasts)
    .map((signature, index) => signature ? { signature, index } : null)
    .filter(Boolean);
  const statuses = attempts.length
    ? await signatureStatuses(attempts.map((row) => row.signature))
    : [];
  const confirmedAssets = [];
  const pending = [];
  const failed = [];
  for (let cursor = 0; cursor < attempts.length; cursor += 1) {
    const { signature, index } = attempts[cursor];
    const status = statuses[cursor];
    if (status?.err) {
      failed.push({ sequence: index + 1, signature, transactionError: status.err });
      continue;
    }
    if (!status || !["confirmed", "finalized"].includes(status.confirmationStatus)) {
      pending.push({ sequence: index + 1, signature, confirmationStatus: status?.confirmationStatus ?? "not_found_yet" });
      continue;
    }
    const assets = job.plan.transactions[index].assets.map((asset) => ({ ...asset, signature }));
    skrRegistry.markMinted(assets, { signature });
    confirmedAssets.push(...assets);
  }
  if (pending.length) {
    const blockHeight = await currentBlockHeight();
    const lastValidBlockHeight = Number(job.plan.lastValidBlockHeight);
    if (!Number.isSafeInteger(lastValidBlockHeight) || blockHeight <= lastValidBlockHeight) {
      return { status: 202, payload: { ok: false, pending: true, pendingTransactions: pending, confirmedAssets } };
    }
    failed.push(...pending.map((row) => ({ ...row, transactionError: "expired_not_found" })));
    pending.length = 0;
  }

  const failedIndexes = new Set(failed.map((row) => row.sequence - 1));
  const releasedNames = job.plan.transactions
    .filter((_, index) => !(job.attemptedSignatures ?? job.broadcasts)[index] || failedIndexes.has(index))
    .flatMap((transaction) => transaction.assets.map((asset) => asset.name));
  const released = skrRegistry.releaseNames(releasedNames);
  audit({
    username,
    action: "cnft_job_reconciled",
    jobId,
    planHash: job.plan.planHash,
    attempted: attempts.length,
    confirmedAssets: confirmedAssets.length,
    failed,
    released: released.length,
  });
  jobs.delete(jobId);
  persistJobs();
  return {
    status: 200,
    payload: {
      ok: failed.length === 0 && attempts.length === job.plan.transactions.length,
      terminal: true,
      partial: attempts.length !== job.plan.transactions.length || failed.length > 0,
      signatures: attempts.map((row) => row.signature),
      assets: confirmedAssets,
      failed,
      released,
      nftNonce,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const username = proxyIdentity(req);
  if (!username) return json(res, 403, { error: "trusted_proxy_required" });
  const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  try {
    if (req.method === "GET" && url.pathname === "/config") {
      cleanJobs();
      const pendingJobs = [...jobs]
        .filter(([, job]) => job.username === username && (job.attemptedSignatures ?? job.broadcasts ?? []).some(Boolean))
        .map(([jobId, job]) => ({
          jobId,
          createdAt: job.createdAt,
          attempted: (job.attemptedSignatures ?? job.broadcasts ?? []).filter(Boolean).length,
          total: job.plan.transactions.length,
        }));
      return json(res, 200, {
        enabled: EXECUTION_ENABLED && Boolean(findExistingPasses),
        resolutionEnabled: true,
        cluster: "mainnet-beta",
        authority: ADMIN_CNFT_AUTHORITY,
        collection: ADMIN_CNFT_COLLECTION,
        tree: ADMIN_CNFT_TREE,
        maxRecipients: MAX_ADMIN_CNFT_RECIPIENTS,
        mintsPerTransaction: MAX_MINTS_PER_TRANSACTION,
        mintsPerApproval: MAX_MINTS_PER_WALLET_APPROVAL,
        batchSignTestCounts: BATCH_SIGN_TEST_COUNTS,
        skrExportSizes: SKR_EXPORT_SIZES,
        pendingJobs,
        nftNonce,
      });
    }

    if (req.method === "GET" && url.pathname === "/skr-registry") {
      return json(res, 200, skrRegistry.snapshot({
        search: url.searchParams.get("search") ?? "",
        status: url.searchParams.get("status") ?? "all",
      }));
    }

    if (req.method === "POST" && url.pathname === "/skr-import") {
      if (!requireAdminPost(req, res)) return;
      const body = await readJson(req);
      const rows = skrRegistry.importNames(body.names, { source: body.source, capturedAt: body.capturedAt });
      audit({ username, action: "skr_import", source: String(body.source ?? "ADB capture").slice(0, 100), count: rows.length });
      return json(res, 200, { rows, registry: skrRegistry.snapshot() });
    }

    if (req.method === "POST" && url.pathname === "/skr-export") {
      if (!requireAdminPost(req, res)) return;
      const body = await readJson(req);
      const names = skrRegistry.exportBatch(body.names, Number(body.limit));
      audit({ username, action: "skr_export_to_nft", requested: Number(body.limit), exported: names.length });
      return json(res, 200, { names, registry: skrRegistry.snapshot() });
    }

    if (req.method === "POST" && url.pathname === "/skr-reserve") {
      if (!requireAdminPost(req, res)) return;
      const body = await readJson(req);
      const batch = skrRegistry.reserveNext(Number(body.limit ?? 50));
      audit({ username, action: "skr_reserve_for_nft", requested: Number(body.limit ?? 50), reserved: batch.names.length, reused: batch.reused });
      return json(res, 200, { ...batch, registry: skrRegistry.snapshot() });
    }

    if (req.method === "POST" && url.pathname === "/skr-release") {
      if (!requireAdminPost(req, res)) return;
      const released = skrRegistry.releaseReserved();
      audit({ username, action: "skr_release_reserved", released: released.length });
      return json(res, 200, { released, registry: skrRegistry.snapshot() });
    }

    if (req.method === "POST" && url.pathname === "/skr-remove") {
      if (!requireAdminPost(req, res)) return;
      cleanJobs();
      const body = await readJson(req);
      const name = String(body.name ?? "").normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^@+/, "");
      const jobId = persistentMintJobForName(name);
      if (jobId) return json(res, 409, { error: "username_has_persistent_mint_job", jobId });
      const removed = skrRegistry.removeName(name);
      audit({ username, action: "skr_remove_invalid", removedName: removed.name, previousStatus: removed.status });
      return json(res, 200, { removed, registry: skrRegistry.snapshot() });
    }

    if (req.method === "POST" && url.pathname === "/batch-sign-test") {
      if (!requireAdminPost(req, res)) return;
      const body = await readJson(req);
      const count = Number(body.count);
      const diagnostic = await prepareBatchSigningDiagnostic({ rpcUrl: RPC_URL, count });
      audit({
        username,
        remoteAddress: req.headers["x-real-ip"] ?? req.socket.remoteAddress,
        action: "cnft_batch_sign_test_prepared",
        count,
      });
      return json(res, 200, diagnostic);
    }

    if (req.method === "POST" && url.pathname === "/resolve") {
      if (!requireAdminPost(req, res)) return;
      const body = await readJson(req);
      const rows = await resolveSkrBatch(body.names);
      applyResolvedSkrCorrections(rows);
      audit({
        username,
        remoteAddress: req.headers["x-real-ip"] ?? req.socket.remoteAddress,
        action: "cnft_resolve",
        inputCount: Array.isArray(body.names) ? body.names.length : 0,
        resolvedCount: rows.filter((row) => row.status === "resolved").length,
        notFoundCount: rows.filter((row) => row.status === "not_found").length,
        retryNeededCount: rows.filter((row) => row.status === "lookup_error").length,
      });
      return json(res, 200, { rows });
    }

    if (req.method === "POST" && url.pathname === "/prepare") {
      if (!requireAdminPost(req, res)) return;
      if (!EXECUTION_ENABLED || !findExistingPasses) {
        return json(res, 423, { error: "cnft_execution_locked", message: "cNFT execution is not enabled on this Admin service" });
      }
      const body = await readJson(req);
      if (!safeEqual(body.nonce, nftNonce)) return json(res, 409, { error: "stale_nonce", nftNonce });
      let recipients = [];
      let preparedJobId = null;
      try {
        const rows = await resolveSkrBatch(body.names);
        applyResolvedSkrCorrections(rows);
        recipients = rows.filter((row) => row.status === "resolved");
        if (recipients.length !== rows.length || recipients.length < 1 || recipients.length > MAX_MINTS_PER_WALLET_APPROVAL) {
          const released = skrRegistry.releaseNames(Array.isArray(body.names) ? body.names : []);
          audit({ username, action: "cnft_prepare_rejected", reason: "invalid_mint_batch", released: released.length });
          return json(res, 400, { error: "invalid_mint_batch", rows, max: MAX_MINTS_PER_WALLET_APPROVAL });
        }
        const confirmation = `MINT ${recipients.length} NFT${recipients.length === 1 ? "" : "S"}`;
        if (body.confirmation !== confirmation) {
          const released = skrRegistry.releaseNames(recipients.map((row) => row.name));
          audit({ username, action: "cnft_prepare_rejected", reason: "confirmation_mismatch", released: released.length });
          return json(res, 400, { error: "confirmation_mismatch", confirmation });
        }
        const existingAssets = await findExistingPasses(recipients.map((row) => row.wallet));
        const existing = recipients.map((row, index) => ({
          name: row.name,
          wallet: row.wallet,
          assetId: existingAssets[index].assetId,
        }));
        const alreadyMinted = existing.filter((row) => row.assetId);
        if (alreadyMinted.length) {
          skrRegistry.markMinted(alreadyMinted);
          const existingNames = new Set(alreadyMinted.map((row) => row.name));
          skrRegistry.releaseNames(recipients.filter((row) => !existingNames.has(row.name)).map((row) => row.name));
          return json(res, 409, { error: "recipient_already_has_pass", recipients: alreadyMinted });
        }

        const plan = await prepareAdminCnftTransactions({ rpcUrl: RPC_URL, recipients });
        const jobId = randomBytes(18).toString("base64url");
        preparedJobId = jobId;
        nftNonce = freshNonce();
        jobs.set(jobId, { createdAt: Date.now(), username, plan, broadcasts: [], attemptedSignatures: [] });
        persistJobs();
        audit({
          username,
          remoteAddress: req.headers["x-real-ip"] ?? req.socket.remoteAddress,
          action: "cnft_prepare",
          jobId,
          planHash: plan.planHash,
          recipients: recipients.map((row) => ({ name: row.name, wallet: row.wallet })),
        });
        return json(res, 200, { jobId, plan, nftNonce });
      } catch (error) {
        if (preparedJobId && !(jobs.get(preparedJobId)?.attemptedSignatures ?? []).some(Boolean)) {
          jobs.delete(preparedJobId);
          persistJobs();
        }
        const released = skrRegistry.releaseNames(recipients.length ? recipients.map((row) => row.name) : (Array.isArray(body.names) ? body.names : []));
        audit({ username, action: "cnft_prepare_failed", message: error.message, released: released.length });
        throw error;
      }
    }

    if (req.method === "POST" && url.pathname === "/submit") {
      if (!requireAdminPost(req, res)) return;
      cleanJobs();
      const body = await readJson(req);
      const job = jobs.get(String(body.jobId ?? ""));
      if (!job || job.username !== username) return json(res, 404, { error: "unknown_or_expired_job" });
      let signedTransactions;
      try {
        signedTransactions = validateSignedPlanTransactions({
          plan: job.plan,
          signedTransactionsBase64: body.signedTransactions,
        });
      } catch (error) {
        audit({
          username,
          action: "cnft_signed_plan_rejected",
          jobId: body.jobId,
          planHash: job.plan.planHash,
          message: error.message,
          diagnostic: error.diagnostic ?? null,
        });
        throw error;
      }
      const blockHeight = await currentBlockHeight();
      const lastValidBlockHeight = Number(job.plan.lastValidBlockHeight);
      if (!Number.isSafeInteger(lastValidBlockHeight) || lastValidBlockHeight - blockHeight < MIN_BLOCKHASH_VALIDITY_BLOCKS) {
        audit({ username, action: "cnft_stale_plan_rejected", jobId: body.jobId, blockHeight, lastValidBlockHeight });
        return json(res, 409, {
          error: "prepared_blockhash_too_old",
          message: "The signed mint plan expired before broadcast. Nothing was submitted; prepare a fresh batch.",
          submitted: 0,
          total: signedTransactions.length,
          signatures: [],
        });
      }
      const expectedSignatures = signedTransactions.map(signedTransactionSignature);
      if (job.attemptedSignatures.some(Boolean)) {
        return json(res, 409, {
          error: "submission_already_attempted",
          message: "This signed batch has already entered the broadcast path. Reconcile it; never submit it again.",
          submitted: job.attemptedSignatures.filter(Boolean).length,
          total: signedTransactions.length,
          signatures: job.attemptedSignatures.filter(Boolean),
        });
      }
      for (let index = 0; index < signedTransactions.length; index += 1) {
        if (job.broadcasts[index]) continue;
        const liveBlockHeight = await currentBlockHeight();
        if (lastValidBlockHeight - liveBlockHeight < MIN_REMAINING_BLOCKS_PER_BROADCAST) {
          audit({
            username,
            action: "cnft_batch_broadcast_stopped",
            jobId: body.jobId,
            submitted: job.broadcasts.filter(Boolean).length,
            sequence: index + 1,
            message: "prepared_blockhash_near_expiry",
            liveBlockHeight,
            lastValidBlockHeight,
          });
          return json(res, 409, {
            error: "prepared_blockhash_near_expiry",
            message: "The remaining signed transactions are too close to blockhash expiry and were not submitted. Audit this batch before preparing another one.",
            submitted: job.attemptedSignatures.filter(Boolean).length,
            total: signedTransactions.length,
            signatures: job.attemptedSignatures.filter(Boolean),
          });
        }
        job.attemptedSignatures[index] = expectedSignatures[index];
        persistJobs();
        try {
          const rpcSignature = await broadcastSignedTransaction(signedTransactions[index]);
          if (rpcSignature !== expectedSignatures[index]) {
            throw Object.assign(new Error("Solana RPC returned a signature that does not match the signed transaction"), { status: 503 });
          }
          job.broadcasts[index] = expectedSignatures[index];
          persistJobs();
          audit({ username, action: "cnft_transaction_broadcast", jobId: body.jobId, sequence: index + 1, signature: job.broadcasts[index] });
          const confirmationStatus = await waitForConfirmedSignature(job.broadcasts[index], lastValidBlockHeight);
          audit({ username, action: "cnft_transaction_confirmed_before_next", jobId: body.jobId, sequence: index + 1, signature: job.broadcasts[index], confirmationStatus });
        } catch (error) {
          audit({ username, action: "cnft_batch_broadcast_stopped", jobId: body.jobId, submitted: job.broadcasts.filter(Boolean).length, sequence: index + 1, message: error.message });
          return json(res, error.status ?? 503, {
            error: "broadcast_stopped",
            message: error.message,
            submitted: job.attemptedSignatures.filter(Boolean).length,
            total: signedTransactions.length,
            signatures: job.attemptedSignatures.filter(Boolean),
          });
        }
      }
      audit({ username, action: "cnft_batch_broadcast", jobId: body.jobId, signatures: job.broadcasts });
      return json(res, 200, { ok: true, signatures: job.broadcasts });
    }

    if (req.method === "POST" && url.pathname === "/reconcile") {
      if (!requireAdminPost(req, res)) return;
      cleanJobs();
      const body = await readJson(req);
      const jobId = String(body.jobId ?? "");
      const job = jobs.get(jobId);
      if (!job || job.username !== username) return json(res, 404, { error: "unknown_or_expired_job" });
      const result = await reconcileJob(jobId, job, username);
      return json(res, result.status, result.payload);
    }

    if (req.method === "POST" && url.pathname === "/confirm") {
      if (!requireAdminPost(req, res)) return;
      cleanJobs();
      const body = await readJson(req);
      const job = jobs.get(String(body.jobId ?? ""));
      if (!job || job.username !== username) return json(res, 404, { error: "unknown_or_expired_job" });
      const serverSignatures = (job.attemptedSignatures ?? []).filter(Boolean);
      const clientSignatures = Array.isArray(body.signatures) ? body.signatures.map(String) : [];
      if (serverSignatures.length !== job.plan.transactions.length ||
          clientSignatures.length !== serverSignatures.length ||
          clientSignatures.some((signature, index) => signature !== serverSignatures[index])) {
        return json(res, 409, { error: "signature_set_mismatch", expected: serverSignatures.length });
      }
      const result = await reconcileJob(String(body.jobId), job, username);
      return json(res, result.status, result.payload);
    }

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, error.status ?? 500, { error: "request_failed", message: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: "luckyme_admin_cnft_started", host: HOST, port: PORT, executionEnabled: EXECUTION_ENABLED }));
});
