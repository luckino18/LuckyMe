import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  loadPushRegistrations,
  registerPushToken,
  sendExpoPushNotifications,
  unregisterPushToken,
} from "../backend/src/push-notifications.mjs";

const EXPO_TOKEN = "ExponentPushToken[luckyme_test-token_123]";

test("push token registration persists one deduplicated Expo token", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "luckyme-push-test-"));
  const storePath = path.join(dir, "tokens.json");

  try {
    const first = await registerPushToken(
      {
        token: EXPO_TOKEN,
        platform: "android",
        projectId: "e054857c-6dfb-46ec-9d60-09ce2150dcc4",
      },
      { storePath, now: "2026-07-08T12:00:00.000Z" },
    );

    const second = await registerPushToken(
      { token: EXPO_TOKEN, platform: "ios" },
      { storePath, now: "2026-07-08T12:05:00.000Z" },
    );

    const stored = JSON.parse(await readFile(storePath, "utf8"));
    const registrations = await loadPushRegistrations({ storePath });

    assert.equal(first.ok, true);
    assert.equal(first.registrations, 1);
    assert.equal(second.registrations, 1);
    assert.equal(second.platform, "ios");
    assert.equal("token" in first, false);
    assert.equal(stored.tokens.length, 1);
    assert.equal(stored.tokens[0].token, EXPO_TOKEN);
    assert.equal(registrations.length, 1);
    assert.equal(registrations[0].tokenHash, first.tokenHash);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});

test("push notification sender defaults to dry-run planning", async () => {
  const result = await sendExpoPushNotifications([
    {
      to: EXPO_TOKEN,
      title: "Mini pool countdown started",
      body: "The 1 hour draw is live. Grab your ticket before the round finishes.",
      data: {
        url: "luckyme://pools?pool=mini",
      },
    },
  ]);

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.planned, 1);
  assert.equal(result.sent, 0);
});

test("push sender delivers both round alerts to every opted-in APK token", async () => {
  const tokens = [
    "ExponentPushToken[luckyme_device_one]",
    "ExponentPushToken[luckyme_device_two]",
  ];
  const alerts = [
    {
      title: "Mini pool countdown started",
      body: "The 1 hour draw is live. Grab your ticket before the round finishes.",
      alert: "started",
    },
    {
      title: "Mini pool: last 10 minutes",
      body: "Last 10 minutes before winner selection. Try your luck before the draw closes.",
      alert: "last10",
    },
  ];
  const messages = alerts.flatMap((alert) => tokens.map((to) => ({
    to,
    title: alert.title,
    body: alert.body,
    channelId: "luckyme-round-alerts",
    data: {
      type: "round_alert",
      pool: "mini",
      roundId: "5",
      alert: alert.alert,
      url: "luckyme://pools?pool=mini",
    },
  })));
  const requests = [];
  const result = await sendExpoPushNotifications(messages, {
    dryRun: false,
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) });
      return { ok: true, status: 200, json: async () => ({ data: [] }) };
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, false);
  assert.equal(result.sent, 4);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.length, 4);
  assert.deepEqual(new Set(requests[0].body.map((item) => item.to)), new Set(tokens));
  assert.deepEqual(new Set(requests[0].body.map((item) => item.data.alert)), new Set(["started", "last10"]));
  for (const message of requests[0].body) {
    assert.equal(message.priority, "high");
    assert.equal(message.channelId, "luckyme-round-alerts");
    assert.equal(message.data.url, "luckyme://pools?pool=mini");
  }
});

test("production round-alert timer scans every minute with guarded live delivery", async () => {
  const [sender, service, timer] = await Promise.all([
    readFile(new URL("../scripts/push-round-alerts.mjs", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/luckyme-push-alerts.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/luckyme-push-alerts.timer", import.meta.url), "utf8"),
  ]);

  assert.match(sender, /const LAST_10_SECONDS = 10 \* 60/);
  assert.match(sender, /alertKey\(poolSpec\.slug, roundId, "started"\)/);
  assert.match(sender, /remainingSeconds <= LAST_10_SECONDS/);
  assert.match(sender, /for \(const registration of registrations\)/);
  assert.match(service, /Environment=CONFIRM_MAINNET_PUSH_ALERTS=true/);
  assert.match(service, /Environment=LUCKYME_PUSH_SEND=true/);
  assert.match(timer, /OnUnitActiveSec=60/);
  assert.match(timer, /Persistent=true/);
});

test("operations monitor covers keeper, RPC, stuck rounds, transactions, and notification failures", async () => {
  const [monitor, service, timer, pkg] = await Promise.all([
    readFile(new URL("../scripts/operations-monitor.mjs", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/luckyme-operations-monitor.service", import.meta.url), "utf8"),
    readFile(new URL("../deploy/systemd/luckyme-operations-monitor.timer", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.match(monitor, /keeper_balance_low/);
  assert.match(monitor, /rpc_unreachable/);
  assert.match(monitor, /round_stuck/);
  assert.match(monitor, /`\$\{name\}_service_failed`/);
  assert.match(monitor, /\["settlement", "luckyme-settlement-keeper\.timer"/);
  assert.match(monitor, /\["notifications", "luckyme-push-alerts\.timer"/);
  assert.match(service, /ExecStart=\/usr\/bin\/npm run monitor:operations/);
  assert.match(timer, /OnUnitActiveSec=60/);
  assert.match(pkg, /"monitor:operations": "node scripts\/operations-monitor\.mjs"/);
});

test("push token registration rejects invalid Expo tokens and supports unregister", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "luckyme-push-test-"));
  const storePath = path.join(dir, "tokens.json");

  try {
    await assert.rejects(
      () => registerPushToken({ token: "not-a-token" }, { storePath }),
      /Invalid Expo push token/,
    );

    await registerPushToken({ token: EXPO_TOKEN, platform: "android" }, { storePath });
    const result = await unregisterPushToken({ token: EXPO_TOKEN }, { storePath });
    const registrations = await loadPushRegistrations({ storePath });

    assert.equal(result.ok, true);
    assert.equal(result.removed, true);
    assert.equal(result.registrations, 0);
    assert.equal(registrations.length, 0);
  } finally {
    await rm(dir, { force: true, recursive: true });
  }
});
