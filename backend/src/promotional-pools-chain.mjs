import { createHash } from "node:crypto";
import {
  PublicKey,
  SYSVAR_SLOT_HASHES_PUBKEY,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  OFFICIAL_SKR_DECIMALS,
  OFFICIAL_SKR_MINT,
  PromotionalPoolError,
} from "./promotional-pools-service.mjs";

export const LUCKYME_PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
export const MAGICBLOCK_VRF_PROGRAM_ID = "Vrf1RNUjXmQGjmQrQLvJHs9SNkvDJEsRVFPkfSQUwGz";
export const MAGICBLOCK_DEFAULT_QUEUE = "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh";

const PROMOTION_MAGIC = Buffer.from("LMPRM001");
const ENTRY_MAGIC = Buffer.from("LMPEN001");
const PROMOTION_LEN = 248;
const ENTRY_LEN = 80;
const STATUS = Object.freeze({
  2: "open",
  3: "locked",
  4: "randomness_pending",
  5: "winner_ready",
  6: "paid",
  7: "cancelled",
});

function fail(status, code, message) {
  throw new PromotionalPoolError(status, code, message);
}

function publicKey(value, label) {
  try {
    return new PublicKey(String(value));
  } catch {
    fail(400, "invalid_address", `${label} is not a valid Solana address`);
  }
}

function u64(value, label) {
  try {
    const result = BigInt(value);
    if (result < 0n || result > 0xffff_ffff_ffff_ffffn) throw new Error();
    return result;
  } catch {
    fail(400, "invalid_promotion", `${label} is outside the u64 range`);
  }
}

function anchorDiscriminator(name) {
  return createHash("sha256").update(`global:${name}`).digest().subarray(0, 8);
}

function promotionDispatchData(operation, payload = Buffer.alloc(0)) {
  const body = Buffer.from(payload);
  const data = Buffer.alloc(8 + 1 + 4 + body.length);
  anchorDiscriminator("promotion_dispatch").copy(data, 0);
  data[8] = operation;
  data.writeUInt32LE(body.length, 9);
  body.copy(data, 13);
  return data;
}

function launchPayload(promotion) {
  const payload = Buffer.alloc(60);
  payload.writeBigUInt64LE(u64(promotion.numericId, "numericId"), 0);
  Buffer.from(promotion.rulesHash, "hex").copy(payload, 8);
  payload.writeBigUInt64LE(u64(promotion.prizeAmountBaseUnits, "prize amount"), 40);
  payload.writeUInt32LE(Number(promotion.capacity), 48);
  payload.writeBigInt64LE(BigInt(promotion.expiresAtUnix), 52);
  return payload;
}

export function derivePromotionAddresses({
  numericId,
  prizeAsset,
  programId = LUCKYME_PROGRAM_ID,
  skrMint = OFFICIAL_SKR_MINT,
}) {
  const program = publicKey(programId, "program ID");
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program)[0];
  const id = Buffer.alloc(8);
  id.writeBigUInt64LE(u64(numericId, "numericId"));
  const promotion = PublicKey.findProgramAddressSync(
    [Buffer.from("promotion"), config.toBuffer(), id],
    program,
  )[0];
  if (String(prizeAsset).toUpperCase() === "SKR") {
    const mint = publicKey(skrMint, "SKR mint");
    return {
      config: config.toBase58(),
      promotion: promotion.toBase58(),
      vault: getAssociatedTokenAddressSync(
        mint,
        promotion,
        true,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ).toBase58(),
      prizeConfig: PublicKey.findProgramAddressSync(
        [Buffer.from("promotion_prize"), promotion.toBuffer()],
        program,
      )[0].toBase58(),
    };
  }
  return {
    config: config.toBase58(),
    promotion: promotion.toBase58(),
    vault: PublicKey.findProgramAddressSync(
      [Buffer.from("promotion_vault"), promotion.toBuffer()],
      program,
    )[0].toBase58(),
    prizeConfig: null,
  };
}

