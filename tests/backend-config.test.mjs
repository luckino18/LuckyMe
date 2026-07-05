import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";

test("backend refuses mainnet release without a configured RPC", async () => {
  const result = await runServerExpectingExit({
    ANCHOR_PROVIDER_URL: "",
    LUCKYME_RELEASE_MODE: "MAINNET_RELEASE",
    LUCKYME_PRODUCTION_RANDOMNESS: "true",
    CORS_ORIGIN: "https://luckyme.example",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /ANCHOR_PROVIDER_URL is required for MAINNET_RELEASE/);
});

test("backend refuses mainnet release on non-HTTPS RPC", async () => {
  const result = await runServerExpectingExit({
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:8899",
    LUCKYME_RELEASE_MODE: "MAINNET_RELEASE",
    LUCKYME_PRODUCTION_RANDOMNESS: "true",
    CORS_ORIGIN: "https://luckyme.example",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /MAINNET_RELEASE requires an HTTPS Solana RPC URL/);
});

test("backend refuses mainnet release on known non-mainnet RPC", async () => {
  const result = await runServerExpectingExit({
    ANCHOR_PROVIDER_URL: "https://api.devnet.solana.com",
    LUCKYME_RELEASE_MODE: "MAINNET_RELEASE",
    LUCKYME_PRODUCTION_RANDOMNESS: "true",
    LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    CORS_ORIGIN: "https://luckyme.example",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /MAINNET_RELEASE requires a mainnet-beta Solana RPC URL/);
});

test("backend refuses mainnet release without ORAO production randomness", async () => {
  const result = await runServerExpectingExit({
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    LUCKYME_RELEASE_MODE: "MAINNET_RELEASE",
    LUCKYME_RANDOMNESS_MODE: "commit_reveal_demo",
    LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    CORS_ORIGIN: "https://luckyme.example",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /MAINNET_RELEASE requires LUCKYME_RANDOMNESS_MODE=orao_vrf/);
});

test("backend accepts strict mainnet production health config", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    HOST: "0.0.0.0",
    NODE_ENV: "production",
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    LUCKYME_RELEASE_MODE: "MAINNET_RELEASE",
    LUCKYME_RANDOMNESS_MODE: "orao_vrf",
    LUCKYME_PRODUCTION_RANDOMNESS: "true",
    LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    CORS_ORIGIN: "https://luckyme.example",
  });

  try {
    await waitForOutput(child, /LuckyMe API listening/);
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.service, "luckyme-api");
    assert.equal(payload.mode, "MAINNET_RELEASE");
    assert.equal(payload.cluster, "mainnet-beta");
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
  }
});

test("backend disables simulate endpoint in mainnet release", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    HOST: "0.0.0.0",
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    LUCKYME_RELEASE_MODE: "MAINNET_RELEASE",
    LUCKYME_RANDOMNESS_MODE: "orao_vrf",
    LUCKYME_PRODUCTION_RANDOMNESS: "true",
    LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
    CORS_ORIGIN: "https://luckyme.example",
  });

  try {
    await waitForOutput(child, /LuckyMe API listening/);
    const response = await fetch(`http://127.0.0.1:${port}/simulate`);
    const payload = await response.json();

    assert.equal(response.status, 404);
    assert.equal(payload.error, "not_found");
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
  }
});

test("backend store build disables local simulate and commit-reveal public config", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:1",
    LUCKYME_RELEASE_MODE: "LOCAL_DEVELOPMENT",
    LUCKYME_RANDOMNESS_MODE: "commit_reveal_demo",
    LUCKYME_STORE_BUILD: "true",
  });

  try {
    await waitForOutput(child, /LuckyMe API listening/);

    const simulateResponse = await fetch(`http://127.0.0.1:${port}/simulate`);
    const simulatePayload = await simulateResponse.json();
    assert.equal(simulateResponse.status, 404);
    assert.equal(simulatePayload.error, "not_found");

    const configResponse = await fetch(`http://127.0.0.1:${port}/config`);
    const configPayload = await configResponse.json();
    assert.equal(configResponse.status, 200);
    assert.deepEqual(configPayload.supportedRandomnessModes, ["orao_vrf"]);
    assert.equal(configPayload.randomnessProvider.provider, "orao_vrf");
    assert.equal(configPayload.randomnessProvider.commitRevealAllowed, false);

    const poolsResponse = await fetch(`http://127.0.0.1:${port}/pools`);
    const poolsPayload = await poolsResponse.json();
    assert.equal(poolsResponse.status, 503);
    assert.notEqual(poolsPayload.source, "static");
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
  }
});

