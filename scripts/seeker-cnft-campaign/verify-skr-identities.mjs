import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { Connection, PublicKey } from "@solana/web3.js";

const require = createRequire(import.meta.url);
const {
  ANS_PROGRAM_ID,
  findTldHouse,
  getDomainKey,
  getHashedName,
  getNameAccountKeyWithBump,
  getOriginNameAccountKey,
  performReverseLookupBatched,
} = require("@onsol/tldparser");

const INPUT_PATH = path.resolve(
  process.env.LUCKYME_SKR_INPUT ||
    "/Users/victor/Desktop/LuckyMe_CURRENT/LuckyMe-Seeker-SGT-1000-wallet-test.json",
);
const OUTPUT_PATH = path.resolve(
  process.env.LUCKYME_SKR_OUTPUT ||
    "/Users/victor/Desktop/LuckyMe_CURRENT/LuckyMe-Seeker-SGT-1000-with-SKR-verification.json",
);
const RPC_URL = process.env.LUCKYME_SKR_RPC_URL || "https://api.mainnet-beta.solana.com";
const MAX_LOGICAL_REQUESTS = 50;
const BATCH_SIZE = 100;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map(
      (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function ownerFromSlice(account) {
  const bytes = account.account.data;
  assert(Buffer.isBuffer(bytes) && bytes.length === 32, "invalid ANS owner slice");
  return new PublicKey(bytes).toBase58();
}

async function retry(label, operation) {
  let lastError;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const message = String(error?.message || error);
      const retryable = /429|rate|timeout|fetch failed|socket/i.test(message);
      if (!retryable || attempt === 5) throw error;
      const delayMs = Math.min(15_000, 1_500 * (attempt + 1));
      console.log(JSON.stringify({ phase: label, retry: attempt + 1, delayMs }));
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

async function main() {
  const inputBytes = await readFile(INPUT_PATH);
  const cohort = JSON.parse(inputBytes);
  assert(cohort.walletCount === 1_000, "expected a 1,000-wallet cohort");
  assert(cohort.wallets?.length === 1_000, "expected exactly 1,000 wallet rows");
  const wallets = new Set(cohort.wallets.map((row) => new PublicKey(row.wallet).toBase58()));
  assert(wallets.size === 1_000, "cohort wallets are not unique");

  const connection = new Connection(RPC_URL, "finalized");
  let logicalRequests = 0;
  const originalRpcRequest = connection._rpcRequest.bind(connection);
  connection._rpcRequest = async (...args) => {
    if (logicalRequests >= MAX_LOGICAL_REQUESTS) {
      throw new Error(`hard logical RPC budget reached: ${MAX_LOGICAL_REQUESTS}`);
    }
    logicalRequests += 1;
    return originalRpcRequest(...args);
  };

  const tldName = ".skr";
  const origin = await getOriginNameAccountKey();
  const parentHash = await getHashedName(tldName);
  const [parentAccount] = getNameAccountKeyWithBump(parentHash, undefined, origin);
  const [tldHouse] = findTldHouse(tldName);

  console.log(JSON.stringify({ phase: "scan_skr_registry", logicalRequests }));
  const nameAccounts = await retry("scan_skr_registry", () => connection.getProgramAccounts(
    ANS_PROGRAM_ID,
    {
      commitment: "finalized",
      filters: [{ memcmp: { offset: 8, bytes: parentAccount.toBase58() } }],
      dataSlice: { offset: 40, length: 32 },
    },
  ));

  const matches = nameAccounts
    .map((account) => ({
      nameAccount: account.pubkey,
      wallet: ownerFromSlice(account),
    }))
    .filter((row) => wallets.has(row.wallet));

  const resolved = [];
  for (let offset = 0; offset < matches.length; offset += BATCH_SIZE) {
    const batch = matches.slice(offset, offset + BATCH_SIZE);
    const domains = await retry("reverse_lookup", () => performReverseLookupBatched(
      connection,
      batch.map((row) => row.nameAccount),
      tldHouse,
    ));
    for (let index = 0; index < batch.length; index += 1) {
      const rawDomain = domains[index];
      const domain = `${String(rawDomain || "").toLowerCase()}.skr`;
      const safeDomain = /^[a-z0-9][a-z0-9_-]{0,63}\.skr$/.test(domain);
      const derived = safeDomain ? (await getDomainKey(domain)).pubkey.toBase58() : null;
      resolved.push({
        wallet: batch[index].wallet,
        skrDomain: safeDomain ? domain : null,
        nameAccount: batch[index].nameAccount.toBase58(),
        forwardAddressMatches: derived === batch[index].nameAccount.toBase58(),
      });
    }
    console.log(JSON.stringify({
      phase: "reverse_lookup",
      resolved: resolved.length,
      matches: matches.length,
      logicalRequests,
    }));
  }

  const domainsByWallet = new Map();
  for (const row of resolved) {
    if (!row.skrDomain || !row.forwardAddressMatches) continue;
    const list = domainsByWallet.get(row.wallet) || [];
    list.push(row);
    domainsByWallet.set(row.wallet, list);
  }

  const rows = cohort.wallets.map((source) => {
    const domains = (domainsByWallet.get(source.wallet) || [])
      .sort((left, right) => left.skrDomain.localeCompare(right.skrDomain));
    return {
      cohortIndex: source.cohortIndex,
      wallet: source.wallet,
      sgtMints: source.sgtMints,
      skrDomains: domains.map((row) => row.skrDomain),
      skrNameAccounts: domains.map((row) => row.nameAccount),
      hasVerifiedSkrRoundTrip: domains.length > 0,
    };
  });
  const verifiedCount = rows.filter((row) => row.hasVerifiedSkrRoundTrip).length;
  const body = {
    schemaVersion: 1,
    kind: "sgt-holder-skr-round-trip-verification",
    cluster: "mainnet-beta",
    sourceFileSha256: sha256(inputBytes),
    walletCount: rows.length,
    verifiedSkrWalletCount: verifiedCount,
    noVerifiedSkrWalletCount: rows.length - verifiedCount,
    registryNameAccountCount: nameAccounts.length,
    matchedNameAccountCount: matches.length,
    logicalRpcRequestCount: logicalRequests,
    verification: [
      "current wallet appeared as owner in the .skr ANS registry",
      "reverse lookup returned a syntactically valid .skr name",
      "forward derivation of that .skr name returned the same ANS name account",
    ],
    wallets: rows,
  };
  body.sha256 = sha256(canonicalJson(body));
  body.completedAt = new Date().toISOString();
  await writeFile(OUTPUT_PATH, `${JSON.stringify(body, null, 2)}\n`);
  console.log(JSON.stringify({
    ok: true,
    walletCount: body.walletCount,
    verifiedSkrWalletCount: body.verifiedSkrWalletCount,
    noVerifiedSkrWalletCount: body.noVerifiedSkrWalletCount,
    registryNameAccountCount: body.registryNameAccountCount,
    logicalRpcRequestCount: body.logicalRpcRequestCount,
    sha256: body.sha256,
    outputPath: OUTPUT_PATH,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
