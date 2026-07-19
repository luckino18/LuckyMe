const $ = (id) => document.getElementById(id);
const names = new Map();
const copied = new Set();
let scanning = false;
let captureBusy = false;
let timer = null;
let lastViewKey = "";
let unchangedViews = 0;

async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: { ...(options.body ? { "content-type": "application/json" } : {}), ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  return payload;
}

function message(text, kind = "info") {
  $("message").hidden = false;
  $("message").className = `message ${kind}`;
  $("message").textContent = text;
}

function render() {
  const all = [...names.keys()];
  const remaining = all.filter((name) => !copied.has(name));
  $("captured-count").textContent = all.length;
  $("remaining-count").textContent = remaining.length;
  $("copied-count").textContent = copied.size;
  $("username-list").innerHTML = all.length
    ? all.map((name, index) => `<article class="${copied.has(name) ? "copied" : ""}"><span>${index + 1}</span><strong>${name}</strong><small>${copied.has(name) ? "COPIED" : "READY"}</small></article>`).join("")
    : "<p>No .skr usernames captured yet.</p>";
  $("start").disabled = scanning || !$("device").value;
  $("stop").disabled = !scanning;
  $("copy-batch").disabled = remaining.length === 0;
  $("copy-all").disabled = remaining.length === 0;
  $("reset-copied").disabled = copied.size === 0;
  $("clear").disabled = all.length === 0;
}

function renderDevices(devices = []) {
  const current = $("device").value;
  const connected = devices.filter((device) => device.state === "device");
  $("device").innerHTML = connected.length
    ? connected.map((device) => `<option value="${device.serial}">${device.serial}</option>`).join("")
    : '<option value="">No device detected</option>';
  if (connected.some((device) => device.serial === current)) $("device").value = current;
  render();
}

async function refresh() {
  try {
    const payload = await api("/status");
    $("bridge-status").textContent = "Bridge ready";
    $("bridge-status").className = "status ready";
    renderDevices(payload.devices || []);
  } catch (error) {
    $("bridge-status").textContent = "Bridge offline";
    $("bridge-status").className = "status offline";
    message(error.message, "error");
  }
}

async function pair() {
  try {
    const payload = await api("/pair", { method: "POST", body: JSON.stringify({ address: $("pair-address").value, code: $("pair-code").value }) });
    $("pair-code").value = "";
    message(payload.output || (payload.ok ? "Seeker paired." : "Pairing needs attention."), payload.ok ? "success" : "warning");
  } catch (error) {
    $("pair-code").value = "";
    message(error.message, "error");
  }
}

async function connect() {
  try {
    const payload = await api("/connect", { method: "POST", body: JSON.stringify({ address: $("connect-address").value }) });
    renderDevices(payload.devices || []);
    message(payload.output || (payload.ok ? "ADB connected." : "Connection needs attention."), payload.ok ? "success" : "warning");
  } catch (error) {
    message(error.message, "error");
  }
}

async function capture() {
  if (captureBusy || !$("device").value) return;
  captureBusy = true;
  try {
    const payload = await api("/capture", { method: "POST", body: JSON.stringify({ serial: $("device").value, autoScroll: scanning }) });
    let added = 0;
    for (const name of payload.names || []) {
      if (names.has(name)) continue;
      names.set(name, payload.capturedAt);
      added += 1;
    }
    if (added) message(`${added} new username${added === 1 ? "" : "s"} captured.`, "success");
    if (scanning && payload.viewKey) {
      unchangedViews = payload.viewKey === lastViewKey ? unchangedViews + 1 : 0;
      lastViewKey = payload.viewKey;
      if (unchangedViews >= 2) {
        stop();
        message("End of the review list detected. Auto-scroll stopped.", "success");
      }
    }
    render();
  } catch (error) {
    stop();
    message(error.message, "error");
  } finally {
    captureBusy = false;
  }
}

function schedule() {
  clearTimeout(timer);
  if (!scanning) return;
  timer = setTimeout(async () => { await capture(); schedule(); }, 700);
}

function start() {
  scanning = true;
  lastViewKey = "";
  unchangedViews = 0;
  message("Auto-capture active. Keep the review list open; LuckyMe will scroll until the end or until you press Stop.", "success");
  render();
  capture().finally(schedule);
}

function stop() {
  scanning = false;
  clearTimeout(timer);
  timer = null;
  render();
}

async function copyValues(values) {
  const text = values.join("\n");
  $("export-output").value = text;
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    $("export-output").focus();
    $("export-output").select();
    document.execCommand("copy");
  }
  values.forEach((name) => copied.add(name));
  message(`${values.length} username${values.length === 1 ? "" : "s"} copied. Paste them into Send NFT.`, "success");
  render();
}

function nextValues(limit) {
  return [...names.keys()].filter((name) => !copied.has(name)).slice(0, limit);
}

$("pair").addEventListener("click", pair);
$("connect").addEventListener("click", connect);
$("refresh").addEventListener("click", refresh);
$("device").addEventListener("change", render);
$("start").addEventListener("click", start);
$("stop").addEventListener("click", stop);
$("copy-batch").addEventListener("click", () => copyValues(nextValues(Number($("batch-size").value))));
$("copy-all").addEventListener("click", () => copyValues(nextValues(Number.MAX_SAFE_INTEGER)));
$("reset-copied").addEventListener("click", () => { copied.clear(); render(); message("Copied marks reset."); });
$("clear").addEventListener("click", () => { stop(); names.clear(); copied.clear(); $("export-output").value = ""; render(); message("Local list cleared."); });

refresh();
