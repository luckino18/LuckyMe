# Randomness

LuckyMe now has two explicit randomness modes:

- `commit_reveal_demo`: devnet/store-demo only.
- `orao_vrf`: provider-randomness path using ORAO Classic VRF request accounts.

There is no silent fallback between the modes. `MAINNET_BETA_CANDIDATE` refuses
to start unless `LUCKYME_RANDOMNESS_MODE=orao_vrf` and
`LUCKYME_PRODUCTION_RANDOMNESS=true` are both set.

## Commit-Reveal Demo

The demo flow remains available for `DEVNET_STORE_DEMO`:

1. A keeper opens a round with `hash("luckyme-commit", reveal)`.
2. Users buy tickets while the commitment is public.
3. After the round ends, settlement reveals the 32-byte secret.
4. The program verifies the commitment and derives randomness from:

```text
sha256("luckyme-round-randomness" || round_pubkey || total_tickets_le || reveal)
```

Winner ticket uses bytes `0..8`, jackpot roll uses bytes `8..16`, and jackpot
ticket uses bytes `16..24`.

Known risk: the reveal provider can calculate the result after seeing the final
ticket count and can refuse unfavorable reveals. Refunds prevent permanent
pool-vault lockup, but they do not make commit-reveal fair enough for mainnet.

## ORAO VRF Provider Path

The provider path keeps the original `Round` account layout stable and adds a
sidecar PDA:

```text
round_randomness = PDA("round_randomness", round)
```

After the round closes, `request_randomness` records:

- provider: `OraoVrf`
- status: `Requested`
- ORAO seed derived at request execution from final round state and request slot
- expected ORAO request PDA
- request timestamp

The ORAO request PDA is derived from:

```text
seed = sha256(
  "luckyme-orao-vrf-seed" ||
  round_pubkey ||
  pool_pubkey ||
  round_id_le ||
  total_tickets_le ||
  entrant_count_le ||
  request_slot_le
)
request = PDA("orao-vrf-randomness-request", seed, ORAO_PROGRAM_ID)
```

`request_slot` is the Solana clock slot observed by the LuckyMe instruction.
That means the exact seed is written to the sidecar only when the post-close
`request_randomness` transaction lands. It is not a seed that can be fully known
and fulfilled before ticket sales end.

Settlement uses `settle_round_with_provider_randomness`. The program verifies:

- provider sidecar belongs to the same round
- sidecar provider is `OraoVrf`
- ORAO request account key matches the sidecar request
- ORAO request PDA derives from the sidecar seed
- ORAO request account owner is `VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`
- ORAO `RandomnessV2` account is fulfilled
- fulfilled seed equals the LuckyMe seed

The final LuckyMe round randomness is derived from the fulfilled 64-byte ORAO
value:

```text
sha256("luckyme-provider-round-randomness" || round_pubkey || total_tickets_le || orao_randomness_64)
```

The program emits `RandomnessRequested`, `RandomnessFulfilled`,
`RoundSettled`, and `EntryRefunded` events for indexers and public monitoring.

## Keeper Commands

`request_randomness` only records LuckyMe metadata. The ORAO request itself is
paid by a keeper wallet through the ORAO SDK.

```bash
LUCKYME_RANDOMNESS_MODE=orao_vrf DRY_RUN=true POOL=mini ROUND_ID=8 npm run randomness:request
LUCKYME_RANDOMNESS_MODE=orao_vrf POOL=mini ROUND_ID=8 npm run randomness:status
LUCKYME_RANDOMNESS_MODE=orao_vrf DRY_RUN=true POOL=mini ROUND_ID=8 npm run randomness:settle
```

The scripts print cluster, release mode, randomness mode, fee payer, ORAO
program id, ORAO network state, seed, request PDA, and dry-run status. They
refuse mainnet unless `CONFIRM_MAINNET=true`.

## Backend Endpoints

Provider endpoints are unsigned transaction builders or read-only status:

- `GET /rounds/:round/randomness?pool=mini`
- `GET /rounds/:pool/:round/randomness`
- `POST /transactions/request-randomness`
- `POST /transactions/settle-provider-round`

`POST /transactions/settle-round` is only for `commit_reveal_demo`. In
`orao_vrf` mode it returns `commit_reveal_settlement_disabled`.

## Refund Recovery

After `round.end_ts + 600` seconds, any caller can crank refunds with
`refund_entry_after_timeout`. The refunded lamports always go to `entry.player`,
even if another fee payer submits the transaction.

Refund remains a recovery backup. It is not a fairness substitute for fulfilled
provider randomness.

## Remaining Mainnet Evidence

The repo now has the ORAO verification path, backend builders, keeper scripts,
and local tests for the state machine. Before mainnet, still produce evidence
for:

- funded devnet ORAO request, fulfillment, and provider settlement
- provider monitoring and alerting
- abandoned-round public reporting
- legal review
- multisig authority handoff
- final external audit against the deployed commit and generated IDL
