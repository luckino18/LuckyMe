import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_CNFT_AUTHORITY,
  BATCH_SIGN_TEST_COUNTS,
  MAX_ADMIN_CNFT_RECIPIENTS,
  MAX_MINTS_PER_TRANSACTION,
  MAX_MINTS_PER_WALLET_APPROVAL,
  SKR_RESOLUTION_CONCURRENCY,
  SKR_RESOLUTION_MAX_ATTEMPTS,
  buildBatchSigningDiagnosticTransactions,
  createExistingPassBatchChecker,
  createSkrResolver,
  normalizeSkrBatch,
  runPacedMintSimulations,
  signedTransactionSignature,
  simulateSerialized,
  validateSignedPlanTransactions,
} from "../scripts/admin-cnft-tool.mjs";
import { ComputeBudgetProgram, Keypair, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";

const tool = readFileSync("scripts/admin-cnft-tool.mjs", "utf8");
const server = readFileSync("scripts/admin-cnft-server.mjs", "utf8");
const service = readFileSync("deploy/systemd/luckyme-admin-cnft.service", "utf8");
const nginx = readFileSync("deploy/nginx/luckyme-admin-location.conf", "utf8");
const html = readFileSync("site/lucky-me.app/admin/index.html", "utf8");
const client = readFileSync("site/lucky-me.app/admin/admin.js", "utf8");

test("Admin cNFT usernames are normalized, validated, and duplicate-aware", () => {
  const rows = normalizeSkrBatch(["@Gigel.SKR", "friend_name.skr", "gigel.skr", "bad domain"]);
  assert.deepEqual(rows.map(({ name, validFormat, duplicate }) => ({ name, validFormat, duplicate })), [
    { name: "gigel.skr", validFormat: true, duplicate: false },
    { name: "friend_name.skr", validFormat: true, duplicate: false },
    { name: "gigel.skr", validFormat: true, duplicate: true },
    { name: "bad domain", validFormat: false, duplicate: false },
  ]);
  assert.throws(
    () => normalizeSkrBatch(Array.from({ length: MAX_ADMIN_CNFT_RECIPIENTS + 1 }, (_, index) => `friend${index}.skr`)),
    /at most 1000 usernames/,
  );
  assert.equal(MAX_ADMIN_CNFT_RECIPIENTS, 1_000);
  assert.equal(normalizeSkrBatch(Array.from({ length: 1_000 }, (_, index) => `friend${index}.skr`)).length, 1_000);
});

test("Admin SKR resolver corrects an OCR-only initial i/l error and reuses reviewed results", async () => {
  const calls = [];
  const owner = "GbJKVry6sCz8GdbUHAEJu5F4n6BmtftZts3xg9Uu7LqD";
  const resolver = createSkrResolver({
    concurrency: 1,
    minLookupIntervalMs: 0,
    sleep: async () => {},
    lookupRecord: async (name) => {
      calls.push(name);
      return name === "lserberl.skr" ? { isValid: true, owner } : undefined;
    },
  });
  const [first] = await resolver(["iserberl.skr"]);
  assert.equal(first.status, "resolved");
  assert.equal(first.name, "lserberl.skr");
  assert.equal(first.correctedFrom, "iserberl.skr");
  const before = calls.length;
  const [second] = await resolver(["iserberl.skr"]);
  assert.equal(second.name, "lserberl.skr");
  assert.equal(calls.length, before);
});

test("Admin simulation retries a temporary RPC throttle without weakening checks", async () => {
  let calls = 0;
  const waits = [];
  const result = await simulateSerialized({
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
    serialized: Buffer.from([1, 2, 3]),
    recipientCount: 1,
    payerBalanceBefore: 1_000_000,
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) return { ok: false, status: 429, headers: { get: () => null }, json: async () => ({ error: { code: -32429 } }) };
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ result: { value: { err: null, accounts: [{ lamports: 999_000 }], unitsConsumed: 12_345 } } }),
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(waits.length, 1);
  assert.equal(result.payerDebitLamports, 1_000);
});

