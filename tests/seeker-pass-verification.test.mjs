import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { createSignInMessage } from "@solana/wallet-standard-util";
import nacl from "tweetnacl";

import {
  SEEKER_PASS_COLLECTION,
  SEEKER_PASS_ENTRY_THRESHOLD,
  SEEKER_PASS_PRIZE_LAMPORTS,
  SEEKER_PASS_PRIZES_LAMPORTS,
  SEEKER_PASS_RANDOMNESS_SLOT_DELAY,
  SEEKER_PASS_TREE,
  SEEKER_PASS_VERIFIED_CREATOR,
  SEEKER_PASS_WINNER_COUNT,
  createMainnetLuckyMeNftVerifier,
  createMainnetSeekerPassVerifier,
  createSeekerReferralService,
  selectSeekerPassWinnerIndexes,
} from "../backend/src/seeker-referral-service.mjs";

function signedOutput(keypair, payload, overrides = {}) {
  const message = createSignInMessage({
    ...payload,
    address: keypair.publicKey.toBase58(),
    ...overrides,
  });
  const signature = nacl.sign.detached(message, keypair.secretKey);
  return {
    publicKey: Buffer.from(keypair.publicKey.toBytes()).toString("base64"),
    signature: Buffer.from(signature).toString("base64"),
    signedMessage: Buffer.from(message).toString("base64"),
  };
}

test("Seeker Pass SIWS verifies ownership without registering an entry", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "luckyme-seeker-pass-"));
  const keypair = Keypair.generate();
  const assetId = Keypair.generate().publicKey.toBase58();
  const service = createSeekerReferralService({
    dbPath: join(directory, "referral.sqlite"),
    logger: () => undefined,
    sgtVerifier: async () => null,
    seekerPassVerifier: async (wallet) => wallet === keypair.publicKey.toBase58()
      ? { assetId, tree: SEEKER_PASS_TREE, leafId: 1 }
      : null,
  });
  t.after(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const { payload } = service.issueSeekerPassNonce({ ip: "test" });
  const result = await service.verifySeekerPassSiws({
    payload,
    output: signedOutput(keypair, payload),
    ip: "test",
  });
  assert.equal(result.eligible, true);
  assert.equal(result.registered, false);
  assert.equal(result.testOnly, true);
  assert.equal(result.wallet, keypair.publicKey.toBase58());
  assert.equal(result.collection, SEEKER_PASS_COLLECTION);
  assert.equal(result.asset.assetId, assetId);
  assert.equal(service.db.prepare("SELECT COUNT(*) AS count FROM seeker_pass_nonces WHERE consumed_at IS NOT NULL").get().count, 1);

  await assert.rejects(
    service.verifySeekerPassSiws({ payload, output: signedOutput(keypair, payload), ip: "test" }),
    (error) => error?.code === "nonce_reused",
  );
});

test("Seeker Pass nonce binds the exact statement", async (t) => {
  const service = createSeekerReferralService({
    sgtVerifier: async () => null,
    seekerPassVerifier: async () => null,
    logger: () => undefined,
  });
  t.after(() => service.close());
  const keypair = Keypair.generate();
  const { payload } = service.issueSeekerPassNonce({ ip: "test" });
  const changed = { ...payload, statement: "Authorize a transfer" };
  await assert.rejects(
    service.verifySeekerPassSiws({ payload: changed, output: signedOutput(keypair, changed), ip: "test" }),
    (error) => error?.code === "invalid_siws",
  );
});

