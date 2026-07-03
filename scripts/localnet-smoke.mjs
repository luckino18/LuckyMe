import crypto from "node:crypto";
import {
  BN,
  POOLS,
  SystemProgram,
  createClient,
  deriveConfig,
  deriveEntry,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
  deriveRound,
} from "./anchor-client.mjs";
import "./init-pools.mjs";

const { connection, payer, program } = createClient();
const config = deriveConfig();
const poolSpec = POOLS[1];
const pool = derivePool(config, poolSpec.id);
const poolVault = derivePoolVault(pool);
const jackpotVault = deriveJackpotVault(pool);
const poolAccount = await program.account.pool.fetch(pool);
const roundId = poolAccount.currentRound.toNumber() + 1;
const round = deriveRound(pool, roundId);
const entry = deriveEntry(round, payer.publicKey);

const reveal = crypto.randomBytes(32);
const commitment = crypto
  .createHash("sha256")
  .update(Buffer.from("luckyme-commit"))
  .update(reveal)
  .digest();

console.log(`Opening round ${roundId} for ${poolSpec.label}`);
let signature = await program.methods
  .openRound([...commitment])
  .accounts({
    keeper: payer.publicKey,
    config,
    pool,
    round,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`Opened round: ${signature}`);

signature = await program.methods
  .buyTickets(new BN(3))
  .accounts({
    player: payer.publicKey,
    config,
    pool,
    round,
    entry,
    poolVault,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`Bought 3 tickets: ${signature}`);

const roundAccount = await program.account.round.fetch(round);
const waitMs = Math.max(0, roundAccount.endTs.toNumber() * 1000 - Date.now() + 1500);
console.log(`Waiting ${Math.ceil(waitMs / 1000)}s until settlement is allowed`);
await new Promise((resolve) => setTimeout(resolve, waitMs));

signature = await program.methods
  .settleRound([...reveal])
  .accounts({
    keeper: payer.publicKey,
    config,
    pool,
    round,
    poolVault,
    jackpotVault,
    winner: payer.publicKey,
    winnerEntry: entry,
    jackpotWinner: payer.publicKey,
    jackpotEntry: entry,
    treasury: payer.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
console.log(`Settled round: ${signature}`);

const settledRound = await program.account.round.fetch(round);
const updatedPool = await program.account.pool.fetch(pool);
console.log({
  round: round.toBase58(),
  winner: settledRound.winner.toBase58(),
  jackpotTriggered: settledRound.jackpotTriggered,
  jackpotWinner: settledRound.jackpotWinner.toBase58(),
  poolJackpotLamports: updatedPool.jackpotLamports.toString(),
});
