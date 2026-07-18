import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ensureTestKeystore } from "./ensure-test-keystore.mjs";

const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const outputDirectory = join(appDirectory, "dist");
const statusPath = join(appDirectory, "..", "site", "lucky-me.app", "build-status.json");

function writeStatus(status, detail, apk = null) {
  writeFileSync(statusPath, `${JSON.stringify({
    status,
    detail,
    version: "1.2.1-ui-test.7",
    apk,
    updatedAt: new Date().toISOString(),
  }, null, 2)}\n`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? appDirectory,
    env: options.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} ${args.join(" ")} failed with exit code ${result.status}`);
}

try {
  writeStatus("running", "Preparing embedded artwork and Android project");
  const { credentials } = ensureTestKeystore();
  const env = {
    ...process.env,
    ...credentials,
    CI: "1",
    NO_DNA: "1",
    NODE_ENV: "production",
    LUCKYME_UI_TEST_BUILD: "true",
    EXPO_PUBLIC_LUCKYME_REFERRAL_API_URL: "https://api.lucky-me.app",
    EXPO_PUBLIC_LUCKYME_WALLET_CHAIN: "solana:mainnet",
    EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL: "https://api.mainnet-beta.solana.com",
  };

  run("node", [join(appDirectory, "scripts", "generate-webview-theme-assets.mjs")], { env });
  writeStatus("running", "Generating the isolated Android test project");
  run("npx", ["expo", "prebuild", "--platform", "android", "--clean"], { env });
  const gradlew = join(appDirectory, "android", "gradlew");
  if (!existsSync(gradlew)) throw new Error("Expo prebuild did not create android/gradlew");
  writeStatus("running", "Compiling and signing the arm64 Seeker APK");
  run(gradlew, ["app:assembleRelease", "-PreactNativeArchitectures=arm64-v8a", "--no-daemon", "--stacktrace"], {
    cwd: join(appDirectory, "android"),
    env,
  });

  const built = join(appDirectory, "android", "app", "build", "outputs", "apk", "release", "app-release.apk");
  mkdirSync(outputDirectory, { recursive: true });
  const output = join(outputDirectory, "LuckyMe-Full-UI-Test-7-WALLET-AUTHORITY.apk");
  copyFileSync(built, output);
  writeStatus("complete", "APK compiled and signed successfully", output);
  console.log(`LuckyMe full UI test APK: ${output}`);
} catch (error) {
  writeStatus("failed", error instanceof Error ? error.message : String(error));
  throw error;
}
