import { existsSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureTestKeystore } from "./ensure-test-keystore.mjs";

const appDirectory = fileURLToPath(new URL("..", import.meta.url));

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? appDirectory,
    env: options.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

const { credentials } = ensureTestKeystore();
const env = {
  ...process.env,
  ...credentials,
  CI: "1",
  NO_DNA: "1",
  NODE_ENV: "production",
  LUCKYME_REFERRAL_TEST_BUILD: "true",
  EXPO_PUBLIC_LUCKYME_REFERRAL_BUILD: "true",
  EXPO_PUBLIC_LUCKYME_REFERRAL_TEST_MODE: "true",
  EXPO_PUBLIC_LUCKYME_REFERRAL_API_URL:
    process.env.EXPO_PUBLIC_LUCKYME_REFERRAL_API_URL ?? "https://api.lucky-me.app",
  EXPO_PUBLIC_LUCKYME_WALLET_CHAIN: "solana:mainnet",
  EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL:
    process.env.EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL ?? "https://api.mainnet-beta.solana.com",
};

run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], { env });
const gradlew = join(appDirectory, "android", "gradlew");
if (!existsSync(gradlew)) throw new Error("Expo prebuild did not create android/gradlew");
run(gradlew, [
  "app:assembleRelease",
  "-PreactNativeArchitectures=arm64-v8a",
  "--no-daemon",
  "--stacktrace",
], {
  cwd: join(appDirectory, "android"),
  env,
});
console.log(`Signed referral test APK: ${join(appDirectory, "android", "app", "build", "outputs", "apk", "release", "app-release.apk")}`);
