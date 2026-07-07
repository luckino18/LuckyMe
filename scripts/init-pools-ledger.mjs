import fs from "node:fs";
import { createRequire } from "node:module";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import {
  BN,
  POOLS,
  PROGRAM_ID,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
} from "./anchor-client.mjs";

const require = createRequire(import.meta.url);
const SolanaLedger = require("@ledgerhq/hw-app-solana").default;
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;

const LEDGER_PATH = process.env.LUCKYME_LEDGER_PATH ?? "44'/501'/0'";
const EXPECTED_AUTHORITY = mustPublicKey(
  "LUCKYME_EXPECTED_AUTHORITY_PUBKEY",
  process.env.LUCKYME_EXPECTED_AUTHORITY_PUBKEY,
);
const TREASURY = mustPublicKey("LUCKYME_TREASURY_PUBKEY", process.env.LUCKYME_TREASURY_PUBKEY);
const FEE_PAYER = readKeypair(
  "LUCKYME_FEE_PAYER_KEYPAIR",
  process.env.LUCKYME_FEE_PAYER_KEYPAIR,
);
const ROUND_DURATION_SECS = Number(process.env.LUCKYME_ROUND_DURATION_SECS ?? 3_600);

const { connection, program, url } = createClient({ requireSigner: false });
const config = deriveConfig();

requireMainnetInitPreflight();

console.log(`Cluster: ${url}`);
console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
console.log(`Authority: ${EXPECTED_AUTHORITY.toBase58()}`);
console.log(`Treasury: ${TREASURY.toBase58()}`);
console.log(`Fee payer: ${FEE_PAYER.publicKey.toBase58()}`);
console.log(`Config: ${config.toBase58()}`);
console.log(`Round duration: ${ROUND_DURATION_SECS}s`);

const transport = await TransportNodeHid.create(30_000, 30_000);
try {
  const ledger = new SolanaLedger(transport);
  const appConfig = await ledger.getAppConfiguration();
  console.log(
    `Ledger Solana app: ${appConfig.version}, blindSigning=${appConfig.blindSigningEnabled}`,
  );

  const ledgerAddress = new PublicKey((await ledger.getAddress(LEDGER_PATH)).address);
  if (!ledgerAddress.equals(EXPECTED_AUTHORITY)) {
    throw new Error(
      `Ledger path ${LEDGER_PATH} resolved ${ledgerAddress.toBase58()}, expected ${EXPECTED_AUTHORITY.toBase58()}`,
    );
  }

  if (!(await accountExists(connection, config))) {
    const instruction = await program.methods
      .initializeConfig(TREASURY, 200, 300, 288, new BN(ROUND_DURATION_SECS))
      .accounts({
        authority: EXPECTED_AUTHORITY,
        config,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    await signAndSend(ledger, "initialize config", instruction);
  } else {
    console.log("Config already exists");
  }

  for (const poolSpec of POOLS) {
    const pool = derivePool(config, poolSpec.id);
    const poolVault = derivePoolVault(pool);
    const jackpotVault = deriveJackpotVault(pool);

    if (await accountExists(connection, pool)) {
      console.log(`${poolSpec.label} pool already exists: ${pool.toBase58()}`);
      continue;
    }

    const instruction = await program.methods
      .initializePool(poolSpec.id, poolSpec.ticketPriceLamports)
      .accounts({
        authority: EXPECTED_AUTHORITY,
        config,
        pool,
        poolVault,
        jackpotVault,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    await signAndSend(ledger, `initialize ${poolSpec.label} pool`, instruction);
  }
} finally {
  await transport.close();
}

async function signAndSend(ledger, label, instruction) {
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({
    feePayer: FEE_PAYER.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  tx.partialSign(FEE_PAYER);
  console.log(`Approve on Ledger: ${label}`);
  const { signature } = await ledger.signTransaction(LEDGER_PATH, tx.serializeMessage());
  tx.addSignature(EXPECTED_AUTHORITY, signature);

  if (!tx.verifySignatures()) {
    throw new Error(`Signature verification failed for ${label}`);
  }

  const txid = await connection.sendRawTransaction(tx.serialize(), {
    maxRetries: 5,
    skipPreflight: false,
  });
  await connection.confirmTransaction(
    {
      signature: txid,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    },
    "confirmed",
  );
  console.log(`${label}: ${txid}`);
}

function readKeypair(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(value, "utf8"))));
}

function mustPublicKey(name, value) {
  if (!value) {
    throw new Error(`${name} is required`);
  }
  try {
    return new PublicKey(value);
  } catch {
    throw new Error(`${name} must be a valid Solana public key`);
  }
}

function requireMainnetInitPreflight() {
  if (!/mainnet|api\.mainnet-beta\.solana\.com/i.test(url)) {
    return;
  }

  if (process.env.CONFIRM_MAINNET_INIT_POOLS !== "true") {
    throw new Error("Refusing mainnet init without CONFIRM_MAINNET_INIT_POOLS=true");
  }

  const expectedProgramId =
    process.env.LUCKYME_EXPECTED_PROGRAM_ID ?? PROGRAM_ID.toBase58();
  if (expectedProgramId !== PROGRAM_ID.toBase58()) {
    throw new Error(
      `LUCKYME_EXPECTED_PROGRAM_ID mismatch: expected ${expectedProgramId}, code uses ${PROGRAM_ID.toBase58()}`,
    );
  }

  if (TREASURY.equals(EXPECTED_AUTHORITY)) {
    throw new Error("Treasury must not equal authority for mainnet init");
  }
}
