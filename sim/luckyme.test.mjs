import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  FIXED_POOLS,
  chanceForPlayer,
  commitmentForReveal,
  lamportsToSol,
  refundEntryAfterTimeout,
  settleRound,
  solToLamports,
  verifyReveal,
} from "./luckyme.mjs";

test("fixed pools use the intended ticket prices", () => {
  assert.deepEqual(
    FIXED_POOLS.map((pool) => [pool.id, lamportsToSol(pool.ticketPriceLamports)]),
    [
      ["mini", "0.005"],
      ["normal", "0.01"],
      ["high", "0.1"],
    ],
  );
});

test("round settlement splits 95 percent prize, 3 percent house, 2 percent jackpot", () => {
  const result = settleRound({
    ticketPriceLamports: solToLamports("0.01"),
    entries: [
      { player: "alice", tickets: 10n },
      { player: "bob", tickets: 5n },
      { player: "carol", tickets: 5n },
    ],
    randomSeed: "round-1",
  });

  assert.equal(lamportsToSol(result.totalLamports), "0.2");
  assert.equal(lamportsToSol(result.mainPrize), "0.19");
  assert.equal(lamportsToSol(result.houseFee), "0.006");
  assert.equal(lamportsToSol(result.jackpotAdd), "0.004");
});

test("winning chance is proportional to ticket count", () => {
  const entries = [
    { player: "small", tickets: 1n },
    { player: "medium", tickets: 5n },
    { player: "large", tickets: 14n },
  ];

  assert.equal(chanceForPlayer(entries, "small"), 5);
  assert.equal(chanceForPlayer(entries, "medium"), 25);
  assert.equal(chanceForPlayer(entries, "large"), 70);
});

test("a player can only enter a round once", () => {
  assert.throws(
    () =>
      settleRound({
        ticketPriceLamports: solToLamports("0.01"),
        entries: [
          { player: "alice", tickets: 1n },
          { player: "bob", tickets: 1n },
          { player: "alice", tickets: 1n },
        ],
        randomSeed: "duplicate-entry",
      }),
    /player already entered round/,
  );
});

test("commit-reveal verification accepts only the committed reveal", () => {
  const commitment = commitmentForReveal("secret-round-42");

  assert.equal(verifyReveal(commitment, "secret-round-42"), true);
  assert.equal(verifyReveal(commitment, "different-secret"), false);
});

test("refunds are only available after the reveal timeout", () => {
  assert.throws(
    () =>
      refundEntryAfterTimeout({
        ticketPriceLamports: solToLamports("0.01"),
        entries: [{ player: "alice", tickets: 2n }],
        player: "alice",
        roundEndTs: 1_000,
        nowTs: 1_599,
      }),
    /refund is not available yet/,
  );

  const result = refundEntryAfterTimeout({
    ticketPriceLamports: solToLamports("0.01"),
    entries: [
      { player: "alice", tickets: 2n },
      { player: "bob", tickets: 1n },
    ],
    player: "alice",
    roundEndTs: 1_000,
    nowTs: 1_600,
  });

  assert.equal(lamportsToSol(result.refundLamports), "0.02");
  assert.equal(result.refundTickets, 2n);
  assert.equal(lamportsToSol(result.remainingLamports), "0.01");
  assert.equal(result.remainingTickets, 1n);
});

test("jackpot payout includes previous balance plus current 2 percent contribution", () => {
  const result = settleRound({
    ticketPriceLamports: solToLamports("0.1"),
    jackpotBalanceLamports: solToLamports("2"),
    config: {
      ...DEFAULT_CONFIG,
      jackpotOddsDenominator: 1n,
    },
    entries: [
      { player: "alice", tickets: 1n },
      { player: "bob", tickets: 1n },
    ],
    randomSeed: "force-jackpot",
  });

  assert.equal(result.jackpotTriggered, true);
  assert.equal(lamportsToSol(result.jackpotAdd), "0.004");
  assert.equal(lamportsToSol(result.jackpotPayout), "2.004");
  assert.equal(lamportsToSol(result.jackpotBalanceAfter), "0");
  assert.match(result.jackpotWinner, /alice|bob/);
});

test("empty rounds are rejected", () => {
  assert.throws(
    () =>
      settleRound({
        ticketPriceLamports: solToLamports("0.01"),
        entries: [],
        randomSeed: "empty",
      }),
    /cannot settle empty round/,
  );
});
