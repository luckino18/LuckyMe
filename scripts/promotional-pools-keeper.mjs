import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, Transaction } from "@solana/web3.js";
import {
  buildPromotionSettlementTransaction,
  buildRequestRandomnessInstruction,
  createPromotionChainAdapter,
  versionedTransactionForSimulation,
} from "../backend/src/promotional-pools-chain.mjs";
import { createPromotionalPoolsService } from "../backend/src/promotional-pools-service.mjs";

function loadKeypair(path) {
  const values = JSON.parse(readFileSync(path, "utf8"));
  return values.length === 32
    ? Keypair.fromSeed(Uint8Array.from(values))
    : Keypair.fromSecretKey(Uint8Array.from(values));
}

async function sendConfirmed(connection, transaction) {
  const simulation = await connection.simulateTransaction(versionedTransactionForSimulation(transaction), {
    commitment: "confirmed",
    sigVerify: true,
  });
  if (simulation.value.err) {
    throw Object.assign(new Error("Promotion keeper simulation failed"), {
      code: "simulation_failed",
      logs: simulation.value.logs?.slice(-20) ?? [],
    });
  }
  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
    maxRetries: 3,
  });
  const confirmation = await connection.confirmTransaction(signature, "confirmed");
  if (confirmation.value.err) throw Object.assign(new Error("Promotion keeper transaction failed"), { signature });
  return signature;
}

export async function runPromotionalPoolsKeeper({
  connection,
  service,
  authorizer,
  writeEnabled = false,
  maxActions = 4,
} = {}) {
  const actions = [];
  for (const registered of service.list()) {
    if (actions.length >= maxActions) break;
    let promotion;
    try {
      promotion = await service.sync(registered.id);
    } catch (error) {
      actions.push({ promotionId: registered.id, action: "sync_failed", error: error.code ?? error.message });
      continue;
    }
    if (promotion.status === "locked") {
      if (!writeEnabled) {
        actions.push({ promotionId: promotion.id, action: "request_randomness_preview" });
        continue;
      }
      const latest = await connection.getLatestBlockhash("confirmed");
      const transaction = new Transaction({
        feePayer: authorizer.publicKey,
        recentBlockhash: latest.blockhash,
      }).add(buildRequestRandomnessInstruction({
        payer: authorizer.publicKey,
        authorizer: authorizer.publicKey,
        promotion: promotion.promotionAddress,
      }));
      transaction.sign(authorizer);
      const signature = await sendConfirmed(connection, transaction);
      service.recordRandomnessRequested(promotion.id, { signature });
      actions.push({ promotionId: promotion.id, action: "randomness_requested", signature });
      continue;
    }
    if (promotion.status !== "winner_ready") continue;
    const winnerEntry = service.confirmedEntryAtIndex(promotion.id, promotion.winnerIndex);
    if (!winnerEntry) {
      actions.push({ promotionId: promotion.id, action: "winner_entry_missing", winnerIndex: promotion.winnerIndex });
      continue;
    }
    if (!writeEnabled) {
      actions.push({
        promotionId: promotion.id,
        action: "settlement_preview",
        winner: winnerEntry.wallet,
        prizeAsset: promotion.prizeAsset,
        prizeAmountBaseUnits: promotion.prizeAmountBaseUnits,
      });
      continue;
    }
    const latest = await connection.getLatestBlockhash("confirmed");
    const transaction = buildPromotionSettlementTransaction({
      promotion,
      winner: winnerEntry.wallet,
      winnerEntry: winnerEntry.entryAddress,
      recentBlockhash: latest.blockhash,
      authorizerSigner: authorizer,
    });
    const signature = await sendConfirmed(connection, transaction);
    service.recordSettlement(promotion.id, {
      signature,
      winnerAddress: winnerEntry.wallet,
    });
    actions.push({ promotionId: promotion.id, action: "paid", signature, winner: winnerEntry.wallet });
  }
  return { writeEnabled, actions };
}

export async function main() {
  const keypairPath = process.env.LUCKYME_PROMOTIONS_AUTHORIZER_KEYPAIR;
  if (!keypairPath) throw new Error("LUCKYME_PROMOTIONS_AUTHORIZER_KEYPAIR is required");
  const authorizer = loadKeypair(keypairPath);
  const connection = new Connection(
    process.env.LUCKYME_PROMOTIONS_RPC_URL ?? "https://api.mainnet-beta.solana.com",
    "confirmed",
  );
  const service = createPromotionalPoolsService({
    dbPath: process.env.LUCKYME_PROMOTIONS_DB_PATH ?? "/var/lib/luckyme-promotions/promotional-pools.sqlite",
    chain: createPromotionChainAdapter({ connection }),
  });
  try {
    const result = await runPromotionalPoolsKeeper({
      connection,
      service,
      authorizer,
      writeEnabled: process.env.CONFIRM_MAINNET_PROMOTIONS_KEEPER === "true",
      maxActions: Number(process.env.LUCKYME_PROMOTIONS_KEEPER_MAX_ACTIONS ?? 4),
    });
    console.log(JSON.stringify({ event: "luckyme_promotions_keeper", ...result }));
  } finally {
    service.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    console.error(JSON.stringify({
      event: "luckyme_promotions_keeper_failed",
      code: error.code ?? "keeper_failed",
      message: error.message,
      logs: error.logs,
    }));
    process.exitCode = 1;
  });
}