export function buildLaunchTransaction({
  promotion,
  recentBlockhash,
  programId = LUCKYME_PROGRAM_ID,
  skrMint = OFFICIAL_SKR_MINT,
  authorizerSigner,
}) {
  const program = publicKey(programId, "program ID");
  const sponsor = publicKey(promotion.sponsor, "sponsor");
  const authorizer = publicKey(promotion.authorizer, "authorizer");
  const config = publicKey(derivePromotionAddresses({
    numericId: promotion.numericId,
    prizeAsset: promotion.prizeAsset,
    programId,
    skrMint,
  }).config, "config");
  const target = publicKey(promotion.promotionAddress, "promotion");
  const auxiliary = publicKey(
    promotion.prizeAsset === "SKR" ? promotion.prizeConfigAddress : promotion.vaultAddress,
    "auxiliary",
  );
  const keys = [
    { pubkey: sponsor, isSigner: true, isWritable: true },
    { pubkey: authorizer, isSigner: true, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: target, isSigner: false, isWritable: true },
    { pubkey: auxiliary, isSigner: false, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  let operation = 0;
  if (promotion.prizeAsset === "SKR") {
    operation = 6;
    const mint = publicKey(skrMint, "SKR mint");
    const sponsorToken = getAssociatedTokenAddressSync(
      mint,
      sponsor,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    keys.push(
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: sponsorToken, isSigner: false, isWritable: true },
      { pubkey: publicKey(promotion.vaultAddress, "vault"), isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    );
  }
  const transaction = new Transaction({
    feePayer: sponsor,
    recentBlockhash: String(recentBlockhash),
  }).add(new TransactionInstruction({
    programId: program,
    keys,
    data: promotionDispatchData(operation, launchPayload(promotion)),
  }));
  if (authorizerSigner) {
    if (!authorizerSigner.publicKey.equals(authorizer)) {
      fail(500, "authorizer_mismatch", "Configured authorizer signer does not match the promotion");
    }
    transaction.partialSign(authorizerSigner);
  }
  return transaction;
}

export function serializePreparedTransaction(transaction) {
  const message = transaction.serializeMessage();
  return {
    transactionBase64: transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    }).toString("base64"),
    messageHash: createHash("sha256").update(message).digest("hex"),
    requiredSigners: transaction.signatures.map(({ publicKey: signer }) => signer.toBase58()),
    recentBlockhash: transaction.recentBlockhash,
    feePayer: transaction.feePayer?.toBase58() ?? null,
  };
}

export function verifySignedPreparedTransaction({ preparedBase64, signedBase64 }) {
  let prepared;
  let signed;
  try {
    prepared = Transaction.from(Buffer.from(preparedBase64, "base64"));
    signed = Transaction.from(Buffer.from(signedBase64, "base64"));
  } catch {
    fail(400, "invalid_transaction", "Prepared or signed transaction could not be decoded");
  }
  if (!prepared.serializeMessage().equals(signed.serializeMessage())) {
    fail(409, "transaction_changed", "The wallet changed the reviewed transaction message");
  }
  if (!signed.verifySignatures(true)) {
    fail(409, "invalid_signatures", "The transaction is missing a required valid signature");
  }
  return signed;
}

export function versionedTransactionForSimulation(transaction) {
  const versioned = new VersionedTransaction(transaction.compileMessage());
  versioned.signatures = transaction.signatures.map(({ signature }) =>
    signature ? Uint8Array.from(signature) : new Uint8Array(64));
  return versioned;
}

export function derivePromotionEntryAddress({
  promotion,
  player,
  programId = LUCKYME_PROGRAM_ID,
}) {
  return PublicKey.findProgramAddressSync([
    Buffer.from("promotion_entry"),
    publicKey(promotion, "promotion").toBuffer(),
    publicKey(player, "player").toBuffer(),
  ], publicKey(programId, "program ID"))[0].toBase58();
}

export function buildPromotionEntryTransaction({
  promotion,
  player,
  recentBlockhash,
  authorizerSigner,
  programId = LUCKYME_PROGRAM_ID,
}) {
  const program = publicKey(programId, "program ID");
  const playerKey = publicKey(player, "player");
  const authorizer = publicKey(promotion.authorizer, "authorizer");
  const promotionKey = publicKey(promotion.promotionAddress, "promotion");
  const entry = publicKey(derivePromotionEntryAddress({
    promotion: promotion.promotionAddress,
    player,
    programId,
  }), "entry");
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program)[0];
  const transaction = new Transaction({
    feePayer: playerKey,
    recentBlockhash: String(recentBlockhash),
  }).add(new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: playerKey, isSigner: true, isWritable: true },
      { pubkey: authorizer, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: promotionKey, isSigner: false, isWritable: true },
      { pubkey: entry, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: promotionDispatchData(1),
  }));
  if (authorizerSigner) {
    if (!authorizerSigner.publicKey.equals(authorizer)) {
      fail(500, "authorizer_mismatch", "Configured authorizer signer does not match the promotion");
    }
    transaction.partialSign(authorizerSigner);
  }
  return { transaction, entryAddress: entry.toBase58() };
}

