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
