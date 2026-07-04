import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import anchor from "@coral-xyz/anchor";
import { Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  BN,
  SystemProgram,
  deriveConfig,
  deriveEntry,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveRound,
} from "../scripts/anchor-client.mjs";

const CLOCK_SYSVAR = new PublicKey("SysvarC1ock11111111111111111111111111111111");
const PROGRAM_ID = new PublicKey("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");
const POOL_ID = 1;
const TICKET_PRICE_LAMPORTS = 5_000_000;
const ROUND_DURATION_SECONDS = 2;
const REFUND_DELAY_SECONDS = 2;

test("localnet buy, settlement, and refund-mode state machine", async () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const idl = readIdl();
  const program = new anchor.Program(idl, provider);
  const authority = provider.wallet.payer;
  const treasury = authority.publicKey;
  const config = deriveConfig();
  const pool = derivePool(config, POOL_ID);
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);

  await program.methods
    .initializeConfig(treasury, 100, 100, 1, new BN(ROUND_DURATION_SECONDS))
    .accounts({
      authority: authority.publicKey,
      config,
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

  await testSettlementFlow({ program, provider, authority, treasury, config, pool, poolVault, jackpotVault });
  await testRefundModeFlow({ program, provider, authority, config, pool, poolVault, jackpotVault });
  await testPauseAndEmptyRoundFlow({ program, provider, authority, treasury, config, pool, poolVault, jackpotVault });
});

async function testSettlementFlow({ program, provider, authority, treasury, config, pool, poolVault, jackpotVault }) {
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
      pool,
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await program.methods
    .buyTickets(new BN(2))
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

  await program.methods
    .buyTickets(new BN(1))
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

  await expectAnchorError(
    () =>
      program.methods
        .buyTickets(new BN(1))
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
        .buyTickets(new BN(1_001))
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
  assert.equal(roundAccount.totalTickets.toString(), "3");
  assert.equal(roundAccount.totalLamports.toString(), String(TICKET_PRICE_LAMPORTS * 3));
  assert.equal(roundAccount.entrantCount, 2);
  assert.equal(await provider.connection.getBalance(poolVault), vaultBefore + TICKET_PRICE_LAMPORTS * 3);

  await waitForClock(provider, Number(roundAccount.endTs), "settlement");

  await expectAnchorError(
    () =>
      program.methods
        .closeEmptyRoundAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          config,
          pool,
          round,
        })
        .rpc(),
    "RoundHasEntries",
  );

  const entries = [
    {
      address: entry,
      player: player.publicKey,
      ticketStart: 0n,
      ticketEndExclusive: 2n,
    },
    {
      address: entryTwo,
      player: playerTwo.publicKey,
      ticketStart: 2n,
      ticketEndExclusive: 3n,
    },
  ];
  const randomness = deriveRoundRandomness(round, 3n, reveal);
  const winnerTicket = randomMod(randomness, 0, 3n);
  const jackpotTicket = randomMod(randomness, 16, 3n);
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
  assert.equal(roundAccount.winner.toBase58(), winnerEntry.player.toBase58());
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
          player: player.publicKey,
          config,
          pool,
          round,
          entry,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RoundSettled",
  );
}

async function testPauseAndEmptyRoundFlow({ program, provider, authority, config, pool, poolVault }) {
  const player = Keypair.generate();
  await fund(provider, player.publicKey);

  const reveal = Buffer.from("pause-round-reveal-0000000000000", "utf8");
  const commitment = commitmentForReveal(reveal);
  const round = deriveRound(pool, 3);
  const entry = deriveEntry(round, player.publicKey);

  await program.methods
    .openRound([...commitment])
    .accounts({
      keeper: authority.publicKey,
      config,
      pool,
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
        .buyTickets(new BN(1))
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
          pool,
          round: deriveRound(pool, 4),
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
          pool,
          round,
        })
        .rpc(),
    "RoundStillOpen",
  );

  await expectAnchorError(
    () =>
      program.methods
        .buyTickets(new BN(0))
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

  const roundAccount = await program.account.round.fetch(round);
  await waitForClock(provider, Number(roundAccount.endTs), "empty round settlement");

  await program.methods
    .closeEmptyRoundAfterTimeout()
    .accounts({
      keeper: authority.publicKey,
      config,
      pool,
      round,
    })
    .rpc();

  const closedRound = await program.account.round.fetch(round);
  assert.equal(closedRound.settled, true);
  assert.equal(closedRound.totalTickets.toString(), "0");
  assert.equal(closedRound.totalLamports.toString(), "0");
  assert.equal(closedRound.entrantCount, 0);
  assert.equal(closedRound.winner.toBase58(), PublicKey.default.toBase58());
  assert.equal(closedRound.jackpotWinner.toBase58(), PublicKey.default.toBase58());
  assert.deepEqual(closedRound.randomness, Array(32).fill(0));

  await expectAnchorError(
    () =>
      program.methods
        .closeEmptyRoundAfterTimeout()
        .accounts({
          keeper: authority.publicKey,
          config,
          pool,
          round,
        })
        .rpc(),
    "RoundSettled",
  );
}