export function buildPromotionSettlementTransaction({
  promotion,
  winner,
  winnerEntry,
  recentBlockhash,
  authorizerSigner,
  programId = LUCKYME_PROGRAM_ID,
  skrMint = OFFICIAL_SKR_MINT,
}) {
  if (!authorizerSigner) fail(500, "authorizer_required", "Promotion authorizer signer is required");
  const program = publicKey(programId, "program ID");
  const authorizer = publicKey(promotion.authorizer, "authorizer");
  if (!authorizerSigner.publicKey.equals(authorizer)) {
    fail(500, "authorizer_mismatch", "Configured authorizer signer does not match the promotion");
  }
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program)[0];
  const target = publicKey(promotion.promotionAddress, "promotion");
  const winnerKey = publicKey(winner, "winner");
  const keys = [
    { pubkey: authorizer, isSigner: true, isWritable: true },
    { pubkey: authorizer, isSigner: true, isWritable: false },
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: target, isSigner: false, isWritable: true },
    {
      pubkey: publicKey(
        promotion.prizeAsset === "SKR" ? promotion.prizeConfigAddress : promotion.vaultAddress,
        "auxiliary",
      ),
      isSigner: false,
      isWritable: true,
    },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  let operation = 2;
  if (promotion.prizeAsset === "SKR") {
    operation = 7;
    const mint = publicKey(skrMint, "SKR mint");
    keys.push(
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: publicKey(promotion.vaultAddress, "vault"), isSigner: false, isWritable: true },
      { pubkey: publicKey(winnerEntry, "winner entry"), isSigner: false, isWritable: false },
      { pubkey: winnerKey, isSigner: false, isWritable: true },
      {
        pubkey: getAssociatedTokenAddressSync(
          mint,
          winnerKey,
          false,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        ),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    );
  } else {
    keys.push(
      { pubkey: publicKey(winnerEntry, "winner entry"), isSigner: false, isWritable: false },
      { pubkey: winnerKey, isSigner: false, isWritable: true },
    );
  }
  const transaction = new Transaction({
    feePayer: authorizer,
    recentBlockhash: String(recentBlockhash),
  }).add(new TransactionInstruction({
    programId: program,
    keys,
    data: promotionDispatchData(operation),
  }));
  transaction.sign(authorizerSigner);
  return transaction;
}

