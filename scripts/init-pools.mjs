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
import { PublicKey } from "@solana/web3.js";

const { connection, payer, program, url } = createClient();
const config = deriveConfig();
const treasury = resolveTreasury();
const roundDurationSecs = Number(process.env.LUCKYME_ROUND_DURATION_SECS ?? 3_600);

requireMainnetInitPreflight();

console.log(`Cluster: ${url}`);
console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
console.log(`Authority: ${payer.publicKey.toBase58()}`);
console.log(`Treasury: ${treasury.toBase58()}`);
console.log(`Config: ${config.toBase58()}`);
console.log(`Round duration: ${roundDurationSecs}s`);

if (!(await accountExists(connection, config))) {
  const signature = await program.methods
    .initializeConfig(treasury, 200, 300, 288, new BN(roundDurationSecs))
    .accounts({
      authority: payer.publicKey,
      config,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`Initialized config: ${signature}`);
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

  const signature = await program.methods
    .initializePool(poolSpec.id, poolSpec.ticketPriceLamports)
    .accounts({
      authority: payer.publicKey,
      config,
      pool,
      poolVault,
      jackpotVault,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log(`Initialized ${poolSpec.label} pool: ${pool.toBase58()} (${signature})`);
}

function resolveTreasury() {
  const value = process.env.LUCKYME_TREASURY_PUBKEY;

  if (!value) {
    return payer.publicKey;
  }

  try {
    return new PublicKey(value);
  } catch {
    throw new Error("LUCKYME_TREASURY_PUBKEY must be a valid Solana public key");
  }
}

function requireMainnetInitPreflight() {
  if (!isMainnetUrl(url)) {
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

  const expectedAuthority = process.env.LUCKYME_EXPECTED_AUTHORITY_PUBKEY;
  if (!expectedAuthority) {
    throw new Error("Mainnet init requires LUCKYME_EXPECTED_AUTHORITY_PUBKEY");
  }

  assertPublicKey("LUCKYME_EXPECTED_AUTHORITY_PUBKEY", expectedAuthority);
  if (expectedAuthority !== payer.publicKey.toBase58()) {
    throw new Error(
      `Authority mismatch: ANCHOR_WALLET is ${payer.publicKey.toBase58()}, expected ${expectedAuthority}`,
    );
  }

  if (!process.env.LUCKYME_TREASURY_PUBKEY) {
    throw new Error("Mainnet init requires explicit LUCKYME_TREASURY_PUBKEY");
  }

  if (
    treasury.equals(payer.publicKey) &&
    process.env.LUCKYME_ALLOW_TREASURY_EQUALS_AUTHORITY !== "true"
  ) {
    throw new Error(
      "Treasury equals authority. Set LUCKYME_ALLOW_TREASURY_EQUALS_AUTHORITY=true only if this is intentional.",
    );
  }
}

function assertPublicKey(name, value) {
  try {
    new PublicKey(value);
  } catch {
    throw new Error(`${name} must be a valid Solana public key`);
  }
}

function isMainnetUrl(value) {
  return /mainnet|api\.mainnet-beta\.solana\.com/i.test(value);
}