test("LuckyMe NFT profile verification is read-only and returns every verified asset", async (t) => {
  const keypair = Keypair.generate();
  const assets = [
    {
      assetId: Keypair.generate().publicKey.toBase58(),
      name: "LuckyMe Seeker Pass #1",
      image: "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.png",
      collectionId: "seeker-pass",
      collectionName: "LuckyMe Seeker Pass",
      collectionAddress: SEEKER_PASS_COLLECTION,
      compressed: true,
      tree: SEEKER_PASS_TREE,
      leafId: 1,
    },
    {
      assetId: Keypair.generate().publicKey.toBase58(),
      name: "LuckyMe Seeker Pass #2",
      image: null,
      collectionId: "seeker-pass",
      collectionName: "LuckyMe Seeker Pass",
      collectionAddress: SEEKER_PASS_COLLECTION,
      compressed: true,
      tree: SEEKER_PASS_TREE,
      leafId: 2,
    },
  ];
  const service = createSeekerReferralService({
    sgtVerifier: async () => null,
    seekerPassVerifier: async () => null,
    luckyMeNftVerifier: async (wallet) => ({
      wallet,
      collections: [{ id: "seeker-pass", name: "LuckyMe Seeker Pass", address: SEEKER_PASS_COLLECTION }],
      assets,
    }),
    logger: () => undefined,
  });
  t.after(() => service.close());

  const { payload } = service.issueLuckyMeNftNonce({ ip: "nft-profile" });
  assert.match(payload.statement, /display its LuckyMe NFT collection/);
  assert.doesNotMatch(payload.statement, /promotion|transfer authorization/i);
  const result = await service.verifyLuckyMeNftSiws({
    payload,
    output: signedOutput(keypair, payload),
    ip: "nft-profile",
  });
  assert.equal(result.wallet, keypair.publicKey.toBase58());
  assert.deepEqual(result.assets, assets);
  assert.equal(service.db.prepare("SELECT COUNT(*) AS count FROM promotion_entries").get().count, 0);
});

test("LuckyMe NFT DAS verifier lists valid collection assets and excludes burned assets", async (t) => {
  const owner = Keypair.generate().publicKey.toBase58();
  const firstAsset = Keypair.generate().publicKey.toBase58();
  const burnedAsset = Keypair.generate().publicKey.toBase58();
  const priorFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({
    jsonrpc: "2.0",
    result: {
      items: [
        {
          id: firstAsset,
          burnt: false,
          compression: { compressed: true, tree: SEEKER_PASS_TREE, leaf_id: 4 },
          ownership: { owner, ownership_model: "single" },
          grouping: [{ group_key: "collection", group_value: SEEKER_PASS_COLLECTION }],
          creators: [{ address: SEEKER_PASS_VERIFIED_CREATOR, verified: true }],
          content: {
            metadata: { name: "LuckyMe Seeker Pass" },
            links: { image: "https://lucky-me.app/cnft/luckyme-seeker-pass-v2.png" },
          },
        },
        {
          id: burnedAsset,
          burnt: true,
          compression: { compressed: true, tree: SEEKER_PASS_TREE, leaf_id: 5 },
          ownership: { owner, ownership_model: "single" },
          grouping: [{ group_key: "collection", group_value: SEEKER_PASS_COLLECTION }],
          creators: [{ address: SEEKER_PASS_VERIFIED_CREATOR, verified: true }],
        },
      ],
    },
  });
  t.after(() => { globalThis.fetch = priorFetch; });

  const verify = createMainnetLuckyMeNftVerifier({
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
  });
  const result = await verify(owner);
  assert.equal(result.assets.length, 1);
  assert.equal(result.assets[0].assetId, firstAsset);
  assert.equal(result.assets[0].collectionName, "LuckyMe Seeker Pass");
  assert.equal(result.assets[0].leafId, 4);
});

