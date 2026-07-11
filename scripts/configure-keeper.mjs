import { PublicKey, Transaction } from "@solana/web3.js";
import {
  PROGRAM_ID,
  SystemProgram,
  accountExists,
  createClient,
  deriveConfig,
  deriveKeeperConfig,
} from "./anchor-client.mjs";

const MAINNET_GENESIS_HASH = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const ACTIVE_KEEPER = "6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N";
const RPC_URL = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
const DRY_RUN = process.env.DRY_RUN !== "false";
const keeper = new PublicKey(process.env.LUCKYME_KEEPER_PUBKEY ?? ACTIVE_KEEPER);

if (!PublicKey.isOnCurve(keeper.toBytes())) {
  throw new Error(`Keeper ${keeper.toBase58()} is not an on-curve wallet address`);
}
if (!DRY_RUN && looksLikeMainnetUrl(RPC_URL)) {
  throw new Error("Mainnet KeeperConfig writes are Ledger-only; use npm run keeper:configure");
}

const readonly = createClient({ requireSigner: false, url: RPC_URL });
const genesisHash = await readonly.connection.getGenesisHash();
const mainnet = genesisHash === MAINNET_GENESIS_HASH;
if (!DRY_RUN && mainnet) {
  throw new Error("Mainnet KeeperConfig writes are Ledger-only; use npm run keeper:configure");
}

const client = DRY_RUN ? readonly : createClient({ requireSigner: true, url: RPC_URL });
const { connection, payer, program, url } = client;
const config = deriveConfig();
const keeperConfig = deriveKeeperConfig(config);
const configAccount = await program.account.config.fetch(config);
const exists = await accountExists(connection, keeperConfig);
const current = exists ? await program.account.keeperConfig.fetch(keeperConfig) : null;
const action = !exists
  ? "initialize_keeper_config"
  : current.keeper.equals(keeper)
    ? "keeper_already_configured"
    : "set_keeper";
const rentLamports = exists
  ? 0
  : await connection.getMinimumBalanceForRentExemption(program.account.keeperConfig.size, "confirmed");

const summary = {
  event: "keeper_configuration_plan",
  cluster: redactRpcUrl(url),
  genesisHash,
  mainnet,
  programId: PROGRAM_ID.toBase58(),
  config: config.toBase58(),
  authority: configAccount.authority.toBase58(),
  keeperConfig: keeperConfig.toBase58(),
  previousKeeper: current?.keeper.toBase58() ?? null,
  keeper: keeper.toBase58(),
  action,
  rentLamports,
  feePayer: configAccount.authority.toBase58(),
  dryRun: DRY_RUN,
};
if (action !== "keeper_already_configured") {
  const authority = configAccount.authority;
  const planningMethod = action === "initialize_keeper_config"
    ? program.methods.initializeKeeperConfig(keeper).accounts({
        authority,
        config,
        keeperConfig,
        systemProgram: SystemProgram.programId,
      })
    : program.methods.setKeeper(keeper).accounts({
        authority,
        config,
        keeperConfig,
      });
  const instruction = await planningMethod.instruction();
  const latestBlockhash = await connection.getLatestBlockhash("confirmed");
  const transaction = new Transaction({
    feePayer: authority,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);
  const feeResponse = await connection.getFeeForMessage(transaction.compileMessage(), "confirmed");
  summary.estimatedFeeLamports = feeResponse?.value ?? feeResponse ?? null;
  if (DRY_RUN) {
    try {
      const simulation = await connection.simulateTransaction(transaction);
      summary.simulation = {
        status: simulation.value.err ? "failed" : "succeeded",
        error: simulation.value.err ?? null,
        unitsConsumed: simulation.value.unitsConsumed ?? null,
        logs: simulation.value.logs ?? [],
      };
    } catch (error) {
      summary.simulation = {
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        unitsConsumed: null,
        logs: [],
      };
    }
  }
}

console.log(JSON.stringify(summary, null, 2));

if (DRY_RUN || action === "keeper_already_configured") {
  process.exit(0);
}
if (!payer.publicKey.equals(configAccount.authority)) {
  throw new Error(
    `Signer ${payer.publicKey.toBase58()} is not Config authority ${configAccount.authority.toBase58()}`,
  );
}

const method = action === "initialize_keeper_config"
  ? program.methods.initializeKeeperConfig(keeper).accounts({
      authority: payer.publicKey,
      config,
      keeperConfig,
      systemProgram: SystemProgram.programId,
    })
  : program.methods.setKeeper(keeper).accounts({
      authority: payer.publicKey,
      config,
      keeperConfig,
    });
const simulation = await method.simulate();
summary.simulation = {
  ok: true,
  logCount: Array.isArray(simulation?.raw) ? simulation.raw.length : null,
};
const signature = await method.rpc();
const verified = await program.account.keeperConfig.fetch(keeperConfig);
if (!verified.keeper.equals(keeper)) {
  throw new Error(`KeeperConfig verification failed after ${signature}`);
}
console.log(JSON.stringify({ ...summary, signature, verifiedKeeper: verified.keeper.toBase58() }, null, 2));

function looksLikeMainnetUrl(value) {
  return /mainnet|api\.mainnet-beta\.solana\.com|helius-rpc/i.test(value);
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
