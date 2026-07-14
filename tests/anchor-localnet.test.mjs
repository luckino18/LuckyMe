import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  BN,
  ORAO_VRF_PROGRAM_ID,
  SystemProgram,
  deriveConfig,
  deriveEntry,
  deriveKeeperConfig,
  deriveOraoRandomnessAccount,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveRound,
  deriveRoundRandomnessAccount,
  mainPrizePayouts,
  randomModDomain,
  selectWinnerTickets,
} from "../scripts/anchor-client.mjs";

const CLOCK_SYSVAR = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const PROGRAM_ID = new PublicKey("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");
const POOL_ID = 1;
const TICKET_PRICE_LAMPORTS = 5_000_000;
const PREMIUM_POOL_ID = 4;
const PREMIUM_TICKET_PRICE_LAMPORTS = 100_000_000;
const HIGH_POOL_ID = 3;
const HIGH_TICKET_PRICE_LAMPORTS = 50_000_000;
// Leave enough local-validator time for the three sequential premium buys.
// Two seconds made the third transaction race the on-chain end timestamp.
const ROUND_DURATION_SECONDS = 5;
const REFUND_DELAY_SECONDS = 2;

test("localnet buy, settlement, and refund-mode state machine", async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = readIdl();
  const program = new anchor.Program(idl, provider);
  const authority = provider.wallet.payer;
  const treasuryWallet = Keypair.generate();
  await fund(provider, treasuryWallet.publicKey);
  const treasury = treasuryWallet.publicKey;
  const config = deriveConfig();
  const keeperConfig = deriveKeeperConfig(config);
  const pool = derivePool(config, POOL_ID);
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);
  const premiumPool = derivePool(config, PREMIUM_POOL_ID);
  const premiumPoolVault = derivePoolVault(premiumPool);
  const premiumJackpotVault = deriveJackpotVault(premiumPool);
  const highPool = derivePool(config, HIGH_POOL_ID);
  const highPoolVault = derivePoolVault(highPool);
  const highJackpotVault = deriveJackpotVault(highPool);

  await program.methods
    .initializeConfig(treasury, 200, 300, 1, new BN(ROUND_DURATION_SECONDS))
    .accounts({
      authority: authority.publicKey,
      config,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .initializeKeeperConfig(authority.publicKey)
    .accounts({
      authority: authority.publicKey,
      config,
      keeperConfig,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .initializePool(POOL_ID, new BN(TICKET_PRICE_LAMPORTS))
    .accounts({
      authority: authority.publicKey,
      config,
      pool,
      poolVault,
      jackpotVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .initializePool(PREMIUM_POOL_ID, new BN(PREMIUM_TICKET_PRICE_LAMPORTS))
    .accounts({
      authority: authority.publicKey,
      config,
      pool: premiumPool,
      poolVault: premiumPoolVault,
      jackpotVault: premiumJackpotVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .initializePool(HIGH_POOL_ID, new BN(HIGH_TICKET_PRICE_LAMPORTS))
    .accounts({
      authority: authority.publicKey,
      config,
      pool: highPool,
      poolVault: highPoolVault,
      jackpotVault: highJackpotVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await testSettlementFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault });
  await testPremiumSettlementFlow({
    program,
    provider,
    authority,
    treasury,
    config,
    keeperConfig,
    pool: premiumPool,
    poolVault: premiumPoolVault,
    jackpotVault: premiumJackpotVault,
  });
  await testRefundModeFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault });
  await testProviderRandomnessRequestAndRefundFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault });
  await testPauseAndEmptyRoundFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault });
  await testEligibleProviderRequestGuard({
    program,
    provider,
    authority,
    config,
    keeperConfig,
    pool: highPool,
    poolVault: highPoolVault,
  });
});