test("DAS verifier filters by collection and validates owner, tree and creator", async (t) => {
  const owner = Keypair.generate().publicKey.toBase58();
  const assetId = Keypair.generate().publicKey.toBase58();
  const priorFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return new Response(JSON.stringify({
      jsonrpc: "2.0",
      result: {
        items: [{
          id: assetId,
          burnt: false,
          compression: { compressed: true, tree: SEEKER_PASS_TREE, leaf_id: 1 },
          ownership: { owner, ownership_model: "single" },
          grouping: [{ group_key: "collection", group_value: SEEKER_PASS_COLLECTION }],
          creators: [{ address: SEEKER_PASS_VERIFIED_CREATOR, verified: true, share: 100 }],
        }],
      },
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
  t.after(() => { globalThis.fetch = priorFetch; });

  const verify = createMainnetSeekerPassVerifier({
    rpcUrl: "https://mainnet.helius-rpc.com/?api-key=test",
  });
  const result = await verify(owner);
  assert.equal(result.assetId, assetId);
  assert.deepEqual(requestBody.params.grouping, ["collection", SEEKER_PASS_COLLECTION]);
  assert.equal(requestBody.params.ownerAddress, owner);
  assert.equal(requestBody.params.tokenType, undefined);
});

test("DAS verifier rejects a standard RPC provider without DAS support", () => {
  assert.throws(
    () => createMainnetSeekerPassVerifier({
      rpcUrl: "https://solana-mainnet.g.alchemy.com/v2/test",
    }),
    (error) => error?.code === "missing_rpc_configuration",
  );
});

test("DAS verifier supports QuickNode compressed NFT filtering", async (t) => {
  const owner = Keypair.generate().publicKey.toBase58();
  const priorFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return Response.json({ jsonrpc: "2.0", result: { items: [] } });
  };
  t.after(() => { globalThis.fetch = priorFetch; });

  const verify = createMainnetSeekerPassVerifier({
    rpcUrl: "https://example.solana-mainnet.quiknode.pro/test/",
  });
  assert.equal(await verify(owner), null);
  assert.equal(requestBody.params.tokenType, undefined);
});

test("DAS verifier accepts an eligible asset when the first provider is unavailable", async (t) => {
  const owner = Keypair.generate().publicKey.toBase58();
  const assetId = Keypair.generate().publicKey.toBase58();
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url.includes("helius")) return new Response("quota exhausted", { status: 429 });
    return Response.json({
      jsonrpc: "2.0",
      result: {
        items: [{
          id: assetId,
          burnt: false,
          compression: { compressed: true, tree: SEEKER_PASS_TREE, leaf_id: 9 },
          ownership: { owner, ownership_model: "single" },
          grouping: [{ group_key: "collection", group_value: SEEKER_PASS_COLLECTION }],
          creators: [{ address: SEEKER_PASS_VERIFIED_CREATOR, verified: true, share: 100 }],
        }],
      },
    });
  };
  t.after(() => { globalThis.fetch = priorFetch; });

  const verify = createMainnetSeekerPassVerifier({
    env: {
      SEEKER_PASS_DAS_RPC_URL: "https://mainnet.helius-rpc.com/?api-key=test",
      LUCKYME_RPC_QUICKNODE_DAS_URL: "https://example.solana-mainnet.quiknode.pro/test/",
    },
  });
  const result = await verify(owner);
  assert.equal(result.assetId, assetId);
  assert.equal(result.leafId, 9);
  assert.equal(calls.length, 2);
  assert.ok(calls.some((url) => url.includes("helius")));
  assert.ok(calls.some((url) => url.includes("quiknode")));
});

test("DAS verifier accepts multiple configured provider URLs and removes duplicates", async (t) => {
  const owner = Keypair.generate().publicKey.toBase58();
  const priorFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return Response.json({ jsonrpc: "2.0", result: { items: [] } });
  };
  t.after(() => { globalThis.fetch = priorFetch; });

  const helius = "https://mainnet.helius-rpc.com/?api-key=test";
  const quicknode = "https://example.solana-mainnet.quiknode.pro/test/";
  const verify = createMainnetSeekerPassVerifier({
    env: {
      SEEKER_PASS_DAS_RPC_URL: helius,
      SEEKER_PASS_DAS_RPC_URLS: `${helius},\n${quicknode}`,
      LUCKYME_RPC_ALCHEMY_URL: "https://solana-mainnet.g.alchemy.com/v2/ignored",
    },
  });
  assert.equal(await verify(owner), null);
  assert.deepEqual(calls.sort(), [helius, quicknode].sort());
});

test("Seeker Pass promotion registers one free entry per wallet and cNFT", async (t) => {
  const keypair = Keypair.generate();
  const assetId = Keypair.generate().publicKey.toBase58();
  const service = createSeekerReferralService({
    seekerPassPromotionEnabled: true,
    sgtVerifier: async () => null,
    seekerPassVerifier: async () => ({ assetId, tree: SEEKER_PASS_TREE, leafId: 7 }),
    promotionRandomnessProvider: {
      currentFinalizedSlot: async () => 100,
      finalizedBlockAtOrAfter: async () => null,
    },
    logger: () => undefined,
  });
  t.after(() => service.close());

  const firstNonce = service.issueSeekerPassNonce({ ip: "entry-1" });
  assert.match(firstNonce.payload.statement, /3 SOL promotion/);
  const first = await service.verifySeekerPassSiws({
    payload: firstNonce.payload,
    output: signedOutput(keypair, firstNonce.payload),
    ip: "entry-1",
  });
  assert.equal(first.eligible, true);
  assert.equal(first.registered, true);
  assert.equal(first.alreadyRegistered, false);
  assert.equal(first.entryNumber, 1);
  assert.equal(first.testOnly, false);
  assert.equal(first.promotion.entryCount, 1);
  assert.equal(first.promotion.entryThreshold, 1_000);
  assert.equal(first.promotion.prizeLamports, "3000000000");

  const secondNonce = service.issueSeekerPassNonce({ ip: "entry-2" });
  const second = await service.verifySeekerPassSiws({
    payload: secondNonce.payload,
    output: signedOutput(keypair, secondNonce.payload),
    ip: "entry-2",
  });
  assert.equal(second.registered, true);
  assert.equal(second.alreadyRegistered, true);
  assert.equal(second.entryNumber, 1);
  assert.equal(second.promotion.entryCount, 1);
});

