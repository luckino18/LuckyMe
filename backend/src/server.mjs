import http from "node:http";
import { URL } from "node:url";
import { FIXED_POOLS, lamportsToSol, settleRound } from "../../sim/luckyme.mjs";

const PORT = Number(process.env.PORT ?? 8788);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/health") {
    return json(res, 200, { ok: true, service: "luckyme-dev-api" });
  }

  if (req.method === "GET" && url.pathname === "/pools") {
    return json(res, 200, {
      pools: FIXED_POOLS.map((pool) => ({
        id: pool.id,
        label: pool.label,
        ticketPriceLamports: pool.ticketPriceLamports.toString(),
        ticketPriceSol: lamportsToSol(pool.ticketPriceLamports),
        roundDurationSeconds: 300,
        mainPrizeBps: 9500,
        houseFeeBps: 300,
        jackpotBps: 200,
      })),
    });
  }

  if (req.method === "GET" && url.pathname === "/simulate") {
    const poolId = url.searchParams.get("pool") ?? "normal";
    const pool = FIXED_POOLS.find((item) => item.id === poolId);
    if (!pool) {
      return json(res, 404, { error: "unknown pool" });
    }

    const result = settleRound({
      ticketPriceLamports: pool.ticketPriceLamports,
      jackpotBalanceLamports: 1_250_000_000n,
      randomSeed: url.searchParams.get("seed") ?? "dev",
      entries: [
        { player: "alice", tickets: 3n },
        { player: "ana", tickets: 8n },
        { player: "marius", tickets: 1n },
      ],
    });

    return json(res, 200, serializeBigInts({
      pool: pool.id,
      totalPoolSol: lamportsToSol(result.totalLamports),
      mainPrizeSol: lamportsToSol(result.mainPrize),
      houseFeeSol: lamportsToSol(result.houseFee),
      jackpotAddSol: lamportsToSol(result.jackpotAdd),
      winner: result.winner,
      jackpotTriggered: result.jackpotTriggered,
      jackpotWinner: result.jackpotWinner,
      jackpotPayoutSol: lamportsToSol(result.jackpotPayout),
      jackpotBalanceAfterSol: lamportsToSol(result.jackpotBalanceAfter),
    }));
  }

  return json(res, 404, { error: "not found" });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`LuckyMe dev API listening on http://localhost:${PORT}`);
});

function json(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  res.end(JSON.stringify(body, null, 2));
}

function serializeBigInts(value) {
  return JSON.parse(
    JSON.stringify(value, (_key, inner) =>
      typeof inner === "bigint" ? inner.toString() : inner,
    ),
  );
}
