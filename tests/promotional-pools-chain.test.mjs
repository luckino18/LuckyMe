import assert from "node:assert/strict";
import test from "node:test";
import { Keypair, Transaction } from "@solana/web3.js";
import {
  buildLaunchTransaction,
  buildPromotionEntryTransaction,
  buildPromotionSettlementTransaction,
  derivePromotionAddresses,
  derivePromotionEntryAddress,
  serializePreparedTransaction,
  verifySignedPreparedTransaction,
} from "../backend/src/promotional-pools-chain.mjs";
import { OFFICIAL_SKR_MINT } from "../backend/src/promotional-pools-service.mjs";

const hash = "12".repeat(32);
const blockhash = Keypair.generate().publicKey.toBase58();

function promotion(asset = "SKR") {
  const sponsor = Keypair.generate();
  const authorizer = Keypair.generate();
  const numericId = "123";
  const addresses = derivePromotionAddresses({ numericId, prizeAsset: asset });
  return {
    sponsor,
    authorizer,
    value: {
      numericId,
      rulesHash: hash,
      capacity: 20,
      prizeAsset: asset,
      prizeAmountBaseUnits: asset === "SKR" ? "500000000" : "10000000",
      expiresAtUnix: 253_402_300_799,
      sponsor: sponsor.publicKey.toBase58(),
      authorizer: authorizer.publicKey.toBase58(),
      promotionAddress: addresses.promotion,
      vaultAddress: addresses.vault,
      prizeConfigAddress: addresses.prizeConfig,
    },
  };
}

test("SKR launch reserves the exact prize in a promotion-owned token vault", () => {
  const item = promotion("SKR");
  const transaction = buildLaunchTransaction({
    promotion: item.value,
    recentBlockhash: blockhash,
    authorizerSigner: item.authorizer,
  });
  assert.equal(transaction.feePayer.toBase58(), item.sponsor.publicKey.toBase58());
  assert.equal(transaction.instructions.length, 1);
  const instruction = transaction.instructions[0];
  assert.equal(instruction.keys.length, 11);
  assert.equal(instruction.keys[0].isSigner, true);
  assert.equal(instruction.keys[1].pubkey.toBase58(), item.authorizer.publicKey.toBase58());
  assert.equal(instruction.keys[1].isSigner, true);
  assert.equal(instruction.keys[6].pubkey.toBase58(), OFFICIAL_SKR_MINT);
  assert.equal(instruction.data[8], 6);
  assert.equal(instruction.data.readBigUInt64LE(13 + 40).toString(), "500000000");
  assert.ok(transaction.signatures[1].signature, "authorizer partially signs before wallet review");
});

test("SOL and SKR promotions derive different vault types", () => {
  const skr = derivePromotionAddresses({ numericId: "5", prizeAsset: "SKR" });
  const sol = derivePromotionAddresses({ numericId: "5", prizeAsset: "SOL" });
  assert.equal(skr.promotion, sol.promotion);
  assert.notEqual(skr.vault, sol.vault);
  assert.ok(skr.prizeConfig);
  assert.equal(sol.prizeConfig, null);
});

test("wallet signature may complete but may not modify a prepared launch", () => {
  const item = promotion("SKR");
  const prepared = buildLaunchTransaction({
    promotion: item.value,
    recentBlockhash: blockhash,
    authorizerSigner: item.authorizer,
  });
  const serialized = serializePreparedTransaction(prepared);
  const signed = Transaction.from(Buffer.from(serialized.transactionBase64, "base64"));
  signed.partialSign(item.sponsor);
  assert.equal(
    verifySignedPreparedTransaction({
      preparedBase64: serialized.transactionBase64,
      signedBase64: signed.serialize().toString("base64"),
    }).feePayer.toBase58(),
    item.sponsor.publicKey.toBase58(),
  );

  const changed = Transaction.from(Buffer.from(serialized.transactionBase64, "base64"));
  changed.instructions[0].data[13 + 48] = 21;
  changed.partialSign(item.sponsor, item.authorizer);
  assert.throws(
    () => verifySignedPreparedTransaction({
      preparedBase64: serialized.transactionBase64,
      signedBase64: changed.serialize().toString("base64"),
    }),
    (error) => error.code === "transaction_changed",
  );
});

test("entry preparation charges the player rent and is pre-authorized once", () => {
  const item = promotion("SKR");
  const player = Keypair.generate();
  const prepared = buildPromotionEntryTransaction({
    promotion: item.value,
    player: player.publicKey,
    recentBlockhash: blockhash,
    authorizerSigner: item.authorizer,
  });
  assert.equal(prepared.transaction.feePayer.toBase58(), player.publicKey.toBase58());
  assert.equal(
    prepared.entryAddress,
    derivePromotionEntryAddress({
      promotion: item.value.promotionAddress,
      player: player.publicKey,
    }),
  );
  assert.equal(prepared.transaction.instructions[0].data[8], 1);
  assert.ok(prepared.transaction.signatures.find(({ publicKey }) =>
    publicKey.equals(item.authorizer.publicKey))?.signature);
  assert.equal(prepared.transaction.signatures.find(({ publicKey }) =>
    publicKey.equals(player.publicKey))?.signature, null);
});

test("keeper settlement sends the exact SKR vault prize to the winner ATA", () => {
  const item = promotion("SKR");
  const winner = Keypair.generate().publicKey;
  const winnerEntry = derivePromotionEntryAddress({
    promotion: item.value.promotionAddress,
    player: winner,
  });
  const transaction = buildPromotionSettlementTransaction({
    promotion: item.value,
    winner,
    winnerEntry,
    recentBlockhash: blockhash,
    authorizerSigner: item.authorizer,
  });
  const instruction = transaction.instructions[0];
  assert.equal(transaction.feePayer.toBase58(), item.authorizer.publicKey.toBase58());
  assert.equal(instruction.data[8], 7);
  assert.equal(instruction.keys[8].pubkey.toBase58(), winnerEntry);
  assert.equal(instruction.keys[9].pubkey.toBase58(), winner.toBase58());
  assert.ok(transaction.verifySignatures(true));
});
