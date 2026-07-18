import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildReferralAdminSnapshot } from "../scripts/admin-referral-snapshot.mjs";
import {
  ReferralHttpError,
  createSeekerReferralService,
} from "../backend/src/seeker-referral-service.mjs";

function fixture(t, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), "luckyme-app-analytics-"));
  const dbPath = join(directory, "referral.sqlite");
  const service = createSeekerReferralService({
    dbPath,
    appAnalyticsEnabled: true,
    appAnalyticsHashKey: "test-key-with-more-than-thirty-two-characters",
    sgtVerifier: async () => null,
    logger: () => undefined,
    ...options,
  });
  t.after(() => {
    service.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { dbPath, service };
}

test("dApp Store analytics count activations without storing the client install ID", (t) => {
  const { dbPath, service } = fixture(t);
  const firstId = "0123456789abcdef0123456789abcdef";
  const secondId = "abcdef0123456789abcdef0123456789";
  const payload = {
    installId: firstId,
    channel: "solana-dapp-store",
    platform: "android",
    appVersion: "1.2.0",
    versionCode: 13,
  };

  assert.equal(service.recordAppActivation(payload, { ip: "test-1" }).firstActivation, true);
  assert.equal(service.recordAppActivation(payload, { ip: "test-1" }).firstActivation, false);
  assert.equal(service.recordAppActivation({ ...payload, installId: secondId }, { ip: "test-2" }).firstActivation, true);

  const rows = service.db.prepare("SELECT install_hash, launch_count FROM app_installations ORDER BY install_hash").all();
  assert.equal(rows.length, 2);
  assert.equal(rows.some((row) => row.install_hash === firstId || row.install_hash === secondId), false);
  assert.deepEqual(rows.map((row) => Number(row.launch_count)).sort(), [1, 2]);

  const snapshot = buildReferralAdminSnapshot({ dbPath });
  assert.equal(snapshot.appAnalytics.uniqueActivations, 2);
  assert.equal(snapshot.appAnalytics.activeToday, 2);
  assert.equal(snapshot.appAnalytics.launches, 3);
  assert.deepEqual(snapshot.appAnalytics.versions, [{
    appVersion: "1.2.0",
    versionCode: 13,
    uniqueActivations: 2,
    launches: 3,
  }]);
});

test("app analytics reject untrusted channels and remain hidden while disabled", (t) => {
  const { service } = fixture(t);
  assert.throws(
    () => service.recordAppActivation({
      installId: "0123456789abcdef0123456789abcdef",
      channel: "sideload",
      platform: "android",
      appVersion: "1.2.0",
      versionCode: 13,
    }, { ip: "test" }),
    (error) => error instanceof ReferralHttpError && error.status === 400,
  );

  const disabled = createSeekerReferralService({
    appAnalyticsEnabled: false,
    sgtVerifier: async () => null,
    logger: () => undefined,
  });
  t.after(() => disabled.close());
  assert.throws(
    () => disabled.recordAppActivation({}, { ip: "test" }),
    (error) => error instanceof ReferralHttpError && error.status === 404,
  );
});
