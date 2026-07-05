import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXPECTED_PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";

const productionFacingFiles = [
  "README.md",
  "SECURITY.md",
  "backend/README.md",
  "app-seeker/README.md",
  "app-seeker/app.json",
  "app-seeker/app.config.js",
  "app-seeker/eas.json",
  "app-seeker/src/LuckyMeScreen.tsx",
  "app-seeker/scripts/validate-production-env.mjs",
  "docs/apk-signing.md",
  "docs/handoff.md",
  "docs/mainnet-readiness.md",
  "docs/solana-mobile-publishing.md",
  "docs/store-readiness.md",
  ...listFiles("docs/store-listing"),
].filter((file) => fs.existsSync(abs(file)));

const forbiddenTerms = [
  ["DEVNET_STORE_DEMO", /DEVNET_STORE_DEMO/i],
  ["solana:devnet", /solana:devnet/i],
  ["api.devnet.solana.com", /api\.devnet\.solana\.com/i],
  ["no real funds", /no real funds/i],
  ["do not use with mainnet funds", /do not use with mainnet funds/i],
  ["not audited", /not audited/i],
  ["legal review required", /legal review required/i],
  ["legal opinion required", /legal opinion required/i],
  ["gambling license required", /gambling license required/i],
  ["realFundsEnabled:false", /realFundsEnabled\s*:\s*false/i],
  ["devnetOnly", /devnetOnly/i],
  ["devnet", /\bdevnet\b/i],
  ["testnet", /\btestnet\b/i],
  ["localnet", /\blocalnet\b/i],
  ["demo", /\bdemo\b/i],
  ["localhost", /localhost/i],
  ["127.0.0.1", /127\.0\.0\.1/i],
];

const failures = [];

for (const file of productionFacingFiles) {
  const original = read(file);
  const content = stripAllowedSections(original);

  for (const [label, pattern] of forbiddenTerms) {
    if (pattern.test(content)) {
      failures.push(`${file}: forbidden production-facing term "${label}"`);
    }
  }
}

auditBackendReleaseGates();
auditProgramIdConsistency();
auditStoreListing();

