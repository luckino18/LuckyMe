import assert from "node:assert/strict";
import test from "node:test";

import { userFacingError } from "../app-seeker/src/user-facing-error.ts";

test("native cancellation and technical exceptions never reach LuckyMe users", () => {
  assert.equal(
    userFacingError(new Error("java.util.concurrent.CancellationException"), "Wallet sign-in failed."),
    "Wallet request was cancelled.",
  );
  assert.equal(
    userFacingError(new Error("java.net.ConnectException: failed to connect"), "Please try again."),
    "Please try again.",
  );
  assert.equal(
    userFacingError(new Error("Session expired. Sign in again."), "Please try again."),
    "Session expired. Sign in again.",
  );
});
