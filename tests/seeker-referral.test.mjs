import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { TOKEN_2022_PROGRAM_ID } from "@solana/spl-token";
import { createSignInMessage } from "@solana/wallet-standard-util";
import nacl from "tweetnacl";
import {
  SGT_GROUP_ADDRESS,
  SGT_METADATA_ADDRESS,
  SGT_MINT_AUTHORITY,
  createSeekerReferralService,
  isAuthenticSgtMint,
} from "../backend/src/seeker-referral-service.mjs";
import { createSeekerReferralHttpServer } from "../backend/src/seeker-referral-server.mjs";
import { WalletOutputError, walletResultBytes } from "../app-seeker/src/wallet-result-bytes.ts";

const require = createRequire(import.meta.url);

test("Seeker wallet output adapter", async (t) => {
  await t.test("recovers Seed Vault protocol-base64 signature bytes", () => {
    const raw = Uint8Array.from({ length: 64 }, (_, index) => index);
    const walletUiBytes = new TextEncoder().encode(Buffer.from(raw).toString("base64"));
    assert.equal(walletUiBytes.length, 88);
    assert.deepEqual(walletResultBytes(walletUiBytes, "signature", 64), raw);
  });

  await t.test("recovers protocol-base64 signed message bytes", () => {
    const raw = new TextEncoder().encode("lucky-me.app wants you to sign in with your Solana account:\nWallet");
    const walletUiBytes = new TextEncoder().encode(Buffer.from(raw).toString("base64"));
    assert.deepEqual(walletResultBytes(walletUiBytes, "signed message"), raw);
  });

  await t.test("preserves raw wallet bytes", () => {
    const signature = Uint8Array.from({ length: 64 }, (_, index) => 255 - index);
    assert.equal(walletResultBytes(signature, "signature", 64), signature);
  });

  await t.test("classifies an actually malformed signature as wallet output", () => {
    assert.throws(
      () => walletResultBytes(new Uint8Array(12), "signature", 64),
      (error) => error instanceof WalletOutputError && /signature length/.test(error.message),
    );
  });
});

function fixture({ testMode = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "luckyme-referral-"));
  let currentTime = Date.parse("2026-07-14T12:00:00.000Z");
  const sgtByWallet = new Map();
  const service = createSeekerReferralService({
    dbPath: join(directory, "referral.sqlite"),
    testMode,
    clock: () => currentTime,
    logger: () => undefined,
    sgtVerifier: async (wallet) => sgtByWallet.get(wallet) ?? null,
  });
  return {
    service,
    sgtByWallet,
    advance(ms) { currentTime += ms; },
    close() {
      service.close();
      rmSync(directory, { force: true, recursive: true });
    },
  };
}

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

async function verifyWallet(f, keypair, { pending = false, sgtMint } = {}) {
  const wallet = keypair.publicKey.toBase58();
  f.sgtByWallet.set(wallet, sgtMint ?? Keypair.generate().publicKey.toBase58());
  const { payload } = f.service.issueNonce({ ip: `ip-${wallet.slice(0, 8)}` });
  return f.service.verifySiws({
    payload,
    output: signedOutput(keypair, payload),
    hasPendingReferral: pending,
    ip: `ip-${wallet.slice(0, 8)}`,
  });
}

function expectCode(code) {
  return (error) => {
    assert.equal(error?.code, code);
    return true;
  };
}