if (failures.length > 0) {
  console.error("MAINNET_RELEASE audit failed:");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("LuckyMe MAINNET_RELEASE audit passed");

function auditBackendReleaseGates() {
  const backend = read("backend/src/server.mjs");

  mustMatch(
    "backend/src/server.mjs",
    "STORE_BUILD is treated as a release surface",
    backend,
    /const IS_RELEASE_SURFACE = RELEASE_MODE === "MAINNET_RELEASE" \|\| IS_NODE_PRODUCTION \|\| IS_STORE_BUILD/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "GET /simulate is gated to LOCAL_DEVELOPMENT and disabled in MAINNET_RELEASE/production/store builds",
    backend,
    /url\.pathname === "\/simulate"[\s\S]{0,240}if \(!IS_LOCAL_DEVELOPMENT \|\| IS_NODE_PRODUCTION \|\| IS_STORE_BUILD \|\| RELEASE_MODE === "MAINNET_RELEASE"\) \{[\s\S]{0,120}return json\(res, 404, \{ error: "not_found" \}\);/,
  );
  mustNotMatch(
    "backend/src/server.mjs",
    "seed \"dev\" reachable from backend simulation data",
    backend,
    /(?:randomSeed|seed):\s*"dev"|url\.searchParams\.get\("seed"\)\s*\?\?\s*"dev"/,
  );
  mustNotMatch(
    "backend/src/server.mjs",
    "alice/ana/marius demo simulation players",
    backend,
    /["'](?:alice|ana|marius)["']/i,
  );
  mustNotMatch(
    "backend/src/server.mjs",
    "source:\"static\" in the main /pools response path",
    backend,
    /source:\s*state\.onchain\.available\s*\?\s*"onchain"\s*:\s*"static"/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "static pool source is limited to local development outside release surfaces",
    backend,
    /!IS_RELEASE_SURFACE && IS_LOCAL_DEVELOPMENT[\s\S]{0,80}\?\s*"static"/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "MAINNET_RELEASE public config exposes ORAO as the only supported randomness mode",
    backend,
    /const supportedRandomnessModes = RELEASE_MODE === "MAINNET_RELEASE"[\s\S]{0,60}\? \["orao_vrf"\][\s\S]{0,60}: \["commit_reveal_demo", "orao_vrf"\]/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "MAINNET_RELEASE public config reports ORAO randomness provider",
    backend,
    /const randomnessProviderName = RELEASE_MODE === "MAINNET_RELEASE"[\s\S]{0,80}\?\s*"orao_vrf"/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "commit reveal is disabled in release public config",
    backend,
    /commitRevealAllowed:\s*RELEASE_MODE !== "MAINNET_RELEASE" && RANDOMNESS_MODE === "commit_reveal_demo"/,
  );
  mustNotMatch(
    "backend/src/server.mjs",
    "commit_reveal_demo exposed as unconditional supported randomness mode",
    backend,
    /const supportedRandomnessModes\s*=\s*\[\s*"commit_reveal_demo",\s*"orao_vrf"\s*\]|supportedRandomnessModes:\s*\["commit_reveal_demo",\s*"orao_vrf"\]/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "MAINNET_RELEASE requires ORAO provider randomness",
    backend,
    /MAINNET_RELEASE requires LUCKYME_RANDOMNESS_MODE=orao_vrf/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "MAINNET_RELEASE requires mainnet-beta cluster",
    backend,
    /MAINNET_RELEASE requires LUCKYME_SOLANA_CLUSTER=mainnet-beta/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "MAINNET_RELEASE requires configured CORS origin",
    backend,
    /CORS_ORIGIN is required for MAINNET_RELEASE/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "transaction submit relay disabled by default",
    backend,
    /const ENABLE_TRANSACTION_SUBMIT = process\.env\.ENABLE_TRANSACTION_SUBMIT === "true"/,
  );
  mustMatch(
    "backend/src/server.mjs",
    "backend never signs player transactions in public release checks",
    backend,
    /backendSignsPlayerTransactions:\s*false/,
  );
}

function auditProgramIdConsistency() {
  const checks = [
    ["Anchor.toml mainnet", read("Anchor.toml").match(/\[programs\.mainnet\][\s\S]*?luckyme\s*=\s*"([^"]+)"/)?.[1]],
    ["program declare_id", read("programs/luckyme/src/lib.rs").match(/declare_id!\("([^"]+)"\)/)?.[1]],
    ["IDL address", JSON.parse(read("idl/luckyme.json")).address],
    ["SDK type address", read("sdk/luckyme.ts").match(/"address":\s*"([^"]+)"/)?.[1]],
    ["scripts PROGRAM_ID", read("scripts/anchor-client.mjs").match(/PROGRAM_ID = new PublicKey\("([^"]+)"\)/)?.[1]],
    ["app extra program id", JSON.parse(read("app-seeker/app.json")).expo.extra.luckymeProgramId],
    ["eas program id", JSON.parse(read("app-seeker/eas.json")).build["dapp-store"].env.EXPO_PUBLIC_LUCKYME_PROGRAM_ID],
    ["README Program ID", read("README.md").match(/Program ID:\*\*\s*`([^`]+)`/)?.[1]],
  ];

  for (const [label, value] of checks) {
    if (value !== EXPECTED_PROGRAM_ID) {
      failures.push(`${label}: expected ${EXPECTED_PROGRAM_ID}, got ${value ?? "missing"}`);
    }
  }

  if (!/PROGRAM_ID/.test(read("backend/src/server.mjs"))) {
    failures.push("backend/src/server.mjs: PROGRAM_ID import/use missing");
  }
}

function auditStoreListing() {
  const requiredFiles = [
    "docs/store-listing/short-description.txt",
    "docs/store-listing/full-description.md",
    "docs/store-listing/whats-new-v1.0.0.txt",
    "docs/store-listing/screenshot-checklist.md",
    "docs/store-listing/icon-adaptive-icon-checklist.md",
    "docs/store-listing/privacy-policy.md",
    "docs/store-listing/support-contact.md",
    "docs/store-listing/category.txt",
  ];

  for (const file of requiredFiles) {
    if (!fs.existsSync(abs(file))) {
      failures.push(`${file}: missing store listing file`);
    } else if (read(file).trim().length === 0) {
      failures.push(`${file}: empty store listing file`);
    }
  }

  if (fs.existsSync(abs("docs/store-listing/category.txt")) &&
    read("docs/store-listing/category.txt").trim() !== "Games") {
    failures.push("docs/store-listing/category.txt: category must be Games");
  }
}

function stripAllowedSections(content) {
  const allowedHeadings = [
    "Local Development",
    "Solana Mobile Docs Scope",
    "Not Specified By Solana Mobile Docs",
    "Solana Mobile Requirements Note",
  ];
  const allowed = new Set(allowedHeadings);
  const lines = content.split(/\r?\n/);
  const kept = [];
  let skippedLevel = 0;

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
    if (heading) {
      const level = heading[1].length;
      const title = heading[2].replace(/#+$/, "").trim();

      if (skippedLevel > 0 && level <= skippedLevel) {
        skippedLevel = 0;
      }

      if (allowed.has(title)) {
        skippedLevel = level;
        continue;
      }
    }

    if (skippedLevel === 0) {
      kept.push(line);
    }
  }

  return kept.join("\n");
}

function mustNotMatch(file, description, content, pattern) {
  if (pattern.test(content)) {
    failures.push(`${file}: unsafe release pattern present: ${description}`);
  }
}

function listFiles(directory) {
  if (!fs.existsSync(abs(directory))) {
    return [];
  }

  return fs.readdirSync(abs(directory))
    .map((entry) => path.join(directory, entry))
    .filter((file) => fs.statSync(abs(file)).isFile());
}

function read(file) {
  return fs.readFileSync(abs(file), "utf8");
}

function abs(file) {
  return path.join(ROOT, file);
}

function mustMatch(file, description, content, pattern) {
  if (!pattern.test(content)) {
    failures.push(`${file}: missing release gate: ${description}`);
  }
}
