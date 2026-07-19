import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createSkrRegistry, SKR_EXPORT_SIZES } from "../scripts/admin-skr-registry.mjs";
import { extractSkrNames, extractSkrOcrCandidates, validateAdbAddress, validatePairingCode } from "../scripts/skr-adb-tools.mjs";

const server = readFileSync("scripts/admin-cnft-server.mjs", "utf8");
const bridge = readFileSync("scripts/skr-adb-bridge.mjs", "utf8");
const localHtml = readFileSync("scripts/skr-adb-local/index.html", "utf8");
const localClient = readFileSync("scripts/skr-adb-local/app.js", "utf8");
const html = readFileSync("site/lucky-me.app/admin/index.html", "utf8");
const client = readFileSync("site/lucky-me.app/admin/admin.js", "utf8");
const nginx = readFileSync("deploy/nginx/luckyme-admin-location.conf", "utf8");

test("ADB UI dump extracts normalized unique .skr usernames", () => {
  const xml = `<node text="@Luckino.SKR" content-desc="friend_name.skr and luckino.skr"/><node text="not-a-domain"/>`;
  assert.deepEqual(extractSkrNames(xml), ["luckino.skr", "friend_name.skr"]);
  assert.equal(validateAdbAddress("192.168.1.25:37123"), "192.168.1.25:37123");
  assert.equal(validatePairingCode("123456"), "123456");
  assert.throws(() => validateAdbAddress("8.8.8.8:5555"), /private phone address/);
  assert.throws(() => validatePairingCode("1234"), /six digits/);
});

test("local OCR keeps multiple i/l candidates with their observation and confidence", () => {
  assert.deepEqual(extractSkrOcrCandidates("7\t0.981000\tiserberl.skr\n7\t0.944000\tlserberl.skr\n8\t0.900000\tnoise"), [
    { name: "iserberl.skr", confidence: 0.981, observation: 7 },
    { name: "lserberl.skr", confidence: 0.944, observation: 7 },
  ]);
});

test("persistent SKR database deduplicates, numbers, reserves, releases and confirms recipients", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "luckyme-skr-registry-")), "registry.json");
  const registry = createSkrRegistry({ filePath });
  const first = registry.importNames(["@Luckino.SKR", "friend.skr"], { source: "Game A" });
  assert.equal(first[0].existedBefore, false);
  const second = registry.importNames(["luckino.skr", "new_user.skr"], { source: "Game B" });
  assert.equal(second[0].existedBefore, true);
  assert.deepEqual(SKR_EXPORT_SIZES, [10, 20, 50, 100]);
  assert.deepEqual(registry.snapshot().users.map((row) => [row.id, row.name]), [[1, "luckino.skr"], [2, "friend.skr"], [3, "new_user.skr"]]);
  const reserved = registry.reserveNext(100);
  assert.deepEqual(reserved.names, ["luckino.skr", "friend.skr", "new_user.skr"]);
  assert.equal(registry.snapshot().summary.reserved, 3);
  assert.deepEqual(registry.reserveNext(100).names, reserved.names);
  assert.equal(registry.releaseReserved().length, 3);
  assert.equal(registry.snapshot().summary.ready, 3);
  registry.reserveNext(100);
  registry.markMinted([{ name: "luckino.skr", wallet: "wallet", assetId: "asset" }], { signature: "signature" });
  assert.deepEqual(registry.releaseNames(["friend.skr"]), ["friend.skr"]);
  assert.equal(registry.removeName("friend.skr").name, "friend.skr");
  assert.throws(() => registry.removeName("luckino.skr"), /confirmed_nft_history_cannot_be_removed/);
  assert.throws(() => registry.removeName("missing.skr"), /username_not_found/);
  const snapshot = registry.snapshot();
  assert.deepEqual(snapshot.summary, { total: 2, ready: 0, reserved: 1, sent: 1, minted: 1, eligible: 0, duplicateCaptures: 1 });
  assert.equal(snapshot.users.find((row) => row.name === "luckino.skr").minted, true);
  assert.equal(snapshot.users.find((row) => row.name === "luckino.skr").status, "sent");
});

test("OCR correction merges the wrong reserved alias into the canonical NFT history", () => {
  const filePath = join(mkdtempSync(join(tmpdir(), "luckyme-skr-correction-")), "registry.json");
  const registry = createSkrRegistry({ filePath });
  registry.importNames(["idiamant.skr", "friend.skr"], { source: "OCR" });
  registry.reserveNext(100);
  const corrected = registry.correctName("idiamant.skr", "ldiamant.skr", { wallet: "wallet" });
  assert.equal(corrected.name, "ldiamant.skr");
  assert.equal(corrected.status, "reserved");
  registry.markMinted([{ name: "ldiamant.skr", wallet: "wallet", assetId: "asset" }]);
  registry.importNames(["idiamant.skr"], { source: "OCR again" });
  const snapshot = registry.snapshot();
  assert.equal(snapshot.users.some((row) => row.name === "idiamant.skr"), false);
  assert.equal(snapshot.users.find((row) => row.name === "ldiamant.skr").status, "sent");
  assert.equal(snapshot.summary.reserved, 1);
});

test("Admin exposes local-only ADB capture and protected registry routes", () => {
  assert.match(bridge, /127\.0\.0\.1/);
  assert.match(bridge, /uiautomator/);
  assert.match(bridge, /skr-ocr\.m/);
  assert.match(bridge, /extractSkrOcrCandidates/);
  assert.match(bridge, /"input", "swipe"/);
  assert.match(bridge, /input\.autoScroll === true/);
  assert.match(bridge, /skr-adb-local/);
  assert.match(localHtml, /LuckyMe SKR Collector/);
  assert.match(localHtml, /<option>10<\/option><option>20<\/option><option>50<\/option><option>100<\/option>/);
  assert.match(localHtml, /Copy next batch/);
  assert.match(localHtml, /scrolls automatically until the end or Stop/);
  assert.match(localClient, /autoScroll: scanning/);
  assert.match(localClient, /End of the review list detected/);
  assert.doesNotMatch(localClient, /lucky-me\.app|skr-import|skr-registry/);
  assert.match(bridge, /ALLOWED_ORIGINS/);
  assert.doesNotMatch(bridge, /shell:\s*true/);
  assert.match(server, /\/skr-registry/);
  assert.match(server, /\/skr-import/);
  assert.match(server, /\/skr-export/);
  assert.match(server, /\/skr-reserve/);
  assert.match(server, /\/skr-release/);
  assert.match(server, /\/skr-remove/);
  assert.match(server, /username_has_persistent_mint_job/);
  assert.match(server, /skrRegistry\.markMinted/);
  assert.match(server, /skrRegistry\.releaseNames/);
  assert.match(server, /applyResolvedSkrCorrections/);
  assert.match(client, /recipient_already_has_pass/);
  assert.match(html, /data-admin-tab="skr-database"/);
  assert.doesNotMatch(html, /data-admin-tab="skr-download"/);
  assert.match(html, /Prepare next 50 in Send NFT/);
  assert.match(client, /JSON\.stringify\(\{ limit: 50 \}\)/);
  assert.match(html, /Return reserved to Ready/);
  assert.match(client, /skr-reserve/);
  assert.match(client, /skr-release/);
  assert.match(client, /skr-remove/);
  assert.match(client, /data-skr-remove/);
  assert.match(nginx, /connect-src 'self' http:\/\/127\.0\.0\.1:8796/);
});
