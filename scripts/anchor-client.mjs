import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const { AnchorProvider, BN, Program, Wallet } = anchor;

export const PROGRAM_ID = new PublicKey("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");
export const ORAO_VRF_PROGRAM_ID = new PublicKey("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");
export const ORAO_RANDOMNESS_ACCOUNT_SEED = Buffer.from("orao-vrf-randomness-request");
export const POOLS = [
  { id: 1, label: "Mini", ticketPriceLamports: new BN(5_000_000) },
  { id: 2, label: "Normal", ticketPriceLamports: new BN(10_000_000) },
  { id: 3, label: "High", ticketPriceLamports: new BN(100_000_000) },
];

class ReadonlyWallet {
  constructor(publicKey = PublicKey.default) {
    this.publicKey = publicKey;
  }

  async signTransaction() {
    throw new Error("Readonly wallet cannot sign transactions");
  }

  async signAllTransactions() {
    throw new Error("Readonly wallet cannot sign transactions");
  }
}

export function createClient({ requireSigner = true, url: overrideUrl } = {}) {
  const url = overrideUrl ?? process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const connection = new Connection(url, "confirmed");
  const payer = requireSigner ? readKeypair() : null;
  const wallet = payer ? new Wallet(payer) : new ReadonlyWallet();
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(new URL("../idl/luckyme.json", import.meta.url), "utf8"));
  const program = new Program(idl, provider);
  return { connection, payer, program, provider, url };
}

export function readKeypair() {
  const walletPath = expandHome(process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
}

export function deriveConfig() {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID)[0];
}

export function derivePool(config, poolId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool"), config.toBuffer(), Buffer.from([poolId])],
    PROGRAM_ID,
  )[0];
}

export function derivePoolVault(pool) {
  return PublicKey.findProgramAddressSync([Buffer.from("vault"), pool.toBuffer()], PROGRAM_ID)[0];
}

export function deriveJackpotVault(pool) {
  return PublicKey.findProgramAddressSync([Buffer.from("jackpot"), pool.toBuffer()], PROGRAM_ID)[0];
}

export function deriveRound(pool, roundId) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("round"), pool.toBuffer(), u64Le(roundId)],
    PROGRAM_ID,
  )[0];
}

export function deriveEntry(round, player) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("entry"), round.toBuffer(), player.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveRoundRandomnessAccount(round) {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("round_randomness"), round.toBuffer()],
    PROGRAM_ID,
  )[0];
}

export function deriveOraoRandomnessSeed(
  round,
  pool,
  roundId,
  totalTickets,
  entrantCount,
  requestSlot,
) {
  if (
    totalTickets === undefined ||
    entrantCount === undefined ||
    requestSlot === undefined
  ) {
    throw new Error(
      "deriveOraoRandomnessSeed requires totalTickets, entrantCount, and requestSlot",
    );
  }

  return createHash("sha256")
    .update(Buffer.from("luckyme-orao-vrf-seed"))
    .update(round.toBuffer())
    .update(pool.toBuffer())
    .update(u64Le(roundId))
    .update(u64Le(totalTickets))
    .update(u32Le(entrantCount))
    .update(u64Le(requestSlot))
    .digest();
}

export function deriveOraoRandomnessAccount(seed, programId = ORAO_VRF_PROGRAM_ID) {
  return PublicKey.findProgramAddressSync(
    [ORAO_RANDOMNESS_ACCOUNT_SEED, Buffer.from(seed)],
    programId,
  )[0];
}

export function deriveProviderRoundRandomness(round, totalTickets, providerRandomness) {
  return createHash("sha256")
    .update(Buffer.from("luckyme-provider-round-randomness"))
    .update(round.toBuffer())
    .update(u64Le(totalTickets))
    .update(Buffer.from(providerRandomness))
    .digest();
}

export function randomnessHash(providerRandomness) {
  return createHash("sha256")
    .update(Buffer.from("luckyme-provider-randomness-hash"))
    .update(Buffer.from(providerRandomness))
    .digest();
}

export function parseOraoRandomnessV2(data) {
  const buffer = Buffer.from(data);
  const discriminator = anchorAccountDiscriminator("account:RandomnessV2");

  if (buffer.length < 9 || !buffer.subarray(0, 8).equals(discriminator)) {
    return {
      status: "invalid",
      error: "invalid_randomness_v2_discriminator",
    };
  }

  const variant = buffer[8];
  if (variant === 0) {
    if (buffer.length < 73) {
      return {
        status: "invalid",
        error: "invalid_pending_randomness_v2_length",
      };
    }
    return {
      status: "pending",
      client: new PublicKey(buffer.subarray(9, 41)),
      seed: buffer.subarray(41, 73),
    };
  }

  if (variant === 1) {
    if (buffer.length < 137) {
      return {
        status: "invalid",
        error: "invalid_fulfilled_randomness_v2_length",
      };
    }
    return {
      status: "fulfilled",
      client: new PublicKey(buffer.subarray(9, 41)),
      seed: buffer.subarray(41, 73),
      randomness: buffer.subarray(73, 137),
      randomnessHash: randomnessHash(buffer.subarray(73, 137)),
    };
  }

  return {
    status: "invalid",
    error: `unknown_randomness_v2_variant_${variant}`,
  };
}

export function anchorAccountDiscriminator(name) {
  return createHash("sha256").update(Buffer.from(name)).digest().subarray(0, 8);
}

export async function accountExists(connection, address) {
  return (await connection.getAccountInfo(address, "confirmed")) !== null;
}

export function u64Le(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function u32Le(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(Number(value));
  return buffer;
}

export function expandHome(value) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export { BN, PublicKey, SystemProgram };
