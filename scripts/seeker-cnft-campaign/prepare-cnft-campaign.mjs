import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { getMerkleTreeSize } from "@metaplex-foundation/mpl-account-compression";
import { publicKey } from "@metaplex-foundation/umi";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const defaultRecipients = path.resolve(repoRoot, "../../../../../../LuckyMe-Seeker-SGT-TOP-500-by-activity.json");
const recipientsPath = path.resolve(
  process.env.LUCKYME_CNFT_RECIPIENTS || process.argv[2] || defaultRecipients,
);
const outputDir = path.resolve(
  process.env.LUCKYME_CNFT_OUTPUT_DIR ||
    path.join(repoRoot, "artifacts/seeker-cnft-campaign/cnft-500"),
);

const metadata = {
  name: "LuckyMe Seeker Pass",
  symbol: "LUCKYME",
  uri: "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.json",
  image: "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.png",
  sellerFeeBasisPoints: 0,
};
const tree = {
  version: "BubblegumV2",
  maxDepth: 14,
  maxBufferSize: 64,
  canopyDepth: 0,
  capacity: 2 ** 14,
  public: false,
};
tree.accountBytes = getMerkleTreeSize(
  tree.maxDepth,
  tree.maxBufferSize,
  tree.canopyDepth,
);

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

async function getTreeRentLamports() {
  const rpcUrl = process.env.SEEKER_SGT_RPC_URL || "https://api.mainnet-beta.solana.com";
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "luckyme-cnft-rent",
      method: "getMinimumBalanceForRentExemption",
      params: [tree.accountBytes],
    }),
  });
  assert(response.ok, `rent RPC returned HTTP ${response.status}`);
  const body = await response.json();
  assert(!body.error && Number.isSafeInteger(body.result), "invalid rent RPC response");
  return body.result;
}

async function main() {
  const recipientBytes = await readFile(recipientsPath);
  const snapshot = JSON.parse(recipientBytes);
  assert(snapshot.walletCount === 500, "recipient snapshot must contain exactly 500 wallets");
  assert(snapshot.wallets?.length === 500, "recipient wallet array must contain exactly 500 rows");

  const seen = new Set();
  const queue = snapshot.wallets.map((row, offset) => {
    const wallet = publicKey(row.wallet).toString();
    assert(!seen.has(wallet), `duplicate recipient: ${wallet}`);
    assert(row.activityRank === offset + 1, `invalid activity rank at row ${offset + 1}`);
    assert(Array.isArray(row.sgtMints) && row.sgtMints.length > 0, `missing SGT mint for ${wallet}`);
    seen.add(wallet);
    return {
      mintIndex: offset + 1,
      activityRank: row.activityRank,
      leafOwner: wallet,
      sgtMints: [...row.sgtMints].sort(),
      status: "pending",
    };
  });

  const metadataPath = path.join(repoRoot, "site/lucky-me.app/cnft/luckyme-seeker-pass-v2.json");
  const metadataBody = JSON.parse(await readFile(metadataPath, "utf8"));
  assert(metadataBody.name === metadata.name, "hosted metadata name does not match mint metadata");
  assert(metadataBody.image === metadata.image, "hosted metadata image does not match plan");

  const treeRentLamports = await getTreeRentLamports();
  const transactionCount = 2 + queue.length;
  const baseFeeEstimateLamports = (queue.length + 4) * 5_000;
  const plan = {
    schemaVersion: 1,
    status: "prepared-not-authorized",
    cluster: "mainnet-beta",
    standard: "Metaplex Bubblegum V2",
    recipients: {
      count: queue.length,
      uniqueWallets: seen.size,
      sourcePath: recipientsPath,
      sourceFileSha256: sha256(recipientBytes),
      sourceInternalSha256: snapshot.sha256,
    },
    metadata,
    collection: {
      standard: "MPL Core Collection",
      plugin: "BubblegumV2",
      verifiedAtMint: true,
      updateAuthority: "payer identity selected at execution",
    },
    tree: {
      ...tree,
      rentLamports: treeRentLamports,
      rentSol: treeRentLamports / 1_000_000_000,
      remainingCapacityAfterCampaign: tree.capacity - queue.length,
    },
    execution: {
      collectionTransactions: 1,
      treeTransactions: 1,
      mintTransactions: queue.length,
      totalTransactions: transactionCount,
      baseFeeEstimateLamports,
      baseFeeEstimateSol: baseFeeEstimateLamports / 1_000_000_000,
      excludedFromEstimate: [
        "MPL Core collection rent and protocol fee",
        "priority fees",
        "failed or retried transactions",
      ],
      signingRequired: true,
      sentTransactions: 0,
    },
  };
  plan.planSha256 = sha256(canonicalJson(plan));

  await mkdir(outputDir, { recursive: true });
  await writeFile(path.join(outputDir, "campaign-plan.json"), `${JSON.stringify(plan, null, 2)}\n`);
  await writeFile(path.join(outputDir, "mint-queue.json"), `${JSON.stringify({
    schemaVersion: 1,
    status: "dry-run-only",
    recipientSnapshotSha256: plan.recipients.sourceFileSha256,
    metadata,
    queue,
  }, null, 2)}\n`);

  console.log(JSON.stringify({
    ok: true,
    status: plan.status,
    recipients: queue.length,
    treeCapacity: tree.capacity,
    treeRentSol: plan.tree.rentSol,
    baseFeeEstimateSol: plan.execution.baseFeeEstimateSol,
    outputDir,
  }));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }));
  process.exitCode = 1;
});
