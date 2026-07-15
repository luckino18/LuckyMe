import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { sendDiscordWebhook, validateDiscordWebhookUrl } from "../backend/src/discord-notifications.mjs";
import { runDiscordAlerts } from "../scripts/discord-alerts.mjs";

const WEBHOOKS = {
  rounds: "https://discord.com/api/webhooks/100/rounds-token",
  results: "https://discord.com/api/webhooks/200/results-token",
  status: "https://discord.com/api/webhooks/300/status-token",
};

test("Discord webhook sender is guarded, safe, and supports dry-run", async () => {
  assert.throws(() => validateDiscordWebhookUrl("https://example.com/hook"), /Invalid Discord webhook URL/);
  const dryRun = await sendDiscordWebhook(WEBHOOKS.rounds, { content: "Round live" });
  assert.deepEqual(dryRun, { ok: true, dryRun: true, planned: 1, sent: 0 });

  const requests = [];
  const sent = await sendDiscordWebhook(WEBHOOKS.rounds, { content: "Round live" }, {
    dryRun: false,
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body) });
      return { ok: true, status: 204 };
    },
  });
  assert.equal(sent.sent, 1);
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0].body.allowed_mentions, { parse: [] });
});

test("Discord alert scanner sends confirmed round, result, and status events once", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "luckyme-discord-test-"));
  const statePath = path.join(dir, "state.json");
  const archivePath = path.join(dir, "settlements.jsonl");
  const monitorPath = path.join(dir, "status.json");
  const now = 1_783_000_000;
  const poolPayload = {
    pools: [{
      id: "mini",
      houseFeeBps: 200,
      jackpotBps: 300,
      prizeSplitBps: [10_000, 0, 0],
      activeRound: { roundId: 9, startTs: now - 100, endTs: now + 500, settled: false },
    }],
  };
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    if (url === "https://api.test/pools") return { ok: true, status: 200, json: async () => poolPayload };
    requests.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 204 };
  };

  try {
    await writeFile(archivePath, `${JSON.stringify({
      pool: "mini", roundId: 8, address: "round8", settled: true, roundOutcome: "settled",
      totalLamports: "100000000", totalTickets: "20", winnerCount: 1,
      winner: "WinnerWallet1111111111111111111111111111111", settlementSignature: "sig8",
    })}\n`);
    await writeFile(monitorPath, `${JSON.stringify({ timestamp: "2026-07-15T12:00:00Z", alerts: [] })}\n`);

    const options = {
      apiUrl: "https://api.test", archivePath, monitorPath, statePath,
      roundsWebhook: WEBHOOKS.rounds, resultsWebhook: WEBHOOKS.results, statusWebhook: WEBHOOKS.status,
      dryRun: false, fetchImpl, now,
    };
    const first = await runDiscordAlerts(options);
    assert.deepEqual(first.planned.map((item) => item.key).sort(), ["round:mini:9:last10", "round:mini:9:started"]);
    assert.equal(requests.length, 2);

    await writeFile(archivePath, `${await readFile(archivePath, "utf8")}${JSON.stringify({
      pool: "mini", roundId: 9, address: "round9", settled: true, roundOutcome: "settled",
      totalLamports: "125000000", totalTickets: "25", winnerCount: 1,
      winner: "WinnerWallet2222222222222222222222222222222", settlementSignature: "sig9",
    })}\n`);
    await writeFile(monitorPath, `${JSON.stringify({
      timestamp: "2026-07-15T12:01:00Z",
      alerts: [{ code: "rpc_unreachable", message: "Solana RPC check failed" }],
    })}\n`);
    const second = await runDiscordAlerts(options);
    assert.deepEqual(second.planned.map((item) => item.key).sort(), ["result:mini:9:sig9", "status:active:rpc_unreachable"]);

    const third = await runDiscordAlerts(options);
    assert.equal(third.planned.length, 0);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("Discord systemd lane is separate from keeper transaction execution", async () => {
  const [service, timer] = await Promise.all([
    readFile(new URL("../deploy/systemd/luckyme-discord-alerts.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/luckyme-discord-alerts.timer", import.meta.url), "utf8"),
  ]);
  assert.match(service, /ExecStart=\/usr\/bin\/node \/opt\/luckyme\/scripts\/discord-alerts\.mjs/);
  assert.match(service, /EnvironmentFile=\/etc\/luckyme\/discord-webhooks\.env/);
  assert.doesNotMatch(service, /settlement:keeper/);
  assert.match(timer, /OnUnitActiveSec=60/);
  assert.match(timer, /Persistent=true/);
});
