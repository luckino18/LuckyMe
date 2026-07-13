import http from "node:http";

const host = process.env.RPC_PROXY_HOST ?? "127.0.0.1";
const port = Number(process.env.RPC_PROXY_PORT ?? 8898);
const upstream = process.env.RPC_UPSTREAM ?? "https://api.mainnet-beta.solana.com";
const methods = new Map();
let requests = 0;
let rpcCalls = 0;

function metrics() {
  return {
    requests,
    rpcCalls,
    methods: Object.fromEntries([...methods.entries()].sort()),
  };
}

function countPayload(payload) {
  const calls = Array.isArray(payload) ? payload : [payload];
  requests += 1;
  rpcCalls += calls.length;
  for (const call of calls) {
    const method = String(call?.method ?? "unknown");
    methods.set(method, (methods.get(method) ?? 0) + 1);
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/__metrics") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(`${JSON.stringify(metrics())}\n`);
  }
  if (req.method === "POST" && req.url === "/__reset") {
    requests = 0;
    rpcCalls = 0;
    methods.clear();
    res.writeHead(204);
    return res.end();
  }
  if (req.method !== "POST") {
    res.writeHead(405);
    return res.end();
  }

  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = Buffer.concat(chunks);
  try {
    countPayload(JSON.parse(body.toString("utf8")));
    const response = await fetch(upstream, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body,
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.writeHead(response.status, {
      "content-type": response.headers.get("content-type") ?? "application/json",
      "content-length": responseBody.length,
    });
    return res.end(responseBody);
  } catch (error) {
    res.writeHead(502, { "content-type": "application/json" });
    return res.end(`${JSON.stringify({ error: error.message })}\n`);
  }
});

server.listen(port, host, () => {
  console.log(JSON.stringify({ event: "rpc_counting_proxy_started", host, port, upstream }));
});

