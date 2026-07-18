import Constants from "expo-constants";
import * as SecureStore from "expo-secure-store";

const INSTALL_ID_KEY = "luckyme.dappStore.installId.v1";

function randomInstallId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

async function installationId() {
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY);
  if (/^[a-f0-9]{32}$/.test(existing ?? "")) return existing as string;
  const created = randomInstallId();
  await SecureStore.setItemAsync(INSTALL_ID_KEY, created, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return created;
}

export async function recordDappStoreActivation() {
  const extra = Constants.expoConfig?.extra ?? {};
  if (extra.storeBuild !== true || extra.appAnalyticsEnabled !== true) return;
  const apiUrl = String(extra.referralApiUrl ?? "https://api.lucky-me.app").replace(/\/$/, "");
  const installId = await installationId();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    await fetch(`${apiUrl}/api/app/activation`, {
      method: "POST",
      signal: controller.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        installId,
        channel: "solana-dapp-store",
        platform: "android",
        appVersion: Constants.nativeAppVersion ?? Constants.expoConfig?.version ?? "unknown",
        versionCode: Number(Constants.nativeBuildVersion ?? Constants.expoConfig?.android?.versionCode ?? 0),
      }),
    });
  } catch {
    // Analytics must never block app startup or wallet access.
  } finally {
    clearTimeout(timer);
  }
}
