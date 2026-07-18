import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import {
  ReferralHttpError,
  createSeekerReferralService,
} from "./seeker-referral-service.mjs";

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

export function createSeekerReferralHttpServer({
  service = createSeekerReferralService(),
  requireHttps = process.env.REFERRAL_REQUIRE_HTTPS === "true" || process.env.NODE_ENV === "production",
  trustProxy = process.env.REFERRAL_TRUST_PROXY === "true",
} = {}) {
  const requestBuckets = new Map();

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
      if (req.method === "POST" && url.pathname === "/api/seeker/verify-siws") {
        const body = await readJson(req);
        return json(res, 200, await service.verifySiws({ ...body, ip }));
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
      const status = error instanceof ReferralHttpError ? error.status : 500;
      const code = error instanceof ReferralHttpError ? error.code : "internal_error";
      const message = error instanceof ReferralHttpError ? error.message : "The referral service could not complete the request";
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
