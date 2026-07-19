import { createSkrRegistry } from "./admin-skr-registry.mjs";

const baseUrl = process.env.LUCKYME_ADMIN_CNFT_AUDIT_URL ?? "http://127.0.0.1:8792";
const registryPath = process.env.LUCKYME_ADMIN_SKR_REGISTRY_PATH ?? "/var/lib/luckyme/admin-skr-registry.json";
const headers = {
  "content-type": "application/json",
  "x-luckyme-admin-proxy": "1",
  "x-luckyme-admin-user": "readonly-audit",
  "x-luckyme-admin-request": "1",
};

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}/${path}`, { cache: "no-store", ...options, headers: { ...headers, ...(options.headers ?? {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 202) throw new Error(`${path}: ${payload.message ?? payload.error ?? `HTTP ${response.status}`}`);
  return { response, payload };
}

const registry = createSkrRegistry({ filePath: registryPath });
const candidates = registry.snapshot({ status: "ready" }).users.map((row) => row.name).slice(0, 100);
if (candidates.length < 50) throw new Error(`Readonly audit needs at least 50 Ready usernames; found ${candidates.length}`);

const [{ payload: config }, { payload: resolution }] = await Promise.all([
  request("config", { method: "GET" }),
  request("resolve", { method: "POST", body: JSON.stringify({ names: candidates }) }),
]);
const seenWallets = new Set();
const names = [];
for (const row of resolution.rows ?? []) {
  if (row.status !== "resolved" || !row.wallet || seenWallets.has(row.wallet)) continue;
  seenWallets.add(row.wallet);
  names.push(row.name);
  if (names.length === 50) break;
}
if (names.length !== 50) throw new Error(`Readonly audit resolved only ${names.length} unique recipients from ${candidates.length} candidates`);

let jobId = null;
try {
  const { payload } = await request("prepare", {
    method: "POST",
    body: JSON.stringify({ names, nonce: config.nftNonce, confirmation: "MINT 50 NFTS" }),
  });
  jobId = payload.jobId;
  if (payload.plan?.recipientCount !== 50 || payload.plan?.transactionCount !== 17 || payload.plan?.transactions?.length !== 17) {
    throw new Error("Prepared plan is not the required 50-recipient / 17-transaction batch");
  }
  console.log(JSON.stringify({ ok: true, recipients: 50, transactions: 17, signed: 0, broadcast: 0, minted: 0, jobId }));
} finally {
  if (jobId) {
    const { payload } = await request("reconcile", { method: "POST", body: JSON.stringify({ jobId }) });
    if (!payload.terminal || (payload.signatures?.length ?? 0) !== 0 || (payload.assets?.length ?? 0) !== 0) {
      throw new Error("Readonly audit cleanup did not terminate without a broadcast");
    }
  }
}