function parsePromotionAccount(info, expectedProgram, expectedAddress) {
  if (!info || !info.owner.equals(expectedProgram) || info.data.length !== PROMOTION_LEN ||
      !info.data.subarray(0, 8).equals(PROMOTION_MAGIC)) {
    fail(503, "promotion_account_invalid", "Promotion account is missing or has an invalid layout");
  }
  const data = info.data;
  const status = STATUS[data[9]];
  if (!status) fail(503, "promotion_state_invalid", "Promotion status is invalid");
  const promotionId = data.readBigUInt64LE(44);
  const config = new PublicKey(data.subarray(12, 44));
  const derived = PublicKey.findProgramAddressSync(
    [Buffer.from("promotion"), config.toBuffer(), data.subarray(44, 52)],
    expectedProgram,
  )[0];
  if (!derived.equals(expectedAddress)) fail(503, "promotion_pda_invalid", "Promotion PDA is invalid");
  const winner = new PublicKey(data.subarray(168, 200));
  return {
    status,
    promotionId: promotionId.toString(),
    rulesHash: data.subarray(52, 84).toString("hex"),
    prizeAmountBaseUnits: data.readBigUInt64LE(84).toString(),
    capacity: data.readUInt32LE(92),
    entryCount: data.readUInt32LE(96),
    authorizer: new PublicKey(data.subarray(100, 132)).toBase58(),
    winnerIndex: ["winner_ready", "paid"].includes(status) ? data.readUInt32LE(164) : null,
    winnerAddress: status === "paid" ? winner.toBase58() : null,
    outstandingEntries: data.readUInt32LE(200),
    expiresAtUnix: Number(data.readBigInt64LE(204)),
    sponsor: new PublicKey(data.subarray(212, 244)).toBase58(),
    prizeAsset: data[244] === 1 ? "SKR" : "SOL",
  };
}

function tokenAmount(info, mint, owner) {
  if (!info) return 0n;
  if (!info.owner.equals(TOKEN_PROGRAM_ID) || info.data.length !== 165) {
    fail(503, "token_account_invalid", "SKR token account has an invalid owner or layout");
  }
  if (!new PublicKey(info.data.subarray(0, 32)).equals(mint) ||
      !new PublicKey(info.data.subarray(32, 64)).equals(owner)) {
    fail(503, "token_account_invalid", "SKR token account mint or authority is invalid");
  }
  return info.data.readBigUInt64LE(64);
}