async function testSettlementFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault }) {
  const player = Keypair.generate();
  const playerTwo = Keypair.generate();
  const oversizedBuyer = Keypair.generate();
  const wrongTreasury = Keypair.generate();
  await Promise.all([
    fund(provider, player.publicKey),
    fund(provider, playerTwo.publicKey),
    fund(provider, oversizedBuyer.publicKey),
    fund(provider, wrongTreasury.publicKey),
  ]);

  const reveal = Buffer.from("settlement-round-reveal-00000000", "utf8");
  const commitment = commitmentForReveal(reveal);
  const round = deriveRound(pool, 1);
  const entry = deriveEntry(round, player.publicKey);
  const entryTwo = deriveEntry(round, playerTwo.publicKey);
  const oversizedEntry = deriveEntry(round, oversizedBuyer.publicKey);
  const vaultBefore = await provider.connection.getBalance(poolVault);

  await program.methods
    .openRound([...commitment])
    .accounts({
      keeper: authority.publicKey,
      config,
          keeperConfig,
      pool,
      previousRound: deriveRound(pool, 0),
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const nextRound = deriveRound(pool, 2);
  await expectAnchorError(
    () =>
      program.methods
        .openRound([...commitmentForReveal(Buffer.alloc(32, 5))])
        .accounts({
          keeper: oversizedBuyer.publicKey,
          config,
          keeperConfig,
          pool,
          previousRound: round,
          round: nextRound,
          systemProgram: SystemProgram.programId,
        })
        .signers([oversizedBuyer])
        .rpc(),
    "UnauthorizedKeeper",
  );
  await expectAnchorError(
    () =>
      program.methods
        .openRound([...commitmentForReveal(Buffer.alloc(32, 6))])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          previousRound: round,
          round: nextRound,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "PreviousRoundStillExists",
  );

  await program.methods
    .buyTickets(new BN(24), new BN(0))
    .accounts({
      player: player.publicKey,
      config,
      pool,
      round,
      entry,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .signers([player])
    .rpc();

  const startedRound = await program.account.round.fetch(round);
  assert.ok(Number(startedRound.startTs) > 0);
  assert.equal(Number(startedRound.endTs) - Number(startedRound.startTs), ROUND_DURATION_SECONDS);

  await expectAnchorError(
    () =>
      program.methods
        .buyTickets(new BN(1), new BN(23))
        .accounts({
          player: playerTwo.publicKey,
          config,
          pool,
          round,
          entry: entryTwo,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([playerTwo])
        .rpc(),
    "ReviewedRoundChanged",
  );

  await program.methods
    .buyTickets(new BN(1), new BN(24))
    .accounts({
      player: playerTwo.publicKey,
      config,
      pool,
      round,
      entry: entryTwo,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .signers([playerTwo])
    .rpc();

  await expectFailure(
    () =>
      program.methods
        .buyTickets(new BN(1), new BN(25))
        .accounts({
          player: player.publicKey,
          config,
          pool,
          round,
          entry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc(),
    "AlreadyEnteredRound",
  );

  await expectAnchorError(
    () =>
      program.methods
        .buyTickets(new BN(1_001), new BN(25))
        .accounts({
          player: oversizedBuyer.publicKey,
          config,
          pool,
          round,
          entry: oversizedEntry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([oversizedBuyer])
        .rpc(),
    "InvalidTicketCount",
  );

  let roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.startTs.toString(), startedRound.startTs.toString());
  assert.equal(roundAccount.endTs.toString(), startedRound.endTs.toString());
  assert.equal(roundAccount.totalTickets.toString(), "25");
  assert.equal(roundAccount.totalLamports.toString(), String(TICKET_PRICE_LAMPORTS * 25));
  assert.equal(roundAccount.entrantCount, 2);
  assert.equal(await provider.connection.getBalance(poolVault), vaultBefore + TICKET_PRICE_LAMPORTS * 25);

  await waitForClock(
    provider,
    Number(roundAccount.endTs) + REFUND_DELAY_SECONDS,
    "eligible round refund guard",
  );

  await expectAnchorError(
    () =>
      program.methods
        .refundEntryAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          player: player.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          entry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RoundEligibleForDraw",
  );

  await expectAnchorError(
    () =>
      program.methods
        .closeEmptyRoundAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          treasury,
        })
        .rpc(),
    "RoundHasEntries",
  );

  const entries = [
    {
      address: entry,
      player: player.publicKey,
      ticketStart: 0n,
      ticketEndExclusive: 24n,
    },
    {
      address: entryTwo,
      player: playerTwo.publicKey,
      ticketStart: 24n,
      ticketEndExclusive: 25n,
    },
  ];
  const randomness = deriveRoundRandomness(round, 25n, reveal);
  const [winnerTicket] = selectWinnerTickets(randomness, 25n, 1);
  const jackpotTicket = randomModDomain(randomness, "jackpot-winner", 0, 25n);
  const winnerEntry = findEntryByTicket(entries, winnerTicket);
  const jackpotEntry = findEntryByTicket(entries, jackpotTicket);
  const wrongWinnerEntry = otherEntry(entries, winnerEntry).address;
  const wrongJackpotEntry = otherEntry(entries, jackpotEntry).address;

  await expectAnchorError(
    () =>
      program.methods
        .settleRound([...Buffer.alloc(32, 9)])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          poolVault,
          jackpotVault,
          winner: winnerEntry.player,
          winnerEntry: winnerEntry.address,
          jackpotWinner: jackpotEntry.player,
          jackpotEntry: jackpotEntry.address,
          treasury,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "InvalidRandomnessReveal",
  );

  await expectAnchorError(
    () =>
      program.methods
        .settleRound([...reveal])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          poolVault,
          jackpotVault,
          winner: winnerEntry.player,
          winnerEntry: winnerEntry.address,
          jackpotWinner: jackpotEntry.player,
          jackpotEntry: jackpotEntry.address,
          treasury: wrongTreasury.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "ConstraintAddress",
  );

  await expectAnchorError(
    () =>
      program.methods
        .settleRound([...reveal])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          poolVault,
          jackpotVault,
          winner: winnerEntry.player,
          winnerEntry: wrongWinnerEntry,
          jackpotWinner: jackpotEntry.player,
          jackpotEntry: jackpotEntry.address,
          treasury,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "WrongWinnerEntry",
  );

  await expectAnchorError(
    () =>
      program.methods
        .settleRound([...reveal])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          poolVault,
          jackpotVault,
          winner: winnerEntry.player,
          winnerEntry: winnerEntry.address,
          jackpotWinner: jackpotEntry.player,
          jackpotEntry: wrongJackpotEntry,
          treasury,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "WrongJackpotEntry",
  );

  await program.methods
    .settleRound([...reveal])
    .accounts({
      keeper: authority.publicKey,
      config,
          keeperConfig,
      pool,
      round,
      poolVault,
      jackpotVault,
      winner: winnerEntry.player,
      winnerEntry: winnerEntry.address,
      jackpotWinner: jackpotEntry.player,
      jackpotEntry: jackpotEntry.address,
      treasury,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  roundAccount = await program.account.round.fetch(round);
  const poolAccount = await program.account.pool.fetch(pool);
  assert.equal(roundAccount.settled, true);
  assert.equal(roundAccount.winnerCount, 1);
  assert.equal(roundAccount.winner.toBase58(), winnerEntry.player.toBase58());
  assert.equal(roundAccount.winnerSecond.toBase58(), PublicKey.default.toBase58());
  assert.equal(roundAccount.winnerThird.toBase58(), PublicKey.default.toBase58());
  assert.equal(roundAccount.jackpotTriggered, true);
  assert.equal(roundAccount.jackpotWinner.toBase58(), jackpotEntry.player.toBase58());
  assert.notDeepEqual(roundAccount.randomness, Array(32).fill(0));
  assert.equal(poolAccount.jackpotLamports.toString(), "0");

  await waitForClock(
    provider,
    Number(roundAccount.endTs) + REFUND_DELAY_SECONDS,
    "post-settlement refund rejection",
  );

  await expectAnchorError(
    () =>
      program.methods
        .refundEntryAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          player: player.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          entry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RoundSettled",
  );

  await closeSettledRoundAccounts({
    program,
    provider,
    authority,
    treasury,
    config,
    keeperConfig,
    pool,
    round,
    entries: [
      { address: entry, player: player.publicKey },
      { address: entryTwo, player: playerTwo.publicKey },
    ],
  });
}

async function testPremiumSettlementFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault }) {
  const players = [Keypair.generate(), Keypair.generate(), Keypair.generate()];
  const oversizedBuyer = Keypair.generate();
  await Promise.all([
    ...players.map((player) => fund(provider, player.publicKey)),
    fund(provider, oversizedBuyer.publicKey),
  ]);

  const reveal = Buffer.from("premium-round-reveal-00000000000", "utf8");
  const commitment = commitmentForReveal(reveal);
  const round = deriveRound(pool, 1);
  const entries = players.map((player) => ({
    player: player.publicKey,
    address: deriveEntry(round, player.publicKey),
  }));
  const oversizedEntry = deriveEntry(round, oversizedBuyer.publicKey);

  await program.methods
    .openRound([...commitment])
    .accounts({
      keeper: authority.publicKey,
      config,
          keeperConfig,
      pool,
      previousRound: deriveRound(pool, 0),
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await expectAnchorError(
    () =>
      program.methods
        .buyTickets(new BN(2), new BN(0))
        .accounts({
          player: oversizedBuyer.publicKey,
          config,
          pool,
          round,
          entry: oversizedEntry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([oversizedBuyer])
        .rpc(),
    "InvalidTicketCount",
  );

  for (const [index, player] of players.entries()) {
    await buyTickets({
      program,
      player,
      config,
      pool,
      round,
      entry: entries[index].address,
      poolVault,
      ticketCount: 1,
    });
  }

  let roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.totalTickets.toString(), "3");
  assert.equal(roundAccount.totalLamports.toString(), String(PREMIUM_TICKET_PRICE_LAMPORTS * 3));
  assert.equal(roundAccount.entrantCount, 3);
  await waitForClock(provider, Number(roundAccount.endTs), "premium settlement");

  const fullEntries = entries.map((entry, index) => ({
    ...entry,
    ticketStart: BigInt(index),
    ticketEndExclusive: BigInt(index + 1),
  }));
  const randomness = deriveRoundRandomness(round, 3n, reveal);
  const winnerTickets = selectWinnerTickets(randomness, 3n, 3);
  const winnerEntries = winnerTickets.map((ticket) => findEntryByTicket(fullEntries, ticket));
  const jackpotTicket = randomModDomain(randomness, "jackpot-winner", 0, 3n);
  const jackpotEntry = findEntryByTicket(fullEntries, jackpotTicket);
  const mainPrize = 285_000_000n;
  const prizePayouts = mainPrizePayouts(mainPrize, {
    winnerCount: 3,
    prizeSplitBps: [7_000, 2_000, 1_000],
  });
  assert.deepEqual(prizePayouts.map(String), ["199500000", "57000000", "28500000"]);

  const balancesBefore = new Map();
  for (const player of players) {
    balancesBefore.set(
      player.publicKey.toBase58(),
      BigInt(await provider.connection.getBalance(player.publicKey)),
    );
  }

  await program.methods
    .settleRound([...reveal])
    .accounts({
      keeper: authority.publicKey,
      config,
          keeperConfig,
      pool,
      round,
      poolVault,
      jackpotVault,
      winner: winnerEntries[0].player,
      winnerEntry: winnerEntries[0].address,
      jackpotWinner: jackpotEntry.player,
      jackpotEntry: jackpotEntry.address,
      treasury,
      systemProgram: SystemProgram.programId,
    })
    .remainingAccounts(remainingWinnerAccounts(winnerEntries))
    .rpc();

  roundAccount = await program.account.round.fetch(round);
  const poolAccount = await program.account.pool.fetch(pool);
  assert.equal(roundAccount.settled, true);
  assert.equal(roundAccount.winnerCount, 3);
  assert.equal(roundAccount.winner.toBase58(), winnerEntries[0].player.toBase58());
  assert.equal(roundAccount.winnerSecond.toBase58(), winnerEntries[1].player.toBase58());
  assert.equal(roundAccount.winnerThird.toBase58(), winnerEntries[2].player.toBase58());
  assert.equal(roundAccount.jackpotTriggered, true);
  assert.equal(roundAccount.jackpotWinner.toBase58(), jackpotEntry.player.toBase58());
  assert.equal(poolAccount.jackpotLamports.toString(), "0");

  const expectedDeltas = new Map(players.map((player) => [player.publicKey.toBase58(), 0n]));
  for (const [index, entry] of winnerEntries.entries()) {
    const key = entry.player.toBase58();
    expectedDeltas.set(key, expectedDeltas.get(key) + prizePayouts[index]);
  }
  expectedDeltas.set(
    jackpotEntry.player.toBase58(),
    expectedDeltas.get(jackpotEntry.player.toBase58()) + 9_000_000n,
  );

  for (const player of players) {
    const key = player.publicKey.toBase58();
    const after = BigInt(await provider.connection.getBalance(player.publicKey));
    assert.equal(after - balancesBefore.get(key), expectedDeltas.get(key));
  }

  const nextRound = deriveRound(pool, 2);
  const nextCommitment = commitmentForReveal(Buffer.alloc(32, 44));
  await program.methods
    .openRoundAfterSettlement([...nextCommitment])
    .accounts({
      keeper: authority.publicKey,
      config,
      keeperConfig,
      pool,
      previousRound: round,
      round: nextRound,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  const [rotatedPool, rotatedRound] = await Promise.all([
    program.account.pool.fetch(pool),
    program.account.round.fetch(nextRound),
  ]);
  assert.equal(rotatedPool.currentRound.toString(), "2");
  assert.equal(rotatedRound.roundId.toString(), "2");
  assert.equal(rotatedRound.startTs.toString(), "0");
  assert.equal(rotatedRound.endTs.toString(), "0");
  assert.equal(
    (await provider.connection.getAccountInfo(round)) !== null,
    true,
    "previous settled Round remains available for background cleanup",
  );
  assert.equal(
    (await provider.connection.getAccountInfo(entries[0].address)) !== null,
    true,
    "previous Entry remains available for background cleanup",
  );

  await closeSettledRoundAccounts({
    program,
    provider,
    authority,
    treasury,
    config,
    keeperConfig,
    pool,
    round,
    entries: entries.map((entry) => ({ address: entry.address, player: entry.player })),
  });
}

async function testPauseAndEmptyRoundFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault }) {
  const player = Keypair.generate();
  await fund(provider, player.publicKey);

  const reveal = Buffer.from("pause-round-reveal-0000000000000", "utf8");
  const commitment = commitmentForReveal(reveal);
  const round = deriveRound(pool, 4);
  const entry = deriveEntry(round, player.publicKey);

  await program.methods
    .openRound([...commitment])
    .accounts({
      keeper: authority.publicKey,
      config,
          keeperConfig,
      pool,
      previousRound: deriveRound(pool, 3),
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .setPaused(true)
    .accounts({
      authority: authority.publicKey,
      config,
    })
    .rpc();

  await expectAnchorError(
    () =>
      program.methods
        .buyTickets(new BN(1), new BN(0))
        .accounts({
          player: player.publicKey,
          config,
          pool,
          round,
          entry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc(),
    "Paused",
  );

  await expectAnchorError(
    () =>
      program.methods
        .openRound([...commitmentForReveal(Buffer.alloc(32, 7))])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          previousRound: round,
          round: deriveRound(pool, 5),
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "Paused",
  );

  await program.methods
    .setPaused(false)
    .accounts({
      authority: authority.publicKey,
      config,
    })
    .rpc();

  await expectAnchorError(
    () =>
      program.methods
        .closeEmptyRoundAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          treasury,
        })
        .rpc(),
    "RoundNotStarted",
  );

  await expectAnchorError(
    () =>
      program.methods
        .buyTickets(new BN(0), new BN(0))
        .accounts({
          player: player.publicKey,
          config,
          pool,
          round,
          entry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([player])
        .rpc(),
    "InvalidTicketCount",
  );

  const waitingRound = await program.account.round.fetch(round);
  assert.equal(Number(waitingRound.startTs), 0);
  assert.equal(Number(waitingRound.endTs), 0);
  assert.equal(waitingRound.settled, false);

  const roundRandomness = deriveRoundRandomnessAccount(round);
  await expectAnchorError(
    () =>
      program.methods
        .requestRandomness()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          roundRandomness,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RoundNotStarted",
  );
  assert.equal(await provider.connection.getAccountInfo(roundRandomness, "confirmed"), null);

  await new Promise((resolve) => setTimeout(resolve, (ROUND_DURATION_SECONDS + 1) * 1_000));
  const samePool = await program.account.pool.fetch(pool);
  const stillWaiting = await program.account.round.fetch(round);
  assert.equal(samePool.currentRound.toString(), "4");
  assert.equal(Number(stillWaiting.startTs), 0);
  assert.equal(Number(stillWaiting.endTs), 0);
  assert.equal(stillWaiting.settled, false);
}

async function testRefundModeFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault }) {
  const playerOne = Keypair.generate();
  const playerTwo = Keypair.generate();
  await Promise.all([
    fund(provider, playerOne.publicKey),
    fund(provider, playerTwo.publicKey),
  ]);

  const reveal = Buffer.from("refund-round-reveal-000000000000", "utf8");
  const commitment = commitmentForReveal(reveal);
  const round = deriveRound(pool, 2);
  const entryOne = deriveEntry(round, playerOne.publicKey);
  const entryTwo = deriveEntry(round, playerTwo.publicKey);
  const vaultBefore = await provider.connection.getBalance(poolVault);

  await program.methods
    .openRound([...commitment])
    .accounts({
      keeper: authority.publicKey,
      config,
          keeperConfig,
      pool,
      previousRound: deriveRound(pool, 1),
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await buyTickets({ program, player: playerOne, config, pool, round, entry: entryOne, poolVault, ticketCount: 1 });
  await buyTickets({ program, player: playerTwo, config, pool, round, entry: entryTwo, poolVault, ticketCount: 23 });

  let roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.totalTickets.toString(), "24");
  assert.equal(roundAccount.totalLamports.toString(), String(TICKET_PRICE_LAMPORTS * 24));
  assert.equal(roundAccount.entrantCount, 2);
  assert.equal(await provider.connection.getBalance(poolVault), vaultBefore + TICKET_PRICE_LAMPORTS * 24);

  await expectAnchorError(
    () =>
      program.methods
        .refundEntryAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          player: playerOne.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          entry: entryOne,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RefundNotAvailable",
  );

  await waitForClock(
    provider,
    Number(roundAccount.endTs) + REFUND_DELAY_SECONDS,
    "refund timeout",
  );

  await expectAnchorError(
    () =>
      program.methods
        .settleRound([...reveal])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          poolVault,
          jackpotVault,
          winner: playerOne.publicKey,
          winnerEntry: entryOne,
          jackpotWinner: playerOne.publicKey,
          jackpotEntry: entryOne,
          treasury,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "MinimumTicketsNotReached",
  );

  await expectAnchorError(
    () =>
      program.methods
        .refundEntryAfterTimeout()
        .accounts({
          keeper: playerOne.publicKey,
          player: playerOne.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          entry: entryOne,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .signers([playerOne])
        .rpc(),
    "UnauthorizedKeeper",
  );

  const entryOneRent = await provider.connection.getBalance(entryOne);
  const playerOneBeforeRefund = await provider.connection.getBalance(playerOne.publicKey);

  await program.methods
    .refundEntryAfterTimeout()
    .accounts({
      keeper: authority.publicKey,
      player: playerOne.publicKey,
      config,
      keeperConfig,
      pool,
      round,
      entry: entryOne,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const playerOneAfterRefund = await provider.connection.getBalance(playerOne.publicKey);
  assert.equal(
    playerOneAfterRefund - playerOneBeforeRefund,
    TICKET_PRICE_LAMPORTS + entryOneRent,
    "refund returns exact ticket principal plus the Entry rent to the player",
  );

  roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.settled, true);
  assert.equal(roundAccount.winnerCount, 0);
  assert.equal(roundAccount.winner.toBase58(), PublicKey.default.toBase58());
  assert.equal(roundAccount.winnerSecond.toBase58(), PublicKey.default.toBase58());
  assert.equal(roundAccount.winnerThird.toBase58(), PublicKey.default.toBase58());
  assert.equal(roundAccount.jackpotWinner.toBase58(), PublicKey.default.toBase58());
  assert.deepEqual(roundAccount.randomness, Array(32).fill(0));
  assert.equal(roundAccount.totalTickets.toString(), "23");
  assert.equal(roundAccount.totalLamports.toString(), String(TICKET_PRICE_LAMPORTS * 23));
  assert.equal(roundAccount.entrantCount, 1);

  assert.equal(await provider.connection.getAccountInfo(entryOne), null);

  const nextRound = deriveRound(pool, 3);
  const nextCommitment = commitmentForReveal(Buffer.alloc(32, 45));
  await expectAnchorError(
    () =>
      program.methods
        .openRoundAfterSettlement([...nextCommitment])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          previousRound: round,
          round: nextRound,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RefundsPending",
  );
  assert.equal(
    await provider.connection.getAccountInfo(nextRound),
    null,
    "a refund-mode round cannot rotate while one player is still unpaid",
  );

  await expectAnchorError(
    () =>
      program.methods
        .closeSettledEntry()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          player: playerTwo.publicKey,
          round,
          entry: entryTwo,
        })
        .rpc(),
    "RefundsPending",
  );

  await expectAnchorError(
    () =>
      program.methods
        .closeSettledRound()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          roundRandomness: deriveRoundRandomnessAccount(round),
          treasury,
        })
        .rpc(),
    "RefundsPending",
  );

  await expectAnchorError(
    () =>
      program.methods
        .settleRound([...reveal])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          poolVault,
          jackpotVault,
          winner: playerTwo.publicKey,
          winnerEntry: entryTwo,
          jackpotWinner: playerTwo.publicKey,
          jackpotEntry: entryTwo,
          treasury,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RoundSettled",
  );

  await program.methods
    .refundEntryAfterTimeout()
    .accounts({
      keeper: authority.publicKey,
      player: playerTwo.publicKey,
      config,
      keeperConfig,
      pool,
      round,
      entry: entryTwo,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.totalTickets.toString(), "0");
  assert.equal(roundAccount.totalLamports.toString(), "0");
  assert.equal(roundAccount.entrantCount, 0);
  assert.equal(await provider.connection.getBalance(poolVault), vaultBefore);

  await expectFailure(
    () =>
      program.methods
        .refundEntryAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          player: playerOne.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          entry: entryOne,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "closed refunded entry cannot be refunded twice",
  );

  await closeSettledRoundAccounts({
    program,
    provider,
    authority,
    treasury,
    config,
    keeperConfig,
    pool,
    round,
  });
}

async function testProviderRandomnessRequestAndRefundFlow({ program, provider, authority, treasury, config, keeperConfig, pool, poolVault, jackpotVault }) {
  const player = Keypair.generate();
  await fund(provider, player.publicKey);

  const reveal = Buffer.from("provider-round-reveal-0000000000", "utf8");
  const commitment = commitmentForReveal(reveal);
  const roundId = 3;
  const round = deriveRound(pool, roundId);
  const entry = deriveEntry(round, player.publicKey);
  const roundRandomness = deriveRoundRandomnessAccount(round);
  const vaultBefore = await provider.connection.getBalance(poolVault);

  await program.methods
    .openRound([...commitment])
    .accounts({
      keeper: authority.publicKey,
      config,
          keeperConfig,
      pool,
      previousRound: deriveRound(pool, roundId - 1),
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  const poolAfterRefundReplacement = await program.account.pool.fetch(pool);
  assert.equal(poolAfterRefundReplacement.currentRound.toString(), String(roundId));
  await expectAnchorError(
    () =>
      program.methods
        .openRound([...commitmentForReveal(Buffer.alloc(32, 12))])
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          previousRound: round,
          round: deriveRound(pool, roundId + 1),
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "PreviousRoundStillExists",
  );

  await buyTickets({ program, player, config, pool, round, entry, poolVault, ticketCount: 2 });

  await expectAnchorError(
    () =>
      program.methods
        .requestRandomness()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          roundRandomness,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RoundStillOpen",
  );

  let roundAccount = await program.account.round.fetch(round);
  await waitForClock(provider, Number(roundAccount.endTs), "provider randomness request");

  await expectAnchorError(
    () =>
      program.methods
        .requestRandomness()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          roundRandomness,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "MinimumTicketsNotReached",
  );
  assert.equal(
    await provider.connection.getAccountInfo(roundRandomness, "confirmed"),
    null,
    "below-minimum request rolls back LuckyMe sidecar creation",
  );

  roundAccount = await program.account.round.fetch(round);
  await waitForClock(
    provider,
    Number(roundAccount.endTs) + REFUND_DELAY_SECONDS,
    "provider refund timeout",
  );

  await program.methods
    .refundEntryAfterTimeout()
    .accounts({
      keeper: authority.publicKey,
      player: player.publicKey,
      config,
      keeperConfig,
      pool,
      round,
      entry,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.settled, true);
  assert.equal(roundAccount.totalTickets.toString(), "0");
  assert.equal(roundAccount.totalLamports.toString(), "0");
  assert.equal(roundAccount.entrantCount, 0);
  assert.equal(await provider.connection.getBalance(poolVault), vaultBefore);

  await closeSettledRoundAccounts({
    program,
    provider,
    authority,
    treasury,
    config,
    keeperConfig,
    pool,
    round,
  });

  assert.equal(ORAO_VRF_PROGRAM_ID.toBase58(), "VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
}

async function testEligibleProviderRequestGuard({
  program,
  provider,
  authority,
  config,
  keeperConfig,
  pool,
  poolVault,
}) {
  const player = Keypair.generate();
  await fund(provider, player.publicKey);
  const reveal = Buffer.from("high-provider-request-reveal-000", "utf8");
  const round = deriveRound(pool, 1);
  const entry = deriveEntry(round, player.publicKey);
  const roundRandomness = deriveRoundRandomnessAccount(round);

  await program.methods
    .openRound([...commitmentForReveal(reveal)])
    .accounts({
      keeper: authority.publicKey,
      config,
      keeperConfig,
      pool,
      previousRound: deriveRound(pool, 0),
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await buyTickets({
    program,
    player,
    config,
    pool,
    round,
    entry,
    poolVault,
    ticketCount: 3,
  });

  const roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.totalTickets.toString(), "3");
  assert.equal(roundAccount.entrantCount, 1);
  await waitForClock(provider, Number(roundAccount.endTs), "eligible High ORAO gate");

  await program.methods
    .requestRandomness()
    .accounts({
      keeper: authority.publicKey,
      config,
      keeperConfig,
      pool,
      round,
      roundRandomness,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  await expectFailure(
    () =>
      program.methods
        .requestRandomness()
        .accounts({
          keeper: authority.publicKey,
          config,
          keeperConfig,
          pool,
          round,
          roundRandomness,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "at most one LuckyMe randomness sidecar can be created",
  );

  const sidecar = await program.account.roundRandomness.fetch(roundRandomness);
  const seed = Buffer.from(sidecar.randomnessSeed);
  assert.equal(sidecar.round.toBase58(), round.toBase58());
  assert.deepEqual(sidecar.provider, { oraoVrf: {} });
  assert.deepEqual(sidecar.status, { requested: {} });
  assert.equal(
    sidecar.request.toBase58(),
    deriveOraoRandomnessAccount(seed).toBase58(),
  );
}

async function closeSettledRoundAccounts({
  program,
  provider,
  authority,
  treasury,
  config,
  keeperConfig,
  pool,
  round,
  entries = [],
  closeRandomness = false,
}) {
  await waitForNextConfirmedSlot(provider);
  for (const entry of entries) {
    const info = await provider.connection.getAccountInfo(entry.address, "confirmed");
    if (!info) {
      continue;
    }
    const playerBefore = await provider.connection.getBalance(entry.player, "confirmed");
    await program.methods
      .closeSettledEntry()
      .accounts({
        keeper: authority.publicKey,
        config,
        keeperConfig,
        player: entry.player,
        round,
        entry: entry.address,
      })
      .rpc();
    await waitForAccountClosed(provider, entry.address, "settled Entry cleanup");
    const playerAfter = await provider.connection.getBalance(entry.player, "confirmed");
    assert.equal(playerAfter - playerBefore, info.lamports);
  }

  const roundRandomness = deriveRoundRandomnessAccount(round);
  const randomnessInfo = await provider.connection.getAccountInfo(roundRandomness, "confirmed");
  if (closeRandomness) {
    assert.ok(randomnessInfo, "round randomness sidecar exists before cleanup");
    const treasuryBefore = await provider.connection.getBalance(treasury, "confirmed");
    const signature = await program.methods
      .closeSettledRandomness()
      .accounts({
        keeper: authority.publicKey,
        config,
        keeperConfig,
        round,
        roundRandomness,
        treasury,
      })
      .rpc();
    await waitForAccountClosed(provider, roundRandomness, "RoundRandomness cleanup");
    const transaction = await provider.connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    assert.ok(transaction?.meta, "RoundRandomness cleanup transaction is available");
    const treasuryAfter = await provider.connection.getBalance(treasury, "confirmed");
    const keeperDelta = transactionLamportDelta(transaction, authority.publicKey);
    assert.ok(
      Math.abs(keeperDelta + transaction.meta.fee - randomnessInfo.lamports) <= 16,
      "keeper receives the RoundRandomness rent, allowing local-validator lamport dust",
    );
    assert.equal(treasuryAfter, treasuryBefore);
  } else {
    assert.equal(randomnessInfo, null, "no sidecar may remain before Round closure");
  }

  const roundInfo = await provider.connection.getAccountInfo(round, "confirmed");
  assert.ok(roundInfo, "round account exists before cleanup");
  const treasuryBefore = await provider.connection.getBalance(treasury, "confirmed");
  const signature = await program.methods
    .closeSettledRound()
    .accounts({
      keeper: authority.publicKey,
      config,
      keeperConfig,
      pool,
      round,
      roundRandomness,
      treasury,
    })
    .rpc();
  await waitForAccountClosed(provider, round, "Round cleanup");
  const transaction = await provider.connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  assert.ok(transaction?.meta, "Round cleanup transaction is available");
  const treasuryAfter = await provider.connection.getBalance(treasury, "confirmed");
  const keeperDelta = transactionLamportDelta(transaction, authority.publicKey);
  assert.ok(
    Math.abs(keeperDelta + transaction.meta.fee - roundInfo.lamports) <= 16,
    "keeper receives the Round rent, allowing local-validator lamport dust",
  );
  assert.equal(treasuryAfter, treasuryBefore);
}

function transactionLamportDelta(transaction, address) {
  const message = transaction.transaction.message;
  const accountKeys = message.staticAccountKeys ?? message.accountKeys;
  const index = accountKeys.findIndex((key) => key.equals(address));
  assert.ok(index >= 0, `transaction contains ${address.toBase58()}`);
  return transaction.meta.postBalances[index] - transaction.meta.preBalances[index];
}

async function buyTickets({ program, player, config, pool, round, entry, poolVault, ticketCount }) {
  const reviewedRound = await program.account.round.fetch(round);
  await program.methods
    .buyTickets(new BN(ticketCount), new BN(reviewedRound.totalTickets.toString()))
    .accounts({
      player: player.publicKey,
      config,
      pool,
      round,
      entry,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .signers([player])
    .rpc();
}

async function fund(provider, publicKey) {
  const signature = await provider.connection.requestAirdrop(publicKey, 2 * LAMPORTS_PER_SOL);
  const latest = await provider.connection.getLatestBlockhash();
  await provider.connection.confirmTransaction({ signature, ...latest }, "confirmed");
}

async function waitForClock(provider, targetUnixTs, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 30_000) {
    const clock = await readClock(provider);
    if (clock.unixTimestamp >= BigInt(targetUnixTs)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const clock = await readClock(provider);
  throw new Error(
    `Timed out waiting for ${label}: clock=${clock.unixTimestamp.toString()} target=${targetUnixTs}`,
  );
}

async function waitForAccountClosed(provider, address, label) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (!(await provider.connection.getAccountInfo(address, "confirmed"))) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Timed out waiting for ${label}: ${address.toBase58()}`);
}

async function waitForNextConfirmedSlot(provider) {
  const initial = await provider.connection.getSlot("confirmed");
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (await provider.connection.getSlot("confirmed") > initial) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Timed out waiting for the next confirmed localnet slot");
}

async function readClock(provider) {
  const account = await provider.connection.getAccountInfo(CLOCK_SYSVAR, "confirmed");
  return {
    slot: account.data.readBigUInt64LE(0),
    unixTimestamp: account.data.readBigInt64LE(32),
  };
}

async function expectAnchorError(fn, code) {
  try {
    await fn();
  } catch (error) {
    const actual = error?.error?.errorCode?.code ?? error?.errorCode?.code;
    if (actual === code || String(error).includes(code)) {
      return;
    }
    throw error;
  }
  throw new Error(`Expected Anchor error ${code}`);
}

async function expectFailure(fn, label) {
  try {
    await fn();
  } catch {
    return;
  }
  throw new Error(`Expected failure: ${label}`);
}

function commitmentForReveal(reveal) {
  assert.equal(reveal.length, 32);
  return crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(reveal)
    .digest();
}

function deriveRoundRandomness(round, totalTickets, reveal) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-round-randomness"))
    .update(round.toBuffer())
    .update(u64Le(totalTickets))
    .update(reveal)
    .digest();
}

function u64Le(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

function findEntryByTicket(entries, ticket) {
  const entry = entries.find((item) =>
    ticket >= item.ticketStart && ticket < item.ticketEndExclusive,
  );
  assert.ok(entry, `entry for ticket ${ticket.toString()} exists`);
  return entry;
}

function otherEntry(entries, selected) {
  const other = entries.find(
    (entry) => entry.address.toBase58() !== selected.address.toBase58(),
  );
  assert.ok(other, "other entry exists");
  return other;
}

function remainingWinnerAccounts(winnerEntries) {
  return [
    { pubkey: winnerEntries[1].player, isWritable: true, isSigner: false },
    { pubkey: winnerEntries[1].address, isWritable: false, isSigner: false },
    { pubkey: winnerEntries[2].player, isWritable: true, isSigner: false },
    { pubkey: winnerEntries[2].address, isWritable: false, isSigner: false },
  ];
}

function readIdl() {
  const path = fs.existsSync("target/idl/luckyme.json")
    ? "target/idl/luckyme.json"
    : "idl/luckyme.json";
  const idl = JSON.parse(fs.readFileSync(path, "utf8"));
  assert.equal(idl.address, PROGRAM_ID.toBase58());
  return idl;
}
