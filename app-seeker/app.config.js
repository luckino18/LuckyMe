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
  const shouldValidate =
    releaseMode === "MAINNET_RELEASE" ||
    storeBuild === "true";

  if (!shouldValidate) {
    return;
  }

  const apiUrl = requireEnv("EXPO_PUBLIC_LUCKYME_API_URL");
  const walletChain = requireEnv("EXPO_PUBLIC_LUCKYME_WALLET_CHAIN");
  const walletRpcUrl = requireEnv("EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL");
  const solanaCluster = requireEnv("EXPO_PUBLIC_LUCKYME_SOLANA_CLUSTER");
  const termsUrl = requireEnv("EXPO_PUBLIC_LUCKYME_TERMS_URL");
  const privacyUrl = requireEnv("EXPO_PUBLIC_LUCKYME_PRIVACY_URL");
  const supportUrl = requireEnv("EXPO_PUBLIC_LUCKYME_SUPPORT_URL");
  // EAS file secrets are materialized only in the remote build environment.
  // The local profile evaluation must therefore be able to resolve the app
  // config before GOOGLE_SERVICES_JSON becomes available.
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

  for (const [name, value] of [
    ["EXPO_PUBLIC_LUCKYME_TERMS_URL", termsUrl],
    ["EXPO_PUBLIC_LUCKYME_PRIVACY_URL", privacyUrl],
    ["EXPO_PUBLIC_LUCKYME_SUPPORT_URL", supportUrl],
  ]) {
    if (!MAINNET_RPC_RE.test(value)) {
      throw new Error(`${name} must be an HTTPS URL`);
    }

    if (isPlaceholderUrl(value)) {
      throw new Error(`${name} must be a final production URL`);
    }
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
    const exampleHost = ["example", "com"].join(".");
    return hostname === exampleHost ||
      hostname.endsWith(".example") ||
      hostname.includes("your-domain");
  } catch {
    return true;
  }
}

module.exports = ({ config }) => {
  validateReleaseEnv();
  const referralTestBuild = process.env.LUCKYME_REFERRAL_TEST_BUILD === "true";
  const seekerPassTestBuild = process.env.LUCKYME_SEEKER_PASS_TEST_BUILD === "true";
  const uiTestBuild = process.env.LUCKYME_UI_TEST_BUILD === "true";
  if ([referralTestBuild, seekerPassTestBuild, uiTestBuild].filter(Boolean).length > 1) {
    throw new Error("Only one isolated LuckyMe test build can be enabled at a time");
  }
  const basePlugins = Array.isArray(expo.plugins) ? expo.plugins : [];
  const referralPlugins = basePlugins.includes("expo-secure-store")
    ? [...basePlugins]
    : [...basePlugins, "expo-secure-store"];

  if (referralTestBuild || seekerPassTestBuild || uiTestBuild) {
    referralPlugins.push("./plugins/with-seeker-referral-test-android");
  }

  return {
    ...config,
    ...expo,
    ...(referralTestBuild
      ? {
          name: "LuckyMe Seeker Referral Test",
          slug: "luckyme-seeker-referral-test",
          version: "1.1.7-referral-test.5",
          scheme: "luckyme-seeker-referral-test",
          plugins: referralPlugins,
        }
      : seekerPassTestBuild
        ? {
            name: "LuckyMe Seeker Pass Test",
            slug: "luckyme-seeker-pass-test",
            version: "1.0.0-seeker-pass-test.1",
            scheme: "luckyme-seeker-pass-test",
            plugins: referralPlugins,
          }
        : uiTestBuild
          ? {
              name: "LuckyMe Full UI Test",
              slug: "luckyme-full-ui-test",
              version: "1.2.1-ui-test.7",
              scheme: "luckyme-ui-test",
              plugins: referralPlugins,
            }
          : { plugins: referralPlugins }),
    android: {
      ...expo.android,
      ...(referralTestBuild
        ? {
            package: "app.luckyme.seekerreferraltest",
            versionCode: 5,
            permissions: ["android.permission.POST_NOTIFICATIONS"],
            blockedPermissions: [
              "android.permission.SYSTEM_ALERT_WINDOW",
              "android.permission.READ_EXTERNAL_STORAGE",
              "android.permission.WRITE_EXTERNAL_STORAGE",
            ],
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: false,
                category: ["BROWSABLE", "DEFAULT"],
                data: [
                  {
                    scheme: "https",
                    host: "www.lucky-me.app",
                    pathPrefix: "/referral-test",
                  },
                ],
              },
            ],
          }
        : seekerPassTestBuild
          ? {
              package: "app.luckyme.seekerpasstest",
              versionCode: 2,
              permissions: [],
              blockedPermissions: [
                "android.permission.SYSTEM_ALERT_WINDOW",
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.WRITE_EXTERNAL_STORAGE",
              ],
              intentFilters: [],
            }
        : uiTestBuild
          ? {
              package: "app.luckyme.uitest",
              versionCode: 7,
              permissions: ["android.permission.POST_NOTIFICATIONS"],
              blockedPermissions: [
                "android.permission.SYSTEM_ALERT_WINDOW",
                "android.permission.READ_EXTERNAL_STORAGE",
                "android.permission.WRITE_EXTERNAL_STORAGE",
              ],
              intentFilters: [],
            }
          : {
            intentFilters: [
              {
                action: "VIEW",
                autoVerify: false,
                category: ["BROWSABLE", "DEFAULT"],
                data: [
                  {
                    scheme: "https",
                    host: "www.lucky-me.app",
                    pathPrefix: "/referral",
                  },
                ],
              },
            ],
          }),
      ...(process.env.GOOGLE_SERVICES_JSON
        ? { googleServicesFile: process.env.GOOGLE_SERVICES_JSON }
        : {}),
    },
    extra: {
      ...expo.extra,
      referralTestBuild,
      seekerPassTestBuild,
      uiTestBuild,
      referralTestMode: referralTestBuild && process.env.EXPO_PUBLIC_LUCKYME_REFERRAL_TEST_MODE === "true",
      referralApiUrl: process.env.EXPO_PUBLIC_LUCKYME_REFERRAL_API_URL ?? "https://api.lucky-me.app",
      referralWalletChain: process.env.EXPO_PUBLIC_LUCKYME_WALLET_CHAIN ?? "solana:mainnet",
      referralWalletRpcUrl: process.env.EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL ?? "https://api.mainnet-beta.solana.com",
      storeBuild: process.env.EXPO_PUBLIC_LUCKYME_STORE_BUILD === "true",
      appAnalyticsEnabled: process.env.EXPO_PUBLIC_LUCKYME_APP_ANALYTICS_ENABLED === "true",
      seekerPassPromotionEnabled: seekerPassTestBuild || uiTestBuild || process.env.EXPO_PUBLIC_LUCKYME_SEEKER_PASS_PROMOTION_ENABLED === "true",
    },
  };
};