test("LuckyMe Seeker referral security and idempotency suite", async (t) => {
  await t.test("1. accepts valid SIWS and authentic SGT", async () => {
    const f = fixture();
    try {
      const result = await verifyWallet(f, Keypair.generate());
      assert.equal(result.profile.state, "VERIFIED");
      assert.match(result.profile.referralCode, /^LM-/);
      assert.ok(result.sessionToken.length >= 40);
    } finally { f.close(); }
  });

  await t.test("2. rejects an invalid SIWS signature", async () => {
    const f = fixture();
    try {
      const wallet = Keypair.generate();
      f.sgtByWallet.set(wallet.publicKey.toBase58(), Keypair.generate().publicKey.toBase58());
      const { payload } = f.service.issueNonce({ ip: "invalid-signature" });
      const output = signedOutput(wallet, payload);
      const bytes = Buffer.from(output.signature, "base64");
      bytes[0] ^= 0xff;
      output.signature = bytes.toString("base64");
      await assert.rejects(
        f.service.verifySiws({ payload, output, ip: "invalid-signature" }),
        expectCode("invalid_siws"),
      );
      const retry = await f.service.verifySiws({
        payload,
        output: signedOutput(wallet, payload),
        ip: "invalid-signature",
      });
      assert.equal(retry.profile.state, "VERIFIED");
    } finally { f.close(); }
  });

  await t.test("3. rejects an expired nonce", async () => {
    const f = fixture();
    try {
      const wallet = Keypair.generate();
      const { payload } = f.service.issueNonce({ ip: "expired" });
      f.advance(6 * 60_000);
      await assert.rejects(
        f.service.verifySiws({ payload, output: signedOutput(wallet, payload), ip: "expired" }),
        expectCode("nonce_expired"),
      );
    } finally { f.close(); }
  });

  await t.test("4. rejects nonce replay", async () => {
    const f = fixture();
    try {
      const wallet = Keypair.generate();
      f.sgtByWallet.set(wallet.publicKey.toBase58(), Keypair.generate().publicKey.toBase58());
      const { payload } = f.service.issueNonce({ ip: "replay" });
      const request = { payload, output: signedOutput(wallet, payload), ip: "replay" };
      await f.service.verifySiws(request);
      await assert.rejects(f.service.verifySiws(request), expectCode("nonce_reused"));
    } finally { f.close(); }
  });

  await t.test("5. rejects a wrong SIWS domain", async () => {
    const f = fixture();
    try {
      const wallet = Keypair.generate();
      const { payload } = f.service.issueNonce({ ip: "domain" });
      const changed = { ...payload, domain: "evil.example" };
      await assert.rejects(
        f.service.verifySiws({ payload: changed, output: signedOutput(wallet, changed), ip: "domain" }),
        expectCode("invalid_siws"),
      );
    } finally { f.close(); }
  });

  await t.test("6. denies a wallet without SGT", async () => {
    const f = fixture();
    try {
      const wallet = Keypair.generate();
      const { payload } = f.service.issueNonce({ ip: "no-sgt" });
      await assert.rejects(
        f.service.verifySiws({ payload, output: signedOutput(wallet, payload), ip: "no-sgt" }),
        expectCode("no_sgt"),
      );
    } finally { f.close(); }
  });

  await t.test("7. rejects a Token-2022 NFT imitating an SGT", () => {
    assert.equal(isAuthenticSgtMint({
      ownerProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
      decimals: 0,
      supply: "1",
      mintAuthority: SGT_MINT_AUTHORITY,
      metadataAuthority: SGT_MINT_AUTHORITY,
      metadataAddress: SGT_METADATA_ADDRESS,
      groupAddress: Keypair.generate().publicKey.toBase58(),
    }), false);
  });

  await t.test("8. recognizes all official SGT authenticity fields", () => {
    assert.equal(isAuthenticSgtMint({
      ownerProgram: TOKEN_2022_PROGRAM_ID.toBase58(),
      decimals: 0,
      supply: "1",
      mintAuthority: SGT_MINT_AUTHORITY,
      metadataAuthority: SGT_MINT_AUTHORITY,
      metadataAddress: SGT_METADATA_ADDRESS,
      groupAddress: SGT_GROUP_ADDRESS,
    }), true);
  });

  await t.test("9. updates the current wallet when the same SGT moves", async () => {
    const f = fixture();
    try {
      const mint = Keypair.generate().publicKey.toBase58();
      const first = await verifyWallet(f, Keypair.generate(), { sgtMint: mint });
      const secondWallet = Keypair.generate();
      const second = await verifyWallet(f, secondWallet, { sgtMint: mint });
      const identity = f.service.db.prepare("SELECT current_wallet FROM seeker_identities WHERE sgt_mint = ?").get(mint);
      assert.equal(identity.current_wallet, secondWallet.publicKey.toBase58());
      assert.notEqual(first.sessionToken, second.sessionToken);
      assert.throws(() => f.service.getProfile(first.sessionToken), expectCode("invalid_session"));
      assert.equal(f.service.getProfile(second.sessionToken).state, "VERIFIED");
    } finally { f.close(); }
  });

  await t.test("10. one SGT cannot create a second profile", async () => {
    const f = fixture();
    try {
      const mint = Keypair.generate().publicKey.toBase58();
      await verifyWallet(f, Keypair.generate(), { sgtMint: mint });
      await verifyWallet(f, Keypair.generate(), { sgtMint: mint });
      const count = f.service.db.prepare("SELECT COUNT(*) AS count FROM referral_profiles WHERE sgt_mint = ?").get(mint);
      assert.equal(count.count, 1);
    } finally { f.close(); }
  });

  await t.test("11. blocks self-referral", async () => {
    const f = fixture();
    try {
      const user = await verifyWallet(f, Keypair.generate(), { pending: true });
      assert.throws(() => f.service.bindReferral(user.sessionToken, {
        referralCode: user.profile.referralCode,
        idempotencyKey: "self-referral-0001",
      }), expectCode("self_referral"));
    } finally { f.close(); }
  });

  await t.test("12. blocks circular referral graphs", async () => {
    const f = fixture();
    try {
      const a = await verifyWallet(f, Keypair.generate());
      const b = await verifyWallet(f, Keypair.generate(), { pending: true });
      f.service.bindReferral(b.sessionToken, {
        referralCode: a.profile.referralCode,
        idempotencyKey: "circle-bind-a-to-b",
      });
      const aSgt = f.service.db.prepare("SELECT sgt_mint FROM referral_profiles WHERE referral_code = ?")
        .get(a.profile.referralCode).sgt_mint;
      f.service.db.prepare("UPDATE referral_profiles SET status = 'pending_activation' WHERE sgt_mint = ?")
        .run(aSgt);
      assert.throws(() => f.service.bindReferral(a.sessionToken, {
        referralCode: b.profile.referralCode,
        idempotencyKey: "circle-bind-b-to-a",
      }), expectCode("circular_referral"));
    } finally { f.close(); }
  });

  await t.test("13. one referred SGT cannot use two codes", async () => {
    const f = fixture();
    try {
      const a = await verifyWallet(f, Keypair.generate());
      const c = await verifyWallet(f, Keypair.generate());
      const b = await verifyWallet(f, Keypair.generate(), { pending: true });
      f.service.bindReferral(b.sessionToken, {
        referralCode: a.profile.referralCode,
        idempotencyKey: "first-referral-code",
      });
      assert.throws(() => f.service.bindReferral(b.sessionToken, {
        referralCode: c.profile.referralCode,
        idempotencyKey: "second-referral-code",
      }), expectCode("sgt_already_bound"));
    } finally { f.close(); }
  });

  await t.test("14. concurrent binds award exactly one immutable binding", async () => {
    const f = fixture();
    try {
      const a = await verifyWallet(f, Keypair.generate());
      const c = await verifyWallet(f, Keypair.generate());
      const b = await verifyWallet(f, Keypair.generate(), { pending: true });
      const results = await Promise.allSettled([
        Promise.resolve().then(() => f.service.bindReferral(b.sessionToken, {
          referralCode: a.profile.referralCode,
          idempotencyKey: "concurrent-referral-a",
        })),
        Promise.resolve().then(() => f.service.bindReferral(b.sessionToken, {
          referralCode: c.profile.referralCode,
          idempotencyKey: "concurrent-referral-c",
        })),
      ]);
      assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(f.service.db.prepare("SELECT COUNT(*) AS count FROM referral_bindings").get().count, 1);
    } finally { f.close(); }
  });

  await t.test("15. retry after a lost response is idempotent", async () => {
    const f = fixture();
    try {
      const a = await verifyWallet(f, Keypair.generate());
      const b = await verifyWallet(f, Keypair.generate(), { pending: true });
      const payload = { referralCode: a.profile.referralCode, idempotencyKey: "network-retry-same-key" };
      const first = f.service.bindReferral(b.sessionToken, payload);
      const retry = f.service.bindReferral(b.sessionToken, payload);
      assert.equal(first.idempotent, false);
      assert.equal(retry.idempotent, true);
      assert.equal(f.service.db.prepare("SELECT COUNT(*) AS count FROM referral_bindings").get().count, 1);
    } finally { f.close(); }
  });

  await t.test("16. simulation endpoint logic is unavailable outside explicit test mode", async () => {
    const f = fixture({ testMode: false });
    try {
      const user = await verifyWallet(f, Keypair.generate());
      assert.throws(() => f.service.simulateQualification(user.sessionToken, {
        idempotencyKey: "simulation-disabled-1",
      }), expectCode("not_found"));
    } finally { f.close(); }
  });

  await t.test("17. leaderboard never duplicates points for the same SGT", async () => {
    const f = fixture();
    try {
      const a = await verifyWallet(f, Keypair.generate());
      const b = await verifyWallet(f, Keypair.generate(), { pending: true });
      f.service.bindReferral(b.sessionToken, {
        referralCode: a.profile.referralCode,
        idempotencyKey: "leaderboard-bind-1",
      });
      f.service.simulateQualification(b.sessionToken, { idempotencyKey: "leaderboard-qualify-1" });
      assert.throws(() => f.service.simulateQualification(b.sessionToken, {
        idempotencyKey: "leaderboard-qualify-2",
      }), expectCode("no_pending_referral"));
      const board = f.service.leaderboard(a.sessionToken);
      const entry = board.entries.find((item) => item.referralCode === a.profile.referralCode);
      assert.equal(entry.totalPoints, 1);
      assert.equal(entry.qualifiedReferrals, 1);
    } finally { f.close(); }
  });

  await t.test("18. logout revokes the session", async () => {
    const f = fixture();
    try {
      const user = await verifyWallet(f, Keypair.generate());
      assert.equal(f.service.logout(user.sessionToken).loggedOut, true);
      assert.throws(() => f.service.getProfile(user.sessionToken), expectCode("invalid_session"));
    } finally { f.close(); }
  });

  await t.test("19. valid deep-link code can be previewed only after verification", async () => {
    const f = fixture();
    try {
      const referrer = await verifyWallet(f, Keypair.generate());
      const referred = await verifyWallet(f, Keypair.generate(), { pending: true });
      const preview = f.service.previewReferral(referred.sessionToken, referrer.profile.referralCode);
      assert.equal(preview.referralCode, referrer.profile.referralCode);
      assert.match(preview.referrerMasked, /…/);
    } finally { f.close(); }
  });

  await t.test("20. nonexistent or expired referral code is rejected", async () => {
    const f = fixture();
    try {
      const user = await verifyWallet(f, Keypair.generate(), { pending: true });
      assert.throws(() => f.service.previewReferral(user.sessionToken, "LM-222222"),
        expectCode("referral_code_not_found"));
    } finally { f.close(); }
  });

  await t.test("21. pending user can explicitly activate without binding a referral", async () => {
    const f = fixture();
    try {
      const user = await verifyWallet(f, Keypair.generate(), { pending: true });
      assert.equal(user.profile.profileStatus, "pending_activation");
      assert.deepEqual(f.service.activateProfile(user.sessionToken), { activated: true, idempotent: false });
      assert.equal(f.service.getProfile(user.sessionToken).profileStatus, "active");
      assert.deepEqual(f.service.activateProfile(user.sessionToken), { activated: true, idempotent: true });
    } finally { f.close(); }
  });

  await t.test("22. HTTP endpoints enforce strict input, auth, security headers, and hidden test mode", async () => {
    const f = fixture({ testMode: false });
    const user = await verifyWallet(f, Keypair.generate());
    const server = createSeekerReferralHttpServer({ service: f.service, requireHttps: false });
    try {
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const address = server.address();
      assert.ok(address && typeof address === "object");
      const base = `http://127.0.0.1:${address.port}`;

      const health = await fetch(`${base}/health`);
      assert.equal(health.status, 200);
      assert.equal(health.headers.get("cache-control"), "no-store");
      assert.equal(health.headers.get("x-content-type-options"), "nosniff");

      const referralHealth = await fetch(`${base}/api/referral/health`);
      assert.equal(referralHealth.status, 200);
      assert.equal((await referralHealth.json()).service, "luckyme-seeker-referral-test");

      const wrongType = await fetch(`${base}/api/seeker/nonce`, { method: "POST", body: "{}" });
      assert.equal(wrongType.status, 415);
      assert.equal((await wrongType.json()).error, "unsupported_media_type");

      const badJson = await fetch(`${base}/api/seeker/nonce`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      });
      assert.equal(badJson.status, 400);
      assert.equal((await badJson.json()).error, "invalid_json");

      const missingAuth = await fetch(`${base}/api/seeker/profile`);
      assert.equal(missingAuth.status, 401);
      assert.equal((await missingAuth.json()).error, "invalid_session");

      const hiddenSimulation = await fetch(`${base}/api/test/referrals/simulate-qualification`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${user.sessionToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ idempotencyKey: "http-disabled-simulation" }),
      });
      assert.equal(hiddenSimulation.status, 404);
      const hiddenPayload = await hiddenSimulation.json();
      assert.equal(hiddenPayload.error, "not_found");
      assert.equal("stack" in hiddenPayload, false);
    } finally {
      server.close();
      f.close();
    }
  });

  await t.test("23. referral build reliably selects integrated UI and preserves notifications", () => {
    const names = [
      "LUCKYME_REFERRAL_TEST_BUILD",
      "EXPO_PUBLIC_LUCKYME_REFERRAL_TEST_MODE",
      "EXPO_PUBLIC_LUCKYME_REFERRAL_API_URL",
    ];
    const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.LUCKYME_REFERRAL_TEST_BUILD = "true";
      process.env.EXPO_PUBLIC_LUCKYME_REFERRAL_TEST_MODE = "true";
      process.env.EXPO_PUBLIC_LUCKYME_REFERRAL_API_URL = "https://api.lucky-me.app";
      const configPath = require.resolve("../app-seeker/app.config.js");
      delete require.cache[configPath];
      const makeConfig = require(configPath);
      const config = makeConfig({ config: {} });
      const pluginNames = config.plugins.map((plugin) => Array.isArray(plugin) ? plugin[0] : plugin);

      assert.equal(config.android.package, "app.luckyme.seekerreferraltest");
      assert.equal(config.android.versionCode, 5);
      assert.equal(config.version, "1.1.7-referral-test.5");
      assert.ok(config.android.permissions.includes("android.permission.POST_NOTIFICATIONS"));
      assert.equal(config.android.blockedPermissions.includes("android.permission.POST_NOTIFICATIONS"), false);
      assert.ok(pluginNames.includes("expo-notifications"));
      assert.equal(config.extra.referralTestBuild, true);
      assert.equal(config.extra.referralTestMode, true);
      assert.equal(config.extra.referralApiUrl, "https://api.lucky-me.app");

      const appSource = readFileSync(new URL("../app-seeker/App.tsx", import.meta.url), "utf8");
      const wrapperSource = readFileSync(new URL("../app-seeker/src/LuckyMeReferralTestApp.tsx", import.meta.url), "utf8");
      const luckyMeSource = readFileSync(new URL("../app-seeker/src/LuckyMeScreen.tsx", import.meta.url), "utf8");
      const referralSource = readFileSync(new URL("../app-seeker/src/SeekerReferralScreen.tsx", import.meta.url), "utf8");
      const buildSource = readFileSync(new URL("../app-seeker/scripts/build-seeker-referral-test.mjs", import.meta.url), "utf8");
      assert.match(appSource, /Constants\.expoConfig\?\.extra/);
      assert.doesNotMatch(appSource, /process\?\.env\?\.EXPO_PUBLIC_LUCKYME_REFERRAL_BUILD/);
      assert.match(wrapperSource, /<LuckyMeScreen/);
      assert.match(wrapperSource, /onOpenReferral=/);
      assert.match(wrapperSource, /<SeekerReferralScreen/);
      assert.doesNotMatch(wrapperSource, /referralBar|SEEKER REFERRAL TEST/);
      assert.match(luckyMeSource, /SEEKER EXCLUSIVE/);
      assert.match(luckyMeSource, /Seeker Referral/);
      assert.match(luckyMeSource, /onOpenReferral/);
      assert.match(referralSource, /error\.status === 404.*BACKEND_UNAVAILABLE/);
      assert.match(referralSource, /walletResultBytes/);
      assert.match(referralSource, /WALLET CHECKED ON MAINNET/);
      assert.match(referralSource, /Clear and choose another wallet/);
      assert.match(referralSource, /PRIMARY Seed Vault wallet/);
      assert.match(buildSource, /reactNativeArchitectures=arm64-v8a/);
    } finally {
      for (const name of names) {
        if (previous[name] === undefined) delete process.env[name];
        else process.env[name] = previous[name];
      }
    }
  });
});
