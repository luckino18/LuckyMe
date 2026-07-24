import http from "node:http";
import { readFileSync } from "node:fs";
import { URL, fileURLToPath } from "node:url";
import { Connection, Keypair } from "@solana/web3.js";
import {
  ReferralHttpError,
  createSeekerReferralService,
} from "./seeker-referral-service.mjs";
import {
  buildPromotionEntryTransaction,
  createPromotionChainAdapter,
  serializePreparedTransaction,
} from "./promotional-pools-chain.mjs";
import {
  PromotionalPoolError,
  createPromotionalPoolsService,
} from "./promotional-pools-service.mjs";
import { createLuckyMePlatformService } from "./luckyme-platform-service.mjs";

const MAX_BODY_BYTES = 64 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

function bearer(req) {
  const header = req.headers.authorization;
  if (typeof header !== "string" || !header.startsWith("Bearer ")) {
    throw new ReferralHttpError(401, "invalid_session", "A valid session is required");
  }
  return header.slice(7);
}

function clientIp(req, trustProxy) {
  const forwarded = req.headers["x-forwarded-for"];
  if (trustProxy && typeof forwarded === "string") return forwarded.split(",")[0].trim();
  return req.socket.remoteAddress ?? "unknown";
}

async function readJson(req) {
  if (!String(req.headers["content-type"] ?? "").toLowerCase().startsWith("application/json")) {
    throw new ReferralHttpError(415, "unsupported_media_type", "Content-Type must be application/json");
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new ReferralHttpError(413, "body_too_large", "Request body is too large");
    chunks.push(chunk);
  }
  try {
    const text = Buffer.concat(chunks).toString("utf8");
    return text ? JSON.parse(text) : {};
  } catch {
    throw new ReferralHttpError(400, "invalid_json", "Request body is not valid JSON");
  }
}

function json(res, status, payload) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  });
  res.end(JSON.stringify(payload));
}

function requireSecureTransport(req, enabled) {
  if (!enabled) return;
  const proto = String(req.headers["x-forwarded-proto"] ?? "").toLowerCase();
  if (proto !== "https") {
    throw new ReferralHttpError(400, "https_required", "HTTPS is required");
  }
}

function loadPromotionAuthorizer(path) {
  if (!path) return null;
  const secret = JSON.parse(readFileSync(path, "utf8"));
  return secret.length === 32
    ? Keypair.fromSeed(Uint8Array.from(secret))
    : Keypair.fromSecretKey(Uint8Array.from(secret));
}

function discordOAuthConfig(req) {
  const clientId = process.env.LUCKYME_DISCORD_CLIENT_ID;
  const clientSecret = process.env.LUCKYME_DISCORD_CLIENT_SECRET;
  const guildId = process.env.LUCKYME_DISCORD_GUILD_ID;
  if (!clientId || !clientSecret || !guildId) {
    throw new ReferralHttpError(
      503,
      "discord_oauth_not_configured",
      "Discord verification is not configured yet",
    );
  }
  const redirectUri = process.env.LUCKYME_DISCORD_REDIRECT_URI ??
    `https://${req.headers.host ?? "api.lucky-me.app"}/api/promotions/oauth/discord/callback`;
  return { clientId, clientSecret, guildId, redirectUri };
}

function discordResultPage(res, { ok, message }) {
  const safe = String(message ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character]);
  const body = `<!doctype html><meta charset="utf-8"><title>LuckyMe Discord</title>
    <body style="font-family:system-ui;background:#061b14;color:white;padding:40px">
      <h1>${ok ? "Discord verified" : "Verification stopped"}</h1>
      <p>${safe}</p>
      <p>You can return to LuckyMe.</p>
    </body>`;
  res.writeHead(ok ? 200 : 400, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
  });
  res.end(body);
}

