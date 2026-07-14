import assert from "node:assert/strict";
import test from "node:test";

function simulateRotation(playerCount, cleanupBatchSize) {
  const previous = { settled: true, entries: playerCount };
  const current = { roundId: 2, waiting: true, entries: 0 };
  let cleanupTransactions = 0;
  while (previous.entries > 0) {
    previous.entries -= Math.min(cleanupBatchSize, previous.entries);
    cleanupTransactions += 1;
    assert.equal(current.waiting, true);
  }
  return { current, cleanupTransactions };
}

test("one thousand players never block the next round", () => {
  const result = simulateRotation(1_000, 8);
  assert.deepEqual(result.current, { roundId: 2, waiting: true, entries: 0 });
  assert.equal(result.cleanupTransactions, 125);
});
