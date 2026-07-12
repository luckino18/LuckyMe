import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const siteRoot = path.join(root, "site/lucky-me.app");
const browserCandidates = [
  process.env.LUCKYME_BROWSER_PATH,
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);
const executablePath = browserCandidates.find((candidate) => fs.existsSync(candidate));

const MIME = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".png": "image/png",
  ".webp": "image/webp",
};

function testServer() {
  const server = http.createServer((request, response) => {
    const pathname = new URL(request.url, "http://127.0.0.1").pathname;
    const relative = pathname === "/" ? "index.html" : pathname.replace(/^\//, "");
    const requested = path.resolve(siteRoot, relative.endsWith("/") ? `${relative}index.html` : relative);
    if (!requested.startsWith(`${siteRoot}${path.sep}`) || !fs.existsSync(requested)) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": MIME[path.extname(requested)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    fs.createReadStream(requested).pipe(response);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function livePools() {
  const policies = {
    mini: [25, 1],
    normal: [13, 1],
    high: [3, 1],
    premium: [3, 3],
  };
  return Object.entries(policies).map(([id, [minimumTickets, minimumDistinctEntrants]], index) => ({
    id,
    label: id[0].toUpperCase() + id.slice(1),
    source: "onchain",
    initialized: true,
    currentRound: index + 10,
    ticketPriceLamports: String([5_000_000, 10_000_000, 50_000_000, 100_000_000][index]),
    maxTicketsPerEntry: id === "premium" ? 1 : 1000,
    jackpotSol: "0",
    minimumTickets,
    minimumDistinctEntrants,
    recentRounds: [],
    activeRound: null,
  }));
}

function maximumDelta(values) {
  return Math.max(...values) - Math.min(...values);
}

test("pool card rows stay aligned and Premium copy remains visible", { skip: !executablePath }, async () => {
  const server = await testServer();
  const { port } = server.address();
  const browser = await chromium.launch({ executablePath, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

  try {
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
      body: JSON.stringify({ onchain: { available: true }, pools: livePools() }),
    }));
    await page.goto(`http://127.0.0.1:${port}/play/`, { waitUntil: "networkidle" });
    await page.waitForFunction(() => document.querySelectorAll("#home-pools .pool-card").length === 4);

    for (const viewport of [
      { width: 390, height: 844 },
      { width: 768, height: 1024 },
      { width: 1024, height: 768 },
      { width: 1366, height: 768 },
      { width: 1440, height: 1000 },
      { width: 1920, height: 1080 },
    ]) {
      await page.setViewportSize(viewport);
      const measurements = await page.evaluate(() => {
        const selectors = [".pool-title", "h3", ".entry", ".minimum-target", ".facts-grid", ".primary-button"];
        const cards = Array.from(document.querySelectorAll("#home-pools .pool-card"));
        return {
          pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          cards: cards.map((card) => Object.fromEntries(selectors.map((selector) => {
            const element = card.querySelector(selector);
            const rect = element.getBoundingClientRect();
            return [selector, { top: rect.top, height: rect.height, bottom: rect.bottom }];
          }))),
          premium: {
            text: cards[3].querySelector(".minimum-target").textContent,
            overflow: cards[3].scrollWidth - cards[3].clientWidth,
            clarificationOverflow: cards[3].querySelector(".minimum-clarification").scrollWidth - cards[3].querySelector(".minimum-clarification").clientWidth,
          },
        };
      });

      assert.ok(measurements.pageOverflow <= 1, `${viewport.width}px page overflowed`);
      assert.ok(measurements.premium.overflow <= 1, `${viewport.width}px Premium card overflowed`);
      assert.ok(measurements.premium.clarificationOverflow <= 1, `${viewport.width}px Premium text overflowed`);
      assert.match(measurements.premium.text, /three distinct wallets/i);

      if (viewport.width >= 1360) {
        for (const selector of [".pool-title", "h3", ".entry", ".minimum-target", ".facts-grid", ".primary-button"]) {
          assert.ok(
            maximumDelta(measurements.cards.map((card) => card[selector].top)) <= 1,
            `${viewport.width}px ${selector} tops differ by more than 1px`,
          );
          assert.ok(
            maximumDelta(measurements.cards.map((card) => card[selector].height)) <= 1,
            `${viewport.width}px ${selector} heights differ by more than 1px`,
          );
        }
      }
    }
  } finally {
    await page.close();
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
