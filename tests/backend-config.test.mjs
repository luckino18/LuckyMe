import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";

test("backend refuses mainnet RPC without required signoffs", async () => {
  const result = await runServerExpectingExit({
    ANCHOR_PROVIDER_URL: "https://api.mainnet-beta.solana.com",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /DEVNET_STORE_DEMO cannot use a mainnet RPC/);
});

test("backend refuses mainnet beta candidate without production randomness", async () => {
  const result = await runServerExpectingExit({
    ANCHOR_PROVIDER_URL: "https://api.devnet.solana.com",
    LUCKYME_RELEASE_MODE: "MAINNET_BETA_CANDIDATE",
    LUCKYME_PRODUCTION_RANDOMNESS: "false",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /MAINNET_BETA_CANDIDATE requires LUCKYME_RANDOMNESS_MODE=orao_vrf/);
});

test("backend refuses mainnet beta candidate on commit reveal", async () => {
  const result = await runServerExpectingExit({
    ANCHOR_PROVIDER_URL: "https://api.devnet.solana.com",
    LUCKYME_RELEASE_MODE: "MAINNET_BETA_CANDIDATE",
    LUCKYME_PRODUCTION_RANDOMNESS: "true",
    LUCKYME_RANDOMNESS_MODE: "commit_reveal_demo",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /LUCKYME_RANDOMNESS_MODE=orao_vrf/);
});

test("backend accepts ORAO randomness mode for public config", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:1",
    LUCKYME_RANDOMNESS_MODE: "orao_vrf",
  });

  try {
    await waitForOutput(child, /LuckyMe dev API listening/);
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
    NODE_ENV: "production",
    CORS_ORIGIN: "*",
  });

  assert.notEqual(result.code, 0);
  assert.match(result.output, /CORS_ORIGIN must be strict/);
});

test("backend transaction submit relay is disabled by default", async () => {
  const port = await getFreePort();
  const child = startServer({
    PORT: String(port),
    ANCHOR_PROVIDER_URL: "http://127.0.0.1:1",
  });

  try {
    await waitForOutput(child, /LuckyMe dev API listening/);
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
  });

  try {
    await waitForOutput(child, /LuckyMe dev API listening/);
    const response = await fetch(`http://127.0.0.1:${port}/config`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.mode, "DEVNET_STORE_DEMO");
    assert.equal(payload.releaseMode, "DEVNET_STORE_DEMO");
    assert.equal(payload.randomnessMode, "commit_reveal_demo");
    assert.deepEqual(payload.supportedRandomnessModes, ["commit_reveal_demo", "orao_vrf"]);
    assert.equal(payload.economics.houseFeeBps, 100);
    assert.equal(payload.economics.jackpotBps, 100);
    assert.equal(payload.economics.mainPrizeBps, 9800);
    assert.equal(payload.economics.roundDurationSeconds, 3600);
    assert.equal(payload.realFundsEnabled, false);
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
      HOST: "127.0.0.1",
      PORT: "0",
      LUCKYME_RELEASE_MODE: "DEVNET_STORE_DEMO",
      LUCKYME_RANDOMNESS_MODE: "commit_reveal_demo",
      LUCKYME_STORE_BUILD: "false",
      LUCKYME_STRICT_ONCHAIN: "false",
      LUCKYME_ENABLE_MAINNET: "false",
      LUCKYME_LEGAL_SIGNOFF: "false",
      LUCKYME_PRODUCTION_RANDOMNESS: "false",
      LUCKYME_MULTISIG_SIGNOFF: "false",
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
