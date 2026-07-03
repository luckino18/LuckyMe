import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram } from "@solana/web3.js";

const { AnchorProvider, BN, Program, Wallet } = anchor;

export const PROGRAM_ID = new PublicKey("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");
export const POOLS = [
  { id: 1, label: "Mini", ticketPriceLamports: new BN(5_000_000) },
  { id: 2, label: "Normal", ticketPriceLamports: new BN(10_000_000) },
  { id: 3, label: "High", ticketPriceLamports: new BN(100_000_000) },
];

export function createClient() {
  const url = process.env.ANCHOR_PROVIDER_URL ?? "http://127.0.0.1:8899";
  const walletPath = expandHome(process.env.ANCHOR_WALLET ?? "~/.config/solana/id.json");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8"))));
  const connection = new Connection(url, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(payer), {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  const idl = JSON.parse(fs.readFileSync(new URL("../idl/luckyme.json", import.meta.url), "utf8"));
  const program = new Program(idl, provider);
  return { connection, payer, program, provider, url };
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

export async function accountExists(connection, address) {
  return (await connection.getAccountInfo(address, "confirmed")) !== null;
}

export function u64Le(value) {
  const buffer = Buffer.alloc(8);
  buffer.writeBigUInt64LE(BigInt(value));
  return buffer;
}

export function expandHome(value) {
  return value.startsWith("~/") ? path.join(os.homedir(), value.slice(2)) : value;
}

export { BN, PublicKey, SystemProgram };
