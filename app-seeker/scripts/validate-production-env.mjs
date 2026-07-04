const MAINNET_PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
const REQUIRED = [
  "EXPO_PUBLIC_LUCKYME_API_URL",
  "EXPO_PUBLIC_LUCKYME_WALLET_CHAIN",
  "EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL",
  "EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER",
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(`Missing required production env vars: ${missing.join(", ")}`);
}

const apiUrl = process.env.EXPO_PUBLIC_LUCKYME_API_URL;
const walletChain = process.env.EXPO_PUBLIC_LUCKYME_WALLET_CHAIN;
const walletRpcUrl = process.env.EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL;
const solanaCluster = process.env.EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER;
const programId = process.env.EXPO_PUBLIC_LUCKYME_PROGRAM_ID ?? MAINNET_PROGRAM_ID;

if (!isHttpsUrl(apiUrl)) {
  fail("EXPO_PUBLIC_LUCKYME_API_URL must be a production HTTPS backend URL");
}

if (/localhost|127\.0\.0\.1|192\.168\.|10\./i.test(apiUrl)) {
  fail("EXPO_PUBLIC_LUCKYME_API_URL cannot point to localhost or a LAN host");
}

if (walletChain !== "solana:mainnet") {
  fail("EXPO_PUBLIC_LUCKYME_WALLET_CHAIN must be solana:mainnet");
}

if (!isHttpsUrl(walletRpcUrl)) {
  fail("EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL must be an HTTPS mainnet RPC URL");
}

if (solanaCluster !== "mainnet-beta") {
  fail("EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER must be mainnet-beta");
}

if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId)) {
  fail("EXPO_PUBLIC_LUCKYME_PROGRAM_ID must be a valid Solana public key");
}

console.log("LuckyMe production app env is valid");

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
