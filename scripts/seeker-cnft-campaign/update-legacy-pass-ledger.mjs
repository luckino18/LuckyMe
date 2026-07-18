#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import readline from "node:readline";

import { fetchCollectionV1, mplCore } from "@metaplex-foundation/mpl-core";
import {
  getAssetWithProof,
  mplBubblegum,
  updateMetadataV2,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  createNoopSigner,
  publicKey,
  signerIdentity,
  some,
} from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import nacl from "tweetnacl";

const require = createRequire(import.meta.url);
const SolanaLedger = require("@ledgerhq/hw-app-solana").default;
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;

const RPC_URL = "https://api.mainnet-beta.solana.com";
const CLUSTER = "mainnet-beta";
const AUTHORITY = "6p8dv8FaqjdoJ2MQHwrYADdP65FKcyyGX3a7kqKtf24H";
const LEDGER_PATH = "44'/501'/1'";
const ASSET_ID = "HHm3WQ28Dxm76uC7BYRn1v8rUaF7BBqvB3KNqb3bw3pL";
const EXPECTED_OWNER = "9qhvSugqzuExBpoo2j4iiMzpHCfwSTwELEuxpGG3W2vQ";
const MERKLE_TREE = "6MaEv559doM7sUkL1tFWRQST9JKRskSd64DzdkL3B22k";
const COLLECTION = "HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J";
const OLD_NAME = "LuckyMe: 1 SOL Lucky Draw";
const OLD_URI = "https://lucky-me.app/cnft/luckyme-1-sol-draw.json";
const NEW_NAME = "LuckyMe Seeker Pass";
const NEW_SYMBOL = "LUCKYME";
const NEW_URI = "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.json";
const NEW_IMAGE_URI = "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.png";
const EXPECTED_METADATA_SHA256 = "1f46ea2a460e192dedba4746c047e335eff9a2b39afc6045adec999ca5a64950";
const EXPECTED_IMAGE_SHA256 = "7b2fde6b4ca9b785067861e1358fcbc44206fa15bd3f1d56f2ab6869afda7f6c";
const MAX_DEBIT_LAMPORTS = 50_000;
const SIMULATE_ONLY = process.argv.includes("--simulate-only");

const authoritySigner = createNoopSigner(publicKey(AUTHORITY));
const umi = createUmi(RPC_URL)
  .use(mplCore())
  .use(mplBubblegum())
  .use(signerIdentity(authoritySigner, true));