async function testRefundModeFlow({ program, provider, authority, config, pool, poolVault, jackpotVault }) {
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
      pool,
      round,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  await buyTickets({ program, player: playerOne, config, pool, round, entry: entryOne, poolVault, ticketCount: 1 });
  await buyTickets({ program, player: playerTwo, config, pool, round, entry: entryTwo, poolVault, ticketCount: 3 });

  let roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.totalTickets.toString(), "4");
  assert.equal(roundAccount.totalLamports.toString(), String(TICKET_PRICE_LAMPORTS * 4));
  assert.equal(roundAccount.entrantCount, 2);
  assert.equal(await provider.connection.getBalance(poolVault), vaultBefore + TICKET_PRICE_LAMPORTS * 4);

  await waitForClock(
    provider,
    Number(roundAccount.endTs) + REFUND_DELAY_SECONDS,
    "refund timeout",
  );

  await program.methods
    .refundEntryAfterTimeout()
    .accounts({
      player: playerOne.publicKey,
      config,
      pool,
      round,
      entry: entryOne,
      poolVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();

  roundAccount = await program.account.round.fetch(round);
  assert.equal(roundAccount.settled, true);
  assert.equal(roundAccount.winner.toBase58(), PublicKey.default.toBase58());
  assert.equal(roundAccount.jackpotWinner.toBase58(), PublicKey.default.toBase58());
  assert.deepEqual(roundAccount.randomness, Array(32).fill(0));
  assert.equal(roundAccount.totalTickets.toString(), "3");
  assert.equal(roundAccount.totalLamports.toString(), String(TICKET_PRICE_LAMPORTS * 3));
  assert.equal(roundAccount.entrantCount, 1);

  const refundedEntry = await program.account.entry.fetch(entryOne);
  assert.equal(refundedEntry.ticketCount.toString(), "0");
  assert.equal(refundedEntry.lamports.toString(), "0");

  await expectAnchorError(
    () =>
      program.methods
        .settleRound([...reveal])
        .accounts({
          keeper: authority.publicKey,
          config,
          pool,
          round,
          poolVault,
          jackpotVault,
          winner: playerTwo.publicKey,
          winnerEntry: entryTwo,
          jackpotWinner: playerTwo.publicKey,
          jackpotEntry: entryTwo,
          treasury: authority.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "RoundSettled",
  );

  await program.methods
    .refundEntryAfterTimeout()
    .accounts({
      player: playerTwo.publicKey,
      config,
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

  await expectAnchorError(
    () =>
      program.methods
        .refundEntryAfterTimeout()
        .accounts({
          player: playerOne.publicKey,
          config,
          pool,
          round,
          entry: entryOne,
          poolVault,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
    "NothingToRefund",
  );
}

async function buyTickets({ program, player, config, pool, round, entry, poolVault, ticketCount }) {
  await program.methods
    .buyTickets(new BN(ticketCount))
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

function randomMod(randomness, offset, modulo) {
  return randomness.readBigUInt64LE(offset) % modulo;
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

function readIdl() {
  const path = fs.existsSync("target/idl/luckyme.json")
    ? "target/idl/luckyme.json"
    : "idl/luckyme.json";
  const idl = JSON.parse(fs.readFileSync(path, "utf8"));
  assert.equal(idl.address, PROGRAM_ID.toBase58());
  return idl;
}
