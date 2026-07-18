#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { canonicalSnapshotHash, discoverSgtHolders } from "./core.mjs";

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

if (process.argv.includes("--help")) {
  console.log(`Usage: node scripts/seeker-cnft-campaign/snapshot-sgt-holders.mjs [options]

Read-only options:
  --rpc-env NAME   Environment variable containing the HTTPS Helius DAS URL
                   (default: SEEKER_SGT_RPC_URL)
  --out PATH       Snapshot output path
                   (default: artifacts/seeker-cnft-campaign/sgt-holders.json)

This command never builds, signs, simulates, or sends a Solana transaction.`);
  process.exit(0);
}

const rpcEnv = option("--rpc-env", "SEEKER_SGT_RPC_URL");
const outPath = resolve(option("--out", "artifacts/seeker-cnft-campaign/sgt-holders.json"));
const rpcUrl = process.env[rpcEnv] ?? process.env.ANCHOR_PROVIDER_URL;
if (!rpcUrl) throw new Error(`${rpcEnv} or ANCHOR_PROVIDER_URL must be configured`);

const discovered = await discoverSgtHolders({ rpcUrl });
const snapshotBody = {
  schemaVersion: 1,
  cluster: "mainnet-beta",
  commitment: "DAS last indexed slot",
  ...discovered,
};
const snapshot = {
  ...snapshotBody,
  snapshotHash: canonicalSnapshotHash(snapshotBody),
  createdAt: new Date().toISOString(),
};
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
console.log(JSON.stringify({
  ok: true,
  outPath,
  lastIndexedSlot: snapshot.lastIndexedSlot,
  validAssets: snapshot.validAssets,
  uniqueWallets: snapshot.uniqueWallets,
  snapshotHash: snapshot.snapshotHash,
}, null, 2));
