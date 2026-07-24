import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction } from "@solana/web3.js";
import { createAdminPromotionsServer } from "../scripts/admin-promotions-server.mjs";

function request(base, path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      "X-LuckyMe-Admin-Proxy": "1",
      "X-LuckyMe-Admin-User": "victor",
      ...(options.body ? {
        "Content-Type": "application/json",
        "X-LuckyMe-Admin-Request": "1",
      } : {}),
      ...(options.headers ?? {}),
    },
  });
}

test("protected Admin prepares an authority-reviewed SKR launch but cannot broadcast by default", async (t) => {
  const sponsor = Keypair.generate();
  const authorizer = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const connection = {
    async getBalance() { return 2_000_000_000; },
    async getMultipleAccountsInfo(addresses) { return addresses.map(() => null); },
    async getAccountInfo() { return null; },
    async getLatestBlockhash() {
      return { blockhash, lastValidBlockHeight: 123_456 };
    },
  };
  const server = createAdminPromotionsServer({
    connection,
    sponsor: sponsor.publicKey.toBase58(),
    authorizerSigner: authorizer,
    dbPath: ":memory:",
    prepareEnabled: true,
    executionEnabled: false,
    priceService: {
      async prices() {
        return {
          SOL: { asset: "SOL", usdPrice: 150, source: "test", fetchedAt: "2026-07-23T12:00:00.000Z", stale: false },
          SKR: { asset: "SKR", usdPrice: 0.04, source: "test", fetchedAt: "2026-07-23T12:00:00.000Z", stale: false },
        };
      },
      async quote(asset) {
        return {
          asset,
          usdPrice: asset === "SKR" ? 0.04 : 150,
          source: "test",
          fetchedAt: "2026-07-23T12:00:00.000Z",
          blockId: 123,
          stale: false,
        };
      },
    },
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const blocked = await fetch(`${base}/config`);
  assert.equal(blocked.status, 403);

  const configResponse = await request(base, "/config");
  assert.equal(configResponse.status, 200);
  const config = await configResponse.json();
  assert.equal(config.cluster, "mainnet-beta");
  assert.equal(config.sponsor, sponsor.publicKey.toBase58());
  assert.equal(config.authorizer, authorizer.publicKey.toBase58());
  assert.equal(config.executionEnabled, false);
  assert.equal(config.treasury.assets.SKR.availableBaseUnits, "0");

  const taskRegistryResponse = await request(base, "/platform/tasks");
  assert.equal(taskRegistryResponse.status, 200);
  const taskRegistry = await taskRegistryResponse.json();
  assert.deepEqual(taskRegistry.tasks.map((task) => task.platform).sort(), ["discord", "x"]);
  assert.deepEqual(taskRegistry.submissions, []);

  const createdTaskResponse = await request(base, "/platform/tasks", {
    method: "POST",
    body: JSON.stringify({
      title: "LuckyMe announcement",
      description: "Read the latest LuckyMe announcement.",
      platform: "community",
      rewardPoints: 3,
      status: "draft",
    }),
  });
  assert.equal(createdTaskResponse.status, 201);
  const createdTask = (await createdTaskResponse.json()).task;
  assert.equal(createdTask.rewardPoints, 5);
  assert.equal(createdTask.rewardXp, 10);
  assert.equal(createdTask.rewardPresetKey, "community_manual");
  assert.equal(createdTask.status, "draft");

  const usersResponse = await request(base, "/platform/users");
  assert.equal(usersResponse.status, 200);
  assert.deepEqual((await usersResponse.json()).users, []);

  const preparedResponse = await request(base, "/prepare", {
    method: "POST",
    body: JSON.stringify({
      title: "SKR Launch Test",
      subtitle: "Exclusive LuckyMe promotion",
      description: "Protected Admin production preparation test.",
      entryCostPoints: 100,
      capacity: 96,
      prizeAsset: "SKR",
      prizeAmount: "500",
      expiryMode: "capacity-only",
    }),
  });
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  assert.equal(prepared.summary.asset, "SKR");
  assert.equal(prepared.summary.prizeAmountBaseUnits, "500000000");
  assert.equal(prepared.summary.capacity, 96);
  assert.equal(prepared.summary.prizeUsd, 20);
  assert.equal(prepared.economy.calculatorVersion, "luckyme-economy-v1");
  assert.match(prepared.confirmation, /^LAUNCH /);
  const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, "base64"));
  assert.equal(transaction.feePayer.toBase58(), sponsor.publicKey.toBase58());
  assert.ok(transaction.signatures.find((item) =>
    item.publicKey.equals(authorizer.publicKey))?.signature);
  assert.equal(transaction.signatures.find((item) =>
    item.publicKey.equals(sponsor.publicKey))?.signature, null);

  const submitResponse = await request(base, "/submit", {
    method: "POST",
    body: JSON.stringify({
      planId: prepared.planId,
      confirmation: prepared.confirmation,
      signedTransactionBase64: prepared.transactionBase64,
    }),
  });
  assert.equal(submitResponse.status, 403);
  assert.equal((await submitResponse.json()).error, "promotion_execution_disabled");
});