test("Admin simulation retries a temporary network interruption", async () => {
  let calls = 0;
  const waits = [];
  const result = await simulateSerialized({
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
    serialized: Buffer.from([1, 2, 3]),
    recipientCount: 1,
    payerBalanceBefore: 1_000_000,
    sleep: async (milliseconds) => waits.push(milliseconds),
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("fetch failed");
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        json: async () => ({ result: { value: { err: null, accounts: [{ lamports: 999_000 }], unitsConsumed: 12_345 } } }),
      };
    },
  });
  assert.equal(calls, 2);
  assert.equal(waits.length, 1);
  assert.equal(result.payerDebitLamports, 1_000);
});

test("Admin SKR resolver retries transient batch failures without reporting false Not found", async () => {
  const calls = new Map();
  const owner = "GbJKVry6sCz8GdbUHAEJu5F4n6BmtftZts3xg9Uu7LqD";
  const resolver = createSkrResolver({
    concurrency: 3,
    maxAttempts: 4,
    minLookupIntervalMs: 0,
    sleep: async () => {},
    lookupRecord: async (name) => {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      if (name === "joony.skr" && calls.get(name) < 3) throw new Error("429 Too Many Requests");
      if (name === "temporary.skr") throw new Error("RPC timeout");
      if (name === "missing.skr") return undefined;
      return { isValid: true, owner };
    },
  });
  const rows = await resolver(["joony.skr", "missing.skr", "temporary.skr"]);
  assert.equal(SKR_RESOLUTION_CONCURRENCY, 3);
  assert.equal(SKR_RESOLUTION_MAX_ATTEMPTS, 4);
  assert.deepEqual(rows.map(({ status, attempts }) => ({ status, attempts })), [
    { status: "resolved", attempts: 3 },
    { status: "not_found", attempts: 2 },
    { status: "lookup_error", attempts: 4 },
  ]);
  assert.equal(rows[0].wallet, owner);
  assert.equal(calls.get("joony.skr"), 3);
  assert.equal(calls.get("temporary.skr"), 4);
});

test("Admin SKR resolver reconfirms empty RPC responses across a 100-name batch", async () => {
  const calls = new Map();
  const names = Array.from({ length: 99 }, (_, index) => `reviewer${index}.skr`).concat("joony.skr");
  const resolver = createSkrResolver({
    concurrency: 3,
    maxAttempts: 4,
    minLookupIntervalMs: 0,
    sleep: async () => {},
    lookupRecord: async (name) => {
      calls.set(name, (calls.get(name) ?? 0) + 1);
      if (calls.get(name) === 1) return undefined;
      const position = names.indexOf(name) + 1;
      const owner = new PublicKey(Uint8Array.from({ length: 32 }, (_, index) => (position + index) % 256));
      return { isValid: true, owner };
    },
  });
  const rows = await resolver(names);
  assert.equal(rows.length, 100);
  assert.equal(rows.filter((row) => row.status === "resolved").length, 100);
  assert.equal(rows.find((row) => row.name === "joony.skr").status, "resolved");
  assert.ok(rows.every((row) => row.attempts === 2));
});

test("Admin cNFT preparation contains no authority secret or server-side sender", () => {
  assert.equal(ADMIN_CNFT_AUTHORITY, "6p8dv8FaqjdoJ2MQHwrYADdP65FKcyyGX3a7kqKtf24H");
  assert.equal(MAX_MINTS_PER_TRANSACTION, 3);
  assert.equal(MAX_MINTS_PER_WALLET_APPROVAL, 50);
  assert.doesNotMatch(tool, /Keypair|fromSecretKey|sendRawTransaction|secretKey/);
  assert.match(tool, /createNoopSigner/);
  assert.match(tool, /simulateTransaction/);
  assert.match(tool, /setBlockhash\(recentBlockhash\)/);
  assert.match(tool, /payerDebitLamports <= maxDebitLamports/);
});

test("Admin duplicate-pass guard checks a whole recipient batch with one DAS collection request", async () => {
  const requested = Array.from({ length: 100 }, (_, index) =>
    new PublicKey(Uint8Array.from({ length: 32 }, (_, byte) => (index + byte + 1) % 256)).toBase58()
  );
  const existingAsset = new PublicKey(Uint8Array.from({ length: 32 }, (_, byte) => byte + 70)).toBase58();
  const calls = [];
  const checker = createExistingPassBatchChecker({
    dasRpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
    sleep: async () => {},
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        json: async () => ({
          result: {
            items: [{
              id: existingAsset,
              ownership: { owner: requested[26], ownership_model: "single" },
              compression: { compressed: true },
              creators: [{ address: ADMIN_CNFT_AUTHORITY, verified: true }],
              grouping: [{ group_key: "collection", group_value: "HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J" }],
            }],
          },
        }),
      };
    },
  });
  const results = await checker(requested);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "searchAssets");
  assert.equal(calls[0].params.compressed, true);
  assert.equal(calls[0].params.tokenType, undefined);
  assert.deepEqual(calls[0].params.grouping, ["collection", "HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J"]);
  assert.equal(results[26].assetId, existingAsset);
  assert.equal(results.filter((row) => row.assetId).length, 1);
});

