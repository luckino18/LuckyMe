import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  PROGRAM_ID,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveKeeperConfig,
} from "./anchor-client.mjs";

const require = createRequire(import.meta.url);
const SolanaLedger = require("@ledgerhq/hw-app-solana").default;
const TransportNodeHid = require("@ledgerhq/hw-transport-node-hid").default;

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const EXPECTED_PROGRAM_ID = new PublicKey("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");
const EXPECTED_CONFIG = new PublicKey("Cvx2ffKnwanpUZGsDBKyo2uwoo6gjucQmrRZpiYVyKh");
const EXPECTED_KEEPER_CONFIG = new PublicKey("8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y");
const EXPECTED_AUTHORITY = new PublicKey("AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds");
const KEEPER = new PublicKey("6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N");
const LEDGER_PATH = "44'/501'/0'";
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "https://api.mainnet-beta.solana.com";
const DRY_RUN = process.env.DRY_RUN !== "false";

if (!DRY_RUN) {
  requireWriteApprovals();
}
if (!PROGRAM_ID.equals(EXPECTED_PROGRAM_ID)) {
  throw new Error(`Program ID ${PROGRAM_ID.toBase58()} does not match approved ${EXPECTED_PROGRAM_ID.toBase58()}`);
}
if (!PublicKey.isOnCurve(KEEPER.toBytes())) {
  throw new Error(`Keeper ${KEEPER.toBase58()} is not an on-curve signer wallet`);
}

const { connection, program, url } = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await connection.getGenesisHash();
if (genesisHash !== MAINNET_GENESIS_HASH) {
  throw new Error(`Ledger KeeperConfig workflow requires exact mainnet genesis ${MAINNET_GENESIS_HASH}`);
}

const config = deriveConfig();
const keeperConfig = deriveKeeperConfig(config);
if (!config.equals(EXPECTED_CONFIG) || !keeperConfig.equals(EXPECTED_KEEPER_CONFIG)) {
  throw new Error("Derived Config or KeeperConfig PDA does not match the approved mainnet plan");
}

const configAccount = await program.account.config.fetch(config);
if (!configAccount.authority.equals(EXPECTED_AUTHORITY)) {
  throw new Error(
    `Config authority ${configAccount.authority.toBase58()} does not match approved Ledger ${EXPECTED_AUTHORITY.toBase58()}`,
  );
}

const exists = await accountExists(connection, keeperConfig);
if (exists) {
  const current = await program.account.keeperConfig.fetch(keeperConfig);
  if (!current.config.equals(config)) {
    throw new Error("Existing KeeperConfig points to an unexpected Config account");
  }
  if (!current.keeper.equals(KEEPER)) {
    throw new Error(
      `KeeperConfig rotation is not authorized by Stage 1; existing keeper is ${current.keeper.toBase58()}`,
    );
  }
  console.log(JSON.stringify({
    event: "keeper_configuration_ledger_plan",
    cluster: redactRpcUrl(url),
    genesisHash,
    mainnet: true,
    programId: PROGRAM_ID.toBase58(),
    config: config.toBase58(),
    authority: EXPECTED_AUTHORITY.toBase58(),
    feePayer: EXPECTED_AUTHORITY.toBase58(),
    ledgerPath: LEDGER_PATH,
    keeperConfig: keeperConfig.toBase58(),
    keeper: KEEPER.toBase58(),
    action: "keeper_already_configured",
    dryRun: DRY_RUN,
  }, null, 2));
  process.exit(0);
}

const rentLamports = await connection.getMinimumBalanceForRentExemption(
  program.account.keeperConfig.size,
  "confirmed",
);
const instruction = await program.methods.initializeKeeperConfig(KEEPER).accounts({
  authority: EXPECTED_AUTHORITY,
  config,
  keeperConfig,
  systemProgram: SystemProgram.programId,
}).instruction();
const latestBlockhash = await connection.getLatestBlockhash("confirmed");
const transaction = new Transaction({
  feePayer: EXPECTED_AUTHORITY,
  blockhash: latestBlockhash.blockhash,
  lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
}).add(instruction);
const feeResponse = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
const estimatedFeeLamports = feeResponse?.value ?? feeResponse ?? null;
if (!Number.isInteger(estimatedFeeLamports) || estimatedFeeLamports <= 0) {
  throw new Error(`Could not estimate KeeperConfig transaction fee: ${estimatedFeeLamports}`);
}

const approvedPlan = {
  genesisHash,
  programId: PROGRAM_ID.toBase58(),
  config: config.toBase58(),
  authority: EXPECTED_AUTHORITY.toBase58(),
  feePayer: EXPECTED_AUTHORITY.toBase58(),
  keeperConfig: keeperConfig.toBase58(),
  keeper: KEEPER.toBase58(),
  action: "initialize_keeper_config",
  rentLamports,
  estimatedFeeLamports,
  instruction: {
    programId: instruction.programId.toBase58(),
    keys: instruction.keys.map((key) => ({
      pubkey: key.pubkey.toBase58(),
      isSigner: key.isSigner,
      isWritable: key.isWritable,
    })),
    dataBase64: Buffer.from(instruction.data).toString("base64"),
  },
};
const simulation = await connection.simulateTransaction(transaction);
const simulationResult = {
  status: simulation.value.err ? "failed" : "succeeded",
  error: simulation.value.err ?? null,
  unitsConsumed: simulation.value.unitsConsumed ?? null,
  logs: simulation.value.logs ?? [],
};
if (simulation.value.err) {
  console.log(JSON.stringify({
    event: "keeper_configuration_ledger_plan",
    cluster: redactRpcUrl(url),
    mainnet: true,
    ledgerPath: LEDGER_PATH,
    ...approvedPlan,
    planHash: null,
    dryRun: DRY_RUN,
    simulation: simulationResult,
  }, null, 2));
  throw new Error(`KeeperConfig simulation failed: ${JSON.stringify(simulation.value.err)}`);
}

