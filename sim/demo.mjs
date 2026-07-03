import { lamportsToSol, settleRound, solToLamports } from "./luckyme.mjs";

const result = settleRound({
  ticketPriceLamports: solToLamports("0.01"),
  jackpotBalanceLamports: solToLamports("1.25"),
  entries: [
    { player: "alice", tickets: 3n },
    { player: "ana", tickets: 8n },
    { player: "marius", tickets: 1n },
  ],
  randomSeed: "demo-round",
});

console.log({
  totalPoolSol: lamportsToSol(result.totalLamports),
  mainPrizeSol: lamportsToSol(result.mainPrize),
  houseFeeSol: lamportsToSol(result.houseFee),
  jackpotAddSol: lamportsToSol(result.jackpotAdd),
  winner: result.winner,
  jackpotTriggered: result.jackpotTriggered,
  jackpotWinner: result.jackpotWinner,
  jackpotPayoutSol: lamportsToSol(result.jackpotPayout),
  jackpotBalanceAfterSol: lamportsToSol(result.jackpotBalanceAfter),
});
