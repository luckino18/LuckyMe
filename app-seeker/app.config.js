const { expo } = require("./app.json");

const MAINNET_PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
const MAINNET_RPC_RE = /^https:\/\/.+/i;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is required for the LuckyMe dApp Store APK build`);
  }
  return value;
}

function validateReleaseEnv() {
  const releaseMode = process.env.EXPO_PUBLIC_LUCKYME_RELEASE_MODE;
  const storeBuild = process.env.EXPO_PUBLIC_LUCKYME_STORE_BUILD;
  const easProfile = process.env.EAS_BUILD_PROFILE;
  const shouldValidate =
    releaseMode === "MAINNET_RELEASE" ||
    storeBuild === "true" ||
    easProfile === "dapp-store";

  if (!shouldValidate) {
    return;
  }

  const apiUrl = requireEnv("EXPO_PUBLIC_LUCKYME_API_URL");
  const walletChain = requireEnv("EXPO_PUBLIC_LUCKYME_WALLET_CHAIN");
  const walletRpcUrl = requireEnv("EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL");
  const solanaCluster = requireEnv("EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER");
  const programId = process.env.EXPO_PUBLIC_LUCKYME_PROGRAM_ID ?? MAINNET_PROGRAM_ID;

  if (!MAINNET_RPC_RE.test(apiUrl)) {
    throw new Error("EXPO_PUBLIC_LUCKYME_API_URL must be a production HTTPS backend URL");
  }

  if (isLoopbackOrLanUrl(apiUrl)) {
    throw new Error("EXPO_PUBLIC_LUCKYME_API_URL cannot point to a loopback or LAN host");
  }

  if (walletChain !== "solana:mainnet") {
    throw new Error("EXPO_PUBLIC_LUCKYME_WALLET_CHAIN must be solana:mainnet");
  }

  if (!MAINNET_RPC_RE.test(walletRpcUrl)) {
    throw new Error("EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL must be an HTTPS mainnet RPC URL");
  }

  if (solanaCluster !== "mainnet-beta") {
    throw new Error("EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER must be mainnet-beta");
  }

  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(programId)) {
    throw new Error("EXPO_PUBLIC_LUCKYME_PROGRAM_ID must be a valid Solana public key");
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

module.exports = ({ config }) => {
  validateReleaseEnv();
  return {
    ...config,
    ...expo,
  };
};
