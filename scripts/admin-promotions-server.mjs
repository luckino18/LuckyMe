import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import http from "node:http";
import { URL, fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  createPromotionChainAdapter,
  derivePromotionAddresses,
  serializePreparedTransaction,
  versionedTransactionForSimulation,
  verifySignedPreparedTransaction,
} from "../backend/src/promotional-pools-chain.mjs";
import {
  PromotionalPoolError,
  createPromotionalPoolsService,
} from "../backend/src/promotional-pools-service.mjs";
import { createLuckyMePlatformService } from "../backend/src/luckyme-platform-service.mjs";
import {
  ECONOMY_VERSION,
  RANKS,
  calculatePromotionEconomy,
  missionRewardPreset,
} from "../backend/src/luckyme-economy.mjs";
import { createPromotionPriceService } from "../backend/src/promotion-price-service.mjs";
import {
  loadPushRegistrations,
  sendExpoPushNotifications,
} from "../backend/src/push-notifications.mjs";

const HOST = process.env.LUCKYME_ADMIN_PROMOTIONS_HOST ?? "127.0.0.1";
const PORT = Number(process.env.LUCKYME_ADMIN_PROMOTIONS_PORT ?? 8793);
const RPC_URL = process.env.LUCKYME_ADMIN_PROMOTIONS_RPC_URL ?? process.env.ANCHOR_PROVIDER_URL ??
  "https://api.mainnet-beta.solana.com";
const DB_PATH = process.env.LUCKYME_PROMOTIONS_DB_PATH ?? "/var/lib/luckyme-promotions/promotional-pools.sqlite";
const SPONSOR = process.env.LUCKYME_PROMOTIONS_SPONSOR ?? "";
const AUTHORIZER_KEYPAIR_PATH = process.env.LUCKYME_PROMOTIONS_AUTHORIZER_KEYPAIR ?? "";
const PREPARE_ENABLED = process.env.LUCKYME_ADMIN_PROMOTIONS_PREPARE_ENABLED === "true";
const EXECUTION_ENABLED = process.env.LUCKYME_ADMIN_PROMOTIONS_EXECUTION_ENABLED === "true";
const MAX_BODY_BYTES = 512 * 1_024;
const PLAN_TTL_MS = 10 * 60_000;

function loadAuthorizer(path) {
  if (!path) return null;
  const values = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(values) || ![32, 64].includes(values.length)) {
    throw new Error("Promotion authorizer keypair has an invalid layout");
  }
  return values.length === 32
    ? Keypair.fromSeed(Uint8Array.from(values))
    : Keypair.fromSecretKey(Uint8Array.from(values));
}

function proxyIdentity(req) {
  if (req.headers["x-luckyme-admin-proxy"] !== "1") return null;
  const username = String(req.headers["x-luckyme-admin-user"] ?? "").trim();
  return username && username.length <= 128 ? username : null;
}

