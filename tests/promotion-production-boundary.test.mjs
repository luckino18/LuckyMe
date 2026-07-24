import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../programs/luckyme/src/promotion_compact.rs", import.meta.url),
  "utf8",
);

function functionBody(name, nextName) {
  const start = source.indexOf(`fn ${name}`);
  const end = source.indexOf(`fn ${nextName}`, start + 1);
  assert.notEqual(start, -1, `${name} exists`);
  assert.notEqual(end, -1, `${nextName} follows ${name}`);
  return source.slice(start, end);
}

test("SKR settlement is authorized by the promotion authorizer, not the offline config authority", () => {
  const settleToken = functionBody("settle_token", "cancel_token");
  assert.doesNotMatch(settleToken, /ctx\.accounts\.config\.authority/);
  assert.match(settleToken, /validate_token_snapshot\(/);
  assert.match(settleToken, /ctx\.accounts\.authorizer\.key\(\)/);
});

test("SKR launch and cancellation still require the config authority", () => {
  const initializeToken = functionBody("initialize_token", "settle_token");
  const cancelToken = functionBody("cancel_token", "archive_token");
  assert.match(initializeToken, /require_authority\(&ctx\)/);
  assert.match(cancelToken, /require_authority\(&ctx\)/);
});
