const MAINNET_PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
const REQUIRED = [
  "EXPO_PUBLIC_LUCKYME_API_URL",
  "EXPO_PUBLIC_LUCKYME_WALLET_CHAIN",
  "EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL",
  "EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER",
  "EXPO_PUBLIC_LUCKYME_TERMS_URL",
  "EXPO_PUBLIC_LUCKYME_PRIVACY_URL",
  "EXPO_PUBLIC_LUCKYME_SUPPORT_URL",
];

const missing = REQUIRED.filter((name) => !process.env[name]);
if (missing.length > 0) {
  fail(`Missing required production env vars: ${missing.join(", ")}`);
}

const apiUrl = process.env.EXPO_PUBLIC_LUCKYME_API_URL;
const walletChain = process.env.EXPO_PUBLIC_LUCKYME_WALLET_CHAIN;
const walletRpcUrl = process.env.EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL;
const solanaCluster = process.env.EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER;
const termsUrl = process.env.EXPO_PUBLIC_LUCKYME_TERMS_URL;
const privacyUrl = process.env.EXPO_PUBLIC_LUCKYME_PRIVACY_URL;
const supportUrl = process.env.EXPO_PUBLIC_LUCKYME_SUPPORT_URL;
const programId = process.env.EXPO_PUBLIC_LUCKYME_PROGRAM_ID ?? MAINNET_PROGRAM_ID;

if (!isHttpsUrl(apiUrl)) {
  fail("EXPO_PUBLIC_LUCKYME_API_URL must be a production HTTPS backend URL");
}

if (isLoopbackOrLanUrl(apiUrl)) {
  fail("EXPO_PUBLIC_LUCKYME_API_URL cannot point to a loopback or LAN host");
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

for (const [name, value] of [
  ["EXPO_PUBLIC_LUCKYME_TERMS_URL", termsUrl],
  ["EXPO_PUBLIC_LUCKYME_PRIVACY_URL", privacyUrl],
  ["EXPO_PUBLIC_LUCKYME_SUPPORT_URL", supportUrl],
]) {
  if (!isHttpsUrl(value)) {
    fail(`${name} must be an HTTPS URL`);
  }

  if (isPlaceholderUrl(value)) {
    fail(`${name} must be a final production URL`);
  }
}

console.log("LuckyMe production app env is valid");

function isHttpsUrl(value) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isLoopbackOrLanUrl(value) {
  try {
    const { hostname } = new URL(value);
    return hostname === ["local", "host"].join("") ||
      hostname.startsWith("127.") ||
      hostname === "::1" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.");
  } catch {
    return false;
  }
}

function isPlaceholderUrl(value) {
  try {
    const { hostname } = new URL(value);
    return hostname === "example.com" ||
      hostname.endsWith(".example") ||
      hostname.includes("your-domain");
  } catch {
    return true;
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
