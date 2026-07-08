import crypto from "node:crypto";
import { Transaction } from "@solana/web3.js";
import {
  POOLS,
  SystemProgram,
  createClient,
  deriveConfig,
  derivePool,
  deriveRound,
} from "./anchor-client.mjs";

const DRY_RUN = process.env.DRY_RUN === "true";
const POOL_FILTER = process.env.POOL?.toLowerCase();
const POOL_BY_SLUG = new Map(POOLS.map((pool) => [pool.slug, pool]));

if (POOL_FILTER && !POOL_BY_SLUG.has(POOL_FILTER)) {
  throw new Error(`Unknown POOL=${POOL_FILTER}. Use one of: ${[...POOL_BY_SLUG.keys()].join(", ")}`);
}

const { connection, payer, program, url } = createClient();
requireMainnetConfirmation(url);

const config = deriveConfig();
const now = Math.floor(Date.now() / 1000);
const transaction = new Transaction();
const plannedActions = [];
const pools = POOL_FILTER ? [POOL_BY_SLUG.get(POOL_FILTER)] : POOLS;

for (const poolSpec of pools) {
  const pool = derivePool(config, poolSpec.id);
  const poolAccount = await program.account.pool.fetch(pool);
  const currentRound = Number(poolAccount.currentRound.toString());

  if (currentRound <= 0) {
    await addOpenRoundInstruction({ poolSpec, pool, currentRound: 0 });
    continue;
  }

  const round = deriveRound(pool, currentRound);
  const roundAccount = await program.account.round.fetch(round);
  const endTs = Number(roundAccount.endTs.toString());
  const totalTickets = BigInt(roundAccount.totalTickets.toString());
  const totalLamports = BigInt(roundAccount.totalLamports.toString());
  const empty = totalTickets === 0n &&
    totalLamports === 0n &&
    Number(roundAccount.entrantCount) === 0;
  const expired = now >= endTs;

  console.log(
    `${poolSpec.label}: round ${currentRound}, expired=${expired ? "yes" : "no"}, settled=${roundAccount.settled ? "yes" : "no"}, tickets=${totalTickets.toString()}`,
  );

  if (!expired) {
    continue;
  }

  if (!empty) {
    console.log(`${poolSpec.label}: skipped; expired round has entries and needs settlement/refund handling.`);
    continue;
  }

  if (!roundAccount.settled) {
    const closeInstruction = await program.methods
      .closeEmptyRoundAfterTimeout()
      .accounts({
        keeper: payer.publicKey,
        config,
        pool,
        round,
      })
      .instruction();
    transaction.add(closeInstruction);
    plannedActions.push(`close ${poolSpec.slug} round ${currentRound} (${round.toBase58()})`);
  }

  await addOpenRoundInstruction({ poolSpec, pool, currentRound });
}

console.log(`Cluster: ${url}`);
console.log(`Keeper: ${payer.publicKey.toBase58()}`);
console.log(`Planned actions: ${plannedActions.length}`);
for (const action of plannedActions) {
  console.log(`- ${action}`);
}
console.log(`Dry run: ${DRY_RUN ? "yes" : "no"}`);

if (plannedActions.length === 0 || DRY_RUN) {
  process.exit(0);
}

const latestBlockhash = await connection.getLatestBlockhash("confirmed");
transaction.feePayer = payer.publicKey;
transaction.recentBlockhash = latestBlockhash.blockhash;
transaction.sign(payer);

const simulation = await connection.simulateTransaction(transaction);
if (simulation.value.err) {
  console.error(JSON.stringify(simulation.value, null, 2));
  throw new Error("Crank transaction simulation failed");
}

const signature = await connection.sendRawTransaction(transaction.serialize(), {
  skipPreflight: false,
  preflightCommitment: "confirmed",
});
console.log(`Submitted crank transaction: ${signature}`);

const confirmation = await connection.confirmTransaction({
  signature,
  blockhash: latestBlockhash.blockhash,
  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
}, "confirmed");
if (confirmation.value.err) {
  console.error(JSON.stringify(confirmation.value, null, 2));
  throw new Error("Crank transaction confirmation failed");
}
console.log(`Confirmed crank transaction: ${signature}`);

async function addOpenRoundInstruction({ poolSpec, pool, currentRound }) {
  const roundId = currentRound + 1;
  const round = deriveRound(pool, roundId);
  const reveal = crypto.randomBytes(32);
  const commitment = commitmentForReveal(reveal);
  const openInstruction = await program.methods
    .openRound([...commitment])
    .accounts({
      keeper: payer.publicKey,
      config,
      pool,
      round,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  transaction.add(openInstruction);
  plannedActions.push(
    `open ${poolSpec.slug} round ${roundId} (${round.toBase58()}) commitment=${commitment.toString("hex")} reveal=${reveal.toString("hex")}`,
  );
}

function commitmentForReveal(reveal) {
  return crypto
    .createHash("sha256")
    .update(Buffer.from("luckyme-commit"))
    .update(reveal)
    .digest();
}

function requireMainnetConfirmation(providerUrl) {
  if (/mainnet|api\.mainnet-beta\.solana\.com|helius-rpc/i.test(providerUrl) && process.env.CONFIRM_MAINNET !== "true") {
    throw new Error("Refusing mainnet empty-round crank without CONFIRM_MAINNET=true");
  }
}
