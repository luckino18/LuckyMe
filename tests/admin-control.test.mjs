import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const server = readFileSync("scripts/admin-control-server.mjs", "utf8");
const nginx = readFileSync("deploy/nginx/luckyme-admin-location.conf", "utf8");
const preview = readFileSync(
  "deploy/systemd/luckyme-settlement-keeper-preview.service",
  "utf8",
);

test("admin control API trusts only the protected local Nginx proxy", () => {
  assert.match(server, /x-luckyme-admin-proxy/);
  assert.match(server, /trusted_proxy_required/);
  assert.match(nginx, /auth_basic_user_file \/etc\/nginx\/luckyme-admin\.htpasswd/);
  assert.match(nginx, /proxy_pass http:\/\/127\.0\.0\.1:8791\//);
  assert.match(nginx, /X-LuckyMe-Admin-Proxy 1/);
});

test("admin actions are fixed, confirmed, nonce-protected systemd operations", () => {
  assert.match(server, /const ACTIONS = Object\.freeze/);
  assert.match(server, /unknown_action/);
  assert.match(server, /stale_nonce/);
  assert.match(server, /confirmation_mismatch/);
  assert.match(server, /execFileAsync/);
  assert.doesNotMatch(server, /\bexec\s*\(/);
});

test("admin settlement preview cannot write mainnet transactions", () => {
  assert.match(preview, /Environment=DRY_RUN=true/);
  assert.match(preview, /Environment=CONFIRM_MAINNET_SETTLEMENT_KEEPER=false/);
  assert.match(preview, /Environment=SETTLEMENT_KEEPER_MAX_ACTIONS=1/);
});
