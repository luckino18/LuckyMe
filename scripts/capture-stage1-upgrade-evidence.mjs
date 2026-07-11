import fs from "node:fs";
import path from "node:path";
import { Connection, PublicKey } from "@solana/web3.js";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const PROGRAM = new PublicKey("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");
const PROGRAM_DATA = new PublicKey("2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh");
const BUFFER = new PublicKey("9qCNwcWU2HRhJKbNHLKDF7RBLib1HTQ9iuA5cdi9Hf5E");
const FEE_PAYER = new PublicKey("9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc");
const AUTHORITY = new PublicKey("AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds");
const SET_AUTHORITY_SIGNATURE =
  "3F8v7yQqrP2agRRQmLLVsda4eJWnKhn2BgqEUWNaBWSEiWua3sirfqyKTKte78BkXsA5YTuVXKgxSuvSuic95CKo";
const UPGRADE_SIGNATURE =
  "2zAaW1ZabqRXCNFk6k1Aiw7Poy9JAGVQdMj98WyNEz9DpVhiRoGwtpCvmPDnsUbV6S5wDLCqEmye7597UeSgyzeQ";
const ARTIFACT_SHA256 = "f6dfc51b8799b4368d0a7be7f517b3f4a91e28a75788d664c57c2d0670d1277f";
const ARTIFACT_SIZE = 350_352;
const BUFFER_RENT_LAMPORTS = 2_439_654_000;
const RPC_URL = process.env.ANCHOR_PROVIDER_URL;
const REPORT_PATH = path.resolve(
  process.env.LUCKYME_STAGE1_UPGRADE_REPORT_PATH
    ?? "docs/mainnet-stage1-upgrade-evidence-2026-07-11.json",
);

if (!RPC_URL) {
  throw new Error("ANCHOR_PROVIDER_URL is required");
}

const connection = new Connection(RPC_URL, "confirmed");
const genesisHash = await connection.getGenesisHash();
if (genesisHash !== MAINNET_GENESIS_HASH) {
  throw new Error(`Expected mainnet genesis, received ${genesisHash}`);
}

const history = await connection.getSignaturesForAddress(BUFFER, { limit: 1000 }, "confirmed");
const setAuthorityRecord = history.find((record) => record.signature === SET_AUTHORITY_SIGNATURE);
const upgradeRecord = history.find((record) => record.signature === UPGRADE_SIGNATURE);
if (!setAuthorityRecord || !upgradeRecord) {
  throw new Error("Buffer history is missing the authority-transfer or upgrade transaction");
}

const uploadRecords = history
  .filter((record) => ![SET_AUTHORITY_SIGNATURE, UPGRADE_SIGNATURE].includes(record.signature))
  .sort((left, right) => left.slot - right.slot || left.signature.localeCompare(right.signature));
if (uploadRecords.length !== 348 || uploadRecords.some((record) => record.err !== null)) {
  throw new Error(`Expected 348 successful upload transactions, found ${uploadRecords.length}`);
}

const uploadTransactions = uploadRecords.map((record) => ({
  signature: record.signature,
  slot: record.slot,
  blockTime: record.blockTime,
  confirmationStatus: record.confirmationStatus,
  error: record.err,
}));

const [setAuthorityTransaction, upgradeTransaction, programAccount, programDataAccount, bufferAccount] =
  await Promise.all([
    connection.getTransaction(SET_AUTHORITY_SIGNATURE, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    }),
    connection.getTransaction(UPGRADE_SIGNATURE, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    }),
    connection.getAccountInfo(PROGRAM, "confirmed"),
    connection.getAccountInfo(PROGRAM_DATA, "confirmed"),
    connection.getAccountInfo(BUFFER, "confirmed"),
  ]);
if (!setAuthorityTransaction || setAuthorityTransaction.meta?.err) {
  throw new Error("Buffer-authority transaction is missing or failed");
}
if (!upgradeTransaction || upgradeTransaction.meta?.err) {
  throw new Error("Upgrade transaction is missing or failed");
}
if (!programAccount?.executable || !programDataAccount) {
  throw new Error("Program or ProgramData account is missing after upgrade");
}
if (bufferAccount && bufferAccount.lamports !== 0) {
  throw new Error(`Buffer still contains ${bufferAccount.lamports} lamports`);
}

const uploadFeeLamports = 1_745_000;

const report = {
  generatedAt: new Date().toISOString(),
  readOnly: true,
  genesisHash,
  programId: PROGRAM.toBase58(),
  programData: PROGRAM_DATA.toBase58(),
  authority: AUTHORITY.toBase58(),
  feePayer: FEE_PAYER.toBase58(),
  artifact: {
    size: ARTIFACT_SIZE,
    sha256: ARTIFACT_SHA256,
  },
  buffer: {
    address: BUFFER.toBase58(),
    rentLamports: BUFFER_RENT_LAMPORTS,
    postUpgradeLamports: bufferAccount?.lamports ?? 0,
  },
  upload: {
    transactionCount: uploadTransactions.length,
    failedTransactionCount: 0,
    feeLamports: uploadFeeLamports,
    feeEvidence:
      "Exact fee derived from fee-payer starting balance minus buffer rent minus post-upload balance; create used two signatures and 347 writes used one unique signer each.",
    transactions: uploadTransactions,
  },
  setBufferAuthority: transactionEvidence(SET_AUTHORITY_SIGNATURE, setAuthorityTransaction),
  upgrade: transactionEvidence(UPGRADE_SIGNATURE, upgradeTransaction),
  totals: {
    nonRefundableFeeLamports:
      uploadFeeLamports
      + setAuthorityTransaction.meta.fee
      + upgradeTransaction.meta.fee,
    bufferRentReturnedLamports: BUFFER_RENT_LAMPORTS,
  },
  captureTimeState: {
    programExecutable: programAccount.executable,
    programDataAccountDataLength: programDataAccount.data.length,
    programDataCapacity: programDataAccount.data.length - 45,
    bufferEffectivelyClosed: !bufferAccount || bufferAccount.lamports === 0,
    feePayerBalanceLamports: await connection.getBalance(FEE_PAYER, "confirmed"),
    authorityBalanceLamports: await connection.getBalance(AUTHORITY, "confirmed"),
  },
};

fs.writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o644 });
console.log(JSON.stringify({
  event: "stage1_upgrade_evidence_captured",
  reportPath: REPORT_PATH,
  uploadTransactionCount: report.upload.transactionCount,
  nonRefundableFeeLamports: report.totals.nonRefundableFeeLamports,
  bufferRentReturnedLamports: report.totals.bufferRentReturnedLamports,
}, null, 2));

function transactionEvidence(signature, transaction) {
  return {
    signature,
    slot: transaction.slot,
    blockTime: transaction.blockTime,
    feeLamports: transaction.meta.fee,
    error: transaction.meta.err,
    allSignatures: transaction.transaction.signatures,
    accountKeys: (
      transaction.transaction.message.staticAccountKeys
      ?? transaction.transaction.message.accountKeys
    ).map((key) => key.toBase58()),
  };
}
