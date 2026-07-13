import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("wallet enrichment batches Entry PDA reads and preserves the pool response shape", () => {
  const result = runHarness(`
    const { PublicKey } = await import("@solana/web3.js");
    const { enrichProgramStateForPlayer } = await import("./backend/src/server.mjs");
    const player = new PublicKey("D9RMWShYrWUe6jxnGX9FT7FDnPTEE8mZZaSSEcSvKe3N");
    const liveRound = new PublicKey("GKwsvpTeCejnDopJSnbCNAsbE4PhScFgYk7GR7dziFUX");
    let fetchMultipleCalls = 0;
    let fetchedAddresses = [];
    const program = {
      account: {
        entry: {
          async fetchMultiple(addresses) {
            fetchMultipleCalls += 1;
            fetchedAddresses = addresses.map((address) => address.toBase58());
            return [{
              round: liveRound,
              player,
              ticketStart: 0n,
              ticketCount: 25n,
              lamports: 125000000n,
            }];
          },
        },
      },
    };
    const current = {
      address: liveRound.toBase58(),
      roundId: 7,
      totalTickets: "25",
      settled: false,
    };
    const archived = {
      address: "AomADwioK2uATmc4GLBhsUQpkDK8Q6N2nLPmPM412VWd",
      roundId: 6,
      totalTickets: "25",
      settled: true,
      archived: true,
      entries: [{
        address: "GbmXc1GeQdzSsQ6H8tXXseqkQKAyuLwmGoqhbrvhDivX",
        player: player.toBase58(),
        ticketStart: "0",
        ticketCount: "25",
        lamports: "125000000",
      }],
    };
    const state = {
      onchain: { available: true },
      config: { initialized: true },
      pools: [{
        id: "mini",
        activeRound: current,
        recentRounds: [current, archived],
      }],
    };
    const enriched = await enrichProgramStateForPlayer(state, player, { program });
    console.log(JSON.stringify({
      fetchMultipleCalls,
      fetchedAddressCount: fetchedAddresses.length,
      publicStateUntouched: state.pools[0].activeRound.userEntry === undefined,
      activeTickets: enriched.pools[0].activeRound.userEntry.ticketCount,
      duplicatedCurrentTickets: enriched.pools[0].recentRounds[0].userEntry.ticketCount,
      archivedChance: enriched.pools[0].recentRounds[1].userEntry.chancePercent,
      poolId: enriched.pools[0].id,
    }));
  `);

  assert.deepEqual(result, {
    fetchMultipleCalls: 1,
    fetchedAddressCount: 1,
    publicStateUntouched: true,
    activeTickets: "25",
    duplicatedCurrentTickets: "25",
    archivedChance: "100.00",
    poolId: "mini",
  });
});

test("wallet enrichment rejects decoded Entry data for another identity", () => {
  const result = runHarness(`
    const { PublicKey } = await import("@solana/web3.js");
    const { enrichProgramStateForPlayer } = await import("./backend/src/server.mjs");
    const player = new PublicKey("D9RMWShYrWUe6jxnGX9FT7FDnPTEE8mZZaSSEcSvKe3N");
    const otherPlayer = new PublicKey("4WQr95Qa41qV1GRWW5uv8Dp6Gze7GVaoNHwxp1H9P8Hm");
    const round = new PublicKey("GKwsvpTeCejnDopJSnbCNAsbE4PhScFgYk7GR7dziFUX");
    const program = { account: { entry: { async fetchMultiple() { return [{
      round,
      player: otherPlayer,
      ticketStart: 0n,
      ticketCount: 1n,
      lamports: 5000000n,
    }]; } } } };
    try {
      await enrichProgramStateForPlayer({
        onchain: { available: true },
        pools: [{ activeRound: { address: round.toBase58(), totalTickets: "1" }, recentRounds: [] }],
      }, player, { program });
      console.log(JSON.stringify({ rejected: false }));
    } catch (error) {
      console.log(JSON.stringify({ rejected: /identity mismatch/.test(error.message) }));
    }
  `);
  assert.equal(result.rejected, true);
});

test("backend shares public state across wallets and batches recent Round accounts", () => {
  const source = fs.readFileSync("backend/src/server.mjs", "utf8");
  assert.match(source, /const publicRecord = await getCachedPublicProgramState\(\)/);
  assert.match(source, /const promise = getProgramState\(\)/);
  assert.doesNotMatch(source, /getProgramState\(\{ player \}\)/);
  assert.match(source, /program\.account\.pool\.fetchMultiple\(poolAddresses\)/);
  assert.match(source, /program\.account\.round\.fetchMultiple\(roundAddresses\)/);
  assert.match(source, /program\.account\.entry\.fetchMultiple\(entryAddresses\)/);
});

function runHarness(source) {
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