function json(res, status, payload) {
  const body = `${JSON.stringify(payload)}\n`;
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

function requireAdminPost(req) {
  if (req.headers["x-luckyme-admin-request"] !== "1") {
    throw Object.assign(new Error("Admin request header is required"), { status: 403, code: "admin_request_header_required" });
  }
}

function audit(event) {
  console.log(JSON.stringify({
    event: "luckyme_admin_promotions_audit",
    timestamp: new Date().toISOString(),
    ...event,
  }));
}

function prizeDisplay(promotion) {
  const amount = BigInt(promotion.prizeAmountBaseUnits);
  const scale = 10n ** BigInt(promotion.prizeDecimals);
  const fraction = (amount % scale).toString().padStart(promotion.prizeDecimals, "0")
    .replace(/0+$/, "");
  return `${amount / scale}${fraction ? `.${fraction}` : ""} ${promotion.prizeAsset}`;
}

export function createAdminPromotionsServer({
  connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    confirmTransactionInitialTimeout: 60_000,
  }),
  sponsor = SPONSOR,
  authorizerSigner = loadAuthorizer(AUTHORIZER_KEYPAIR_PATH),
  dbPath = DB_PATH,
  prepareEnabled = PREPARE_ENABLED,
  executionEnabled = EXECUTION_ENABLED,
  priceService = createPromotionPriceService(),
} = {}) {
  const chain = createPromotionChainAdapter({ connection, sponsor });
  const service = createPromotionalPoolsService({ dbPath, chain });
  const platform = createLuckyMePlatformService({ db: service.db, pointsService: service });
  const plans = new Map();

  function cleanPlans() {
    const cutoff = Date.now() - PLAN_TTL_MS;
    for (const [id, plan] of plans) {
      if (plan.createdAt < cutoff) plans.delete(id);
    }
  }

  async function configPayload() {
    let treasury = null;
    let treasuryError = null;
    try {
      treasury = await service.treasury();
    } catch (error) {
      treasuryError = error.code ?? "treasury_unavailable";
    }
    let prices = null;
    let priceError = null;
    try {
      prices = await priceService.prices();
    } catch (error) {
      priceError = error.message;
    }
    return {
      cluster: "mainnet-beta",
      sponsor,
      authorizer: authorizerSigner?.publicKey.toBase58() ?? null,
      prepareEnabled: Boolean(prepareEnabled && authorizerSigner && sponsor),
      executionEnabled,
      treasury,
      treasuryError,
      promotions: service.list({ includeDrafts: true }),
      economy: {
        calculatorVersion: ECONOMY_VERSION,
        ranks: RANKS,
        audience: platform.activeAudience(),
        prices,
        priceError,
      },
    };
  }

  async function economyCalculation(input) {
    const quote = await priceService.quote(input.prizeAsset, { force: Boolean(input.forcePriceRefresh) });
    if (quote.stale) {
      throw Object.assign(new Error(`${quote.asset} price is stale; wait for a fresh market quote`), {
        status: 503,
        code: "promotion_price_stale",
      });
    }
    const audience = input.useLiveAudience ? platform.activeAudience() : {
      eligibleActiveUsers: 0,
      historicalConversionRate: 0.25,
    };
    return calculatePromotionEconomy({
      prizeAsset: input.prizeAsset,
      prizeAmount: input.prizeAmount,
      usdPrice: quote.usdPrice,
      priceSource: quote.source,
      priceFetchedAt: quote.fetchedAt,
      priceBlockId: quote.blockId,
      mode: input.economyMode,
      useLiveAudience: input.useLiveAudience,
      eligibleActiveUsers: audience.eligibleActiveUsers,
      historicalConversionRate: audience.historicalConversionRate,
      requestedCapacity: input.capacity,
      requestedEntryCostPoints: input.entryCostPoints,
      minLevel: input.minLevel,
      maxLevel: input.maxLevel,
    });
  }

  const server = http.createServer(async (req, res) => {
    const username = proxyIdentity(req);
    if (!username) return json(res, 403, { error: "trusted_proxy_required" });
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
    try {
      cleanPlans();
      if (req.method === "GET" && (url.pathname === "/config" || url.pathname === "/")) {
        return json(res, 200, await configPayload());
      }
      if (req.method === "GET" && url.pathname === "/treasury") {
        return json(res, 200, await service.treasury());
      }
      if (req.method === "GET" && url.pathname === "/promotions") {
        return json(res, 200, { promotions: service.list({ includeDrafts: true }) });
      }
      if (req.method === "POST" && url.pathname === "/economy/calculate") {
        requireAdminPost(req);
        return json(res, 200, { economy: await economyCalculation(await readJson(req)) });
      }
      if (req.method === "POST" && url.pathname === "/platform/tasks/reward-preview") {
        requireAdminPost(req);
        const input = await readJson(req);
        return json(res, 200, {
          reward: missionRewardPreset({
            platform: input.platform,
            xAction: input.xAction,
            gameplayPoolType: input.gameplayPoolType,
            gameplayRequiredCount: input.gameplayRequiredCount,
          }),
        });
      }
      if (req.method === "GET" && url.pathname === "/platform/users") {
        return json(res, 200, {
          users: platform.listUsers({
            search: url.searchParams.get("search") ?? "",
            limit: Number(url.searchParams.get("limit") ?? 500),
          }),
        });
      }
      const platformUserMatch = url.pathname.match(/^\/platform\/users\/([^/]+)$/);
      if (req.method === "GET" && platformUserMatch) {
        return json(res, 200, {
          user: platform.userDetails(decodeURIComponent(platformUserMatch[1])),
        });
      }
      const platformUserStatusMatch = url.pathname.match(/^\/platform\/users\/([^/]+)\/status$/);
      if (req.method === "POST" && platformUserStatusMatch) {
        requireAdminPost(req);
        const input = await readJson(req);
        return json(res, 200, {
          user: platform.setUserStatus({
            actor: username,
            wallet: decodeURIComponent(platformUserStatusMatch[1]),
            status: input.status,
          }),
        });
      }
      if (req.method === "GET" && url.pathname === "/platform/tasks") {
        return json(res, 200, {
          tasks: platform.listTasks(null, { includeInactive: true }),
          submissions: platform.listSubmissions({
            status: url.searchParams.get("submissionStatus") ?? "pending_review",
          }),
        });
      }
      if (req.method === "POST" && url.pathname === "/platform/tasks") {
        requireAdminPost(req);
        return json(res, 201, {
          task: platform.createTask({ actor: username, ...await readJson(req) }),
        });
      }
      const platformTaskUpdateMatch = url.pathname.match(/^\/platform\/tasks\/([^/]+)\/update$/);
      if (req.method === "POST" && platformTaskUpdateMatch) {
        requireAdminPost(req);
        return json(res, 200, {
          task: platform.updateTask({
            actor: username,
            taskId: platformTaskUpdateMatch[1],
            ...await readJson(req),
          }),
        });
      }
      const platformTaskDeleteMatch = url.pathname.match(/^\/platform\/tasks\/([^/]+)\/delete$/);
      if (req.method === "POST" && platformTaskDeleteMatch) {
        requireAdminPost(req);
        return json(res, 200, platform.deleteTask({
          actor: username,
          taskId: platformTaskDeleteMatch[1],
        }));
      }
      const platformReviewMatch = url.pathname.match(/^\/platform\/submissions\/([^/]+)\/review$/);
      if (req.method === "POST" && platformReviewMatch) {
        requireAdminPost(req);
        return json(res, 200, platform.reviewTask({
          actor: username,
          submissionId: platformReviewMatch[1],
          ...await readJson(req),
        }));
      }
      if (req.method === "POST" && url.pathname === "/prepare") {
        requireAdminPost(req);
        if (!prepareEnabled || !authorizerSigner || !sponsor) {
          return json(res, 403, { error: "promotion_preparation_disabled" });
        }
        const input = await readJson(req);
        const economy = await economyCalculation(input);
        if (economy.intentionalSubsidy && economy.mode !== "ultra") {
          return json(res, 409, {
            error: "unsafe_standard_promotion",
            message: "This configuration is below the standard LuckyMe economic floor. Use the Ultra Promotion tab for an intentional subsidy.",
            economy,
          });
        }
        if (economy.intentionalSubsidy &&
            (input.approveIntentionalSubsidy !== true ||
             input.subsidyConfirmation !== "APPROVE INTENTIONAL HOUSE SUBSIDY")) {
          return json(res, 409, {
            error: "subsidy_approval_required",
            message: "Confirm the intentional House subsidy before preparing this Ultra Promotion.",
            economy,
          });
        }
        let numericId = BigInt(Date.now());
        let addresses = derivePromotionAddresses({ numericId, prizeAsset: input.prizeAsset });
        while (await connection.getAccountInfo(new PublicKey(addresses.promotion), "confirmed")) {
          numericId += 1n;
          addresses = derivePromotionAddresses({ numericId, prizeAsset: input.prizeAsset });
        }
        const promotion = service.createDraft({
          ...input,
          entryCostPoints: economy.entryCostPoints,
          capacity: economy.capacity,
          minLevel: economy.minLevel,
          maxLevel: economy.maxLevel,
          economyMode: economy.mode,
          numericId: numericId.toString(),
          sponsor,
          authorizer: authorizerSigner.publicKey.toBase58(),
          addresses,
          actor: username,
        });
        const overrides = {
          capacity: economy.capacity === economy.recommendedCapacity
            ? null
            : { recommended: economy.recommendedCapacity, selected: economy.capacity },
          entryCostPoints: economy.entryCostPoints === economy.recommendedEntryCostPoints
            ? null
            : { recommended: economy.recommendedEntryCostPoints, selected: economy.entryCostPoints },
        };
        service.saveEconomySnapshot(promotion.id, economy, {
          actor: username,
          overrides,
          approved: economy.intentionalSubsidy,
        });
        const latest = await connection.getLatestBlockhash("confirmed");
        const transaction = chain.buildLaunchTransaction({
          promotion,
          recentBlockhash: latest.blockhash,
          authorizerSigner,
        });
        const prepared = serializePreparedTransaction(transaction);
        service.markPrepared(promotion.id, { actor: username });
        const planId = randomBytes(24).toString("base64url");
        const confirmation = `LAUNCH ${promotion.id}`;
        plans.set(planId, {
          username,
          promotionId: promotion.id,
          prepared,
          confirmation,
          lastValidBlockHeight: latest.lastValidBlockHeight,
          createdAt: Date.now(),
        });
        audit({
          username,
          action: "promotion_launch_prepared",
          promotionId: promotion.id,
          planId,
          asset: promotion.prizeAsset,
          prizeAmountBaseUnits: promotion.prizeAmountBaseUnits,
          capacity: promotion.capacity,
        });
        return json(res, 200, {
          planId,
          confirmation,
          transactionBase64: prepared.transactionBase64,
          promotion: service.pool(promotion.id),
          economy: service.economySnapshot(promotion.id),
          summary: {
            network: "Solana Mainnet",
            sponsor,
            vault: promotion.vaultAddress,
            asset: promotion.prizeAsset,
            prizeAmountBaseUnits: promotion.prizeAmountBaseUnits,
            prizeDecimals: promotion.prizeDecimals,
            capacity: promotion.capacity,
            entryCostPoints: promotion.entryCostPoints,
            expiryMode: promotion.expiryMode,
            economyStatus: economy.economicStatus,
            prizeUsd: economy.prizeUsd,
          },
        });
      }
      if (req.method === "POST" && url.pathname === "/submit") {
        requireAdminPost(req);
        if (!executionEnabled) return json(res, 403, { error: "promotion_execution_disabled" });
        const input = await readJson(req);
        const plan = plans.get(String(input.planId ?? ""));
        if (!plan || plan.username !== username) return json(res, 404, { error: "launch_plan_not_found" });
        if (input.confirmation !== plan.confirmation) {
          return json(res, 400, { error: "confirmation_mismatch" });
        }
        const signed = verifySignedPreparedTransaction({
          preparedBase64: plan.prepared.transactionBase64,
          signedBase64: String(input.signedTransactionBase64 ?? ""),
        });
        const simulation = await connection.simulateTransaction(versionedTransactionForSimulation(signed), {
          commitment: "confirmed",
          sigVerify: true,
        });
        if (simulation.value.err) {
          audit({ username, action: "promotion_launch_simulation_failed", promotionId: plan.promotionId, error: simulation.value.err });
          return json(res, 409, {
            error: "promotion_simulation_failed",
            logs: simulation.value.logs?.slice(-20) ?? [],
          });
        }
        const signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: false,
          preflightCommitment: "confirmed",
          maxRetries: 3,
        });
        const confirmation = await connection.confirmTransaction({
          signature,
          blockhash: plan.prepared.recentBlockhash,
          lastValidBlockHeight: plan.lastValidBlockHeight,
        }, "confirmed");
        if (confirmation.value.err) {
          return json(res, 503, { error: "promotion_launch_unconfirmed", signature });
        }
        const draft = service.pool(plan.promotionId);
        const onchain = await chain.readPromotion(draft);
        if (!onchain || onchain.status !== "open") {
          return json(res, 503, { error: "promotion_launch_verification_failed", signature });
        }
        const launched = service.markLaunched(plan.promotionId, { signature, actor: username });
        plans.delete(String(input.planId));
        audit({ username, action: "promotion_launched", promotionId: launched.id, signature });
        let notification = { sent: false, recipients: 0 };
        if (platform.beginPromotionNotification(launched.id)) {
          try {
            const registrations = await loadPushRegistrations();
            const messages = registrations.filter((item) => item.token).map((item) => ({
              to: item.token,
              title: `New LuckyMe promotion: ${launched.title}`,
              body: `Win ${prizeDisplay(launched)} · Entry ${launched.entryCostPoints} Lucky Points`,
              data: {
                url: `luckyme://promotions?promotion=${encodeURIComponent(launched.id)}`,
                promotionId: launched.id,
                type: "promotion-launched",
              },
              channelId: "luckyme-round-alerts",
            }));
            const delivery = await sendExpoPushNotifications(messages, {
              dryRun: process.env.LUCKYME_PUSH_SEND !== "true",
            });
            if (delivery.dryRun) throw new Error("Push delivery is disabled");
            platform.finishPromotionNotification(launched.id, { recipients: delivery.sent });
            notification = { sent: true, recipients: delivery.sent };
          } catch (error) {
            platform.finishPromotionNotification(launched.id, { error: error.message });
            audit({
              username,
              action: "promotion_push_failed",
              promotionId: launched.id,
              error: error.message,
            });
            notification = { sent: false, recipients: 0, error: error.message };
          }
        }
        return json(res, 200, { promotion: launched, signature, notification });
      }
      return json(res, 404, { error: "not_found" });
    } catch (error) {
      const status = error instanceof PromotionalPoolError ? error.status : error.status ?? 500;
      const code = error instanceof PromotionalPoolError ? error.code : error.code ?? "request_failed";
      if (status >= 500) {
        console.error(JSON.stringify({ event: "luckyme_admin_promotions_failed", path: url.pathname, code }));
      }
      return json(res, status, { error: code, message: error.message });
    }
  });
  server.once("close", () => service.close());
  return server;
}

export function startAdminPromotionsServer(options = {}) {
  const server = createAdminPromotionsServer(options);
  server.listen(PORT, HOST, () => {
    console.log(JSON.stringify({
      event: "luckyme_admin_promotions_started",
      host: HOST,
      port: PORT,
      prepareEnabled: PREPARE_ENABLED,
      executionEnabled: EXECUTION_ENABLED,
    }));
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  startAdminPromotionsServer();
}
