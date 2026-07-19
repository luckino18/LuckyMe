import { execFile } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { URL } from "node:url";

const execFileAsync = promisify(execFile);
const HOST = process.env.LUCKYME_ADMIN_CONTROL_HOST ?? "127.0.0.1";
const PORT = Number(process.env.LUCKYME_ADMIN_CONTROL_PORT ?? 8791);
const STATUS_PATH = process.env.LUCKYME_ADMIN_STATUS_PATH ?? "/var/www/luckyme/public/admin/status.json";
const MAX_BODY_BYTES = 8_192;
const MAX_LOG_LINES = 120;

const UNITS = Object.freeze({
  settlementTimer: "luckyme-settlement-keeper.timer",
  settlementService: "luckyme-settlement-keeper.service",
  settlementPreview: "luckyme-settlement-keeper-preview.service",
  notificationsTimer: "luckyme-push-alerts.timer",
  notificationsService: "luckyme-push-alerts.service",
  monitorTimer: "luckyme-operations-monitor.timer",
  monitorService: "luckyme-operations-monitor.service",
});

const ACTIONS = Object.freeze({
  refresh_status: ["start", UNITS.monitorService],
  settlement_preview: ["start", UNITS.settlementPreview],
  settlement_timer_start: ["enable", "--now", UNITS.settlementTimer],
  settlement_timer_stop: ["disable", "--now", UNITS.settlementTimer],
  notifications_timer_start: ["enable", "--now", UNITS.notificationsTimer],
  notifications_timer_stop: ["disable", "--now", UNITS.notificationsTimer],
  notifications_run_once: ["start", UNITS.notificationsService],
});

let actionNonce = freshNonce();
let actionInProgress = false;

function freshNonce() {
  return randomBytes(24).toString("base64url");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left ?? ""));
  const b = Buffer.from(String(right ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
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

async function run(command, args, timeout = 45_000) {
  return execFileAsync(command, args, {
    encoding: "utf8",
    timeout,
    maxBuffer: 512_000,
    env: { PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin" },
  });
}

async function unitState(unit) {
  const { stdout } = await run("/usr/bin/systemctl", [
    "show", unit,
    "-p", "ActiveState",
    "-p", "SubState",
    "-p", "UnitFileState",
    "-p", "Result",
    "-p", "ExecMainStatus",
    "-p", "NextElapseUSecRealtime",
    "--no-pager",
  ]);
  return Object.fromEntries(stdout.trim().split("\n").filter(Boolean).map((line) => {
    const separator = line.indexOf("=");
    return [line.slice(0, separator), line.slice(separator + 1)];
  }));
}

async function recentLogs(unit, lines = 60) {
  const safeLines = Math.max(1, Math.min(MAX_LOG_LINES, Number(lines) || 60));
  const { stdout } = await run("/usr/bin/journalctl", [
    "-u", unit, "-n", String(safeLines), "--no-pager", "-o", "short-iso",
  ]);
  return stdout.trim();
}

async function statusPayload() {
  const [monitor, settlementTimer, settlementService, notificationsTimer, notificationsService] = await Promise.all([
    readFile(STATUS_PATH, "utf8").then(JSON.parse).catch((error) => ({ ok: false, alerts: [{ code: "status_unavailable", message: error.message }] })),
    unitState(UNITS.settlementTimer),
    unitState(UNITS.settlementService),
    unitState(UNITS.notificationsTimer),
    unitState(UNITS.notificationsService),
  ]);
  return {
    ok: monitor.ok === true,
    timestamp: new Date().toISOString(),
    monitor,
    controls: {
      settlement: { timer: settlementTimer, service: settlementService },
      notifications: { timer: notificationsTimer, service: notificationsService },
    },
    actionNonce,
    actionInProgress,
  };
}

function audit(event) {
  console.log(JSON.stringify({ event: "luckyme_admin_audit", timestamp: new Date().toISOString(), ...event }));
}

const server = http.createServer(async (req, res) => {
  const username = proxyIdentity(req);
  if (!username) return json(res, 403, { error: "trusted_proxy_required" });

  const url = new URL(req.url, `http://${req.headers.host ?? `${HOST}:${PORT}`}`);
  try {
    if (req.method === "GET" && url.pathname === "/status") {
      return json(res, 200, await statusPayload());
    }

    if (req.method === "GET" && url.pathname === "/logs") {
      const key = url.searchParams.get("unit") ?? "settlement";
      const allowed = {
        settlement: UNITS.settlementService,
        preview: UNITS.settlementPreview,
        notifications: UNITS.notificationsService,
        monitor: UNITS.monitorService,
        admin: "luckyme-admin-control.service",
      };
      if (!allowed[key]) return json(res, 400, { error: "unknown_log" });
      return json(res, 200, { unit: key, logs: await recentLogs(allowed[key], url.searchParams.get("lines")) });
    }

    if (req.method === "POST" && url.pathname === "/actions") {
      if (req.headers["x-luckyme-admin-request"] !== "1") {
        return json(res, 403, { error: "admin_request_header_required" });
      }
      if (actionInProgress) return json(res, 409, { error: "action_in_progress" });
      const body = await readJson(req);
      const action = String(body.action ?? "");
      if (!ACTIONS[action]) return json(res, 400, { error: "unknown_action" });
      if (!safeEqual(body.nonce, actionNonce)) return json(res, 409, { error: "stale_nonce", actionNonce });
      if (body.confirmation !== action) return json(res, 400, { error: "confirmation_mismatch" });

      actionInProgress = true;
      actionNonce = freshNonce();
      const startedAt = Date.now();
      try {
        const { stdout, stderr } = await run("/usr/bin/systemctl", ACTIONS[action], 120_000);
        const result = {
          ok: true,
          action,
          durationMs: Date.now() - startedAt,
          outputHash: createHash("sha256").update(`${stdout}\n${stderr}`).digest("hex"),
        };
        audit({ username, remoteAddress: req.headers["x-real-ip"] ?? req.socket.remoteAddress, ...result });
        return json(res, 200, { ...result, status: await statusPayload() });
      } catch (error) {
        const result = { ok: false, action, durationMs: Date.now() - startedAt, error: error.message };
        audit({ username, remoteAddress: req.headers["x-real-ip"] ?? req.socket.remoteAddress, ...result });
        return json(res, 500, result);
      } finally {
        actionInProgress = false;
      }
    }

    return json(res, 404, { error: "not_found" });
  } catch (error) {
    return json(res, error.status ?? 500, { error: "request_failed", message: error.message });
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ event: "luckyme_admin_control_started", host: HOST, port: PORT }));
});
