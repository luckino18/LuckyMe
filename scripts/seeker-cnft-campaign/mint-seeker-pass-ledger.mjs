#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import readline from "node:readline";

import {
  fetchCollectionV1,
  mplCore,
  updateCollection,
} from "@metaplex-foundation/mpl-core";
import {
  fetchTreeConfig,
  findLeafAssetIdPda,
  mintV2,
  mplBubblegum,
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
const PAYER = "6p8dv8FaqjdoJ2MQHwrYADdP65FKcyyGX3a7kqKtf24H";
const LEDGER_PATH = "44'/501'/1'";
const MERKLE_TREE = "6MaEv559doM7sUkL1tFWRQST9JKRskSd64DzdkL3B22k";
const TREE_CONFIG = "7SGHPHpnGXQkQekM9XQvRZKaNiHHRgh4yFZxPc2p4NNv";
const COLLECTION = "HqbzvQGhssViGrwaPkJWPPRTSnGbi4z2DsPeDYyJqo9J";
const LEAF_OWNER = "9qhvSugqzuExBpoo2j4iiMzpHCfwSTwELEuxpGG3W2vQ";
const EXPECTED_NUM_MINTED = 1n;
const NFT_NAME = "LuckyMe Seeker Pass";
const NFT_URI = "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.json";
const IMAGE_URI = "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.png";
const EXPECTED_METADATA_SHA256 = "1f46ea2a460e192dedba4746c047e335eff9a2b39afc6045adec999ca5a64950";
const EXPECTED_IMAGE_SHA256 = "7b2fde6b4ca9b785067861e1358fcbc44206fa15bd3f1d56f2ab6869afda7f6c";
const MAX_DEBIT_LAMPORTS = 250_000;

const payerSigner = createNoopSigner(publicKey(PAYER));
const umi = createUmi(RPC_URL)
  .use(mplCore())
  .use(mplBubblegum())
  .use(signerIdentity(payerSigner, true));
const connection = new Connection(RPC_URL, "confirmed");
const merkleTree = publicKey(MERKLE_TREE);
const treeConfigAddress = publicKey(TREE_CONFIG);
const collection = publicKey(COLLECTION);
const leafOwner = publicKey(LEAF_OWNER);

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

async function fetchAndGuardState() {
  const [treeConfig, coreCollection] = await Promise.all([
    fetchTreeConfig(umi, treeConfigAddress),
    fetchCollectionV1(umi, collection),
  ]);
  assert(treeConfig.treeCreator.toString() === PAYER, "tree creator mismatch");
  assert(treeConfig.treeDelegate.toString() === PAYER, "tree delegate mismatch");
  assert(treeConfig.numMinted === EXPECTED_NUM_MINTED, `tree numMinted is ${treeConfig.numMinted}`);
  assert(treeConfig.totalMintCapacity > treeConfig.numMinted, "tree has no remaining capacity");
  assert(coreCollection.updateAuthority.toString() === PAYER, "collection update authority mismatch");
  assert(BigInt(coreCollection.currentSize) === EXPECTED_NUM_MINTED, `collection currentSize is ${coreCollection.currentSize}`);
  return { treeConfig, coreCollection };
}

const assetId = findLeafAssetIdPda(umi, {
  merkleTree,
  leafIndex: EXPECTED_NUM_MINTED,
})[0];

function builder() {
  return updateCollection(umi, {
    collection,
    authority: payerSigner,
    payer: payerSigner,
    name: NFT_NAME,
    uri: NFT_URI,
  }).add(mintV2(umi, {
    collectionAuthority: payerSigner,
    leafOwner,
    leafDelegate: leafOwner,
    merkleTree,
    coreCollection: collection,
    metadata: {
      name: NFT_NAME,
      uri: NFT_URI,
      sellerFeeBasisPoints: 0,
      collection: some(collection),
      creators: [{
        address: publicKey(PAYER),
        verified: true,
        share: 100,
      }],
    },
  }));
}

async function buildAndSimulate() {
  await fetchAndGuardState();
  const umiTransaction = await builder().buildAndSign(umi);
  const serialized = umi.transactions.serialize(umiTransaction);
  const currentBalance = await connection.getBalance(new PublicKey(PAYER), "confirmed");
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "luckyme-seeker-pass-simulation",
      method: "simulateTransaction",
      params: [Buffer.from(serialized).toString("base64"), {
        encoding: "base64",
        sigVerify: false,
        commitment: "processed",
        accounts: {
          encoding: "base64",
          addresses: [PAYER, MERKLE_TREE, TREE_CONFIG, COLLECTION],
        },
      }],
    }),
  });
  const body = await response.json();
  if (!response.ok || body.error) throw new Error(`simulation RPC failed: ${JSON.stringify(body.error)}`);
  const result = body.result.value;
  if (result.err) throw new Error(`simulation failed: ${JSON.stringify(result.err)}`);
  const payerPost = result.accounts?.[0]?.lamports;
  if (!Number.isSafeInteger(payerPost)) throw new Error("simulation did not return payer balance");
  const debitLamports = currentBalance - payerPost;
  if (debitLamports < 0 || debitLamports > MAX_DEBIT_LAMPORTS) {
    throw new Error(`simulated debit ${debitLamports} exceeds guarded maximum ${MAX_DEBIT_LAMPORTS}`);
  }
  return {
    serialized,
    debitLamports,
    postBalance: payerPost,
    unitsConsumed: result.unitsConsumed,
  };
}