const hashMaterial = { ...approvedPlan, simulationStatus: "succeeded" };
const planHash = createHash("sha256").update(JSON.stringify(hashMaterial)).digest("hex");
const summary = {
  event: "keeper_configuration_ledger_plan",
  cluster: redactRpcUrl(url),
  mainnet: true,
  ledgerPath: LEDGER_PATH,
  ...approvedPlan,
  planHash,
  dryRun: DRY_RUN,
  simulation: simulationResult,
};
console.log(JSON.stringify(summary, null, 2));

if (DRY_RUN) {
  process.exit(0);
}
if (process.env.LUCKYME_APPROVED_KEEPER_CONFIG_PLAN_HASH !== planHash) {
  throw new Error(
    `Refusing write: set LUCKYME_APPROVED_KEEPER_CONFIG_PLAN_HASH=${planHash} from the reviewed dry-run`,
  );
}

await assertStateUnchanged(program, config, keeperConfig);
const authorityBalance = await connection.getBalance(EXPECTED_AUTHORITY, "confirmed");
const requiredLamports = rentLamports + estimatedFeeLamports;
if (authorityBalance < requiredLamports) {
  throw new Error(
    `Authority ${EXPECTED_AUTHORITY.toBase58()} has ${authorityBalance} lamports; ${requiredLamports} required`,
  );
}

let transport;
try {
  transport = await TransportNodeHid.create(30_000, 30_000);
  const ledger = new SolanaLedger(transport);
  const appConfig = await ledger.getAppConfiguration();
  const ledgerAddress = new PublicKey((await ledger.getAddress(LEDGER_PATH)).address);
  if (!ledgerAddress.equals(EXPECTED_AUTHORITY)) {
    throw new Error(
      `Ledger path ${LEDGER_PATH} resolved ${ledgerAddress.toBase58()}, expected ${EXPECTED_AUTHORITY.toBase58()}`,
    );
  }
  if (!appConfig.blindSigningEnabled) {
    throw new Error("Ledger Solana blind signing must be enabled for this Anchor instruction");
  }

  await assertStateUnchanged(program, config, keeperConfig);
  console.log(`Approve on Ledger: initialize KeeperConfig for ${KEEPER.toBase58()}`);
  const { signature } = await ledger.signTransaction(LEDGER_PATH, transaction.serializeMessage());
  transaction.addSignature(EXPECTED_AUTHORITY, signature);
  if (!transaction.verifySignatures()) {
    throw new Error("KeeperConfig transaction signature failed local verification");
  }

  const txid = await connection.sendRawTransaction(transaction.serialize(), {
    maxRetries: 5,
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  const confirmation = await connection.confirmTransaction({
    signature: txid,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, "confirmed");
  if (confirmation.value.err) {
    throw new Error(`KeeperConfig transaction ${txid} failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  const verified = await fetchKeeperConfigWithRetry(program, keeperConfig);
  if (!verified.config.equals(config) || !verified.keeper.equals(KEEPER)) {
    throw new Error(`KeeperConfig verification failed after ${txid}`);
  }
  console.log(JSON.stringify({
    event: "keeper_configuration_ledger_confirmed",
    action: "initialize_keeper_config",
    signature: txid,
    planHash,
    keeperConfig: keeperConfig.toBase58(),
    verifiedKeeper: verified.keeper.toBase58(),
  }, null, 2));
} finally {
  if (transport) {
    await transport.close();
  }
}

async function assertStateUnchanged(programClient, configAddress, keeperConfigAddress) {
  const latestConfig = await programClient.account.config.fetch(configAddress);
  if (!latestConfig.authority.equals(EXPECTED_AUTHORITY)) {
    throw new Error("Config authority changed after the reviewed simulation");
  }
  if (await accountExists(connection, keeperConfigAddress)) {
    throw new Error("KeeperConfig appeared after the reviewed simulation; rebuild the plan before signing");
  }
}

async function fetchKeeperConfigWithRetry(programClient, keeperConfigAddress) {
  let lastError;
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      return await programClient.account.keeperConfig.fetch(keeperConfigAddress);
    } catch (error) {
      lastError = error;
      if (!/Account does not exist or has no data/.test(String(error)) || attempt === 6) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
  throw lastError;
}

function requireWriteApprovals() {
  if (
    process.env.CONFIRM_MAINNET_KEEPER_CONFIG !== "true"
    || process.env.CONFIRM_LEDGER_AUTHORITY !== "true"
  ) {
    throw new Error(
      "Refusing Ledger mainnet KeeperConfig write without CONFIRM_MAINNET_KEEPER_CONFIG=true and CONFIRM_LEDGER_AUTHORITY=true",
    );
  }
}

function redactRpcUrl(value) {
  try {
    const parsed = new URL(value);
    parsed.search = parsed.search ? "?redacted=true" : "";
    return parsed.toString();
  } catch {
    return String(value).replace(/([?&](?:api-key|apikey|token|key)=)[^&]+/gi, "$1<redacted>");
  }
}
