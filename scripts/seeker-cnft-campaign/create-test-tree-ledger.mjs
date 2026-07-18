#!/usr/bin/env node
import { createRequire } from "node:module";
import readline from "node:readline";

import { mplCore } from "@metaplex-foundation/mpl-core";
import {
  createTreeV2,
  findTreeConfigPda,
  mplBubblegum,
} from "@metaplex-foundation/mpl-bubblegum";
import {
  createNoopSigner,
  generateSigner,
  publicKey,
  signerIdentity,
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
const MAX_DEPTH = 14;
const MAX_BUFFER_SIZE = 64;
const CANOPY_DEPTH = 0;
const CAPACITY = 2 ** MAX_DEPTH;
const MAX_DEBIT_LAMPORTS = 230_000_000;

const payerSigner = createNoopSigner(publicKey(PAYER));
const umi = createUmi(RPC_URL)
  .use(mplCore())
  .use(mplBubblegum())
  .use(signerIdentity(payerSigner, true));
const connection = new Connection(RPC_URL, "confirmed");
const merkleTree = generateSigner(umi);
const treeConfig = findTreeConfigPda(umi, { merkleTree: merkleTree.publicKey })[0];

async function builder() {
  return createTreeV2(umi, {
    merkleTree,
    maxDepth: MAX_DEPTH,
    maxBufferSize: MAX_BUFFER_SIZE,
    canopyDepth: CANOPY_DEPTH,
    public: false,
  });
}

async function buildAndSimulate() {
  const transactionBuilder = await builder();
  const umiTransaction = await transactionBuilder.buildAndSign(umi);
  const serialized = umi.transactions.serialize(umiTransaction);
  const currentBalance = await connection.getBalance(new PublicKey(PAYER), "confirmed");
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: "luckyme-create-tree-simulation",
      method: "simulateTransaction",
      params: [Buffer.from(serialized).toString("base64"), {
        encoding: "base64",
        sigVerify: false,
        commitment: "processed",
        accounts: {
          encoding: "base64",
          addresses: [PAYER, merkleTree.publicKey, treeConfig],
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
    currentBalance,
    postBalance: payerPost,
    treeRentLamports: result.accounts?.[1]?.lamports ?? null,
    treeConfigRentLamports: result.accounts?.[2]?.lamports ?? null,
    unitsConsumed: result.unitsConsumed,
  };
}

const initial = await buildAndSimulate();
const approvalPhrase = `APPROVE TREE ${merkleTree.publicKey}`;
console.log(JSON.stringify({
  status: "waiting-for-explicit-approval",
  cluster: CLUSTER,
  action: "create one private Bubblegum V2 Merkle tree",
  merkleTreeAddress: merkleTree.publicKey,
  treeConfigAddress: treeConfig,
  feePayerAndTreeCreator: PAYER,
  ledgerPath: LEDGER_PATH,
  recipient: merkleTree.publicKey,
  maxDepth: MAX_DEPTH,
  maxBufferSize: MAX_BUFFER_SIZE,
  canopyDepth: CANOPY_DEPTH,
  capacity: CAPACITY,
  public: false,
  amountSol: initial.debitLamports / 1_000_000_000,
  treeRentSol: initial.treeRentLamports / 1_000_000_000,
  treeConfigRentSol: initial.treeConfigRentLamports / 1_000_000_000,
  estimatedPostBalanceSol: initial.postBalance / 1_000_000_000,
  transactionBytes: initial.serialized.length,
  unitsConsumed: initial.unitsConsumed,
  nftMintedByThisTransaction: false,
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

    const raw = transaction.serialize();
    const txSignature = await connection.sendRawTransaction(raw, {
      skipPreflight: false,
      maxRetries: 3,
    });
    const confirmation = await connection.confirmTransaction(txSignature, "confirmed");
    if (confirmation.value.err) throw new Error(`transaction failed: ${JSON.stringify(confirmation.value.err)}`);
    console.log(JSON.stringify({
      status: "confirmed",
      cluster: CLUSTER,
      merkleTreeAddress: merkleTree.publicKey,
      treeConfigAddress: treeConfig,
      signature: txSignature,
      debitLamportsGuardMaximum: MAX_DEBIT_LAMPORTS,
      sentTransactions: 1,
    }, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      status: "failed",
      error: error.message,
      sentTransactions: 0,
    }, null, 2));
    process.exitCode = 1;
  } finally {
    if (transport) await transport.close();
  }
});
