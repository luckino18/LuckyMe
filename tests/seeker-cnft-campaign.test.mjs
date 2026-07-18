import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  SGT_GROUP_ADDRESS,
  buildMintQueue,
  canonicalSnapshotHash,
  discoverSgtHolders,
  rankActiveHolders,
} from "../scripts/seeker-cnft-campaign/core.mjs";

function tokenAccount(mint, owner, amount = 1n) {
  const data = Buffer.alloc(72);
  new PublicKey(mint).toBuffer().copy(data, 0);
  new PublicKey(owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(amount, 64);
  return { account: { data: [data.toString("base64"), "base64"] } };
}

test("read-only SGT discovery paginates, rejects bad assets and consolidates wallets", async () => {
  const walletA = Keypair.generate().publicKey.toBase58();
  const walletB = Keypair.generate().publicKey.toBase58();
  const mintA = Keypair.generate().publicKey.toBase58();
  const mintB = Keypair.generate().publicKey.toBase58();
  const mintC = Keypair.generate().publicKey.toBase58();
  const requests = [];
  const replies = [
    { context: { slot: 123 }, value: { accounts: [{ pubkey: mintA }, { pubkey: mintB }], paginationKey: "next" } },
    { context: { slot: 124 }, value: { accounts: [{ pubkey: mintC }, { pubkey: "bad" }], paginationKey: null } },
    { context: { slot: 125 }, value: { accounts: [
      tokenAccount(mintA, walletA), tokenAccount(mintB, walletA), tokenAccount(mintC, walletB),
      tokenAccount(Keypair.generate().publicKey.toBase58(), walletB),
    ], paginationKey: null } },
  ];
  const fetchImpl = async (_url, options) => {
    const body = JSON.parse(options.body);
    requests.push(body);
    return { ok: true, json: async () => ({ jsonrpc: "2.0", result: replies.shift() }) };
  };

  const result = await discoverSgtHolders({
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=hidden",
    fetchImpl,
    pageSize: 2,
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[0].params[1].filters[2].memcmp.bytes, SGT_GROUP_ADDRESS);
  assert.equal(result.lastIndexedSlot, 125);
  assert.equal(result.validAssets, 3);
  assert.equal(result.uniqueWallets, 2);
  assert.deepEqual(result.holders.find((row) => row.wallet === walletA).sgtMints.sort(), [mintA, mintB].sort());
});

test("activity ranking is deterministic and favors days, signer activity, then recency", () => {
  const holders = Array.from({ length: 4 }, () => ({
    wallet: Keypair.generate().publicKey.toBase58(),
    sgtMints: [Keypair.generate().publicKey.toBase58()],
  }));
  const activity = [
    { wallet: holders[0].wallet, activeDays: 5, successfulSignerTransactions: 100, lastActiveSlot: 10 },
    { wallet: holders[1].wallet, activeDays: 6, successfulSignerTransactions: 1, lastActiveSlot: 10 },
    { wallet: holders[2].wallet, activeDays: 5, successfulSignerTransactions: 100, lastActiveSlot: 11 },
    { wallet: holders[3].wallet, activeDays: 0, successfulSignerTransactions: 0, lastActiveSlot: 0 },
  ];
  const ranked = rankActiveHolders({ holders, activity, limit: 3 });
  assert.deepEqual(ranked.map((row) => row.wallet), [holders[1].wallet, holders[2].wallet, holders[0].wallet]);
  assert.deepEqual(ranked.map((row) => row.rank), [1, 2, 3]);
});

test("mint queue remains a dry-run and estimates base signature fees", () => {
  const recipients = Array.from({ length: 10 }, () => ({ wallet: Keypair.generate().publicKey.toBase58() }));
  const queue = buildMintQueue(recipients, { mintsPerTransaction: 3 });
  assert.equal(queue.mode, "dry-run-only");
  assert.equal(queue.recipientCount, 10);
  assert.equal(queue.transactionCount, 4);
  assert.equal(queue.baseFeeLamports, 20_000);
  assert.equal(queue.transactions.at(-1).recipients.length, 1);
});

test("snapshot hashes are stable for identical input", () => {
  const value = { cluster: "mainnet-beta", holders: [{ wallet: "example" }], slot: 123 };
  assert.equal(canonicalSnapshotHash(value), canonicalSnapshotHash(structuredClone(value)));
  const changed = structuredClone(value);
  changed.holders[0].wallet = "different";
  assert.notEqual(canonicalSnapshotHash(value), canonicalSnapshotHash(changed));
});
