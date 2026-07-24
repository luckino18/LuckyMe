import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import { runPromotionalPoolsKeeper } from "../scripts/promotional-pools-keeper.mjs";

test("promotion keeper previews randomness and exact winner payout without broadcasting", async () => {
  const locked = { id: "locked", status: "locked" };
  const ready = {
    id: "ready",
    status: "winner_ready",
    winnerIndex: 7,
    prizeAsset: "SKR",
    prizeAmountBaseUnits: "500000000",
  };
  const service = {
    list() { return [locked, ready]; },
    async sync(id) { return id === "locked" ? locked : ready; },
    confirmedEntryAtIndex(id, index) {
      assert.equal(id, "ready");
      assert.equal(index, 7);
      return {
        wallet: Keypair.generate().publicKey.toBase58(),
        entryAddress: Keypair.generate().publicKey.toBase58(),
      };
    },
  };
  const result = await runPromotionalPoolsKeeper({
    service,
    connection: {
      async sendRawTransaction() {
        throw new Error("preview must not broadcast");
      },
    },
    authorizer: Keypair.generate(),
    writeEnabled: false,
  });
  assert.equal(result.writeEnabled, false);
  assert.deepEqual(result.actions.map((item) => item.action), [
    "request_randomness_preview",
    "settlement_preview",
  ]);
  assert.equal(result.actions[1].prizeAmountBaseUnits, "500000000");
});