async function waitForFinalState() {
  for (let attempt = 0; attempt < 15; attempt += 1) {
    const [treeConfig, coreCollection] = await Promise.all([
      fetchTreeConfig(umi, treeConfigAddress),
      fetchCollectionV1(umi, collection),
    ]);
    if (
      treeConfig.numMinted === EXPECTED_NUM_MINTED + 1n &&
      BigInt(coreCollection.currentSize) === EXPECTED_NUM_MINTED + 1n &&
      coreCollection.name === NFT_NAME &&
      coreCollection.uri === NFT_URI
    ) {
      return { treeConfig, coreCollection };
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("transaction confirmed but the public RPC did not expose the updated collection/tree state within 15 seconds");
}

await Promise.all([
  verifyHostedAsset(NFT_URI, EXPECTED_METADATA_SHA256, "application/json"),
  verifyHostedAsset(IMAGE_URI, EXPECTED_IMAGE_SHA256, "image/png"),
]);
const initial = await buildAndSimulate();
const approvalPhrase = `APPROVE PASS ${assetId} TO ${LEAF_OWNER}`;
console.log(JSON.stringify({
  status: "waiting-for-explicit-approval",
  cluster: CLUSTER,
  action: "rename the existing Core collection and mint exactly one new Bubblegum V2 LuckyMe Seeker Pass",
  collection: COLLECTION,
  collectionNewName: NFT_NAME,
  assetId,
  leafIndex: EXPECTED_NUM_MINTED.toString(),
  leafOwner: LEAF_OWNER,
  verifiedDomain: "luckino.skr",
  merkleTree: MERKLE_TREE,
  feePayerCollectionAuthorityAndVerifiedCreator: PAYER,
  ledgerPath: LEDGER_PATH,
  metadataUri: NFT_URI,
  imageUri: IMAGE_URI,
  creatorVerifiedAtMint: true,
  sellerFeeBasisPoints: 0,
  amountSol: initial.debitLamports / 1_000_000_000,
  estimatedPostBalanceSol: initial.postBalance / 1_000_000_000,
  transactionBytes: initial.serialized.length,
  unitsConsumed: initial.unitsConsumed,
  collectionUpdates: 1,
  mintCount: 1,
  sentTransactions: 0,
  requiredApprovalPhrase: approvalPhrase,
}, null, 2));

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
    if (ledgerAddress.toBase58() !== PAYER) {
      throw new Error(`Ledger address mismatch: ${ledgerAddress.toBase58()}`);
    }

    const transaction = VersionedTransaction.deserialize(finalSimulation.serialized);
    const messageBytes = transaction.message.serialize();
    const { signature } = await ledger.signTransaction(LEDGER_PATH, messageBytes);
    const requiredSignerKeys = transaction.message.staticAccountKeys.slice(
      0,
      transaction.message.header.numRequiredSignatures,
    );
    const payerIndex = requiredSignerKeys.findIndex((key) => key.equals(ledgerAddress));
    if (payerIndex < 0) throw new Error("payer is not a required transaction signer");
    transaction.signatures[payerIndex] = Uint8Array.from(signature);
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

    const { treeConfig: finalTreeConfig, coreCollection: finalCollection } = await waitForFinalState();

    console.log(JSON.stringify({
      status: "confirmed",
      cluster: CLUSTER,
      assetId,
      leafIndex: EXPECTED_NUM_MINTED.toString(),
      leafOwner: LEAF_OWNER,
      collection: COLLECTION,
      collectionName: finalCollection.name,
      collectionUri: finalCollection.uri,
      treeNumMinted: finalTreeConfig.numMinted.toString(),
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
