import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("backend minimum policy classifies ticket and distinct-wallet targets behaviorally", () => {
  const result = runPolicyHarness(`
    const {
      archiveIdentityMatches,
      archivedRoundPayload,
      assertRoundMinimumReached,
      getRefundState,
      minimumPolicyForPool,
      roundPolicyFields,
    } = await import("./backend/src/server.mjs");
    const now = 2_000_000_000;
    const round = (totalTickets, entrantCount, overrides = {}) => ({
      totalTickets: String(totalTickets),
      totalLamports: String(Number(totalTickets) * 5_000_000),
      entrantCount,
      startTs: now - 3_600,
      endTs: now - 1,
      settled: false,
      jackpotTriggered: false,
      winnerCount: 0,
      winner: "11111111111111111111111111111111",
      winnerSecond: "11111111111111111111111111111111",
      winnerThird: "11111111111111111111111111111111",
      jackpotWinner: "11111111111111111111111111111111",
      randomness: Array(32).fill(0),
      ...overrides,
    });
    const classify = (pool, tickets, entrants, overrides) =>
      roundPolicyFields(pool, round(tickets, entrants, overrides), { now });
    const blockedCode = (pool, tickets, entrants) => {
      try {
        assertRoundMinimumReached(pool, round(tickets, entrants));
        return null;
      } catch (error) {
        return error.code;
      }
    };
    console.log(JSON.stringify({
      mapping: ["mini", "normal", "high", "premium"].map((pool) => minimumPolicyForPool(pool)),
      mini24: classify("mini", 24, 1),
      mini25OneWallet: classify("mini", 25, 1),
      normal12: classify("normal", 12, 1),
      normal13: classify("normal", 13, 1),
      high2: classify("high", 2, 1),
      high3: classify("high", 3, 1),
      premiumTwoWallets: classify("premium", 3, 2),
      premiumThreeWallets: classify("premium", 3, 3),
      waiting: roundPolicyFields("mini", round(0, 0, { startTs: 0, endTs: 0, totalLamports: "0" }), { now }),
      archivedRefund: roundPolicyFields("mini", round(0, 0, {
        settled: true,
        roundOutcome: "cancelled_below_minimum",
        refundStatus: "completed",
        totalLamports: "0",
      }), { now, archived: true }),
      blocked: {
        mini24: blockedCode("mini", 24, 1),
        premiumTwoWallets: blockedCode("premium", 3, 2),
        mini25: blockedCode("mini", 25, 1),
      },
      refundAvailability: {
        mini24: getRefundState(round(24, 1, { endTs: 1 }), "mini").refundAvailable,
        mini25: getRefundState(round(25, 1, { endTs: 1 }), "mini").refundAvailable,
      },
      archivedCancelled: archivedRoundPayload({
        pool: "mini",
        roundId: 11,
        totalTickets: "24",
        totalLamports: "120000000",
        entrantCount: 2,
        settled: true,
        roundOutcome: "cancelled_below_minimum",
        refundStatus: "completed",
        oraoRequested: false,
        randomnessCommitment: "11".repeat(32),
        randomness: Array(32).fill(0),
        winnerCount: 0,
        winner: "11111111111111111111111111111111",
        winnerSecond: "11111111111111111111111111111111",
        winnerThird: "11111111111111111111111111111111",
        jackpotWinner: "11111111111111111111111111111111",
        entries: [],
        startTs: 1,
        endTs: 2,
      }, null),
      archiveIdentity: {
        exact: archiveIdentityMatches(
          { genesisHash: "mainnet", programId: "program", poolAddress: "pool" },
          { genesisHash: "mainnet", programId: "program", poolAddress: "pool" },
        ),
        wrongGenesis: archiveIdentityMatches(
          { genesisHash: "localnet", programId: "program", poolAddress: "pool" },
          { genesisHash: "mainnet", programId: "program", poolAddress: "pool" },
        ),
        wrongProgram: archiveIdentityMatches(
          { genesisHash: "mainnet", programId: "other", poolAddress: "pool" },
          { genesisHash: "mainnet", programId: "program", poolAddress: "pool" },
        ),
        missingIdentity: archiveIdentityMatches(
          { pool: "mini", roundId: 1 },
          { genesisHash: "mainnet", programId: "program", poolAddress: "pool" },
        ),
      },
    }));
  `);

  assert.deepEqual(result.mapping, [
    { minimumTickets: 25, minimumDistinctEntrants: 1 },
    { minimumTickets: 13, minimumDistinctEntrants: 1 },
    { minimumTickets: 3, minimumDistinctEntrants: 1 },
    { minimumTickets: 3, minimumDistinctEntrants: 3 },
  ]);
  assert.equal(result.mini24.roundOutcome, "cancelled_below_minimum");
  assert.equal(result.mini24.refundStatus, "pending");
  assert.equal(result.mini24.ticketsRemaining, 1);
  assert.equal(result.mini25OneWallet.roundOutcome, "eligible_for_draw");
  assert.equal(result.mini25OneWallet.minimumReached, true);
  assert.equal(result.normal12.roundOutcome, "cancelled_below_minimum");
  assert.equal(result.normal13.roundOutcome, "eligible_for_draw");
  assert.equal(result.high2.roundOutcome, "cancelled_below_minimum");
  assert.equal(result.high3.roundOutcome, "eligible_for_draw");
  assert.equal(result.premiumTwoWallets.minimumReached, false);
  assert.equal(result.premiumTwoWallets.roundOutcome, "cancelled_below_minimum");
  assert.equal(result.premiumThreeWallets.minimumReached, true);
  assert.equal(result.premiumThreeWallets.roundOutcome, "eligible_for_draw");
  assert.equal(result.waiting.roundOutcome, "waiting");
  assert.equal(result.waiting.refundStatus, "none");
  assert.equal(result.archivedRefund.refundStatus, "completed");
  assert.deepEqual(result.blocked, {
    mini24: "minimum_tickets_not_reached",
    premiumTwoWallets: "minimum_distinct_entrants_not_reached",
    mini25: null,
  });
  assert.deepEqual(result.refundAvailability, { mini24: true, mini25: false });
  assert.equal(result.archivedCancelled.randomnessProofStatus, "refund_mode");
  assert.equal(result.archivedCancelled.providerRandomness.status, "not_requested");
  assert.equal(result.archivedCancelled.refundMode, true);
  assert.deepEqual(result.archiveIdentity, {
    exact: true,
    wrongGenesis: false,
    wrongProgram: false,
    missingIdentity: false,
  });
});