export function createPromotionChainAdapter({
  connection,
  programId = LUCKYME_PROGRAM_ID,
  skrMint = OFFICIAL_SKR_MINT,
  sponsor,
}) {
  if (!connection) fail(500, "rpc_required", "A Solana connection is required");
  const program = publicKey(programId, "program ID");
  const mint = publicKey(skrMint, "SKR mint");
  const sponsorKey = sponsor ? publicKey(sponsor, "sponsor") : null;

  async function readPromotion(promotion) {
    const address = publicKey(promotion.promotionAddress, "promotion");
    const info = await connection.getAccountInfo(address, "confirmed");
    if (!info) return null;
    const state = parsePromotionAccount(info, program, address);
    if (state.rulesHash !== promotion.rulesHash ||
        state.prizeAmountBaseUnits !== promotion.prizeAmountBaseUnits ||
        state.capacity !== promotion.capacity ||
        state.authorizer !== promotion.authorizer ||
        state.sponsor !== promotion.sponsor ||
        state.prizeAsset !== promotion.prizeAsset) {
      fail(503, "promotion_binding_invalid", "On-chain promotion does not match the registered rules");
    }
    return state;
  }

  async function verifyEntry({ promotion, wallet, entryAddress, entryIndex, signature }) {
    const [status, info] = await Promise.all([
      connection.getSignatureStatuses([signature], { searchTransactionHistory: true }),
      connection.getAccountInfo(publicKey(entryAddress, "entry"), "confirmed"),
    ]);
    const confirmation = status?.value?.[0];
    if (!confirmation || confirmation.err ||
        !["confirmed", "finalized"].includes(confirmation.confirmationStatus)) return false;
    if (!info || !info.owner.equals(program) || info.data.length !== ENTRY_LEN ||
        !info.data.subarray(0, 8).equals(ENTRY_MAGIC)) return false;
    return new PublicKey(info.data.subarray(8, 40)).toBase58() === promotion.promotionAddress &&
      new PublicKey(info.data.subarray(40, 72)).toBase58() === wallet &&
      info.data.readUInt32LE(72) === Number(entryIndex);
  }

  async function treasurySummary(promotions) {
    if (!sponsorKey) fail(503, "sponsor_required", "Promotion sponsor is not configured");
    const sponsorToken = getAssociatedTokenAddressSync(
      mint,
      sponsorKey,
      false,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const active = promotions.filter((item) =>
      ["open", "locked", "randomness_pending", "winner_ready"].includes(item.status));
    const skr = active.filter((item) => item.prizeAsset === "SKR");
    const sol = active.filter((item) => item.prizeAsset === "SOL");
    const addresses = [
      sponsorToken,
      ...skr.map((item) => publicKey(item.vaultAddress, "SKR vault")),
      ...sol.map((item) => publicKey(item.vaultAddress, "SOL vault")),
    ];
    const [solAvailable, infos] = await Promise.all([
      connection.getBalance(sponsorKey, "confirmed"),
      connection.getMultipleAccountsInfo(addresses, "confirmed"),
    ]);
    const availableSkr = tokenAmount(infos[0], mint, sponsorKey);
    let reservedSkr = 0n;
    for (let index = 0; index < skr.length; index += 1) {
      reservedSkr += tokenAmount(
        infos[1 + index],
        mint,
        publicKey(skr[index].promotionAddress, "promotion"),
      );
    }
    let reservedSol = 0n;
    for (let index = 0; index < sol.length; index += 1) {
      reservedSol += BigInt(infos[1 + skr.length + index]?.lamports ?? 0);
    }
    return {
      sponsor: sponsorKey.toBase58(),
      assets: {
        SKR: {
          mint: mint.toBase58(),
          decimals: OFFICIAL_SKR_DECIMALS,
          walletTokenAddress: sponsorToken.toBase58(),
          totalBaseUnits: (availableSkr + reservedSkr).toString(),
          availableBaseUnits: availableSkr.toString(),
          reservedBaseUnits: reservedSkr.toString(),
        },
        SOL: {
          decimals: 9,
          totalBaseUnits: (BigInt(solAvailable) + reservedSol).toString(),
          availableBaseUnits: String(solAvailable),
          reservedBaseUnits: reservedSol.toString(),
        },
      },
    };
  }

  return {
    readPromotion,
    verifyEntry,
    treasurySummary,
    derivePromotionAddresses: (input) => derivePromotionAddresses({ ...input, programId, skrMint }),
    buildLaunchTransaction: (input) => buildLaunchTransaction({ ...input, programId, skrMint }),
    buildEntryTransaction: (input) => buildPromotionEntryTransaction({ ...input, programId }),
    buildSettlementTransaction: (input) => buildPromotionSettlementTransaction({ ...input, programId, skrMint }),
  };
}

export function buildRequestRandomnessInstruction({
  payer,
  authorizer,
  promotion,
  programId = LUCKYME_PROGRAM_ID,
}) {
  const program = publicKey(programId, "program ID");
  const config = PublicKey.findProgramAddressSync([Buffer.from("config")], program)[0];
  const identity = PublicKey.findProgramAddressSync([Buffer.from("identity")], program)[0];
  return new TransactionInstruction({
    programId: program,
    keys: [
      { pubkey: publicKey(payer, "payer"), isSigner: true, isWritable: true },
      { pubkey: publicKey(authorizer, "authorizer"), isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: false },
      { pubkey: publicKey(promotion, "promotion"), isSigner: false, isWritable: true },
      { pubkey: identity, isSigner: false, isWritable: false },
      { pubkey: publicKey(MAGICBLOCK_DEFAULT_QUEUE, "MagicBlock queue"), isSigner: false, isWritable: true },
      { pubkey: publicKey(MAGICBLOCK_VRF_PROGRAM_ID, "MagicBlock program"), isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_SLOT_HASHES_PUBKEY, isSigner: false, isWritable: false },
    ],
    data: anchorDiscriminator("request_promotion_randomness"),
  });
}