test("1,000th verified cNFT freezes the commitment and draws 20 unfunded winners automatically", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "luckyme-seeker-pass-draw-"));
  const lastWallet = Keypair.generate();
  const lastAsset = Keypair.generate().publicKey.toBase58();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const service = createSeekerReferralService({
    dbPath: join(directory, "promotion.sqlite"),
    seekerPassPromotionEnabled: true,
    sgtVerifier: async () => null,
    seekerPassVerifier: async () => ({ assetId: lastAsset, tree: SEEKER_PASS_TREE, leafId: 1_000 }),
    promotionRandomnessProvider: {
      currentFinalizedSlot: async () => 500,
      finalizedBlockAtOrAfter: async (targetSlot) => ({ slot: targetSlot, blockhash, blockTime: 1_700_000_000 }),
    },
    logger: () => undefined,
  });
  t.after(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const insert = service.db.prepare(`
    INSERT INTO promotion_entries
      (campaign_id, wallet, asset_id, tree_address, leaf_id, verified_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const campaignId = service.seekerPassPromotionStatus().campaignId;
  for (let index = 1; index < SEEKER_PASS_ENTRY_THRESHOLD; index += 1) {
    insert.run(
      campaignId,
      Keypair.generate().publicKey.toBase58(),
      Keypair.generate().publicKey.toBase58(),
      SEEKER_PASS_TREE,
      index,
      "2026-07-17T00:00:00.000Z",
    );
  }

  const nonce = service.issueSeekerPassNonce({ ip: "threshold" });
  const registration = await service.verifySeekerPassSiws({
    payload: nonce.payload,
    output: signedOutput(lastWallet, nonce.payload),
    ip: "threshold",
  });
  assert.equal(registration.entryNumber, SEEKER_PASS_ENTRY_THRESHOLD);
  await service.advanceSeekerPassPromotion();

  const status = service.seekerPassPromotionStatus({ includeWinnerWallets: true });
  assert.equal(status.status, "drawn_unfunded");
  assert.equal(status.entryCount, SEEKER_PASS_ENTRY_THRESHOLD);
  assert.equal(status.targetSlot, 500 + SEEKER_PASS_RANDOMNESS_SLOT_DELAY);
  assert.equal(status.resolvedSlot, status.targetSlot);
  assert.match(status.entryCommitment, /^[a-f0-9]{64}$/);
  assert.match(status.randomnessHash, /^[a-f0-9]{64}$/);
  assert.equal(status.winners.length, SEEKER_PASS_WINNER_COUNT);
  assert.equal(new Set(status.winners.map((winner) => winner.wallet)).size, SEEKER_PASS_WINNER_COUNT);
  assert.equal(status.winners.reduce((total, winner) => total + Number(winner.prizeLamports), 0), SEEKER_PASS_PRIZE_LAMPORTS);
  assert.deepEqual(status.winners.map((winner) => Number(winner.prizeLamports)), SEEKER_PASS_PRIZES_LAMPORTS);
  assert.equal(status.funded, false);
  assert.equal(status.payoutEnabled, false);
  assert.ok(status.winners.every((winner) => winner.payoutStatus === "locked_unfunded"));
});

test("promotion winner selection is deterministic, unique and unbiased by duplicate retries", () => {
  const randomness = "42".repeat(32);
  const first = selectSeekerPassWinnerIndexes(randomness, 1_000, 20);
  const second = selectSeekerPassWinnerIndexes(randomness, 1_000, 20);
  assert.deepEqual(first, second);
  assert.equal(first.length, 20);
  assert.equal(new Set(first).size, 20);
  assert.ok(first.every((index) => index >= 0 && index < 1_000));
});