test("site and How to Play keep targets, refund wording, and wallet modal consistent", () => {
  const app = fs.readFileSync("site/lucky-me.app/app.js", "utf8");
  const play = fs.readFileSync("site/lucky-me.app/play/index.html", "utf8");
  const guide = fs.readFileSync("site/lucky-me.app/how-to-play/index.html", "utf8");
  const landing = fs.readFileSync("site/lucky-me.app/index.html", "utf8");
  const combined = `${app}\n${play}\n${guide}\n${landing}`;

  assert.match(app, /minimumTickets:\s*25/);
  assert.match(app, /minimumTickets:\s*13/);
  assert.equal((app.match(/minimumTickets:\s*3/g) || []).length, 2);
  assert.match(app, /minimumDistinctEntrants:\s*3/);
  assert.match(app, /tickets sold/);
  assert.match(app, /Round cancelled — automatic refunds in progress/);
  assert.match(app, /Refund complete — ticket purchase amount returned/);
  assert.match(combined, /100% of the ticket purchase amount is automatically returned/);
  assert.match(combined, /Solana network fees are not refundable/);
  assert.match(combined, /No claim button is required/);
  assert.doesNotMatch(combined, /25 players/i);
  assert.match(guide, /Mini<\/th><td>0\.005 SOL<\/td><td>25/);
  assert.match(guide, /Normal<\/th><td>0\.01 SOL<\/td><td>13/);
  assert.match(guide, /Premium<\/th><td>0\.1 SOL<\/td><td>3<\/td><td>3/);
  assert.match(play, /id="wallet-modal"/);
  assert.match(play, /data-action="open-wallet-modal"/);
  assert.match(play, /data-route="how"/);
  assert.match(landing, /href="\/how-to-play\/"/);
  assert.match(app, /setInterval\(\(\) => \{[\s\S]*void loadPools\(\);[\s\S]*12_000/);
  assert.match(app, /Boolean\(round\) && hasVerifiedMinimumPolicy/);
  assert.match(app, /expectedRoundId/);
  assert.match(app, /expectedTotalTickets/);
  assert.match(app, /payload\.summary\?\.totalTicketsBefore/);
});

test("web purchase supports visible multi-ticket presets and wallet-compatible send options", () => {
  const app = fs.readFileSync("site/lucky-me.app/app.js", "utf8");

  assert.match(app, /\[1, 5, 10, 20, 25\]/);
  assert.match(app, /data-ticket-count="\$\{value\}"/);
  assert.match(app, /ticketCountButton\.dataset\.ticketCount/);
  assert.match(app, /pool\.id === "premium" \? ""/);
  assert.doesNotMatch(app, /options:\s*\{\s*commitment:/);
  assert.match(app, /preflightCommitment: "confirmed"/);
});

test("Seeker How To stays within the phone viewport", () => {
  const seekerScreens = fs.readFileSync("app-seeker/src/stitchScreens.ts", "utf8");

  assert.match(seekerScreens, /<main class="stack how-to-page">/);
  assert.match(seekerScreens, /\.how-to-page \{[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: clip;/);
  assert.match(
    seekerScreens,
    /@media \(max-width: 520px\) \{[\s\S]*?\.how-to-page \.pool-rules-table[\s\S]*?min-width: 0;/,
  );
  assert.match(seekerScreens, /<td data-label="Target tickets"/);
  assert.match(seekerScreens, /content: attr\(data-label\)/);
});

test("reviewed ticket progress is bound through backend and on-chain instruction", () => {
  const backend = fs.readFileSync("backend/src/server.mjs", "utf8");
  const program = fs.readFileSync("programs/luckyme/src/lib.rs", "utf8");

  assert.match(backend, /parseRoundId\(payload\.expectedRoundId\)/);
  assert.match(backend, /parseExpectedTotalTickets\(payload\.expectedTotalTickets\)/);
  assert.match(backend, /reviewed_round_changed/);
  assert.match(backend, /reviewed_ticket_total_changed/);
  assert.match(backend, /\.buyTickets\(new BN\(ticketCount\), new BN\(expectedTotalTickets\.toString\(\)\)\)/);
  assert.match(program, /expected_total_tickets: u64/);
  assert.match(program, /round\.total_tickets == expected_total_tickets/);
  assert.match(program, /ReviewedRoundChanged/);
});

function runPolicyHarness(source) {
  const child = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      LUCKYME_POLICY_TEST_ONLY: "true",
      LUCKYME_RELEASE_MODE: "LOCAL_DEVELOPMENT",
      LUCKYME_RANDOMNESS_MODE: "commit_reveal_demo",
      LUCKYME_SOLANA_CLUSTER: "localnet",
      LUCKYME_STORE_BUILD: "false",
      LUCKYME_STRICT_ONCHAIN: "false",
      LUCKYME_PRODUCTION_RANDOMNESS: "false",
    },
  });
  assert.equal(child.status, 0, child.stderr || child.stdout);
  return JSON.parse(child.stdout.trim());
}
