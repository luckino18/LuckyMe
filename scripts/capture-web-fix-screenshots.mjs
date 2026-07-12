import fs from "node:fs";
import fsPromises from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import QRCode from "qrcode";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(root, "site/lucky-me.app");
const screenshotRoot = path.join(root, "docs/screenshots");
const browserCandidates = [
  process.env.LUCKYME_BROWSER_PATH,
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

if (!executablePath) {
  throw new Error("Set LUCKYME_BROWSER_PATH to a Chrome or Brave executable");
}

const mime = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
};

const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
  const requested = path.resolve(siteRoot, relative.endsWith("/") ? `${relative}index.html` : relative);
  if (!requested.startsWith(`${siteRoot}${path.sep}`) || !fs.existsSync(requested)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": mime[path.extname(requested)] || "application/octet-stream",
    "cache-control": "no-store",
  });
  fs.createReadStream(requested).pipe(response);
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const { port } = server.address();
const origin = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath, headless: true });

const pools = [
  ["mini", "Mini", 25, 1, "5000000", 1000],
  ["normal", "Normal", 13, 1, "10000000", 1000],
  ["high", "High", 3, 1, "50000000", 1000],
  ["premium", "Premium", 3, 3, "100000000", 1],
].map(([id, label, minimumTickets, minimumDistinctEntrants, ticketPriceLamports, maxTicketsPerEntry], index) => ({
  id,
  label,
  source: "onchain",
  initialized: true,
  currentRound: index + 10,
  ticketPriceLamports,
  maxTicketsPerEntry,
  jackpotSol: "0",
  minimumTickets,
  minimumDistinctEntrants,
  activeRound: null,
  recentRounds: [],
}));

const placeholderUri = "wc:luckyme-screenshot-placeholder-not-a-session";
const placeholderQr = await QRCode.toDataURL(placeholderUri, {
  errorCorrectionLevel: "M",
  margin: 2,
  width: 320,
});
const walletConnectMock = `
  export class UniversalProvider {
    static async init() { return new UniversalProvider(); }
    constructor() { this.listeners = new Map(); this.session = null; }
    on(event, listener) { this.listeners.set(event, listener); }
    off(event, listener) { if (this.listeners.get(event) === listener) this.listeners.delete(event); }
    connect() {
      setTimeout(() => this.listeners.get("display_uri")?.(${JSON.stringify(placeholderUri)}), 25);
      return new Promise(() => {});
    }
    disconnect() { return Promise.resolve(); }
  }
  export function createWalletConnectQrDataUrl() { return Promise.resolve(${JSON.stringify(placeholderQr)}); }
`;

async function configuredPage(viewport) {
  const page = await browser.newPage({ viewport });
  await page.route("https://esm.sh/**", (route) => route.fulfill({
    contentType: "application/javascript",
    body: "export class Connection{}; export class PublicKey{}; export class Transaction{};",
  }));
  await page.route("https://api.lucky-me.app/config", (route) => route.fulfill({
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ releaseMode: "MAINNET_RELEASE", onchainAvailable: true, onchain: { available: true } }),
  }));
  await page.route("https://api.lucky-me.app/pools", (route) => route.fulfill({
    contentType: "application/json",
    headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ onchain: { available: true }, pools }),
  }));
  await page.route("**/assets/vendor/walletconnect-bundle.js*", (route) => route.fulfill({
    contentType: "application/javascript",
    body: walletConnectMock,
  }));
  return page;
}

try {
  const desktop = await configuredPage({ width: 1440, height: 1000 });
  await desktop.goto(`${origin}/play/`, { waitUntil: "networkidle" });
  await desktop.getByRole("button", { name: "View pools", exact: true }).click();
  await desktop.waitForTimeout(300);
  await desktop.screenshot({
    path: path.join(screenshotRoot, "pool-alignment-desktop-1440x1000-2026-07-12.png"),
    fullPage: true,
  });
  await desktop.close();

  const mobile = await configuredPage({ width: 390, height: 844 });
  await mobile.goto(`${origin}/play/`, { waitUntil: "networkidle" });
  await mobile.getByRole("button", { name: "View pools", exact: true }).click();
  await mobile.waitForTimeout(300);
  await mobile.screenshot({
    path: path.join(screenshotRoot, "pool-alignment-mobile-390x844-2026-07-12.png"),
  });
  await mobile.close();

  const walletConnect = await configuredPage({ width: 768, height: 1024 });
  await walletConnect.goto(`${origin}/play/?wallet`, { waitUntil: "networkidle" });
  await walletConnect.locator('[data-connect="mobile-wallet"]').click();
  await walletConnect.locator(".walletconnect-qr").waitFor({ state: "visible" });
  await walletConnect.waitForTimeout(300);
  await walletConnect.screenshot({
    path: path.join(screenshotRoot, "walletconnect-local-qr-768x1024-2026-07-12.png"),
  });
  await walletConnect.close();

  for (const file of [
    "pool-alignment-desktop-1440x1000-2026-07-12.png",
    "pool-alignment-mobile-390x844-2026-07-12.png",
    "walletconnect-local-qr-768x1024-2026-07-12.png",
  ]) {
    const stat = await fsPromises.stat(path.join(screenshotRoot, file));
    console.log(`${file} ${stat.size}`);
  }
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
