import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import http from "node:http";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { URL } from "node:url";
import { fileURLToPath } from "node:url";

import { extractSkrNames, extractSkrOcrCandidates, validateAdbAddress, validatePairingCode } from "./skr-adb-tools.mjs";

const runFile = promisify(execFile);
const HOST = "127.0.0.1";
const PORT = Number(process.env.LUCKYME_SKR_BRIDGE_PORT ?? 8796);
const ADB = process.env.ADB_PATH ?? "/Users/victor/Library/Android/sdk/platform-tools/adb";
const LOCAL_ORIGIN = `http://${HOST}:${PORT}`;
const LOCAL_UI = join(dirname(fileURLToPath(import.meta.url)), "skr-adb-local");
const OCR_SOURCE = join(dirname(fileURLToPath(import.meta.url)), "skr-ocr.m");
const OCR_BINARY = "/private/tmp/luckyme-skr-ocr";
const ALLOWED_ORIGINS = new Set([LOCAL_ORIGIN, `http://localhost:${PORT}`, "https://lucky-me.app", "https://www.lucky-me.app", "http://127.0.0.1:8794", "http://127.0.0.1:8792"]);
const MAX_BODY = 8 * 1_024;

const STATIC_FILES = new Map([
  ["/", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/index.html", { file: "index.html", type: "text/html; charset=utf-8" }],
  ["/app.js", { file: "app.js", type: "text/javascript; charset=utf-8" }],
  ["/styles.css", { file: "styles.css", type: "text/css; charset=utf-8" }],
]);

function responseHeaders(origin) {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    "access-control-allow-private-network": "true",
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "vary": "Origin",
  };
}

function send(res, status, payload, origin) {
  res.writeHead(status, responseHeaders(origin));
  res.end(`${JSON.stringify(payload)}\n`);
}

async function sendStatic(res, pathname) {
  const asset = STATIC_FILES.get(pathname);
  if (!asset) return false;
  const content = await readFile(join(LOCAL_UI, asset.file));
  res.writeHead(200, {
    "cache-control": "no-store",
    "content-type": asset.type,
    "content-security-policy": "default-src 'self'; connect-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'",
    "x-content-type-options": "nosniff",
  });
  res.end(content);
  return true;
}

