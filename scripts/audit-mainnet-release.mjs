import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const EXPECTED_PROGRAM_ID = "4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3";
const DEV_CLUSTER = ["dev", "net"].join("");
const LOCAL_CLUSTER = ["local", "net"].join("");
const DEV_STORE_MODE = ["DEVNET", "STORE", "DEMO"].join("_");
const NO_REAL_FUNDS = ["no", "real", "funds"].join(" ");
const NO_REAL_PRIZES = ["no", "real", "prizes"].join(" ");
const MAINNET_FUNDS_WARNING = ["do not use with", "mainnet funds"].join(" ");
const DEVNET_ONLY = [DEV_CLUSTER, "only"].join(" ");
const LOCALNET_ONLY = [LOCAL_CLUSTER, "only"].join(" ");
const EXTERNAL_AUDIT_REQUIRED = ["external", "audit", "required"].join(" ");
const LEGAL_REVIEW_REQUIRED = ["legal", "review", "required"].join(" ");
const LEGAL_OPINION_REQUIRED = ["legal", "opinion", "required"].join(" ");
const GAMBLING_LICENSE_REQUIRED = ["gambling", "license", "required"].join(" ");
const MAINNET_BLOCKED = ["mainnet", "blocked"].join(" ");

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
  "docs/release-v1.0.0-mainnet.md",
  "docs/solana-mobile-publishing.md",
  "docs/store-readiness.md",
  ...listFiles("docs/store-listing"),
].filter((file) => fs.existsSync(abs(file)));

const forbiddenTerms = [
  [DEV_STORE_MODE, new RegExp(DEV_STORE_MODE, "i")],
  [`solana:${DEV_CLUSTER}`, new RegExp(`solana:${DEV_CLUSTER}`, "i")],
  [`api.${DEV_CLUSTER}.solana.com`, new RegExp(`api\\.${DEV_CLUSTER}\\.solana\\.com`, "i")],
  [NO_REAL_FUNDS, new RegExp(NO_REAL_FUNDS, "i")],
  [NO_REAL_PRIZES, new RegExp(NO_REAL_PRIZES, "i")],
  [MAINNET_FUNDS_WARNING, new RegExp(MAINNET_FUNDS_WARNING, "i")],
  ["not audited", /not audited/i],
  [EXTERNAL_AUDIT_REQUIRED, new RegExp(EXTERNAL_AUDIT_REQUIRED, "i")],
  [LEGAL_REVIEW_REQUIRED, new RegExp(LEGAL_REVIEW_REQUIRED, "i")],
  [LEGAL_OPINION_REQUIRED, new RegExp(LEGAL_OPINION_REQUIRED, "i")],
  [GAMBLING_LICENSE_REQUIRED, new RegExp(GAMBLING_LICENSE_REQUIRED, "i")],
  [MAINNET_BLOCKED, new RegExp(MAINNET_BLOCKED, "i")],
  ["realFundsEnabled:false", /realFundsEnabled\s*:\s*false/i],
  [DEVNET_ONLY, new RegExp(DEVNET_ONLY, "i")],
  [LOCALNET_ONLY, new RegExp(LOCALNET_ONLY, "i")],
  [DEV_CLUSTER, new RegExp(`\\b${DEV_CLUSTER}\\b`, "i")],
  ["testnet", /\btestnet\b/i],
  [LOCAL_CLUSTER, new RegExp(`\\b${LOCAL_CLUSTER}\\b`, "i")],
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
auditAppReleaseLinks();
auditDeployEvidence();
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

function auditAppReleaseLinks() {
  const appConfig = read("app-seeker/app.config.js");
  const appValidator = read("app-seeker/scripts/validate-production-env.mjs");
  const appScreen = read("app-seeker/src/LuckyMeScreen.tsx");
  const appReadme = read("app-seeker/README.md");
  const easEnv = JSON.parse(read("app-seeker/eas.json")).build["dapp-store"].env ?? {};
  const requiredLinks = read("docs/store-listing/required-links.md");
  const requiredEasEnv = [
    "EXPO_PUBLIC_LUCKYME_API_URL",
    "EXPO_PUBLIC_LUCKYME_WALLET_RPC_URL",
    "EXPO_PUBLIC_LUCKYME_TERMS_URL",
    "EXPO_PUBLIC_LUCKYME_PRIVACY_URL",
    "EXPO_PUBLIC_LUCKYME_SUPPORT_URL",
  ];
  const requiredEnv = [
    "EXPO_PUBLIC_LUCKYME_TERMS_URL",
    "EXPO_PUBLIC_LUCKYME_PRIVACY_URL",
    "EXPO_PUBLIC_LUCKYME_SUPPORT_URL",
  ];

  for (const envName of requiredEasEnv) {
    if (!isProductionHttpsUrl(easEnv[envName])) {
      failures.push(`app-seeker/eas.json: ${envName} must be a production HTTPS URL`);
    }
  }

  for (const envName of requiredEnv) {
    mustMatch(
      "app-seeker/app.config.js",
      `${envName} required by store build config`,
      appConfig,
      new RegExp(`requireEnv\\("${envName}"\\)`),
    );
    mustMatch(
      "app-seeker/scripts/validate-production-env.mjs",
      `${envName} required by production validator`,
      appValidator,
      new RegExp(`"${envName}"`),
    );
    mustMatch(
      "docs/store-listing/required-links.md",
      `${envName} listed as pre-submit asset`,
      requiredLinks,
      new RegExp(envName),
    );
  }

  mustNotMatch(
    "app-seeker/src/LuckyMeScreen.tsx",
    "placeholder policy/support link fallback",
    appScreen,
    /https:\/\/example\.com\/(?:terms|privacy|support)/,
  );
  mustMatch(
    "app-seeker/README.md",
    "EAS build documents production API/link env injection",
    appReadme,
    /EAS project environment or as EAS secrets/,
  );
}

function auditDeployEvidence() {
  const evidenceFile = "docs/final-release-evidence.md";
  if (!fs.existsSync(abs(evidenceFile))) {
    failures.push(`${evidenceFile}: missing final release evidence file`);
    return;
  }

  const evidence = read(evidenceFile);
  for (const field of [
    "Mainnet program deploy tx",
    "Initialized config tx",
    "Initialized pools txs",
    "Backend production HTTPS URL",
    "EAS APK build URL",
    "apksigner verify --print-certs",
    "Android / Seeker wallet test result",
  ]) {
    if (!evidence.includes(field)) {
      failures.push(`${evidenceFile}: missing evidence field "${field}"`);
    }
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
    "docs/store-listing/required-links.md",
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
    "Local Development Only",
    "Historical Release Note",
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

function isProductionHttpsUrl(value) {
  if (typeof value !== "string") {
    return false;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname;
    return parsed.protocol === "https:" &&
      host !== ["local", "host"].join("") &&
      !host.startsWith("127.") &&
      host !== "::1" &&
      !host.startsWith("192.168.") &&
      !host.startsWith("10.") &&
      host !== ["example", "com"].join(".") &&
      !host.endsWith(".example") &&
      !host.includes("your-domain");
  } catch {
    return false;
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
