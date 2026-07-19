import {
  SOLANA_MAINNET_CHAIN,
  SOLANA_SIGN_TRANSACTION,
  base58Encode,
  compatibleWalletStandardOptions,
  connectWalletStandardOption,
  createWalletStandardRegistry,
} from "/wallet-standard.js?v=20260712-pool-walletconnect-fix";

const $ = (id) => document.getElementById(id);
const safe = (value) => String(value ?? "—").replace(/[&<>"']/g, (char) => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[char]));
const stateLabel = (state) => state?.ActiveState === "active" || (state?.ActiveState === "inactive" && state?.Result === "success") ? "Healthy" : "Attention";
const sol = (lamports) => `${(Number(lamports ?? 0) / 1_000_000_000).toFixed(6)} SOL`;
let winnerRounds = [];
let referralBindings = [];
let referralSnapshot = { counts: {}, profiles: 0, verifiedIdentities: 0 };
const nftWalletRegistry = createWalletStandardRegistry(window);
const nftState = {
  config: null,
  names: [],
  rows: [],
  wallet: null,
  busy: false,
};
const SKR_BRIDGE_URL = "http://127.0.0.1:8796";
const skrState = {
  devices: [],
  names: new Map(),
  exported: new Set(),
  registry: { summary: {}, users: [] },
  scanning: false,
  captureBusy: false,
  timer: null,
};

function nftApi(path, options = {}) {
  return fetch(`/admin/api/nft/${path}`, {
    cache: "no-store",
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json", "X-LuckyMe-Admin-Request": "1" } : {}),
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok && response.status !== 202) {
      const error = new Error(payload.message || payload.error || `HTTP ${response.status}`);
      error.payload = payload;
      error.httpStatus = response.status;
      throw error;
    }
    return { response, payload };
  });
}

function parseNftNames(value) {
  return String(value || "")
    .split(/[\s,;]+/)
    .map((name) => name.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/^@+/, ""))
    .filter(Boolean);
}

function addNftNames(value) {
  const maximum = Number(nftState.config?.maxRecipients || 1_000);
  const existing = new Set(nftState.names);
  for (const name of parseNftNames(value)) {
    if (nftState.names.length >= maximum) break;
    if (existing.has(name)) continue;
    nftState.names.push(name);
    existing.add(name);
  }
  nftState.rows = [];
  nftState.wallet = null;
  renderNftTool();
}

function skrBridge(path, options = {}) {
  return fetch(`${SKR_BRIDGE_URL}${path}`, {
    cache: "no-store",
    credentials: "omit",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  }).then(async (response) => {
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.message || payload.error || `Local bridge HTTP ${response.status}`);
    return payload;
  });
}

function showSkrResult(kind, html) {
  $("skr-result").hidden = false;
  $("skr-result").className = `nft-result ${kind}`;
  $("skr-result").innerHTML = html;
}

function renderSkrDevices() {
  const select = $("skr-device");
  const current = select.value;
  select.innerHTML = skrState.devices.length
    ? skrState.devices.map((device) => `<option value="${safe(device.serial)}">${safe(device.serial)} · ${safe(device.state)}</option>`).join("")
    : `<option value="">No device detected</option>`;
  if (skrState.devices.some((device) => device.serial === current)) select.value = current;
}

