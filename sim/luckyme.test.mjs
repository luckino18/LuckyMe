import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_CONFIG,
  DEFAULT_MAIN_PRIZE_BPS,
  DEFAULT_ROUND_DURATION_SECONDS,
  FIXED_POOLS,
  chanceForPlayer,
  classifyExpiredRound,
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
      ["high", "0.05"],
      ["premium", "0.1"],
    ],
  );
});

test("fixed pools use the approved ticket and wallet minimums", () => {
  assert.deepEqual(
    FIXED_POOLS.map((pool) => [
      pool.id,
      Number(pool.minimumTickets),
      pool.minimumDistinctEntrants,
    ]),
    [
      ["mini", 25, 1],
      ["normal", 13, 1],
      ["high", 3, 1],
      ["premium", 3, 3],
    ],
  );
});

test("expired rounds below each total-ticket minimum refund without ORAO", () => {
  const cases = [
    ["mini", 24n],
    ["normal", 12n],
    ["high", 2n],
  ];
  for (const [poolId, tickets] of cases) {
    const pool = FIXED_POOLS.find((candidate) => candidate.id === poolId);
    const decision = classifyExpiredRound({
      pool,
      entries: [{ player: `${poolId}-buyer`, tickets }],
    });
    assert.equal(decision.action, "refund", poolId);
    assert.equal(decision.roundOutcome, "cancelled_below_minimum", poolId);
    assert.equal(decision.requestOrao, false, poolId);
    assert.equal(decision.refundLamports, tickets * pool.ticketPriceLamports, poolId);
  }

  const premium = FIXED_POOLS.find((candidate) => candidate.id === "premium");
  const premiumDecision = classifyExpiredRound({
    pool: premium,
    entries: [
      { player: "premium-a", tickets: 1n },
      { player: "premium-b", tickets: 1n },
    ],
  });
  assert.equal(premiumDecision.action, "refund");
  assert.equal(premiumDecision.requestOrao, false);
  assert.equal(premiumDecision.refundLamports, 2n * premium.ticketPriceLamports);
});

test("minimum totals enter the draw path and one wallet can satisfy non-Premium pools", () => {
  for (const poolId of ["mini", "normal", "high"]) {
    const pool = FIXED_POOLS.find((candidate) => candidate.id === poolId);
    const decision = classifyExpiredRound({
      pool,
      entries: [{ player: `${poolId}-single-wallet`, tickets: pool.minimumTickets }],
    });
    assert.equal(decision.action, "request_orao", poolId);
    assert.equal(decision.roundOutcome, "eligible_for_draw", poolId);
    assert.equal(decision.requestOrao, true, poolId);
  }

  const premium = FIXED_POOLS.find((candidate) => candidate.id === "premium");
  const premiumDecision = classifyExpiredRound({
    pool: premium,
    entries: [
      { player: "premium-a", tickets: 1n },
      { player: "premium-b", tickets: 1n },
      { player: "premium-c", tickets: 1n },
    ],
  });
  assert.equal(premiumDecision.action, "request_orao");
  assert.equal(premiumDecision.requestOrao, true);
});

test("default economics use hourly rounds and a 95/2/3 split", () => {
  assert.equal(DEFAULT_ROUND_DURATION_SECONDS, 3_600);
  assert.equal(DEFAULT_MAIN_PRIZE_BPS, 9_500n);
  assert.equal(DEFAULT_CONFIG.houseFeeBps, 200n);
  assert.equal(DEFAULT_CONFIG.jackpotBps, 300n);
});

test("round settlement splits 95 percent prize, 2 percent house, 3 percent jackpot", () => {
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
  assert.equal(lamportsToSol(result.houseFee), "0.004");
  assert.equal(lamportsToSol(result.jackpotAdd), "0.006");
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

test("premium requires three entrants and pays three distinct winners 70/20/10", () => {
  const premium = FIXED_POOLS.find((pool) => pool.id === "premium");
  const result = settleRound({
    pool: premium,
    jackpotBalanceLamports: 0n,
    config: {
      ...DEFAULT_CONFIG,
      jackpotOddsDenominator: 999_999n,
    },
    entries: [
      { player: "alice", tickets: 1n },
      { player: "bob", tickets: 1n },
      { player: "carol", tickets: 1n },
    ],
    randomSeed: "premium-three-winners",
  });

  assert.equal(result.winnerCount, 3);
  assert.equal(new Set(result.winners.map((winner) => winner.player)).size, 3);
  assert.deepEqual(
    result.winners.map((winner) => lamportsToSol(winner.prizeLamports)),
    ["0.1995", "0.057", "0.0285"],
  );
  assert.equal(lamportsToSol(result.mainPrize), "0.285");
});

test("premium rejects fewer than three entrants", () => {
  const premium = FIXED_POOLS.find((pool) => pool.id === "premium");

  assert.throws(
    () =>
      settleRound({
        pool: premium,
        entries: [
          { player: "alice", tickets: 1n },
          { player: "bob", tickets: 1n },
        ],
        randomSeed: "premium-too-few",
      }),
    /requires at least 3 (?:total tickets|distinct entrants)/,
  );
});

test("premium allows only one ticket per wallet", () => {
  const premium = FIXED_POOLS.find((pool) => pool.id === "premium");

  assert.throws(
    () =>
      settleRound({
        pool: premium,
        entries: [
          { player: "alice", tickets: 2n },
          { player: "bob", tickets: 1n },
          { player: "carol", tickets: 1n },
        ],
        randomSeed: "premium-ticket-limit",
      }),
    /per-entry maximum of 1/,
  );
});

test("jackpot payout includes previous balance plus current 3 percent contribution", () => {
  const result = settleRound({
    ticketPriceLamports: solToLamports("0.01"),
    jackpotBalanceLamports: solToLamports("2"),
    config: {
      ...DEFAULT_CONFIG,
      jackpotOddsDenominator: 1n,
    },
    entries: [
      { player: "alice", tickets: 10n },
      { player: "bob", tickets: 10n },
    ],
    randomSeed: "force-jackpot",
  });

  assert.equal(result.jackpotTriggered, true);
  assert.equal(lamportsToSol(result.jackpotAdd), "0.006");
  assert.equal(lamportsToSol(result.jackpotPayout), "2.006");
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
