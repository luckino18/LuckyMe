import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ORAO_VRF_PROGRAM_ID,
  POOLS,
  PROGRAM_ID,
  deriveConfig,
  deriveJackpotVault,
  derivePool,
  derivePoolVault,
} from "./anchor-client.mjs";

const ROOT = process.cwd();
const PROGRAM_BINARY = path.join(ROOT, "target/deploy/luckyme.so");
const PROGRAM_KEYPAIR = path.join(ROOT, "target/deploy/luckyme-keypair.json");

const requiredWallets = [
  {
    env: "LUCKYME_DEPLOY_AUTHORITY_PUBKEY",
    role: "deploy / upgrade / config authority",
    recommendedSol: "5.00",
  },
  {
    env: "LUCKYME_TREASURY_PUBKEY",
    role: "treasury recipient",
    recommendedSol: "0.05",
  },
  {
    env: "LUCKYME_KEEPER_PUBKEY",
    role: "round keeper / cranker",
    recommendedSol: "0.75",
  },
  {
    env: "LUCKYME_PUBLISHER_PUBKEY",
    role: "Solana Mobile publisher portal",
    recommendedSol: "0.75",
  },
];
const optionalWallets = [
  {
    env: "LUCKYME_SEEKER_TEST_PUBKEY",
    role: "Seeker test player",
    recommendedSol: "0.50",
  },
];

const failures = [];
const warnings = [];
const wallets = new Map();
const config = deriveConfig();
const reservedAddresses = new Map();

console.log("LuckyMe mainnet wallet plan");
console.log(`Program ID: ${PROGRAM_ID.toBase58()}`);
console.log(`Config PDA: ${config.toBase58()}`);
reserveAddress("LuckyMe Program ID", PROGRAM_ID);
reserveAddress("LuckyMe config PDA", config);
reserveAddress("System Program", SystemProgram.programId);
reserveAddress("ORAO VRF Program ID", ORAO_VRF_PROGRAM_ID);

for (const poolSpec of POOLS) {
  const pool = derivePool(config, poolSpec.id);
  const poolVault = derivePoolVault(pool);
  const jackpotVault = deriveJackpotVault(pool);
  console.log(`${poolSpec.label} pool PDA: ${pool.toBase58()}`);
  console.log(`${poolSpec.label} pool vault PDA: ${poolVault.toBase58()}`);
  console.log(`${poolSpec.label} jackpot vault PDA: ${jackpotVault.toBase58()}`);
  reserveAddress(`${poolSpec.label} pool PDA`, pool);
  reserveAddress(`${poolSpec.label} pool vault PDA`, poolVault);
  reserveAddress(`${poolSpec.label} jackpot vault PDA`, jackpotVault);
}

auditProgramKeypair();
auditProgramBinary();
readWalletEnv(requiredWallets, true);
readWalletEnv(optionalWallets, false);
auditDuplicates();
auditReservedWalletAddresses();
printFundingPlan();

if (failures.length > 0) {
  console.error("\nWallet plan failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  printEnvTemplate();
  process.exit(1);
}

if (warnings.length > 0) {
  console.warn("\nWarnings:");
  for (const warning of warnings) {
    console.warn(`- ${warning}`);
  }
}

console.log("\nWallet plan passed. Do not send SOL until these exact addresses are confirmed by Victor.");

function auditProgramKeypair() {
  if (!fs.existsSync(PROGRAM_KEYPAIR)) {
    warnings.push(`Missing ${relative(PROGRAM_KEYPAIR)}; build before final deploy verification.`);
    return;
  }

  let keypair;
  try {
    const secretKey = JSON.parse(fs.readFileSync(PROGRAM_KEYPAIR, "utf8"));
    keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch (error) {
    failures.push(`Cannot read ${relative(PROGRAM_KEYPAIR)}: ${errorMessage(error)}`);
    return;
  }

  const keypairPubkey = keypair.publicKey.toBase58();
  console.log(`Program keypair pubkey: ${keypairPubkey}`);
  if (keypairPubkey !== PROGRAM_ID.toBase58()) {
    failures.push(
      `Program keypair mismatch: ${relative(PROGRAM_KEYPAIR)} is ${keypairPubkey}, but code/docs use ${PROGRAM_ID.toBase58()}`,
    );
  }
}

function auditProgramBinary() {
  if (!fs.existsSync(PROGRAM_BINARY)) {
    warnings.push(`Missing ${relative(PROGRAM_BINARY)}; run NO_DNA=1 anchor build before funding deploy.`);
    return;
  }

  const bytes = fs.statSync(PROGRAM_BINARY).size;
  console.log(`Program binary: ${relative(PROGRAM_BINARY)} (${bytes} bytes)`);
  console.log(`Program rent estimate: ${rentForBytes(bytes)} SOL`);
}

function readWalletEnv(definitions, required) {
  for (const definition of definitions) {
    const value = process.env[definition.env];
    if (!value) {
      if (required) {
        failures.push(`${definition.env} is required for the funding plan`);
      }
      continue;
    }

    try {
      const publicKey = new PublicKey(value);
      if (!PublicKey.isOnCurve(publicKey.toBytes())) {
        failures.push(`${definition.env} is an off-curve address/PDA, not a wallet address`);
      }
      wallets.set(definition.env, {
        ...definition,
        publicKey,
      });
    } catch {
      failures.push(`${definition.env} is not a valid Solana public key`);
    }
  }
}

function auditDuplicates() {
  if (process.env.LUCKYME_ALLOW_SHARED_WALLETS === "true") {
    return;
  }

  const seen = new Map();
  for (const [env, wallet] of wallets) {
    const address = wallet.publicKey.toBase58();
    const previous = seen.get(address);
    if (previous) {
      failures.push(
        `${env} and ${previous} are the same address (${address}); set LUCKYME_ALLOW_SHARED_WALLETS=true only if intentional`,
      );
    } else {
      seen.set(address, env);
    }
  }
}

function auditReservedWalletAddresses() {
  for (const [env, wallet] of wallets) {
    const address = wallet.publicKey.toBase58();
    const reservedLabel = reservedAddresses.get(address);
    if (reservedLabel) {
      failures.push(`${env} is ${reservedLabel} (${address}), not a wallet address`);
    }
  }
}

function printFundingPlan() {
  console.log("\nFunding plan");
  for (const definition of [...requiredWallets, ...optionalWallets]) {
    const wallet = wallets.get(definition.env);
    const address = wallet?.publicKey.toBase58() ?? "<missing>";
    console.log(`${definition.env}: ${address} | ${definition.role} | recommended ${definition.recommendedSol} SOL`);
  }
}

function printEnvTemplate() {
  console.error("\nRequired public-key env template:");
  for (const definition of requiredWallets) {
    console.error(`export ${definition.env}=<${definition.role} public key>`);
  }
  for (const definition of optionalWallets) {
    console.error(`# export ${definition.env}=<${definition.role} public key>`);
  }
}

function rentForBytes(bytes) {
  const result = spawnSync("solana", ["rent", String(bytes)], {
    encoding: "utf8",
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const match = output.match(/Rent-exempt minimum:\s*([0-9.]+)\s+SOL/);
  if (match?.[1]) {
    return match[1];
  }

  // Fallback to the current mainnet rent constants used by the Solana CLI output.
  const lamports = BigInt(bytes) * 6_960n + 890_880n;
  return Number(lamports) / 1_000_000_000;
}

function reserveAddress(label, publicKey) {
  reservedAddresses.set(publicKey.toBase58(), label);
}

function relative(file) {
  return path.relative(ROOT, file);
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