test("backend production runtime requires mainnet release mode", async () => {
  const result = await runServerExpectingExit({
    HOST: "0.0.0.0",
    NODE_ENV: "production",
    LUCKYME_RELEASE_MODE: "LOCAL_DEVELOPMENT",
    CORS_ORIGIN: "https://luckyme.example",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /NODE_ENV=production requires LUCKYME_RELEASE_MODE=MAINNET_RELEASE/);
});

test("backend accepts ORAO randomness mode for public config", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:1",
    LUCKYME_RELEASE_MODE: "LOCAL_DEVELOPMENT",
    LUCKYME_RANDOMNESS_MODE: "orao_vrf",
  });

  try {
    await waitForOutput(child, /LuckyMe API listening/);
    const response = await fetch(`http://127.0.0.1:${port}/config`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.randomnessMode, "orao_vrf");
    assert.equal(payload.randomnessProvider.provider, "orao_vrf");
    assert.equal(payload.randomnessProvider.failover, "none");
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
  }
});

test("backend production mode requires strict CORS", async () => {
  const result = await runServerExpectingExit({
    HOST: "0.0.0.0",
    NODE_ENV: "production",
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
    CORS_ORIGIN: "*",
    LUCKYME_RELEASE_MODE: "MAINNET_RELEASE",
    LUCKYME_RANDOMNESS_MODE: "orao_vrf",
    LUCKYME_PRODUCTION_RANDOMNESS: "true",
    LUCKYME_SOLANA_CLUSTER: "mainnet-beta",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /CORS_ORIGIN must be strict/);
});

test("backend transaction submit relay is disabled by default", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:1",
    LUCKYME_RELEASE_MODE: "LOCAL_DEVELOPMENT",
  });

  try {
    await waitForOutput(child, /LuckyMe API listening/);
    const response = await fetch(`http://127.0.0.1:${port}/transactions/submit`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    const payload = await response.json();

    assert.equal(response.status, 403);
    assert.equal(payload.error, "transaction_submit_disabled");
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
  }
});

test("backend exposes safe public config", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:1",
    LUCKYME_RELEASE_MODE: "LOCAL_DEVELOPMENT",
  });

  try {
    await waitForOutput(child, /LuckyMe API listening/);
    const response = await fetch(`http://127.0.0.1:${port}/config`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.mode, "LOCAL_DEVELOPMENT");
    assert.equal(payload.releaseMode, "LOCAL_DEVELOPMENT");
    assert.equal(payload.randomnessMode, "commit_reveal_demo");
    assert.deepEqual(payload.supportedRandomnessModes, ["commit_reveal_demo", "orao_vrf"]);
    assert.equal(payload.economics.houseFeeBps, 100);
    assert.equal(payload.economics.jackpotBps, 100);
    assert.equal(payload.economics.mainPrizeBps, 9800);
    assert.equal(payload.economics.roundDurationSeconds, 3600);
    assert.equal(payload.realFundsEnabled, false);
    assert.equal(payload.releaseChecks.backendSignsPlayerTransactions, false);
  } finally {
    child.kill();
    await once(child, "exit").catch(() => {});
  }
});

async function runServerExpectingExit(env) {
  const child = startServer(env);
  const [code] = await once(child, "exit");
  return {
    code,
    output: child.output,
  };
}

function startServer(env) {
  const child = spawn(process.execPath, ["backend/src/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOST: "0.0.0.0",
      PORT: "8788",
      LUCKYME_RELEASE_MODE: "LOCAL_DEVELOPMENT",
      LUCKYME_RANDOMNESS_MODE: "commit_reveal_demo",
      LUCKYME_STORE_BUILD: "false",
      LUCKYME_STRICT_ONCHAIN: "false",
      LUCKYME_SOLANA_CLUSTER: "localnet",
      LUCKYME_PRODUCTION_RANDOMNESS: "false",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  child.output = "";
  child.stdout.on("data", (chunk) => {
    child.output += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    child.output += chunk.toString("utf8");
  });
  return child;
}

async function waitForOutput(child, pattern) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 10_000) {
    if (pattern.test(child.output)) {
      return;
    }
    if (child.exitCode !== null) {
      throw new Error(`Server exited early: ${child.output}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${pattern}: ${child.output}`);
}

async function getFreePort() {
  const server = http.createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  server.close();
  await once(server, "close");
  return port;
}
