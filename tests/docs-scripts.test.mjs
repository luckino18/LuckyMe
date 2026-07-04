import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const packageJson = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const appPackageJson = JSON.parse(
  fs.readFileSync(path.join(ROOT, "app-seeker/package.json"), "utf8"),
);
const rootScripts = new Set(Object.keys(packageJson.scripts ?? {}));
const appScripts = new Set(Object.keys(appPackageJson.scripts ?? {}));
const docs = [
  "README.md",
  "SECURITY.md",
  "backend/README.md",
  "app-seeker/README.md",
  "docs/apk-signing.md",
  "docs/local-development.md",
  "docs/manual-settlement.md",
  "docs/randomness.md",
  "docs/mainnet-readiness.md",
  "docs/solana-mobile-publishing.md",
  "docs/production-keeper.md",
  "docs/handoff.md",
].filter((file) => fs.existsSync(path.join(ROOT, file)));

test("documented npm scripts exist in root or app package.json", () => {
  const missing = [];

  for (const file of docs) {
    const content = fs.readFileSync(path.join(ROOT, file), "utf8");
    for (const match of content.matchAll(/\bnpm run ([a-zA-Z0-9:_-]+)/g)) {
      const script = match[1];
      if (!rootScripts.has(script) && !appScripts.has(script)) {
        missing.push(`${file}: npm run ${script}`);
      }
    }
  }

  assert.deepEqual(missing, []);
});