test("Admin duplicate-pass guard ignores burned compressed assets", async () => {
  const owner = Keypair.generate().publicKey.toBase58();
  const checker = createExistingPassBatchChecker({
    dasRpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
    sleep: async () => {},
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        result: {
          items: [{
            id: Keypair.generate().publicKey.toBase58(),
            burnt: true,
            ownership: { owner, ownership_model: "single" },
            compression: { compressed: true },
            creators: [{ address: ADMIN_CNFT_AUTHORITY, verified: true }],
            grouping: [{ group_key: "collection", group_value: "HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J" }],
          }],
        },
      }),
    }),
  });
  assert.equal((await checker([owner]))[0].assetId, null);
});

test("Admin Solflare diagnostic builds signed-only memo batches without a broadcast path", () => {
  assert.deepEqual(BATCH_SIGN_TEST_COUNTS, [5, 20, 50, 100]);
  const transactions = buildBatchSigningDiagnosticTransactions({
    recentBlockhash: "11111111111111111111111111111111",
    count: 5,
  });
  assert.equal(transactions.length, 5);
  const messages = transactions.map((encoded) => Transaction.from(Buffer.from(encoded, "base64")));
  assert.equal(new Set(transactions).size, 5);
  assert.ok(messages.every((transaction) => transaction.feePayer?.toBase58() === ADMIN_CNFT_AUTHORITY));
  assert.ok(messages.every((transaction) => transaction.instructions.length === 1));
  assert.throws(() => buildBatchSigningDiagnosticTransactions({ recentBlockhash: "11111111111111111111111111111111", count: 6 }), /must be one of/);
});

