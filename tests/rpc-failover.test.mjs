import assert from "node:assert/strict";
import test from "node:test";
import { createRpcFailoverFetch, isRetryableRpcError, rpcProvidersFromEnv } from "../scripts/rpc-failover.mjs";

test("RPC providers are ordered, deduplicated and public fallback is explicit", () => {
  const providers = rpcProvidersFromEnv("https://primary.example", {
    LUCKYME_RPC_SHYFT_URL: "https://primary.example",
    LUCKYME_RPC_CHAINSTACK_URL: "https://chainstack.example",
    LUCKYME_RPC_ALCHEMY_URL: "https://alchemy.example",
    LUCKYME_RPC_PUBLIC_FALLBACK: "true",
  });
  assert.deepEqual(providers.map(({ name }) => name), [
    "primary",
    "chainstack",
    "alchemy",
    "solana-public",
  ]);
});

test("RPC fetch fails over on quota errors and sticks to the healthy provider", async () => {
  const calls = [];
  const rpcFetch = createRpcFailoverFetch({
    primaryUrl: "https://primary.example",
    env: { LUCKYME_RPC_CHAINSTACK_URL: "https://backup.example" },
    fetchImpl: async (url) => {
      calls.push(url);
      if (url.includes("primary")) {
        return Response.json({ error: { code: -32000, message: "max usage reached" } });
      }
      return Response.json({ jsonrpc: "2.0", result: "ok", id: 1 });
    },
  });

  assert.equal((await rpcFetch("ignored")).status, 200);
  assert.equal((await rpcFetch("ignored")).status, 200);
  assert.deepEqual(calls, [
    "https://primary.example",
    "https://backup.example",
    "https://backup.example",
  ]);
  assert.equal(rpcFetch.status().preferred, "chainstack");
});

test("RPC fetch skips a provider with invalid or expired credentials", async () => {
  const calls = [];
  const rpcFetch = createRpcFailoverFetch({
    primaryUrl: "https://primary.example",
    env: { LUCKYME_RPC_CHAINSTACK_URL: "https://backup.example" },
    fetchImpl: async (url) => {
      calls.push(url);
      return url.includes("primary")
        ? new Response("Unauthorized", { status: 401 })
        : Response.json({ jsonrpc: "2.0", result: "ok", id: 1 });
    },
  });

  assert.equal((await rpcFetch("ignored")).status, 200);
  assert.deepEqual(calls, ["https://primary.example", "https://backup.example"]);
});

test("RPC health state is shared by separate backend clients", async () => {
  const calls = [];
  const options = {
    primaryUrl: "https://shared-primary.example",
    env: { LUCKYME_RPC_ALCHEMY_URL: "https://shared-backup.example" },
    shareHealthState: true,
    fetchImpl: async (url) => {
      calls.push(url);
      return url.includes("primary")
        ? new Response("Too many requests", { status: 429 })
        : Response.json({ jsonrpc: "2.0", result: "ok", id: 1 });
    },
  };

  const firstClient = createRpcFailoverFetch(options);
  assert.equal((await firstClient("ignored")).status, 200);
  const secondClient = createRpcFailoverFetch(options);
  assert.equal((await secondClient("ignored")).status, 200);
  assert.deepEqual(calls, [
    "https://shared-primary.example",
    "https://shared-backup.example",
    "https://shared-backup.example",
  ]);
  assert.equal(secondClient.status().preferred, "alchemy");
});

test("RPC fetch does not hide deterministic Solana program errors", async () => {
  const calls = [];
  const rpcFetch = createRpcFailoverFetch({
    primaryUrl: "https://primary.example",
    env: { LUCKYME_RPC_CHAINSTACK_URL: "https://backup.example" },
    fetchImpl: async (url) => {
      calls.push(url);
      return Response.json({ error: { code: -32002, message: "Transaction simulation failed: custom program error: 0x1" } });
    },
  });

  const response = await rpcFetch("ignored");
  assert.equal(response.status, 200);
  assert.deepEqual(calls, ["https://primary.example"]);
});

test("transport and timeout errors are classified as retryable", () => {
  assert.equal(isRetryableRpcError(new Error("fetch failed: ECONNRESET")), true);
  assert.equal(isRetryableRpcError(new DOMException("aborted", "AbortError")), true);
  assert.equal(isRetryableRpcError(new Error("custom program error: 0x1")), false);
});
