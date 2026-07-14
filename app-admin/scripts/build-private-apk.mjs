import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const android = join(root, "android");
const sdk = process.env.ANDROID_HOME ?? join(homedir(), "Library", "Android", "sdk");
const apksigner = join(sdk, "build-tools", "36.0.0", "apksigner");
const secureDirectory = join(homedir(), ".luckyme-admin");
const keystore = join(secureDirectory, "luckyme-admin-release.jks");
const passwordFile = join(secureDirectory, "keystore.pass");
const unsignedApk = join(android, "app", "build", "outputs", "apk", "release", "app-release.apk");
const outputApk = join(homedir(), "Desktop", "LuckyMe-Admin-1.0.0-code1.apk");

for (const required of [apksigner, keystore, passwordFile]) {
  if (!existsSync(required)) throw new Error(`Required private build material is missing: ${required}`);
}

execFileSync(join(android, "gradlew"), ["assembleRelease"], { cwd: android, stdio: "inherit" });
execFileSync(apksigner, [
  "sign",
  "--ks", keystore,
  "--ks-key-alias", "luckyme-admin",
  "--ks-pass", `file:${passwordFile}`,
  "--out", outputApk,
  unsignedApk,
], { stdio: "inherit" });
execFileSync(apksigner, ["verify", "--verbose", "--print-certs", outputApk], { stdio: "inherit" });
console.log(outputApk);