test("Admin cNFT API is proxy protected, locked by default, and nonce gated", () => {
  assert.match(server, /LUCKYME_ADMIN_CNFT_EXECUTION_ENABLED === "true"/);
  assert.match(server, /cnft_execution_locked/);
  assert.match(server, /trusted_proxy_required/);
  assert.match(server, /admin_request_header_required/);
  assert.match(server, /stale_nonce/);
  assert.match(server, /recipient_already_has_pass/);
  assert.match(server, /MAX_MINTS_PER_WALLET_APPROVAL/);
  assert.match(server, /clientSignatures\.length !== serverSignatures\.length/);
  assert.match(server, /url\.pathname === "\/submit"/);
  assert.match(server, /validateSignedPlanTransactions/);
  assert.match(server, /cnft_batch_broadcast_stopped/);
  assert.match(server, /url\.pathname === "\/reconcile"/);
  assert.match(server, /cnft_job_reconciled/);
  assert.match(server, /cnft_stale_plan_rejected/);
  assert.match(server, /MIN_BLOCKHASH_VALIDITY_BLOCKS/);
  assert.match(server, /cnft_prepare_failed/);
  assert.match(server, /skrRegistry\.releaseNames/);
  assert.match(server, /attemptedSignatures/);
  assert.match(server, /LUCKYME_ADMIN_CNFT_JOB_STORE_PATH/);
  assert.match(server, /persistJobs\(\)/);
  assert.match(server, /pendingJobs/);
  assert.match(client, /Audit interrupted batch/);
  assert.match(server, /signedTransactionSignature/);
  assert.match(server, /signature_set_mismatch/);
  assert.match(server, /waitForConfirmedSignature\(job\.broadcasts\[index\], lastValidBlockHeight\)/);
  assert.match(server, /cnft_transaction_confirmed_before_next/);
  assert.match(server, /MIN_REMAINING_BLOCKS_PER_BROADCAST/);
  assert.match(server, /prepared_blockhash_near_expiry/);
  assert.match(server, /const liveBlockHeight = await currentBlockHeight\(\)/);
  assert.match(server, /skipPreflight: true/);
  assert.doesNotMatch(server, /setTimeout\(resolve, 250\)/);
  assert.match(server, /confirmation_mismatch/);
  assert.match(server, /pendingTransactions: pending/);
  assert.match(server, /async function signatureStatuses\(signatures\)/);
  assert.match(server, /params: \[signatures, \{ searchTransactionHistory: true \}\]/);
  assert.match(server, /https:\/\/api\.mainnet-beta\.solana\.com/);
  assert.doesNotMatch(server, /mapWithConcurrency\(signatures, 5, signatureStatus\)/);
  assert.match(server, /url\.pathname === "\/batch-sign-test"/);
  assert.match(server, /cnft_batch_sign_test_prepared/);
  assert.match(service, /User=luckyme/);
  assert.match(service, /LUCKYME_ADMIN_CNFT_EXECUTION_ENABLED=false/);
  assert.doesNotMatch(service, /User=root/);
  assert.match(nginx, /location \^~ \/admin\/api\/nft\//);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:8792\//);
  assert.match(nginx, /client_max_body_size 512k/);
  assert.match(nginx, /proxy_read_timeout 300s/);
});

test("Admin cNFT UI accepts Enter and multiple recipients before explicit wallet approval", () => {
  assert.match(html, /data-admin-tab="nft-send"/);
  assert.match(html, /data-admin-panel="nft-send"/);
  assert.match(html, /id="nft-recipient-input"/);
  assert.match(html, /Review &amp; mint/);
  assert.match(client, /event\.key === "Enter"/);
  assert.match(client, /parseNftNames/);
  assert.doesNotMatch(client, /window\.prompt/);
  assert.match(client, /SOLANA_SIGN_TRANSACTION/);
  assert.match(client, /feature\.signTransaction\(\.\.\.inputs\)/);
  assert.doesNotMatch(client, /feature\.signAndSendTransaction/);
  assert.match(client, /nftApi\("submit"/);
  assert.match(client, /nftApi\("reconcile"/);
  assert.match(client, /No transaction is being retried or rebroadcast/);
  assert.match(client, /transactionsBase64\.length > 100/);
  assert.match(client, /error\.httpStatus = response\.status/);
  assert.match(client, /error\.httpStatus !== 503/);
  assert.match(client, /0 broadcast · 0 NFT minted · 0 SOL spent/);
  assert.match(html, /id="nft-batch-connect-wallet"/);
  assert.doesNotMatch(html, /data-batch-sign-count="200"/);
  assert.doesNotMatch(html, /data-batch-sign-count="334"/);
  assert.match(client, /connected\.account\.address !== nftState\.config\.authority/);
  assert.match(client, /maxRecipients \|\| 1_000/);
  assert.doesNotMatch(client, /Ledger-backed/);
});

test("Admin mint plans refresh the shared blockhash after simulations", () => {
  const preparationStart = tool.indexOf("export async function prepareAdminCnftTransactions");
  const transactionsDeclaration = tool.indexOf("const transactions = [];", preparationStart);
  const transactionsUse = tool.indexOf("transactions.push({", preparationStart);
  assert.ok(preparationStart >= 0 && transactionsDeclaration > preparationStart);
  assert.ok(transactionsUse > transactionsDeclaration, "transactions must be initialized before the first use");
  assert.match(tool, /const freshBlockhash = await umi\.rpc\.getLatestBlockhash/);
  assert.match(tool, /builder\.setBlockhash\(freshBlockhash\)/);
  assert.match(tool, /lastValidBlockHeight: Number\(freshBlockhash\.lastValidBlockHeight\)/);
});

test("Admin executes all 34 simulations required for 100 recipients before the fresh rebuild", async () => {
  const waits = [];
  const calls = [];
  const candidates = Array.from({ length: 34 }, (_, index) => ({
    sequence: index + 1,
    recipientCount: index === 33 ? 1 : 3,
  }));
  const prepared = await runPacedMintSimulations({
    candidates,
    intervalMs: 300,
    sleep: async (milliseconds) => waits.push(milliseconds),
    simulateCandidate: async (candidate, index) => {
      calls.push(index);
      return { unitsConsumed: 100_000 + candidate.recipientCount };
    },
  });
  assert.equal(prepared.length, 34);
  assert.equal(prepared.reduce((sum, row) => sum + row.recipientCount, 0), 100);
  assert.deepEqual(calls, Array.from({ length: 34 }, (_, index) => index));
  assert.equal(waits.length, 33);
  assert.ok(waits.every((milliseconds) => milliseconds === 300));
  assert.equal(prepared[33].simulation.unitsConsumed, 100_001);
});

test("Admin derives the exact Solana signature from every signed transaction", () => {
  const authority = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const transaction = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [],
  }).compileToV0Message());
  transaction.sign([authority]);
  const signature = signedTransactionSignature(Buffer.from(transaction.serialize()).toString("base64"));
  assert.match(signature, /^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
  assert.throws(() => signedTransactionSignature("not-a-transaction"), /invalid/);
});

test("Admin validates a complete 100-recipient wallet approval containing 34 transactions", () => {
  const authority = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const planned = Array.from({ length: 34 }, (_, transactionIndex) => {
    const programId = new PublicKey(Uint8Array.from({ length: 32 }, (_, byte) => ((transactionIndex + 1) * 7 + byte) % 256));
    return new VersionedTransaction(new TransactionMessage({
      payerKey: authority.publicKey,
      recentBlockhash: "11111111111111111111111111111111",
      instructions: [new TransactionInstruction({ keys: [], programId, data: Buffer.from([transactionIndex]) })],
    }).compileToV0Message());
  });
  const signed = planned.map((transaction) => {
    const copy = VersionedTransaction.deserialize(transaction.serialize());
    copy.sign([authority]);
    return copy;
  });
  const validated = validateSignedPlanTransactions({
    plan: { transactions: planned.map((transaction) => ({ transactionBase64: Buffer.from(transaction.serialize()).toString("base64") })) },
    signedTransactionsBase64: [...signed].reverse().map((transaction) => Buffer.from(transaction.serialize()).toString("base64")),
    authorityAddress: authority.publicKey.toBase58(),
  });
  assert.equal(validated.length, 34);
  assert.deepEqual(validated, signed.map((transaction) => Buffer.from(transaction.serialize()).toString("base64")));
});

test("Admin accepts an authority-refreshed blockhash but rejects any reviewed-plan change", () => {
  const authority = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const recipient = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 33)).publicKey;
  const message = new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [new TransactionInstruction({ keys: [], programId: recipient, data: Buffer.alloc(0) })],
  }).compileToV0Message();
  const planned = new VersionedTransaction(message);
  const signed = new VersionedTransaction(message);
  signed.sign([authority]);
  const validated = validateSignedPlanTransactions({
    plan: { transactions: [{ transactionBase64: Buffer.from(planned.serialize()).toString("base64") }] },
    signedTransactionsBase64: [Buffer.from(signed.serialize()).toString("base64")],
    authorityAddress: authority.publicKey.toBase58(),
  });
  assert.equal(validated.length, 1);
  const altered = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [new TransactionInstruction({ keys: [], programId: PublicKey.default, data: Buffer.from([1]) })],
  }).compileToV0Message());
  altered.sign([authority]);
  assert.throws(() => validateSignedPlanTransactions({
    plan: { transactions: [{ transactionBase64: Buffer.from(planned.serialize()).toString("base64") }] },
    signedTransactionsBase64: [Buffer.from(altered.serialize()).toString("base64")],
    authorityAddress: authority.publicKey.toBase58(),
  }), /does not match/);

  const refreshedBlockhash = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: Keypair.generate().publicKey.toBase58(),
    instructions: [new TransactionInstruction({ keys: [], programId: recipient, data: Buffer.alloc(0) })],
  }).compileToV0Message());
  refreshedBlockhash.sign([authority]);
  const refreshedValidated = validateSignedPlanTransactions({
    plan: { transactions: [{ transactionBase64: Buffer.from(planned.serialize()).toString("base64") }] },
    signedTransactionsBase64: [Buffer.from(refreshedBlockhash.serialize()).toString("base64")],
    authorityAddress: authority.publicKey.toBase58(),
  });
  assert.equal(refreshedValidated.length, 1);
});

