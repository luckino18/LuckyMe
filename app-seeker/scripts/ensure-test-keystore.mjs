import { randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const secretsDirectory = join(homedir(), ".luckyme", "seeker-referral-test");
const credentialsPath = join(secretsDirectory, "signing-credentials.json");
const keystorePath = join(secretsDirectory, "luckyme-seeker-referral-test.keystore");

export function ensureTestKeystore() {
  mkdirSync(secretsDirectory, { recursive: true, mode: 0o700 });
  chmodSync(secretsDirectory, 0o700);
  if (existsSync(credentialsPath) && existsSync(keystorePath)) {
    const credentials = JSON.parse(readFileSync(credentialsPath, "utf8"));
    chmodSync(credentialsPath, 0o600);
    chmodSync(keystorePath, 0o600);
    return { credentials, credentialsPath, generated: false };
  }

  const credentials = {
    LM_TEST_KEYSTORE_PATH: keystorePath,
    LM_TEST_KEYSTORE_PASSWORD: randomBytes(36).toString("base64url"),
    LM_TEST_KEY_ALIAS: "luckyme-seeker-referral-test",
    LM_TEST_KEY_PASSWORD: randomBytes(36).toString("base64url"),
  };
  const keytool = spawnSync("keytool", [
    "-genkeypair",
    "-noprompt",
    "-keystore", credentials.LM_TEST_KEYSTORE_PATH,
    "-storetype", "JKS",
    "-storepass", credentials.LM_TEST_KEYSTORE_PASSWORD,
    "-keypass", credentials.LM_TEST_KEY_PASSWORD,
    "-alias", credentials.LM_TEST_KEY_ALIAS,
    "-keyalg", "RSA",
    "-keysize", "3072",
    "-validity", "3650",
    "-dname", "CN=LuckyMe Seeker Referral Test, O=LuckyMe Local Test, C=IT",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (keytool.status !== 0) {
    throw new Error(`Test keystore generation failed: ${keytool.stderr.trim()}`);
  }
  writeFileSync(credentialsPath, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  chmodSync(credentialsPath, 0o600);
  chmodSync(keystorePath, 0o600);
  return { credentials, credentialsPath, generated: true };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = ensureTestKeystore();
  console.log(result.generated ? "Created local test signing identity" : "Reusing local test signing identity");
  console.log(`Keystore: ${result.credentials.LM_TEST_KEYSTORE_PATH}`);
  console.log(`Credentials file: ${result.credentialsPath}`);
}