const connection = new Connection(RPC_URL, "confirmed");
const assetId = publicKey(ASSET_ID);
const collection = publicKey(COLLECTION);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function verifyHostedAsset(url, expectedHash, expectedContentType) {
  const response = await fetch(url, { cache: "no-store" });
  assert(response.ok, `${url} returned HTTP ${response.status}`);
  const contentType = response.headers.get("content-type") ?? "";
  assert(contentType.toLowerCase().includes(expectedContentType), `${url} content type is ${contentType}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(sha256(bytes) === expectedHash, `${url} hash mismatch`);
}

function collectionAddress(asset) {
  return asset.rpcAsset.grouping?.find((row) => row.group_key === "collection")?.group_value ?? null;
}

async function fetchAndGuardAsset() {
  const [asset, coreCollection] = await Promise.all([
    getAssetWithProof(umi, assetId, { truncateCanopy: true }),
    fetchCollectionV1(umi, collection),
  ]);
  assert(asset.rpcAsset.interface === "MplBubblegumV2", "asset is not Bubblegum V2");
  assert(asset.rpcAsset.ownership.owner === EXPECTED_OWNER, "leaf owner mismatch");
  assert(asset.merkleTree.toString() === MERKLE_TREE, "merkle tree mismatch");
  assert(asset.nonce === 0, `leaf nonce is ${asset.nonce}, expected 0`);
  assert(collectionAddress(asset) === COLLECTION, "collection grouping mismatch");
  assert(coreCollection.updateAuthority.toString() === AUTHORITY, "collection update authority mismatch");

  const currentName = asset.rpcAsset.content?.metadata?.name ?? asset.metadata.name;
  const currentUri = asset.rpcAsset.content?.json_uri ?? asset.metadata.uri;
  const alreadyUpdated = currentName === NEW_NAME && currentUri === NEW_URI;
  assert(
    alreadyUpdated || (currentName === OLD_NAME && currentUri === OLD_URI),
    `unexpected current metadata: ${currentName} / ${currentUri}`,
  );
  return { asset, currentName, currentUri, alreadyUpdated };
}

function builder(asset) {
  // getAssetWithProof currently exposes the legacy DAS collection shape
  // ({ key, verified }) even for MplBubblegumV2. The V2 instruction serializer
  // expects the collection option to contain only the MPL-Core public key.
  const currentMetadata = {
    name: asset.metadata.name,
    symbol: asset.metadata.symbol,
    uri: asset.metadata.uri,
    sellerFeeBasisPoints: asset.metadata.sellerFeeBasisPoints,
    primarySaleHappened: asset.metadata.primarySaleHappened,
    isMutable: asset.metadata.isMutable,
    tokenStandard: asset.metadata.tokenStandard,
    creators: asset.metadata.creators,
    collection: some(collection),
  };
  return updateMetadataV2(umi, {
    ...asset,
    payer: authoritySigner,
    authority: authoritySigner,
    leafOwner: publicKey(EXPECTED_OWNER),
    coreCollection: collection,
    currentMetadata,
    updateArgs: {
      name: some(NEW_NAME),
      symbol: some(NEW_SYMBOL),
      uri: some(NEW_URI),
    },
  });
}

async function buildAndSimulate() {
  const state = await fetchAndGuardAsset();
  assert(!state.alreadyUpdated, "asset is already updated; refusing a duplicate transaction");
  const umiTransaction = await builder(state.asset).buildAndSign(umi);
  const serialized = umi.transactions.serialize(umiTransaction);
  const currentBalance = await connection.getBalance(new PublicKey(AUTHORITY), "confirmed");
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "luckyme-update-legacy-pass-simulation",
      method: "simulateTransaction",
      params: [Buffer.from(serialized).toString("base64"), {
        encoding: "base64",
        sigVerify: false,
        commitment: "processed",
        accounts: {
          encoding: "base64",
          addresses: [AUTHORITY, MERKLE_TREE, COLLECTION],
        },
      }],
    }),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`simulation RPC failed: ${JSON.stringify(body.error)}`);
  const result = body.result.value;
  if (result.err) throw new Error(`simulation failed: ${JSON.stringify(result.err)}`);
  const payerPost = result.accounts?.[0]?.lamports;
  if (!Number.isSafeInteger(payerPost)) throw new Error("simulation did not return authority balance");
  const debitLamports = currentBalance - payerPost;
  if (debitLamports < 0 || debitLamports > MAX_DEBIT_LAMPORTS) {
    throw new Error(`simulated debit ${debitLamports} exceeds guarded maximum ${MAX_DEBIT_LAMPORTS}`);
  }
  return {
    ...state,
    serialized,
    debitLamports,
    postBalance: payerPost,
    unitsConsumed: result.unitsConsumed,
  };
}

async function waitForFinalState() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "luckyme-update-legacy-pass-postcheck",
        method: "getAsset",
        params: { id: ASSET_ID },
      }),
    });
    const body = await response.json();
    const asset = body.result;
    if (
      asset?.content?.metadata?.name === NEW_NAME &&
      asset?.content?.metadata?.symbol === NEW_SYMBOL &&
      asset?.content?.json_uri === NEW_URI &&
      asset?.ownership?.owner === EXPECTED_OWNER &&
      asset?.grouping?.some((row) => row.group_key === "collection" && row.group_value === COLLECTION)
    ) {
      return asset;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("transaction confirmed but DAS did not expose the updated asset within 30 seconds");
}

await Promise.all([
  verifyHostedAsset(NEW_URI, EXPECTED_METADATA_SHA256, "application/json"),
  verifyHostedAsset(NEW_IMAGE_URI, EXPECTED_IMAGE_SHA256, "image/png"),
]);
const initial = await buildAndSimulate();
const approvalPhrase = `APPROVE UPDATE ${ASSET_ID} TO LUCKYME SEEKER PASS`;
console.log(JSON.stringify({
  status: SIMULATE_ONLY ? "simulation-passed" : "waiting-for-explicit-approval",
  cluster: CLUSTER,
  action: "update exactly one existing Bubblegum V2 cNFT metadata leaf",
  assetId: ASSET_ID,
  leafIndex: 0,
  leafOwnerUnchanged: EXPECTED_OWNER,
  collectionUnchanged: COLLECTION,
  merkleTreeUnchanged: MERKLE_TREE,
  authorityAndFeePayer: AUTHORITY,
  ledgerPath: LEDGER_PATH,
  before: { name: initial.currentName, uri: initial.currentUri },
  after: { name: NEW_NAME, symbol: NEW_SYMBOL, uri: NEW_URI, image: NEW_IMAGE_URI },
  creatorsChanged: false,
  ownerChanged: false,
  collectionChanged: false,
  amountSol: initial.debitLamports / 1_000_000_000,
  estimatedPostBalanceSol: initial.postBalance / 1_000_000_000,
  transactionBytes: initial.serialized.length,
  unitsConsumed: initial.unitsConsumed,
  sentTransactions: 0,
  requiredApprovalPhrase: SIMULATE_ONLY ? null : approvalPhrase,
}, null, 2));

if (SIMULATE_ONLY) process.exit(0);

const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
prompt.setPrompt("approval> ");
prompt.prompt();
prompt.once("line", async (line) => {
  prompt.close();
  if (line.trim() !== approvalPhrase) {
    console.log(JSON.stringify({ status: "cancelled", sentTransactions: 0 }));
    process.exitCode = 2;
    return;
  }

  let transport;
  let txSignature = null;
  try {
    const finalSimulation = await buildAndSimulate();
    transport = await TransportNodeHid.create(30_000, 30_000);
    const ledger = new SolanaLedger(transport);
    const ledgerAddress = new PublicKey((await ledger.getAddress(LEDGER_PATH)).address);
    if (ledgerAddress.toBase58() !== AUTHORITY) {
      throw new Error(`Ledger address mismatch: ${ledgerAddress.toBase58()}`);
    }

    const transaction = VersionedTransaction.deserialize(finalSimulation.serialized);
    const messageBytes = transaction.message.serialize();
    const { signature } = await ledger.signTransaction(LEDGER_PATH, messageBytes);
    const requiredSignerKeys = transaction.message.staticAccountKeys.slice(
      0,
      transaction.message.header.numRequiredSignatures,
    );
    const authorityIndex = requiredSignerKeys.findIndex((key) => key.equals(ledgerAddress));
    if (authorityIndex < 0) throw new Error("authority is not a required transaction signer");
    transaction.signatures[authorityIndex] = Uint8Array.from(signature);
    const signaturesValid = requiredSignerKeys.every((key, index) => nacl.sign.detached.verify(
      messageBytes,
      transaction.signatures[index],
      key.toBytes(),
    ));
    if (!signaturesValid) throw new Error("transaction signatures failed local verification");

    txSignature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
      maxRetries: 3,
    });
    const confirmation = await connection.confirmTransaction(txSignature, "confirmed");
    if (confirmation.value.err) throw new Error(`transaction failed: ${JSON.stringify(confirmation.value.err)}`);

    const finalAsset = await waitForFinalState();
    console.log(JSON.stringify({
      status: "confirmed",
      cluster: CLUSTER,
      assetId: ASSET_ID,
      owner: finalAsset.ownership.owner,
      collection: COLLECTION,
      name: finalAsset.content.metadata.name,
      symbol: finalAsset.content.metadata.symbol,
      uri: finalAsset.content.json_uri,
      signature: txSignature,
      sentTransactions: 1,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      status: txSignature ? "broadcast-or-confirmed-postcheck-failed" : "failed-before-broadcast",
      error: error.message,
      signature: txSignature,
      sentTransactions: txSignature ? 1 : 0,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (transport) await transport.close();
  }
});
