# Randomness

LuckyMe production settlement uses the ORAO VRF provider path.

## Modes

- `MAINNET_RELEASE`: requires `LUCKYME_RANDOMNESS_MODE=orao_vrf` and
  `LUCKYME_PRODUCTION_RANDOMNESS=true`.
- `LOCAL_DEVELOPMENT`: may use `commit_reveal_demo` for local validator testing.

There is no silent fallback from ORAO provider randomness to commit-reveal in
`MAINNET_RELEASE`. The production program rejects commit-reveal settlement, and
the old manual commit-reveal scripts refuse mainnet.

## ORAO Provider Flow

1. The first paid ticket starts the one-hour round timer.
2. The round closes.
3. The keeper evaluates the on-chain draw minimum: Mini 25 tickets, Normal 13,
   High 3, and Premium 3 tickets from 3 distinct wallets.
4. A below-target round enters automatic refund mode. It creates no LuckyMe
   randomness sidecar, submits no ORAO request, and has no winner draw.
5. For an eligible round, the settlement keeper signs `request_randomness`.
6. The program records the provider sidecar and ORAO randomness request PDA.
7. The settlement keeper submits the ORAO VRF request.
8. The settlement keeper polls the provider account until fulfilled.
9. The settlement keeper signs `settle_round_with_provider_randomness`.
10. The program verifies owner, seed, request PDA, sidecar state, fulfillment,
   and provider randomness hash before deriving winner and jackpot result.
11. The ORAO seed remains in the settled Round so proof can still be checked
   after the LuckyMe sidecar rent is returned.
12. The keeper archives the settlement, cleans temporary LuckyMe accounts, and
    opens one new round waiting for its first ticket.

All keeper-only instructions validate the `KeeperConfig` PDA. On mainnet it must
authorize exactly
`6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`. The LuckyMe
`RoundRandomness` sidecar is closed to `config.treasury`; it is not an extra
payment to the keeper. The ORAO-owned request PDA is outside LuckyMe's close
authority and is not counted as recoverable rent.

`npm run settlement:keeper` performs this flow as a one-shot process. It is
dry-run by default and requires `DRY_RUN=false` plus
`CONFIRM_MAINNET_SETTLEMENT_KEEPER=true` before it can submit mainnet
transactions.

The direct `randomness:request` and `randomness:settle` commands also default to
dry-run, verify the configured keeper, and simulate before RPC. They are
diagnostic/manual recovery tools; the coordinated production path remains
`settlement:keeper`.

## Timeout And Refund

A funded round that expires below its applicable minimum becomes refundable
after the production 600-second refund delay. Refund execution is keeper-only:
the instruction requires the configured keeper signer and `KeeperConfig` PDA.
Before each submission the keeper persists progress in its append-only refund
journal, then returns the complete ticket principal and closes the Entry so its
rent returns to the player stored in that Entry. Network fees already paid to
Solana are not refundable. Players do not submit a claim transaction.

## Local Development Validation

```bash
npm test
NO_DNA=1 anchor build --provider.cluster localnet
npm run test:anchor
```

Anchor integration coverage includes buy, duplicate entry rejection, settlement,
refund mode, provider request sidecar, missing provider fulfillment rejection,
and vault balance checks.
