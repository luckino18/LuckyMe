import assert from "node:assert/strict";
import test from "node:test";
import { Keypair } from "@solana/web3.js";
import {
  CAPACITY_ONLY_EXPIRY_UNIX,
  OFFICIAL_SKR_MINT,
  createPromotionalPoolsService,
  decimalToBaseUnits,
} from "../backend/src/promotional-pools-service.mjs";

const address = () => Keypair.generate().publicKey.toBase58();
const signature = () => "5".repeat(88);

function fixture() {
  let now = Date.parse("2026-07-23T10:00:00.000Z");
  const sponsor = address();
  const authorizer = address();
  const chain = {
    async verifyEntry() { return true; },
    async readPromotion(promotion) {
      return {
        status: promotion.status,
        entryCount: promotion.entryCount,
        winnerIndex: promotion.winnerIndex,
        winnerAddress: promotion.winnerAddress,
      };
    },
    async treasurySummary(promotions) {
      const reserved = promotions
        .filter((item) => !["draft", "prepared", "paid", "cancelled", "archived"].includes(item.status))
        .reduce((sum, item) => sum + BigInt(item.prizeAmountBaseUnits), 0n);
      return { asset: "SKR", availableBaseUnits: "3500000000", reservedBaseUnits: reserved.toString() };
    },
  };
  const service = createPromotionalPoolsService({ clock: () => now, chain, reservationTtlMs: 60_000 });
  return {
    service,
    sponsor,
    authorizer,
    advance(ms) { now += ms; },
    draft(overrides = {}) {
      return service.createDraft({
        title: "SKR Community Draw",
        subtitle: "Exclusive LuckyMe promotion",
        description: "A capacity-only promotion for LuckyMe users.",
        entryCostPoints: 25,
        capacity: 2,
        prizeAsset: "SKR",
        prizeAmount: "500",
        expiryMode: "capacity-only",
        sponsor,
        authorizer,
        addresses: {
          promotion: address(),
          vault: address(),
          prizeConfig: address(),
        },
        ...overrides,
      });
    },
  };
}

test("SKR amounts use the official mint and six decimals", () => {
  assert.equal(decimalToBaseUnits("500", 6).toString(), "500000000");
  assert.equal(decimalToBaseUnits("0,000001", 6).toString(), "1");
  const f = fixture();
  const promotion = f.draft();
  assert.equal(promotion.prizeMint, OFFICIAL_SKR_MINT);
  assert.equal(promotion.prizeAmountBaseUnits, "500000000");
  assert.equal(promotion.expiresAtUnix, CAPACITY_ONLY_EXPIRY_UNIX);
  f.service.close();
});

test("two simultaneous SKR promotions keep independent vaults and treasury reservations", async () => {
  const f = fixture();
  const first = f.draft();
  const second = f.draft({
    numericId: "2",
    title: "Second SKR Draw",
    prizeAmount: "1000",
  });
  f.service.markPrepared(first.id);
  f.service.markLaunched(first.id, { signature: signature() });
  f.service.markPrepared(second.id);
  f.service.markLaunched(second.id, { signature: `4${signature().slice(1)}` });
  const treasury = await f.service.treasury();
  assert.equal(treasury.availableBaseUnits, "3500000000");
  assert.equal(treasury.reservedBaseUnits, "1500000000");
  assert.notEqual(first.vaultAddress, second.vaultAddress);
  f.service.close();
});

test("Lucky Points are reserved atomically, confirmed once, and capacity locks the pool", async () => {
  const f = fixture();
  const promotion = f.draft();
  f.service.markPrepared(promotion.id);
  f.service.markLaunched(promotion.id, { signature: signature() });
  const firstWallet = address();
  const secondWallet = address();
  f.service.creditPoints({ wallet: firstWallet, amount: 100, idempotencyKey: "credit:first:0001" });
  f.service.creditPoints({ wallet: secondWallet, amount: 25, idempotencyKey: "credit:second:001" });

  const first = f.service.reserveEntry({
    promotionId: promotion.id,
    wallet: firstWallet,
    idempotencyKey: "entry:first:000001",
  });
  assert.equal(first.balance, 100, "a prepared wallet transaction must not debit points");
  assert.equal(first.availableBalance, 75, "held points cannot fund another concurrent entry");
  assert.equal(f.service.points(firstWallet), 100);
  assert.equal(f.service.reserveEntry({
    promotionId: promotion.id,
    wallet: firstWallet,
    idempotencyKey: "entry:first:000001",
  }).replayed, true);
  const firstConfirmed = await f.service.confirmEntry({
    entryId: first.entryId,
    entryAddress: address(),
    entryIndex: 0,
    entrySignature: signature(),
  });
  assert.equal(firstConfirmed.promotion.status, "open");
  assert.equal(firstConfirmed.promotion.entryCount, 1);
  assert.equal(f.service.points(firstWallet), 75, "points debit only after on-chain confirmation");

  const second = f.service.reserveEntry({
    promotionId: promotion.id,
    wallet: secondWallet,
    idempotencyKey: "entry:second:00001",
  });
  const secondConfirmed = await f.service.confirmEntry({
    entryId: second.entryId,
    entryAddress: address(),
    entryIndex: 1,
    entrySignature: `4${signature().slice(1)}`,
  });
  assert.equal(secondConfirmed.promotion.status, "locked");
  assert.equal(secondConfirmed.promotion.entryCount, 2);
  f.service.close();
});

test("expired unsigned entry reservations return Lucky Points exactly once", () => {
  const f = fixture();
  const promotion = f.draft();
  f.service.markPrepared(promotion.id);
  f.service.markLaunched(promotion.id, { signature: signature() });
  const player = address();
  f.service.creditPoints({ wallet: player, amount: 50, idempotencyKey: "credit:expiry:0001" });
  f.service.reserveEntry({
    promotionId: promotion.id,
    wallet: player,
    idempotencyKey: "entry:expiry:00001",
  });
  assert.equal(f.service.points(player), 50);
  assert.equal(f.service.availablePoints(player), 25);
  f.advance(60_001);
  assert.equal(f.service.releaseExpiredReservations(), 1);
  assert.equal(f.service.releaseExpiredReservations(), 0);
  assert.equal(f.service.points(player), 50);
  assert.equal(f.service.availablePoints(player), 50);
  f.service.close();
});

test("an entry cannot reserve more Lucky Points than the wallet owns", () => {
  const f = fixture();
  const promotion = f.draft();
  f.service.markPrepared(promotion.id);
  f.service.markLaunched(promotion.id, { signature: signature() });
  const player = address();
  f.service.creditPoints({ wallet: player, amount: 24, idempotencyKey: "credit:low:000001" });
  assert.throws(
    () => f.service.reserveEntry({
      promotionId: promotion.id,
      wallet: player,
      idempotencyKey: "entry:low:0000001",
    }),
    (error) => error.code === "insufficient_lucky_points",
  );
  f.service.close();
});