test("Admin accepts a wallet-reordered signed batch and restores reviewed plan order", () => {
  const authority = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const recipients = [41, 42, 43].map((seed) => Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + seed)).publicKey);
  const planned = recipients.map((recipient) => new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: "11111111111111111111111111111111",
    instructions: [new TransactionInstruction({ keys: [], programId: recipient, data: Buffer.from([recipient.toBytes()[0]]) })],
  }).compileToV0Message()));
  const signed = planned.map((transaction) => {
    const copy = VersionedTransaction.deserialize(transaction.serialize());
    copy.sign([authority]);
    return copy;
  });
  const reordered = [signed[2], signed[0], signed[1]];
  const validated = validateSignedPlanTransactions({
    plan: { transactions: planned.map((transaction) => ({ transactionBase64: Buffer.from(transaction.serialize()).toString("base64") })) },
    signedTransactionsBase64: reordered.map((transaction) => Buffer.from(transaction.serialize()).toString("base64")),
    authorityAddress: authority.publicKey.toBase58(),
  });
  assert.deepEqual(validated, signed.map((transaction) => Buffer.from(transaction.serialize()).toString("base64")));
});

test("Admin accepts bounded wallet protection instructions but rejects unrelated additions", () => {
  const authority = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 1));
  const recipient = Keypair.fromSeed(Uint8Array.from({ length: 32 }, (_, index) => index + 65)).publicKey;
  const mintInstruction = new TransactionInstruction({ keys: [], programId: recipient, data: Buffer.from([7, 8, 9]) });
  const blockhash = "11111111111111111111111111111111";
  const planned = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [mintInstruction],
  }).compileToV0Message());
  const walletAdjusted = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 }), mintInstruction],
  }).compileToV0Message());
  walletAdjusted.sign([authority]);
  assert.equal(validateSignedPlanTransactions({
    plan: { transactions: [{ transactionBase64: Buffer.from(planned.serialize()).toString("base64") }] },
    signedTransactionsBase64: [Buffer.from(walletAdjusted.serialize()).toString("base64")],
    authorityAddress: authority.publicKey.toBase58(),
  }).length, 1);

  const lighthouseProgram = new PublicKey("L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95");
  const walletProtected = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 25_000 }),
      mintInstruction,
      new TransactionInstruction({
        keys: [{ pubkey: authority.publicKey, isSigner: true, isWritable: true }],
        programId: lighthouseProgram,
        data: Buffer.from([1, 2, 3]),
      }),
    ],
  }).compileToV0Message());
  walletProtected.sign([authority]);
  assert.equal(validateSignedPlanTransactions({
    plan: { transactions: [{ transactionBase64: Buffer.from(planned.serialize()).toString("base64") }] },
    signedTransactionsBase64: [Buffer.from(walletProtected.serialize()).toString("base64")],
    authorityAddress: authority.publicKey.toBase58(),
  }).length, 1);

  const misplacedLighthouse = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [
      new TransactionInstruction({ keys: [], programId: lighthouseProgram, data: Buffer.from([1]) }),
      mintInstruction,
    ],
  }).compileToV0Message());
  misplacedLighthouse.sign([authority]);
  assert.throws(() => validateSignedPlanTransactions({
    plan: { transactions: [{ transactionBase64: Buffer.from(planned.serialize()).toString("base64") }] },
    signedTransactionsBase64: [Buffer.from(misplacedLighthouse.serialize()).toString("base64")],
    authorityAddress: authority.publicKey.toBase58(),
  }), /does not match/);

  const malicious = new VersionedTransaction(new TransactionMessage({
    payerKey: authority.publicKey,
    recentBlockhash: blockhash,
    instructions: [mintInstruction, new TransactionInstruction({ keys: [], programId: PublicKey.default, data: Buffer.from([1]) })],
  }).compileToV0Message());
  malicious.sign([authority]);
  assert.throws(() => validateSignedPlanTransactions({
    plan: { transactions: [{ transactionBase64: Buffer.from(planned.serialize()).toString("base64") }] },
    signedTransactionsBase64: [Buffer.from(malicious.serialize()).toString("base64")],
    authorityAddress: authority.publicKey.toBase58(),
  }), /does not match/);
});

test("Admin cNFT batches use at most 50 recipients without a typed confirmation popup", () => {
  assert.doesNotMatch(client, /window\.prompt/);
  assert.doesNotMatch(client, /Type exactly/);
  assert.match(client, /Math\.min\(50, Math\.max/);
  assert.match(client, /mintsPerApproval\) \|\| 50/);
  assert.match(client, /mintsPerTransaction\) \|\| 3/);
  assert.doesNotMatch(client, /recipients\.map\(\(row\) => `\$\{row\.name\} → \$\{row\.wallet\}`\)\.join\("\\n"\)/);
});