function renderSkrCapture() {
  const rows = [...skrState.names.values()];
  const minted = rows.filter((row) => row.minted).length;
  const repeated = rows.filter((row) => row.existedBefore).length;
  $("skr-capture-summary").innerHTML = [
    ["Captured", rows.length],
    ["New to registry", rows.length - repeated],
    ["Seen before", repeated],
    ["Already received NFT", minted],
  ].map(([label, value]) => `<article class="referral-stat"><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("");
  $("skr-capture-empty").hidden = rows.length > 0;
  $("skr-capture-list").innerHTML = rows.map((row) => `<article class="skr-capture-row ${row.minted ? "minted" : row.existedBefore ? "duplicate" : "new"}">
    <strong>${safe(row.name)}</strong>
    <span>${row.minted ? "NFT already sent" : row.existedBefore ? "Seen in an earlier lot" : "New username"}</span>
    <small>${safe((row.sources ?? []).map((source) => source.label).join(", ") || "Current capture")}</small>
  </article>`).join("");
  $("skr-start-scan").disabled = skrState.scanning || !$("skr-device").value;
  $("skr-stop-scan").disabled = !skrState.scanning;
  $("skr-export-to-nft").disabled = rows.every((row) => row.minted || skrState.exported.has(row.name));
}

function renderSkrRegistry() {
  const summary = skrState.registry.summary ?? {};
  $("skr-registry-summary").innerHTML = [
    ["All usernames", summary.total ?? 0],
    ["Ready", summary.ready ?? summary.eligible ?? 0],
    ["Reserved", summary.reserved ?? 0],
    ["NFT confirmed", summary.sent ?? summary.minted ?? 0],
  ].map(([label, value]) => `<article class="referral-stat"><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("");
  const users = skrState.registry.users ?? [];
  $("skr-registry-list").innerHTML = users.length ? users.map((row) => `<article class="skr-registry-row ${safe(row.status || (row.minted ? "sent" : "ready"))}">
    <strong class="skr-database-id">#${safe(row.id)}</strong>
    <div><strong>${safe(row.name)}</strong><span>${row.status === "sent" || row.minted ? "NFT confirmed" : row.status === "reserved" ? "Reserved for Send NFT" : "Ready to send"}</span></div>
    <div><span>Captures</span><strong>${safe(row.captureCount)}</strong></div>
    <div><span>Sources</span><strong>${safe((row.sources ?? []).length)}</strong></div>
    <div><span>Last seen</span><strong>${row.lastSeenAt ? safe(new Date(row.lastSeenAt).toLocaleString()) : "—"}</strong></div>
    <div><span>Wallet</span><code>${safe(row.wallet ?? "—")}</code></div>
    <div class="skr-registry-actions">
      ${row.signature ? `<a href="https://solscan.io/tx/${encodeURIComponent(row.signature)}" target="_blank" rel="noopener noreferrer">Solscan</a>` : ""}
      ${row.status === "sent" || row.minted ? "" : `<button class="nft-button danger skr-remove-button" type="button" data-skr-remove="${safe(row.name)}">Remove</button>`}
    </div>
  </article>`).join("") : `<p class="entry-empty history-empty">No username matches this filter.</p>`;
}

async function loadSkrRegistry() {
  try {
    const query = new URLSearchParams({
      status: $("skr-registry-status")?.value || "all",
      search: $("skr-registry-search")?.value || "",
    });
    const { payload } = await nftApi(`skr-registry?${query}`);
    skrState.registry = payload;
    renderSkrRegistry();
  } catch (error) {
    if ($("skr-registry-list")) $("skr-registry-list").innerHTML = `<div class="alert"><strong>Registry unavailable</strong>${safe(error.message)}</div>`;
  }
}

function showSkrDatabaseResult(kind, html) {
  const result = $("skr-database-result");
  result.hidden = false;
  result.className = `nft-result ${kind}`;
  result.innerHTML = html;
}

async function saveSkrDatabase() {
  const names = parseNftNames($("skr-database-input").value);
  if (!names.length) {
    showSkrDatabaseResult("warning", "<strong>Nothing to save</strong><span>Paste at least one username.skr.</span>");
    return;
  }
  try {
    const source = $("skr-database-source").value.trim() || `Manual import ${new Date().toISOString().slice(0, 10)}`;
    const { payload } = await nftApi("skr-import", { method: "POST", body: JSON.stringify({ names, source }) });
    const rows = payload.rows ?? [];
    const added = rows.filter((row) => !row.existedBefore).length;
    const duplicates = rows.filter((row) => row.existedBefore).length + Math.max(0, names.length - rows.length);
    skrState.registry = payload.registry;
    $("skr-database-input").value = "";
    renderSkrRegistry();
    showSkrDatabaseResult("success", `<strong>${added} new username${added === 1 ? "" : "s"} saved</strong><span>${duplicates} duplicate or invalid entr${duplicates === 1 ? "y was" : "ies were"} excluded. Existing delivery history was preserved.</span>`);
  } catch (error) {
    showSkrDatabaseResult("error", `<strong>Database save stopped</strong><span>${safe(error.message)}</span>`);
  }
}

async function prepareNextSkrBatch() {
  if (nftState.names.length && !window.confirm("Replace the current Send NFT recipient list with the reserved SKR Database batch?")) return;
  try {
    const { payload } = await nftApi("skr-reserve", { method: "POST", body: JSON.stringify({ limit: 50 }) });
    if (!payload.names?.length) throw new Error("There are no Ready usernames left in the database");
    nftState.names = [];
    nftState.rows = [];
    nftState.wallet = null;
    addNftNames(payload.names.join("\n"));
    skrState.registry = payload.registry;
    renderSkrRegistry();
    selectTab("nft-send");
    showNftResult("success", `<strong>${payload.names.length} username${payload.names.length === 1 ? "" : "s"} reserved from SKR Database</strong><span>${payload.reused ? "The existing unfinished reservation was restored." : "They are ready for resolution and wallet approval."} Only confirmed mints move to NFT Confirmed.</span>`);
  } catch (error) {
    showSkrDatabaseResult("error", `<strong>Batch preparation stopped</strong><span>${safe(error.message)}</span>`);
  }
}

async function releaseReservedSkr() {
  if (!window.confirm("Return every unconfirmed reserved username to Ready? Confirmed NFT recipients will remain protected.")) return;
  try {
    const { payload } = await nftApi("skr-release", { method: "POST", body: "{}" });
    skrState.registry = payload.registry;
    renderSkrRegistry();
    showSkrDatabaseResult("success", `<strong>${payload.released?.length ?? 0} username${payload.released?.length === 1 ? "" : "s"} returned to Ready</strong><span>No confirmed NFT record was changed.</span>`);
  } catch (error) {
    showSkrDatabaseResult("error", `<strong>Release stopped</strong><span>${safe(error.message)}</span>`);
  }
}

async function removeSkrUsername(name) {
  if (!window.confirm(`Remove ${name} permanently from SKR Database? This is only for an invalid or incorrectly read username.`)) return;
  try {
    const { payload } = await nftApi("skr-remove", { method: "POST", body: JSON.stringify({ name }) });
    skrState.registry = payload.registry;
    renderSkrRegistry();
    showSkrDatabaseResult("success", `<strong>${safe(payload.removed.name)} removed</strong><span>The invalid username is no longer Ready or Reserved for NFT delivery.</span>`);
  } catch (error) {
    showSkrDatabaseResult("error", `<strong>Username was not removed</strong><span>${safe(error.message)}</span>`);
  }
}

async function refreshSkrBridge() {
  try {
    const payload = await skrBridge("/status");
    skrState.devices = Array.isArray(payload.devices) ? payload.devices.filter((device) => device.state === "device") : [];
    $("skr-bridge-status").textContent = "Bridge ready";
    $("skr-bridge-status").className = "status ok";
    renderSkrDevices();
    renderSkrCapture();
  } catch (error) {
    skrState.devices = [];
    $("skr-bridge-status").textContent = "Bridge offline";
    $("skr-bridge-status").className = "status bad";
    renderSkrDevices();
    renderSkrCapture();
    showSkrResult("warning", `<strong>Start the local SKR Bridge</strong><span>Double-click “Start LuckyMe SKR Bridge.command” on the Mac, then refresh devices.</span><small>${safe(error.message)}</small>`);
  }
}

async function pairSkrDevice() {
  try {
    showSkrResult("working", "<strong>Pairing Seeker…</strong><span>The code stays on this Mac.</span>");
    const payload = await skrBridge("/pair", { method: "POST", body: JSON.stringify({ address: $("skr-pair-address").value, code: $("skr-pair-code").value }) });
    $("skr-pair-code").value = "";
    showSkrResult(payload.ok ? "success" : "warning", `<strong>${payload.ok ? "Seeker paired" : "Pairing was not confirmed"}</strong><span>${safe(payload.output)}</span>`);
  } catch (error) {
    $("skr-pair-code").value = "";
    showSkrResult("error", `<strong>ADB pairing failed</strong><span>${safe(error.message)}</span>`);
  }
}

async function connectSkrDevice() {
  try {
    const payload = await skrBridge("/connect", { method: "POST", body: JSON.stringify({ address: $("skr-connect-address").value }) });
    skrState.devices = (payload.devices ?? []).filter((device) => device.state === "device");
    renderSkrDevices();
    renderSkrCapture();
    showSkrResult(payload.ok ? "success" : "warning", `<strong>${payload.ok ? "ADB connected" : "ADB connection needs attention"}</strong><span>${safe(payload.output)}</span>`);
  } catch (error) {
    showSkrResult("error", `<strong>ADB connection failed</strong><span>${safe(error.message)}</span>`);
  }
}

async function captureSkrScreen() {
  if (skrState.captureBusy) return;
  const serial = $("skr-device").value;
  if (!serial) return;
  skrState.captureBusy = true;
  try {
    const capture = await skrBridge("/capture", { method: "POST", body: JSON.stringify({ serial }) });
    const fresh = (capture.names ?? []).filter((name) => !skrState.names.has(name));
    if (fresh.length) {
      const source = $("skr-source").value.trim() || `ADB capture ${new Date().toISOString().slice(0, 10)}`;
      const { payload } = await nftApi("skr-import", { method: "POST", body: JSON.stringify({ names: fresh, source, capturedAt: capture.capturedAt }) });
      for (const row of payload.rows ?? []) skrState.names.set(row.name, row);
      skrState.registry = payload.registry;
      renderSkrRegistry();
      renderSkrCapture();
      showSkrResult("success", `<strong>${fresh.length} new visible username${fresh.length === 1 ? "" : "s"} captured</strong><span>Keep scrolling the review list while capture is active.</span>`);
    }
  } catch (error) {
    showSkrResult("error", `<strong>Screen capture failed</strong><span>${safe(error.message)}</span>`);
    stopSkrScan();
  } finally {
    skrState.captureBusy = false;
  }
}

function scheduleSkrCapture() {
  clearTimeout(skrState.timer);
  if (!skrState.scanning) return;
  skrState.timer = setTimeout(async () => {
    await captureSkrScreen();
    scheduleSkrCapture();
  }, 2_500);
}

function startSkrScan() {
  if (!$("skr-device").value) return;
  skrState.scanning = true;
  renderSkrCapture();
  showSkrResult("working", "<strong>Capture active</strong><span>Open the desired reviews and scroll manually on Seeker.</span>");
  captureSkrScreen().finally(scheduleSkrCapture);
}

function stopSkrScan() {
  skrState.scanning = false;
  clearTimeout(skrState.timer);
  skrState.timer = null;
  renderSkrCapture();
}

async function exportSkrToNft() {
  try {
    const limit = Number($("skr-export-size").value);
    const names = [...skrState.names.keys()].filter((name) => !skrState.exported.has(name));
    const { payload } = await nftApi("skr-export", { method: "POST", body: JSON.stringify({ names, limit }) });
    if (!payload.names?.length) throw new Error("This capture has no eligible usernames left");
    for (const name of payload.names) skrState.exported.add(name);
    addNftNames(payload.names.join("\n"));
    skrState.registry = payload.registry;
    renderSkrRegistry();
    stopSkrScan();
    selectTab("nft-send");
    showNftResult("success", `<strong>${payload.names.length} username${payload.names.length === 1 ? "" : "s"} transferred from SKR Download</strong><span>Resolve them on-chain before reviewing the mint.</span>`);
  } catch (error) {
    showSkrResult("error", `<strong>Batch export stopped</strong><span>${safe(error.message)}</span>`);
  }
}

function nftRowStatus(row) {
  const labels = {
    resolved: "Resolved",
    invalid: "Invalid name",
    duplicate: "Duplicate name",
    duplicate_wallet: "Same wallet",
    not_found: "Not found",
    lookup_error: "Retry needed",
  };
  return labels[row?.status] || "Pending";
}

function renderNftTool() {
  const max = Number(nftState.config?.maxRecipients || 1_000);
  $("nft-recipient-counter").textContent = `${nftState.names.length} / ${max}`;
  $("nft-recipient-empty").hidden = nftState.names.length > 0;
  $("nft-recipient-list").innerHTML = nftState.names.map((name, index) => {
    const row = nftState.rows[index];
    const wallet = row?.wallet ? `<code>${safe(row.wallet)}</code>` : "";
    const displayedName = row?.name || name;
    const correction = row?.correctedFrom
      ? `<small>OCR corrected from ${safe(row.correctedFrom)}</small>`
      : "";
    return `<article class="nft-recipient-row ${safe(row?.status || "pending")}">
      <span class="nft-row-index">${index + 1}</span>
      <div><strong>${safe(displayedName)}</strong>${correction}${wallet}</div>
      <span class="nft-row-status">${safe(nftRowStatus(row))}</span>
      <button type="button" data-remove-nft="${index}" aria-label="Remove ${safe(name)}">×</button>
    </article>`;
  }).join("");
  document.querySelectorAll("[data-remove-nft]").forEach((button) => button.addEventListener("click", () => {
    nftState.names.splice(Number(button.dataset.removeNft), 1);
    nftState.rows = [];
    nftState.wallet = null;
    renderNftTool();
  }));

  const ready = nftState.rows.length > 0 && nftState.rows.every((row) => row.status === "resolved");
  $("nft-preview").hidden = !ready;
  if (ready) {
    const transactionSize = Math.max(1, Number(nftState.config?.mintsPerTransaction) || 3);
    const approvalSize = Math.max(1, Number(nftState.config?.mintsPerApproval) || 50);
    const txCount = Math.ceil(nftState.rows.length / transactionSize);
    const approvalCount = Math.ceil(nftState.rows.length / approvalSize);
    $("nft-preview-title").textContent = `${nftState.rows.length} NFT${nftState.rows.length === 1 ? "" : "s"} ready`;
    $("nft-summary").innerHTML = [
      ["Recipients", nftState.rows.length],
      ["Wallet approvals", approvalCount],
      ["Transactions", txCount],
      ["Network", "Mainnet"],
    ].map(([label, value]) => `<article><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("");
    const authority = nftState.wallet?.account?.address || nftState.config?.authority || "—";
    $("nft-authority-copy").innerHTML = `<span>Required authority</span><code>${safe(nftState.config?.authority)}</code><span>Connected</span><code>${safe(authority)}</code>`;
  }
  const connected = nftState.wallet?.account?.address === nftState.config?.authority;
  $("nft-connect-wallet").textContent = connected ? "Authority wallet connected" : "Connect authority wallet";
  $("nft-batch-connect-wallet").textContent = connected ? "Solflare authority connected" : "Connect Solflare authority";
  document.querySelectorAll("[data-batch-sign-count]").forEach((button) => {
    button.disabled = !connected || nftState.busy;
  });
  $("nft-mint").disabled = !ready || !connected || !nftState.config?.enabled || nftState.busy;
  $("nft-resolve").disabled = nftState.names.length < 1 || nftState.busy;
  $("nft-clear").disabled = nftState.names.length < 1 || nftState.busy;
  const enabled = nftState.config?.enabled;
  $("nft-tool-status").textContent = enabled ? "Wallet approval required" : "Preview only";
  $("nft-tool-status").className = `status ${enabled ? "ok" : "neutral"}`;
}

async function runBatchSigningDiagnostic(count) {
  const wallet = nftState.wallet?.standardWallet;
  const account = nftState.wallet?.account;
  const feature = wallet?.features?.[SOLANA_SIGN_TRANSACTION];
  if (!wallet || !account || account.address !== nftState.config?.authority) {
    showNftResult("warning", "<strong>Connect the authority wallet first</strong><span>The diagnostic is restricted to the exact LuckyMe authority address.</span>");
    return;
  }
  if (typeof feature?.signTransaction !== "function") {
    showNftResult("error", "<strong>Batch signing unavailable</strong><span>This Solflare connection does not expose transaction-only batch signing.</span>");
    return;
  }
  const approved = window.confirm(
    `Batch signing diagnostic: ${count} transactions\n\n` +
    "Solflare will be asked to SIGN memo-only test transactions.\n" +
    "LuckyMe will NOT broadcast them, no NFT will be minted, and no SOL will be spent.\n\n" +
    "Continue to Solflare?",
  );
  if (!approved) return;

  nftState.busy = true;
  renderNftTool();
  showNftResult("working", `<strong>Preparing ${count} unsigned diagnostic transactions…</strong><span>Nothing has been sent to Solana.</span>`);
  let signedOutputs = null;
  try {
    const { payload } = await nftApi("batch-sign-test", {
      method: "POST",
      body: JSON.stringify({ count }),
    });
    if (payload.authority !== account.address || !Array.isArray(payload.transactions) || payload.transactions.length !== count) {
      throw new Error("The diagnostic service returned an invalid signing batch");
    }
    const inputs = payload.transactions.map((transactionBase64) => ({
      account,
      transaction: bytesFromBase64(transactionBase64),
      chain: SOLANA_MAINNET_CHAIN,
      options: { preflightCommitment: "confirmed" },
    }));
    payload.transactions.length = 0;
    const startedAt = performance.now();
    signedOutputs = await feature.signTransaction(...inputs);
    const durationMs = Math.round(performance.now() - startedAt);
    if (!Array.isArray(signedOutputs) || signedOutputs.length !== count || signedOutputs.some((output) => !(output?.signedTransaction instanceof Uint8Array))) {
      throw new Error(`Solflare returned ${signedOutputs?.length ?? 0} of ${count} signed transactions`);
    }
    showNftResult("success", `<strong>Batch ${count} passed in ${(durationMs / 1_000).toFixed(1)} seconds</strong><span>${count} transactions signed · 0 broadcast · 0 NFT minted · 0 SOL spent</span><small>The signed test transactions were discarded immediately.</small>`);
  } catch (error) {
    showNftResult("error", `<strong>Batch ${count} stopped</strong><span>${safe(error.message)}</span><small>0 transactions were broadcast. Try the previous smaller level.</small>`);
  } finally {
    signedOutputs = null;
    nftState.busy = false;
    renderNftTool();
  }
}

function showNftResult(kind, html) {
  $("nft-result").hidden = false;
  $("nft-result").className = `nft-result ${kind}`;
  $("nft-result").innerHTML = html;
}

async function loadNftConfig() {
  try {
    const { payload } = await nftApi("config");
    nftState.config = payload;
    const pending = Array.isArray(payload.pendingJobs) ? payload.pendingJobs : [];
    if (pending.length) {
      const job = pending[0];
      showNftResult("warning", `<strong>Interrupted mint batch found</strong><span>${safe(job.attempted)} of ${safe(job.total)} signed transactions entered the broadcast path. Audit it on Solana before starting another batch.</span><button class="nft-button secondary" id="nft-recover-pending" type="button">Audit interrupted batch</button>`);
      $("nft-recover-pending").addEventListener("click", () => recoverPendingNftJob(job.jobId));
    }
  } catch (error) {
    nftState.config = { enabled: false, maxRecipients: 1_000, mintsPerTransaction: 3, mintsPerApproval: 50 };
    showNftResult("error", `<strong>NFT tool unavailable</strong><span>${safe(error.message)}</span>`);
  }
  renderNftTool();
}

async function recoverPendingNftJob(jobId) {
  nftState.busy = true;
  renderNftTool();
  showNftResult("working", "<strong>Auditing the interrupted batch on Solana</strong><span>Nothing is being signed, retried or rebroadcast.</span>");
  try {
    const result = await reconcileNftJob(jobId);
    await loadSkrRegistry();
    const confirmed = result.assets?.length ?? 0;
    const released = result.released?.length ?? 0;
    showNftResult(result.partial ? "warning" : "success", `<strong>Interrupted batch audited</strong><span>${safe(confirmed)} NFTs confirmed · ${safe(released)} recipients returned to Ready · no blind retry.</span>`);
  } catch (error) {
    showNftResult("error", `<strong>Chain audit is still pending</strong><span>${safe(error.message)}</span>`);
  } finally {
    nftState.busy = false;
    renderNftTool();
  }
}

async function resolveNftNames() {
  nftState.busy = true;
  renderNftTool();
  showNftResult("working", "<strong>Resolving .skr names on Solana…</strong><span>No transaction is being created.</span>");
  try {
    const { payload } = await nftApi("resolve", { method: "POST", body: JSON.stringify({ names: nftState.names }) });
    nftState.rows = payload.rows || [];
    const valid = nftState.rows.filter((row) => row.status === "resolved").length;
    const retryNeeded = nftState.rows.filter((row) => row.status === "lookup_error").length;
    const invalid = nftState.rows.length - valid - retryNeeded;
    const detail = retryNeeded
      ? `${retryNeeded} temporary lookup${retryNeeded === 1 ? "" : "s"} could not be confirmed after automatic retries. Press Resolve again; they are not marked as missing.`
      : invalid
        ? `${invalid} row${invalid === 1 ? "" : "s"} must be corrected before minting.`
        : "Every username has a valid current wallet owner.";
    showNftResult(retryNeeded || invalid ? "warning" : "success", `<strong>${valid} recipient${valid === 1 ? "" : "s"} resolved</strong><span>${detail}</span>`);
  } catch (error) {
    showNftResult("error", `<strong>Resolution failed</strong><span>${safe(error.message)}</span>`);
  } finally {
    nftState.busy = false;
    renderNftTool();
  }
}

function availableAuthorityWallets() {
  return compatibleWalletStandardOptions(nftWalletRegistry.get());
}

async function connectNftWallet(option) {
  try {
    const connected = await connectWalletStandardOption(option);
    if (connected.account.address !== nftState.config.authority) {
      throw new Error(`This wallet opened ${connected.account.address}. Select the LuckyMe authority account ${nftState.config.authority}.`);
    }
    nftState.wallet = { ...connected, name: option.name };
    showNftResult("success", `<strong>${safe(option.name)} connected</strong><span>The authority address matches. Nothing has been signed.</span>`);
    renderNftTool();
  } catch (error) {
    showNftResult("error", `<strong>Wallet not connected</strong><span>${safe(error.message)}</span>`);
  }
}

function chooseNftWallet() {
  const options = availableAuthorityWallets();
  if (!options.length) {
    showNftResult("warning", "<strong>No compatible Solana wallet detected</strong><span>Open this Admin page in Brave, where your authority-backed Solflare extension is installed.</span>");
    return;
  }
  showNftResult("wallets", `<strong>Choose the authority wallet</strong><div class="nft-wallet-options">${options.map((option, index) => `<button type="button" data-nft-wallet="${index}">${option.icon ? `<img src="${safe(option.icon)}" alt="" />` : ""}<span>${safe(option.name)}</span></button>`).join("")}</div>`);
  document.querySelectorAll("[data-nft-wallet]").forEach((button) => button.addEventListener("click", () => connectNftWallet(options[Number(button.dataset.nftWallet)])));
}

function bytesFromBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function signNftTransactions(transactionsBase64) {
  const wallet = nftState.wallet?.standardWallet;
  const account = nftState.wallet?.account;
  const feature = wallet?.features?.[SOLANA_SIGN_TRANSACTION];
  if (!wallet || !account || typeof feature?.signTransaction !== "function") {
    throw new Error("The authority wallet cannot batch-sign these Solana transactions");
  }
  if (!Array.isArray(transactionsBase64) || transactionsBase64.length < 1 || transactionsBase64.length > 100) {
    throw new Error("A wallet approval must contain between 1 and 100 transactions");
  }
  const inputs = transactionsBase64.map((transactionBase64) => ({
    account,
    transaction: bytesFromBase64(transactionBase64),
    chain: SOLANA_MAINNET_CHAIN,
    options: { preflightCommitment: "confirmed", skipPreflight: false, maxRetries: 3 },
  }));
  const results = await feature.signTransaction(...inputs);
  if (!Array.isArray(results) || results.length !== inputs.length || results.some((result) => !(result?.signedTransaction instanceof Uint8Array))) {
    throw new Error(`The wallet returned ${results?.length ?? 0} of ${inputs.length} signed transactions`);
  }
  return results.map((result) => {
    let binary = "";
    for (const byte of result.signedTransaction) binary += String.fromCharCode(byte);
    return btoa(binary);
  });
}

async function confirmNftJob(jobId, signatures) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const { response, payload } = await nftApi("confirm", {
        method: "POST",
        body: JSON.stringify({ jobId, signatures }),
      });
      if (response.status !== 202) return payload;
    } catch (error) {
      if (error.httpStatus !== 503) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The transaction was sent, but confirmation is still pending. Check its signature in Solscan before retrying.");
}

async function reconcileNftJob(jobId) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    try {
      const { response, payload } = await nftApi("reconcile", {
        method: "POST",
        body: JSON.stringify({ jobId }),
      });
      if (response.status !== 202) return payload;
    } catch (error) {
      if (error.httpStatus !== 503) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("The submitted transactions are still pending. Do not retry; check their signatures in Solscan.");
}

async function mintNftBatch() {
  const recipients = nftState.rows.filter((row) => row.status === "resolved");
  const transactionSize = Math.max(1, Number(nftState.config.mintsPerTransaction) || 3);
  const approvalSize = Math.min(50, Math.max(1, Number(nftState.config.mintsPerApproval) || 50));

  nftState.busy = true;
  renderNftTool();
  const approvalGroups = [];
  for (let offset = 0; offset < recipients.length; offset += approvalSize) approvalGroups.push(recipients.slice(offset, offset + approvalSize));
  const completed = [];
  let submittedProgress = null;
  let activeJobId = null;
  try {
    for (let approvalIndex = 0; approvalIndex < approvalGroups.length; approvalIndex += 1) {
      const approvalRecipients = approvalGroups[approvalIndex];
      const transactionCount = Math.ceil(approvalRecipients.length / transactionSize);
      showNftResult("working", `<strong>Preparing approval ${approvalIndex + 1} of ${approvalGroups.length}</strong><span>${transactionCount} transactions for ${approvalRecipients.length} NFTs are being resolved and simulated. Solflare opens only after the complete batch is ready.</span>`);
      const confirmation = `MINT ${approvalRecipients.length} NFT${approvalRecipients.length === 1 ? "" : "S"}`;
      const prepared = await nftApi("prepare", {
        method: "POST",
        body: JSON.stringify({ names: approvalRecipients.map((row) => row.name), nonce: nftState.config.nftNonce, confirmation }),
      });
      activeJobId = prepared.payload.jobId;
      nftState.config.nftNonce = prepared.payload.nftNonce;
      const transactions = prepared.payload.plan?.transactions;
      if (!Array.isArray(transactions) || transactions.length !== transactionCount || transactions.some((transaction) => !transaction?.transactionBase64)) {
        throw new Error("The Admin service did not return the complete mint transaction batch");
      }

      showNftResult("working", `<strong>Approve batch ${approvalIndex + 1} of ${approvalGroups.length} once in Solflare</strong><span>${transactions.length} transactions · ${approvalRecipients.length} NFTs · one approval screen. Nothing is broadcast until the complete batch is signed.</span>`);
      const signedTransactions = await signNftTransactions(transactions.map((transaction) => transaction.transactionBase64));
      showNftResult("working", `<strong>Submitting signed batch ${approvalIndex + 1} of ${approvalGroups.length}</strong><span>The backend is broadcasting only the transactions approved in the single Solflare prompt.</span>`);
      const submitted = await nftApi("submit", {
        method: "POST",
        body: JSON.stringify({ jobId: prepared.payload.jobId, signedTransactions }),
      });
      submittedProgress = { submitted: submitted.payload.signatures?.length ?? 0, total: transactions.length };
      const signatures = submitted.payload.signatures;
      if (!Array.isArray(signatures) || signatures.length !== transactions.length) {
        throw new Error(`Only ${signatures?.length ?? 0} of ${transactions.length} signed transactions were submitted`);
      }
      showNftResult("working", `<strong>Confirming batch ${approvalIndex + 1} of ${approvalGroups.length}</strong><span>${signatures.length} transactions are being verified on Solana.</span>`);
      const confirmed = await confirmNftJob(prepared.payload.jobId, signatures);
      completed.push(...(confirmed.assets || []));
      submittedProgress = null;
      activeJobId = null;
    }
    nftState.names = [];
    nftState.rows = [];
    await loadSkrRegistry();
    showNftResult("success", `<strong>${completed.length} NFT${completed.length === 1 ? "" : "s"} confirmed on Solana</strong><div class="nft-confirmed-list">${completed.map((asset) => `<div><span>${safe(asset.name)}</span><code>${safe(asset.assetId)}</code><a href="https://solscan.io/tx/${encodeURIComponent(asset.signature)}" target="_blank" rel="noopener noreferrer">Solscan</a></div>`).join("")}</div>`);
  } catch (error) {
    if (!activeJobId && error.payload?.error === "recipient_already_has_pass") {
      const alreadyHeld = new Set((error.payload.recipients ?? []).map((row) => row.name));
      const removed = nftState.rows.filter((row) => alreadyHeld.has(row.name));
      nftState.names = nftState.names.filter((originalName, index) => {
        const row = nftState.rows[index];
        return !alreadyHeld.has(row?.name) && !alreadyHeld.has(originalName);
      });
      nftState.rows = [];
      await loadSkrRegistry();
      showNftResult("warning", `<strong>${removed.length} recipient${removed.length === 1 ? " already has" : "s already have"} the official NFT</strong><span>${safe(removed.map((row) => row.name).join(", "))} ${removed.length === 1 ? "was" : "were"} removed from this Send NFT queue and recorded in NFT history. Resolve the remaining names before continuing.</span>`);
      return;
    }
    let reconciled = null;
    if (activeJobId) {
      try {
        showNftResult("working", "<strong>Auditing the interrupted batch on Solana</strong><span>No transaction is being retried or rebroadcast.</span>");
        reconciled = await reconcileNftJob(activeJobId);
        completed.push(...(reconciled.assets || []));
        await loadSkrRegistry();
      } catch (reconcileError) {
        error = reconcileError;
      }
    }
    const submitted = Number(error.payload?.submitted ?? submittedProgress?.submitted ?? 0);
    const total = Number(error.payload?.total ?? submittedProgress?.total ?? 0);
    if (reconciled?.terminal) {
      const released = reconciled.released?.length ?? 0;
      const detail = `${completed.length} NFT${completed.length === 1 ? "" : "s"} confirmed · ${released} recipient${released === 1 ? "" : "s"} returned to Ready · no automatic retry.`;
      showNftResult(reconciled.partial ? "warning" : "success", `<strong>Batch audited on Solana</strong><span>${safe(detail)}</span>`);
    } else {
      const partial = submitted > 0;
      const detail = partial
        ? `${submitted}${total ? ` of ${total}` : ""} signed transactions were submitted to Solana. Do not retry this batch; run a chain audit first.`
        : `${completed.length} NFT${completed.length === 1 ? "" : "s"} were confirmed before the stop. No additional transaction was reported as submitted.`;
      showNftResult("error", `<strong>Mint flow stopped</strong><span>${safe(error.message)}</span><small>${safe(detail)}</small>`);
    }
  } finally {
    nftState.busy = false;
    renderNftTool();
  }
}

function renderAcquisition() {
  const analytics = referralSnapshot.appAnalytics ?? {};
  $("acquisition-summary").innerHTML = [
    ["Unique activations", analytics.uniqueActivations ?? 0],
    ["Active today", analytics.activeToday ?? 0],
    ["Total launches", analytics.launches ?? 0],
    ["Measured versions", analytics.versions?.length ?? 0],
  ].map(([label, value]) => `<article class="referral-stat"><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("");
  $("acquisition-versions").innerHTML = (analytics.versions ?? []).map((item) => `<article class="referral-card"><div class="referral-card-head"><div><span class="eyebrow">Version code ${safe(item.versionCode)}</span><h3>LuckyMe ${safe(item.appVersion)}</h3></div><span class="referral-status qualified">dApp Store</span></div><div class="referral-progress"><div><strong>${safe(item.uniqueActivations)}</strong><span>Unique activations</span></div><div><strong>${safe(item.launches)}</strong><span>Total launches</span></div></div></article>`).join("") || `<p class="entry-empty history-empty">No measured activations yet.</p>`;
}

function promotionStatusClass(status) {
  if (status === "paid") return "qualified";
  if (status === "drawn_unfunded") return "ready";
  if (["commitment_frozen", "randomness_pending"].includes(status)) return "pending";
  return status === "open" ? "qualified" : "invalid";
}

function renderPromotions() {
  const promotions = Array.isArray(referralSnapshot.promotions) ? referralSnapshot.promotions : [];
  $("promotion-list").innerHTML = promotions.length ? promotions.map((promotion) => {
    const prizes = (promotion.prizes ?? []).map((prize) => `<div><span>#${safe(prize.rank)}</span><strong>${safe(Number(prize.prizeSol).toFixed(3))} SOL</strong></div>`).join("");
    const winners = (promotion.winners ?? []).map((winner) => `<div class="history-winner"><span>#${safe(winner.rank)}</span><code class="wallet-address">${safe(winner.wallet)}</code><strong>${safe(Number(winner.prizeSol).toFixed(3))} SOL</strong></div>`).join("");
    const drawEvidence = promotion.entryCommitment
      ? `<div class="promotion-evidence"><div><span>Entry commitment</span><code>${safe(promotion.entryCommitment)}</code></div><div><span>Target / resolved slot</span><code>${safe(promotion.targetSlot)} / ${safe(promotion.resolvedSlot)}</code></div><div><span>Randomness hash</span><code>${safe(promotion.randomnessHash)}</code></div></div>`
      : "";
    return `<article class="promotion-card">
      <div class="referral-card-head"><div><span class="eyebrow">${safe(promotion.campaignId)}</span><h3>${safe(promotion.name)}</h3></div><span class="referral-status ${promotionStatusClass(promotion.status)}">${safe(promotion.status)}</span></div>
      <div class="referral-summary promotion-summary"><article class="referral-stat"><span>Validated NFTs</span><strong>${safe(promotion.entryCount)} / ${safe(promotion.entryThreshold)}</strong></article><article class="referral-stat"><span>Winners</span><strong>${safe(promotion.winnerCount)}</strong></article><article class="referral-stat"><span>Total prizes</span><strong>${safe(Number(promotion.prizeSol).toFixed(2))} SOL</strong></article><article class="referral-stat"><span>Funding</span><strong>${promotion.funded ? "Funded" : "Not loaded"}</strong></article></div>
      <div class="promotion-progress"><span style="width:${Math.max(0, Math.min(100, Number(promotion.progressPercent ?? 0)))}%"></span></div>
      <p class="panel-copy">${safe(promotion.entriesRemaining)} verified entries remaining · payout ${promotion.payoutEnabled ? "enabled" : "locked"}</p>
      <div class="promotion-prizes">${prizes}</div>
      ${drawEvidence}
      ${winners ? `<div class="history-winners promotion-winners"><span class="eyebrow">Draw winners</span>${winners}</div>` : ""}
    </article>`;
  }).join("") : `<p class="entry-empty history-empty">No promotions are registered.</p>`;
}

function statusClass(status) {
  if (["qualified", "qualified_test"].includes(status)) return "qualified";
  if (status === "ready_to_qualify") return "ready";
  if (status === "invalidated") return "invalid";
  return "pending";
}

function renderReferrals() {
  const selectedStatus = $("referral-status").value;
  const search = $("referral-search").value.trim().toLowerCase();
  const counts = referralSnapshot.counts ?? {};
  $("referral-summary").innerHTML = [
    ["Verified SGTs", referralSnapshot.verifiedIdentities ?? 0],
    ["Referral profiles", referralSnapshot.profiles ?? 0],
    ["Pending", counts.pending ?? 0],
    ["Qualified", (counts.qualified ?? 0) + (counts.qualified_test ?? 0)],
  ].map(([label, value]) => `<article class="referral-stat"><span>${safe(label)}</span><strong>${safe(value)}</strong></article>`).join("");

  const filtered = referralBindings.filter((binding) => {
    const statusMatches = !selectedStatus || binding.status === selectedStatus ||
      (selectedStatus === "qualified" && binding.status === "qualified_test");
    const haystack = [
      binding.referralCode,
      binding.referrer?.wallet,
      binding.referred?.wallet,
      binding.referrer?.sgtMint,
      binding.referred?.sgtMint,
    ].join(" ").toLowerCase();
    return statusMatches && (!search || haystack.includes(search));
  });

  $("referral-list").innerHTML = filtered.length ? filtered.map((binding) => {
    const progress = binding.progress ?? {};
    return `<article class="referral-card">
      <div class="referral-card-head"><div><span class="eyebrow">${safe(binding.referralCode)}</span><h3>${safe(binding.referrer?.wallet)} → ${safe(binding.referred?.wallet)}</h3></div><span class="referral-status ${statusClass(binding.status)}">${safe(binding.status)}</span></div>
      <div class="referral-identities">
        <div><span>Referrer wallet</span><code class="wallet-address">${safe(binding.referrer?.wallet)}</code><small>SGT ${safe(binding.referrer?.sgtMint)}</small></div>
        <div><span>Referred wallet</span><code class="wallet-address">${safe(binding.referred?.wallet)}</code><small>SGT ${safe(binding.referred?.sgtMint)}</small></div>
      </div>
      <div class="referral-progress">
        <div><strong>${safe(Math.min(Number(progress.winningRounds ?? 0), 3))}/3</strong><span>Completed rounds</span></div>
        <div><strong>${safe(Math.min(Number(progress.playDays ?? 0), 3))}/3</strong><span>Play days</span></div>
        <div><strong>${safe(Math.min(Number(progress.activeDays ?? 0), 7))}/7</strong><span>Active days</span></div>
      </div>
      <div class="history-footer"><span>Bound ${binding.boundAt ? safe(new Date(binding.boundAt).toLocaleString()) : "—"}</span><span>Last active ${safe(binding.lastActivityDate ?? "—")}</span></div>
    </article>`;
  }).join("") : `<p class="entry-empty history-empty">No referral matches this filter.</p>`;
}

function renderWinnerHistory() {
  const pool = $("history-pool").value;
  const roundFilter = $("history-round").value.trim();
  const rounds = winnerRounds.filter((round) =>
    (!pool || round.pool === pool) && (!roundFilter || String(round.roundId) === roundFilter));
  $("winner-history").innerHTML = rounds.length ? rounds.map((round) => {
    const winners = (round.winners ?? []).map((winner) => `<div class="history-winner"><span>#${safe(winner.rank)}</span><code class="wallet-address">${safe(winner.wallet)}</code><strong>${safe(sol(winner.prizeLamports))}</strong></div>`).join("");
    const jackpot = round.jackpot ? `<div class="history-winner jackpot"><span>Jackpot</span><code class="wallet-address">${safe(round.jackpot.wallet)}</code><strong>${safe(sol(round.jackpot.prizeLamports))}</strong></div>` : "";
    const empty = !winners && !jackpot ? `<p class="entry-empty">No winner — ${safe(round.outcome === "cancelled_below_minimum" ? "round refunded" : round.outcome)}</p>` : "";
    const explorer = /^[1-9A-HJ-NP-Za-km-z]{64,88}$/.test(round.settlementSignature ?? "") ? `<a class="explorer" href="https://solscan.io/tx/${encodeURIComponent(round.settlementSignature)}" target="_blank" rel="noopener noreferrer">Settlement transaction</a>` : "";
    return `<article class="history-round"><div class="entry-heading"><div><span class="eyebrow">${safe(round.pool)}</span><h3>Round ${safe(round.roundId)}</h3></div><div class="entry-total"><strong>${safe(round.totalTickets)} tickets</strong><span>${safe(sol(round.totalLamports))} played</span></div></div><div class="history-winners">${winners}${jackpot}${empty}</div><div class="history-footer"><span>${round.archivedAt ? safe(new Date(round.archivedAt).toLocaleString()) : "Archived"}</span>${explorer}</div></article>`;
  }).join("") : `<p class="entry-empty history-empty">No archived round matches this filter.</p>`;
}

function render(report) {
  $("overall").textContent = report.ok ? "All systems healthy" : `${report.alerts.length} alert${report.alerts.length === 1 ? "" : "s"}`;
  $("overall").className = `status ${report.ok ? "ok" : "bad"}`;
  $("updated").textContent = `Updated ${new Date(report.timestamp).toLocaleString()} · refreshes every 15 seconds`;
  $("alerts").innerHTML = report.alerts.length ? report.alerts.map((item) => `<div class="alert"><strong>${safe(item.code)}</strong>${safe(item.message)}</div>`).join("") : "";
  const keeperSol = Number(report.checks?.keeper?.balanceLamports ?? 0) / 1_000_000_000;
  $("summary").innerHTML = [
    ["API", report.checks?.api?.ok ? "Healthy" : "Unavailable", report.checks?.api?.cluster ?? "mainnet-beta"],
    ["Solana RPC", report.checks?.rpc?.ok ? "Healthy" : "Unavailable", `confirmed slot ${report.checks?.rpc?.slot ?? "—"}`],
    ["Keeper balance", `${keeperSol.toFixed(6)} SOL`, safe(report.checks?.keeper?.address)],
    ["Open alerts", String(report.alerts?.length ?? 0), report.ok ? "No action required" : "Review details above"],
  ].map(([title,value,copy]) => `<article class="card"><span class="eyebrow">${safe(title)}</span><strong class="card-value ${value === "Healthy" || value === "0" ? "good" : ""}">${safe(value)}</strong><p class="card-copy">${safe(copy)}</p></article>`).join("");
  $("rounds").innerHTML = (report.checks?.rounds ?? []).map((round) => `<article class="round"><h3>${safe(round.pool)}</h3><div class="kv"><span>Round</span><strong>${safe(round.roundId)}</strong></div><div class="kv"><span>Outcome</span><strong>${safe(round.outcome)}</strong></div><div class="kv"><span>Started</span><strong>${round.startTs > 0 ? new Date(round.startTs * 1000).toLocaleTimeString() : "Waiting"}</strong></div><div class="kv"><span>Settled</span><strong>${round.settled ? "Yes" : "No"}</strong></div></article>`).join("");
  $("treasury-pools").innerHTML = (report.checks?.rounds ?? []).map((round) => {
    const bps = Number(round.treasuryHouseFeeBps);
    const percent = round.treasuryHouseFeeBps != null && Number.isFinite(bps) ? `${(bps / 100).toFixed(2)}%` : "—";
    const estimate = round.treasuryEstimateLamports == null ? "Unavailable" : sol(round.treasuryEstimateLamports);
    const settlementCopy = Number(round.totalTickets ?? 0) === 0
      ? "No tickets sold yet"
      : round.minimumReached
        ? "Target reached · paid at settlement"
        : "Paid only if the round reaches its target";
    return `<article class="treasury-pool"><span class="eyebrow">${safe(round.pool)} · round ${safe(round.roundId)}</span><strong class="treasury-value">${safe(estimate)}</strong><div class="kv"><span>Treasury rate</span><strong>${safe(percent)}</strong></div><div class="kv"><span>Ticket value</span><strong>${safe(sol(round.totalLamports))}</strong></div><p class="treasury-copy">${safe(settlementCopy)}</p></article>`;
  }).join("");
  $("entry-pools").innerHTML = (report.checks?.rounds ?? []).map((round) => {
    const entries = Array.isArray(round.entries) ? round.entries : [];
    const wallets = entries.length
      ? entries.map((entry) => `<div class="entry-wallet"><code class="wallet-address">${safe(entry.player)}</code><div class="entry-metrics"><strong>${safe(entry.ticketCount)} ticket${String(entry.ticketCount) === "1" ? "" : "s"}</strong><span>${safe(sol(entry.lamports))}</span></div></div>`).join("")
      : `<p class="entry-empty">No tickets in this round.</p>`;
    return `<article class="entry-pool"><div class="entry-heading"><div><span class="eyebrow">${safe(round.pool)}</span><h3>Round ${safe(round.roundId)}</h3></div><div class="entry-total"><strong>${safe(round.totalTickets)} tickets</strong><span>${safe(round.walletCount ?? entries.length)} wallets</span></div></div><div class="entry-wallets">${wallets}</div></article>`;
  }).join("");
  winnerRounds = Array.isArray(report.checks?.winnerHistory?.rounds) ? report.checks.winnerHistory.rounds : [];
  renderWinnerHistory();
  referralSnapshot = report.checks?.referrals ?? { counts: {}, profiles: 0, verifiedIdentities: 0 };
  referralBindings = Array.isArray(referralSnapshot.bindings) ? referralSnapshot.bindings : [];
  renderReferrals();
  renderAcquisition();
  renderPromotions();
  $("services").innerHTML = ["settlement","notifications"].map((name) => { const check=report.checks?.[name]??{}; return `<article class="service"><h3>${safe(name)}</h3><div class="kv"><span>Timer</span><strong>${safe(check.timer?.ActiveState)}</strong></div><div class="kv"><span>Enabled</span><strong>${safe(check.timer?.UnitFileState)}</strong></div><div class="kv"><span>Last run</span><strong>${safe(stateLabel(check.service))}</strong></div><div class="kv"><span>Exit</span><strong>${safe(check.service?.ExecMainStatus ?? "0")}</strong></div></article>`; }).join("");
}

$("history-pool").addEventListener("change", renderWinnerHistory);
$("history-round").addEventListener("input", renderWinnerHistory);
$("referral-status").addEventListener("change", renderReferrals);
$("referral-search").addEventListener("input", renderReferrals);

function selectTab(name) {
  const selected = ["status", "treasury", "winners", "referrals", "downloads", "promotions", "skr-database", "nft-send"].includes(name) ? name : "status";
  document.querySelectorAll("[data-admin-tab]").forEach((button) => {
    button.classList.toggle("active", button.dataset.adminTab === selected);
  });
  document.querySelectorAll("[data-admin-panel]").forEach((panel) => {
    panel.classList.toggle("active", panel.dataset.adminPanel === selected);
  });
  history.replaceState(null, "", `#${selected}`);
  if (selected === "skr-database") loadSkrRegistry();
}

document.querySelectorAll("[data-admin-tab]").forEach((button) => {
  button.addEventListener("click", () => selectTab(button.dataset.adminTab));
});
selectTab(location.hash.slice(1));

function commitNftInput() {
  const input = $("nft-recipient-input");
  addNftNames(input.value);
  input.value = "";
  input.focus();
}

$("nft-add-recipients").addEventListener("click", commitNftInput);
$("nft-recipient-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    commitNftInput();
  }
});
$("nft-clear").addEventListener("click", () => {
  nftState.names = [];
  nftState.rows = [];
  nftState.wallet = null;
  $("nft-result").hidden = true;
  renderNftTool();
});
$("nft-resolve").addEventListener("click", resolveNftNames);
$("nft-connect-wallet").addEventListener("click", chooseNftWallet);
$("nft-batch-connect-wallet").addEventListener("click", chooseNftWallet);
document.querySelectorAll("[data-batch-sign-count]").forEach((button) => {
  button.addEventListener("click", () => runBatchSigningDiagnostic(Number(button.dataset.batchSignCount)));
});
$("nft-mint").addEventListener("click", mintNftBatch);
$("skr-database-save").addEventListener("click", saveSkrDatabase);
$("skr-database-clear").addEventListener("click", () => { $("skr-database-input").value = ""; $("skr-database-input").focus(); });
$("skr-prepare-50").addEventListener("click", prepareNextSkrBatch);
$("skr-release-reserved").addEventListener("click", releaseReservedSkr);
$("skr-registry-status").addEventListener("change", loadSkrRegistry);
$("skr-registry-search").addEventListener("input", () => {
  clearTimeout(skrState.searchTimer);
  skrState.searchTimer = setTimeout(loadSkrRegistry, 200);
});
$("skr-registry-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-skr-remove]");
  if (button) removeSkrUsername(button.dataset.skrRemove);
});
loadNftConfig();
loadSkrRegistry();

async function refresh() {
  try {
    const response = await fetch("/admin/status.json", { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    render(await response.json());
  } catch (error) {
    $("overall").textContent = "Status unavailable";
    $("overall").className = "status bad";
    $("alerts").innerHTML = `<div class="alert"><strong>dashboard_error</strong>${safe(error.message)}</div>`;
  }
}

refresh();
window.setInterval(refresh, 15_000);