function defaultPromotions() {
  if (process.env.LUCKYME_PROMOTIONS_ENABLED !== "true") return null;
  const authorizer = loadPromotionAuthorizer(process.env.LUCKYME_PROMOTIONS_AUTHORIZER_KEYPAIR);
  if (!authorizer) throw new Error("LUCKYME_PROMOTIONS_AUTHORIZER_KEYPAIR is required");
  const connection = new Connection(
    process.env.LUCKYME_PROMOTIONS_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const chain = createPromotionChainAdapter({ connection });
  const promotionService = createPromotionalPoolsService({
    dbPath: process.env.LUCKYME_PROMOTIONS_DB_PATH ?? "/var/lib/luckyme-promotions/promotional-pools.sqlite",
    chain,
  });
  return {
    authorizer,
    connection,
    service: promotionService,
    platform: createLuckyMePlatformService({
      db: promotionService.db,
      pointsService: promotionService,
    }),
  };
}

export function createSeekerReferralHttpServer({
  service = createSeekerReferralService(),
  promotions = defaultPromotions(),
  requireHttps = process.env.REFERRAL_REQUIRE_HTTPS === "true" || process.env.NODE_ENV === "production",
  trustProxy = process.env.REFERRAL_TRUST_PROXY === "true",
} = {}) {
  const requestBuckets = new Map();
  const platform = promotions?.platform ?? (
    promotions?.service?.db
      ? createLuckyMePlatformService({
        db: promotions.service.db,
        pointsService: promotions.service,
      })
      : null
  );

  function enforceRequestRateLimit(ip) {
    const now = Date.now();
    const key = String(ip);
    const bucket = requestBuckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      requestBuckets.set(key, { count: 1, resetAt: now + 60_000 });
      return;
    }
    bucket.count += 1;
    if (bucket.count > 120) {
      throw new ReferralHttpError(429, "rate_limited", "Too many requests");
    }
    if (requestBuckets.size > 10_000) {
      for (const [bucketKey, value] of requestBuckets) {
        if (value.resetAt <= now) requestBuckets.delete(bucketKey);
      }
    }
  }

  const server = http.createServer(async (req, res) => {
    req.setTimeout(REQUEST_TIMEOUT_MS);
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    try {
      const ip = clientIp(req, trustProxy);
      enforceRequestRateLimit(ip);
      requireSecureTransport(req, requireHttps);
      if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/api/referral/health")) {
        return json(res, 200, {
          ok: true,
          service: service.testMode ? "luckyme-seeker-referral-test" : "luckyme-seeker-referral",
          testMode: service.testMode,
          seekerPassPromotionEnabled: service.seekerPassPromotionEnabled,
        });
      }
      if (req.method === "POST" && url.pathname === "/api/seeker/nonce") {
        await readJson(req);
        return json(res, 200, service.issueNonce({ ip }));
      }
      if (req.method === "POST" && url.pathname === "/api/app/activation" && service.appAnalyticsEnabled) {
        return json(res, 200, service.recordAppActivation(await readJson(req), { ip }));
      }
      if (req.method === "GET" && url.pathname === "/api/seeker-pass/status") {
        return json(res, 200, service.seekerPassPromotionStatus());
      }
      if (req.method === "POST" && url.pathname === "/api/seeker-pass/nonce") {
        await readJson(req);
        return json(res, 200, service.issueSeekerPassNonce({ ip }));
      }
      if (req.method === "POST" && url.pathname === "/api/seeker-pass/verify") {
        return json(res, 200, await service.verifySeekerPassSiws({ ...await readJson(req), ip }));
      }
      if (req.method === "POST" && url.pathname === "/api/luckyme-nfts/nonce") {
        await readJson(req);
        return json(res, 200, service.issueLuckyMeNftNonce({ ip }));
      }
      if (req.method === "POST" && url.pathname === "/api/luckyme-nfts/verify") {
        return json(res, 200, await service.verifyLuckyMeNftSiws({ ...await readJson(req), ip }));
      }
      if (req.method === "POST" && url.pathname === "/api/seeker/verify-siws") {
        const body = await readJson(req);
        return json(res, 200, await service.verifySiws({ ...body, ip }));
      }
      if (req.method === "GET" && url.pathname === "/api/promotions/profile") {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        platform.syncValidPoolParticipations?.(auth.wallet);
        return json(res, 200, { profile: platform.profile(auth.wallet) });
      }
      if (req.method === "POST" && url.pathname === "/api/promotions/profile/username") {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        const body = await readJson(req);
        return json(res, 200, {
          profile: platform.finalizeUsername({ wallet: auth.wallet, ...body }),
        });
      }
      if (req.method === "POST" && url.pathname === "/api/promotions/profile/avatar/acquire") {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        return json(res, 200, platform.acquireAvatar({
          wallet: auth.wallet,
          ...await readJson(req),
        }));
      }
      if (req.method === "POST" && url.pathname === "/api/promotions/profile/avatar/select") {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        return json(res, 200, {
          profile: platform.selectAvatar({
            wallet: auth.wallet,
            ...await readJson(req),
          }),
        });
      }
      if (req.method === "GET" && url.pathname === "/api/promotions/tasks") {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        platform.syncValidPoolParticipations?.(auth.wallet);
        return json(res, 200, { tasks: platform.listTasks(auth.wallet) });
      }
      if (req.method === "GET" && url.pathname === "/api/promotions/activity") {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        platform.syncValidPoolParticipations?.(auth.wallet);
        return json(res, 200, { missions: platform.missionHistory(auth.wallet) });
      }
      const xChallengeMatch = url.pathname.match(/^\/api\/promotions\/tasks\/([^/]+)\/x\/challenge$/);
      if (req.method === "POST" && xChallengeMatch) {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        await readJson(req);
        return json(res, 201, platform.beginXVerification({
          wallet: auth.wallet,
          taskId: xChallengeMatch[1],
        }));
      }
      const xSubmitMatch = url.pathname.match(/^\/api\/promotions\/tasks\/([^/]+)\/x\/submit$/);
      if (req.method === "POST" && xSubmitMatch) {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        return json(res, 201, platform.submitXVerification({
          wallet: auth.wallet,
          taskId: xSubmitMatch[1],
          ...await readJson(req),
        }));
      }
      const discordStartMatch = url.pathname.match(/^\/api\/promotions\/tasks\/([^/]+)\/discord\/start$/);
      if (req.method === "POST" && discordStartMatch) {
        if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        await readJson(req);
        const oauth = discordOAuthConfig(req);
        const state = platform.beginDiscordOAuth({
          wallet: auth.wallet,
          taskId: discordStartMatch[1],
        });
        const authorizationUrl = new URL("https://discord.com/oauth2/authorize");
        authorizationUrl.search = new URLSearchParams({
          client_id: oauth.clientId,
          response_type: "code",
          redirect_uri: oauth.redirectUri,
          scope: "identify guilds",
          state: state.state,
          prompt: "consent",
        }).toString();
        return json(res, 201, {
          authorizationUrl: String(authorizationUrl),
          expiresAt: state.expiresAt,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/promotions/oauth/discord/callback") {
        try {
          if (!platform) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
          const oauth = discordOAuthConfig(req);
          const code = url.searchParams.get("code");
          const state = url.searchParams.get("state");
          if (!code || !state) {
            throw new ReferralHttpError(400, "invalid_oauth_callback", "Discord did not return a valid authorization");
          }
          const tokenResponse = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              client_id: oauth.clientId,
              client_secret: oauth.clientSecret,
              grant_type: "authorization_code",
              code,
              redirect_uri: oauth.redirectUri,
            }),
            signal: AbortSignal.timeout(10_000),
          });
          if (!tokenResponse.ok) {
            throw new ReferralHttpError(502, "discord_token_failed", "Discord authorization could not be completed");
          }
          const token = await tokenResponse.json();
          const headers = { authorization: `Bearer ${token.access_token}` };
          const [userResponse, guildsResponse] = await Promise.all([
            fetch("https://discord.com/api/users/@me", { headers, signal: AbortSignal.timeout(10_000) }),
            fetch("https://discord.com/api/users/@me/guilds", { headers, signal: AbortSignal.timeout(10_000) }),
          ]);
          if (!userResponse.ok || !guildsResponse.ok) {
            throw new ReferralHttpError(502, "discord_identity_failed", "Discord identity could not be read");
          }
          const discordUser = await userResponse.json();
          const guilds = await guildsResponse.json();
          if (!Array.isArray(guilds) || !guilds.some((guild) => guild.id === oauth.guildId)) {
            throw new ReferralHttpError(
              403,
              "discord_membership_required",
              "Join the official LuckyMe Discord server, then try again",
            );
          }
          const result = platform.completeDiscordOAuth({
            state,
            externalId: discordUser.id,
            username: discordUser.global_name || discordUser.username,
          });
          return discordResultPage(res, {
            ok: true,
            message: `Discord verified. ${result.luckyPoints} Lucky Points are now available.`,
          });
        } catch (error) {
          return discordResultPage(res, {
            ok: false,
            message: error.message || "Discord verification failed",
          });
        }
      }
      if (req.method === "GET" && url.pathname === "/api/promotions") {
        return json(res, 200, {
          promotions: promotions?.service.list() ?? [],
          enabled: Boolean(promotions),
        });
      }
      if (req.method === "GET" && url.pathname === "/api/promotions/me") {
        const auth = service.authenticate(bearer(req));
        const profile = platform?.profile(auth.wallet);
        return json(res, 200, {
          wallet: auth.wallet,
          luckyPoints: promotions?.service.points(auth.wallet) ?? 0,
          username: profile?.username ?? null,
          profile,
        });
      }
      const promotionPrepareMatch = url.pathname.match(/^\/api\/promotions\/([^/]+)\/entry\/prepare$/);
      if (req.method === "POST" && promotionPrepareMatch) {
        if (!promotions) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        const body = await readJson(req);
        const promotion = await promotions.service.sync(promotionPrepareMatch[1]);
        const playerProfile = platform?.profile(auth.wallet);
        const playerLevel = Number(playerProfile?.xp?.level ?? 1);
        if (playerLevel < Number(promotion.minLevel ?? 1) ||
            playerLevel > Number(promotion.maxLevel ?? 100)) {
          throw new ReferralHttpError(
            403,
            "promotion_level_required",
            `This promotion is available for levels ${promotion.minLevel ?? 1}-${promotion.maxLevel ?? 100}`,
          );
        }
        const reservation = promotions.service.reserveEntry({
          promotionId: promotion.id,
          wallet: auth.wallet,
          idempotencyKey: body.idempotencyKey,
        });
        const latest = await promotions.connection.getLatestBlockhash("confirmed");
        const prepared = buildPromotionEntryTransaction({
          promotion,
          player: auth.wallet,
          recentBlockhash: latest.blockhash,
          authorizerSigner: promotions.authorizer,
        });
        const serialized = serializePreparedTransaction(prepared.transaction);
        return json(res, 200, {
          entryId: reservation.entryId,
          entryAddress: prepared.entryAddress,
          expectedEntryIndex: promotion.entryCount,
          luckyPoints: reservation.balance,
          transactionBase64: serialized.transactionBase64,
          lastValidBlockHeight: latest.lastValidBlockHeight,
        });
      }
      const promotionConfirmMatch = url.pathname.match(/^\/api\/promotions\/([^/]+)\/entry\/confirm$/);
      if (req.method === "POST" && promotionConfirmMatch) {
        if (!promotions) throw new ReferralHttpError(503, "promotions_disabled", "Promotions are not enabled");
        const auth = service.authenticate(bearer(req));
        const body = await readJson(req);
        const result = await promotions.service.confirmEntry({
          entryId: body.entryId,
          wallet: auth.wallet,
          entryAddress: body.entryAddress,
          entryIndex: body.entryIndex,
          entrySignature: body.signature,
        });
        return json(res, 200, {
          promotion: result.promotion,
          luckyPoints: promotions.service.points(result.entry.wallet),
          replayed: result.replayed,
        });
      }
      if (req.method === "GET" && url.pathname === "/api/seeker/profile") {
        return json(res, 200, service.getProfile(bearer(req)));
      }
      if (req.method === "POST" && url.pathname === "/api/referrals/activity") {
        await readJson(req);
        return json(res, 200, service.recordActivity(bearer(req)));
      }
      const previewMatch = url.pathname.match(/^\/api\/referrals\/preview\/(LM-[A-Za-z0-9-]+)$/);
      if (req.method === "GET" && previewMatch) {
        return json(res, 200, service.previewReferral(bearer(req), previewMatch[1]));
      }
      if (req.method === "POST" && url.pathname === "/api/referrals/bind") {
        return json(res, 200, service.bindReferral(bearer(req), await readJson(req)));
      }
      if (req.method === "POST" && url.pathname === "/api/referrals/activate") {
        await readJson(req);
        return json(res, 200, service.activateProfile(bearer(req)));
      }
      if (req.method === "GET" && url.pathname === "/api/referrals/me") {
        return json(res, 200, service.referralMe(bearer(req)));
      }
      if (req.method === "GET" && url.pathname === "/api/referrals/leaderboard") {
        return json(res, 200, service.leaderboard(bearer(req)));
      }
      if (req.method === "POST" && url.pathname === "/api/test/referrals/simulate-qualification") {
        return json(res, 200, service.simulateQualification(bearer(req), await readJson(req)));
      }
      if (req.method === "POST" && url.pathname === "/api/auth/logout") {
        await readJson(req);
        return json(res, 200, service.logout(bearer(req)));
      }
      return json(res, 404, { error: "not_found", message: "Not found" });
    } catch (error) {
      const expected = error instanceof ReferralHttpError || error instanceof PromotionalPoolError;
      const status = expected ? error.status : 500;
      const code = expected ? error.code : "internal_error";
      const message = expected ? error.message : "The referral service could not complete the request";
      if (status >= 500) console.error("[seeker-referral] request_failed", { code, path: url.pathname });
      return json(res, status, { error: code, message });
    }
  });
  server.requestTimeout = REQUEST_TIMEOUT_MS;
  server.headersTimeout = REQUEST_TIMEOUT_MS + 2_000;
  if (service.seekerPassPromotionEnabled) {
    const promotionTimer = setInterval(() => {
      service.advanceSeekerPassPromotion().catch((error) => {
        console.error("[seeker-referral] promotion_advance_failed", { code: error?.code ?? "unknown" });
      });
    }, 15_000);
    promotionTimer.unref();
    server.once("close", () => clearInterval(promotionTimer));
    void service.advanceSeekerPassPromotion().catch(() => undefined);
  }
  return server;
}

export function startSeekerReferralServer(options = {}) {
  const port = Number(options.port ?? process.env.SEEKER_REFERRAL_PORT ?? 8790);
  const host = options.host ?? process.env.SEEKER_REFERRAL_HOST ?? "127.0.0.1";
  const server = createSeekerReferralHttpServer(options);
  server.listen(port, host, () => {
    console.info(`[seeker-referral] listening on http://${host}:${port}`);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startSeekerReferralServer();
}
