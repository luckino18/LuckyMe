import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction } from "@solana/web3.js";
import { createSeekerReferralHttpServer } from "../backend/src/seeker-referral-server.mjs";
import { derivePromotionAddresses } from "../backend/src/promotional-pools-chain.mjs";
import { createPromotionalPoolsService } from "../backend/src/promotional-pools-service.mjs";
import { createLuckyMePlatformService } from "../backend/src/luckyme-platform-service.mjs";

function request(base, path, options = {}) {
  return fetch(`${base}${path}`, {
    ...options,
    headers: {
      Authorization: "Bearer valid-session",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers ?? {}),
    },
  });
}

test("promotion API binds a Lucky Points reservation to the authenticated wallet transaction", async (t) => {
  const player = Keypair.generate();
  const sponsor = Keypair.generate();
  const authorizer = Keypair.generate();
  const blockhash = Keypair.generate().publicKey.toBase58();
  const addresses = derivePromotionAddresses({ numericId: "77", prizeAsset: "SKR" });
  const promotion = {
    id: "pool-77",
    numericId: "77",
    rulesHash: "12".repeat(32),
    title: "500 SKR",
    subtitle: "LuckyMe promotion",
    description: "Test",
    entryCostPoints: 25,
    capacity: 20,
    entryCount: 3,
    prizeAsset: "SKR",
    prizeAmountBaseUnits: "500000000",
    expiresAtUnix: 253_402_300_799,
    sponsor: sponsor.publicKey.toBase58(),
    authorizer: authorizer.publicKey.toBase58(),
    promotionAddress: addresses.promotion,
    vaultAddress: addresses.vault,
    prizeConfigAddress: addresses.prizeConfig,
    status: "open",
  };
  const referral = {
    testMode: false,
    seekerPassPromotionEnabled: false,
    authenticate(token) {
      assert.equal(token, "valid-session");
      return { wallet: player.publicKey.toBase58(), sgtMint: Keypair.generate().publicKey.toBase58() };
    },
  };
  const promotionService = {
    list() { return [promotion]; },
    points(wallet) {
      assert.equal(wallet, player.publicKey.toBase58());
      return 75;
    },
    async sync(id) {
      assert.equal(id, promotion.id);
      return promotion;
    },
    reserveEntry(input) {
      assert.equal(input.wallet, player.publicKey.toBase58());
      assert.equal(input.idempotencyKey, "entry-request-0001");
      return { entryId: "entry-reservation", balance: 50 };
    },
  };
  const connection = {
    async getLatestBlockhash() {
      return { blockhash, lastValidBlockHeight: 987_654 };
    },
  };
  const server = createSeekerReferralHttpServer({
    service: referral,
    promotions: { service: promotionService, connection, authorizer },
    requireHttps: false,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const publicResponse = await fetch(`${base}/api/promotions`);
  assert.equal(publicResponse.status, 200);
  assert.equal((await publicResponse.json()).promotions[0].title, "500 SKR");

  const meResponse = await request(base, "/api/promotions/me");
  assert.equal(meResponse.status, 200);
  assert.equal((await meResponse.json()).luckyPoints, 75);

  const preparedResponse = await request(base, `/api/promotions/${promotion.id}/entry/prepare`, {
    method: "POST",
    body: JSON.stringify({ idempotencyKey: "entry-request-0001" }),
  });
  assert.equal(preparedResponse.status, 200);
  const prepared = await preparedResponse.json();
  assert.equal(prepared.entryId, "entry-reservation");
  assert.equal(prepared.expectedEntryIndex, 3);
  assert.equal(prepared.luckyPoints, 50);
  const transaction = Transaction.from(Buffer.from(prepared.transactionBase64, "base64"));
  assert.equal(transaction.feePayer.toBase58(), player.publicKey.toBase58());
  assert.ok(transaction.signatures.find(({ publicKey }) =>
    publicKey.equals(authorizer.publicKey))?.signature);
  assert.equal(transaction.signatures.find(({ publicKey }) =>
    publicKey.equals(player.publicKey))?.signature, null);
});

test("authenticated APK profile and X mission routes share the promotions database", async (t) => {
  const player = Keypair.generate();
  const promotionService = createPromotionalPoolsService({
    dbPath: ":memory:",
    chain: {},
  });
  const platform = createLuckyMePlatformService({
    db: promotionService.db,
    pointsService: promotionService,
  });
  const referral = {
    testMode: false,
    seekerPassPromotionEnabled: false,
    authenticate(token) {
      assert.equal(token, "valid-session");
      return { wallet: player.publicKey.toBase58() };
    },
  };
  const server = createSeekerReferralHttpServer({
    service: referral,
    promotions: {
      service: promotionService,
      platform,
      connection: {},
      authorizer: Keypair.generate(),
    },
    requireHttps: false,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;

  const profileResponse = await request(base, "/api/promotions/profile");
  assert.equal(profileResponse.status, 200);
  const profile = (await profileResponse.json()).profile;
  assert.equal(profile.wallet, player.publicKey.toBase58());
  assert.equal(profile.usernameState.canCustomize, true);

  const usernameResponse = await request(base, "/api/promotions/profile/username", {
    method: "POST",
    body: JSON.stringify({
      username: "api_player",
      permanenceAccepted: true,
      confirmation: "CONFIRM PERMANENT USERNAME",
    }),
  });
  assert.equal(usernameResponse.status, 200);
  assert.equal((await usernameResponse.json()).profile.username, "api_player");

  const tasksResponse = await request(base, "/api/promotions/tasks");
  assert.equal(tasksResponse.status, 200);
  const tasks = (await tasksResponse.json()).tasks;
  const xTask = tasks.find((task) => task.platform === "x");
  assert.ok(xTask);

  const challengeResponse = await request(
    base,
    `/api/promotions/tasks/${encodeURIComponent(xTask.id)}/x/challenge`,
    { method: "POST", body: "{}" },
  );
  assert.equal(challengeResponse.status, 201);
  const challenge = await challengeResponse.json();
  assert.match(challenge.message, /^Verifying my LuckyMe identity:/);

  const submissionResponse = await request(
    base,
    `/api/promotions/tasks/${encodeURIComponent(xTask.id)}/x/submit`,
    {
      method: "POST",
      body: JSON.stringify({
        challengeId: challenge.id,
        handle: "@api_player",
        postUrl: "https://x.com/api_player/status/1234567890123456789",
      }),
    },
  );
  assert.equal(submissionResponse.status, 201);
  assert.equal((await submissionResponse.json()).status, "pending_review");
});