async function body(req) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > MAX_BODY) throw Object.assign(new Error("Request is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

async function adb(args, timeout = 20_000) {
  const { stdout, stderr } = await runFile(ADB, args, { timeout, maxBuffer: 4 * 1_024 * 1_024 });
  return `${stdout ?? ""}${stderr ?? ""}`.trim();
}

async function pairWithRecovery(address, code) {
  try {
    return await adb(["pair", address, code]);
  } catch (error) {
    const details = `${error?.message ?? ""}\n${error?.stdout ?? ""}\n${error?.stderr ?? ""}`;
    if (!/protocol fault|couldn't read status message/i.test(details)) throw error;
    await adb(["kill-server"]);
    await adb(["start-server"]);
    return adb(["pair", address, code]);
  }
}

async function devices() {
  const output = await adb(["devices", "-l"]);
  return output.split(/\r?\n/).slice(1).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [serial, state] = line.split(/\s+/, 2);
    return { serial, state, description: line };
  });
}

let ocrReady;
async function ensureOcrBinary() {
  ocrReady ??= runFile("/usr/bin/clang", [
    "-fobjc-arc",
    OCR_SOURCE,
    "-framework", "Foundation",
    "-framework", "AppKit",
    "-framework", "Vision",
    "-o", OCR_BINARY,
  ], { timeout: 45_000, maxBuffer: 4 * 1_024 * 1_024 });
  await ocrReady;
}

async function capture(serial, autoScroll = false) {
  const safeSerial = String(serial ?? "").trim();
  if (!/^[a-zA-Z0-9_.:[\]-]{1,128}$/.test(safeSerial)) throw Object.assign(new Error("Select a connected ADB device"), { status: 400 });
  await adb(["-s", safeSerial, "shell", "uiautomator", "dump", "/sdcard/luckyme-skr-window.xml"], 25_000);
  const xml = await adb(["-s", safeSerial, "exec-out", "cat", "/sdcard/luckyme-skr-window.xml"]);
  const screenshot = `/private/tmp/luckyme-skr-${process.pid}.png`;
  let ocrText = "";
  try {
    await adb(["-s", safeSerial, "shell", "screencap", "-p", "/sdcard/luckyme-skr-screen.png"], 25_000);
    await adb(["-s", safeSerial, "pull", "/sdcard/luckyme-skr-screen.png", screenshot], 25_000);
    await ensureOcrBinary();
    const { stdout } = await runFile(OCR_BINARY, [screenshot], {
      timeout: 45_000,
      maxBuffer: 4 * 1_024 * 1_024,
    });
    ocrText = stdout ?? "";
  } finally {
    await unlink(screenshot).catch(() => {});
  }
  const xmlNames = extractSkrNames(xml);
  const ocrCandidates = extractSkrOcrCandidates(ocrText);
  const bestOcrNames = new Map();
  for (const candidate of ocrCandidates) {
    if (!bestOcrNames.has(candidate.observation)) bestOcrNames.set(candidate.observation, candidate.name);
  }
  const result = {
    serial: safeSerial,
    names: [...new Set([...xmlNames, ...bestOcrNames.values()])],
    ocrCandidates,
    captureMode: "android-ui-plus-local-ocr-candidates",
    viewKey: createHash("sha256").update(xml).digest("hex"),
    capturedAt: new Date().toISOString(),
  };
  if (autoScroll) {
    await adb(["-s", safeSerial, "shell", "input", "swipe", "600", "2150", "600", "850", "450"], 10_000);
    result.scrolled = true;
  }
  return result;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, LOCAL_ORIGIN);
  if (req.method === "GET" && await sendStatic(res, url.pathname)) return;
  const origin = String(req.headers.origin || LOCAL_ORIGIN);
  if (!ALLOWED_ORIGINS.has(origin)) return send(res, 403, { error: "origin_not_allowed" }, "null");
  if (req.method === "OPTIONS") {
    res.writeHead(204, responseHeaders(origin));
    return res.end();
  }
  try {
    if (req.method === "GET" && url.pathname === "/status") {
      return send(res, 200, { ok: true, adb: await adb(["version"]), devices: await devices() }, origin);
    }
    if (req.method === "POST" && url.pathname === "/pair") {
      const input = await body(req);
      const address = validateAdbAddress(input.address);
      const code = validatePairingCode(input.code);
      const output = await pairWithRecovery(address, code);
      return send(res, 200, { ok: /successfully paired/i.test(output), output }, origin);
    }
    if (req.method === "POST" && url.pathname === "/connect") {
      const input = await body(req);
      const address = validateAdbAddress(input.address);
      const output = await adb(["connect", address]);
      return send(res, 200, { ok: /connected to|already connected/i.test(output), output, devices: await devices() }, origin);
    }
    if (req.method === "POST" && url.pathname === "/capture") {
      const input = await body(req);
      return send(res, 200, { ok: true, ...(await capture(input.serial, input.autoScroll === true)) }, origin);
    }
    return send(res, 404, { error: "not_found" }, origin);
  } catch (error) {
    return send(res, error.status ?? 500, { error: "adb_bridge_error", message: error.message }, origin);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`LuckyMe SKR Tool ready: ${LOCAL_ORIGIN}/`);
  console.log("Keep this window open while the local tool is scanning the Seeker screen.");
  if (process.env.LUCKYME_SKR_OPEN_BROWSER === "true") {
    execFile("/usr/bin/open", [`${LOCAL_ORIGIN}/`], () => {});
  }
});
