# Randomness

LuckyMe production settlement uses the ORAO VRF provider path.

## Modes

- `MAINNET_RELEASE`: requires `LUCKYME_RANDOMNESS_MODE=orao_vrf` and
  `LUCKYME_PRODUCTION_RANDOMNESS=true`.
- `LOCAL_DEVELOPMENT`: may use `commit_reveal_demo` for local validator testing.

There is no silent fallback from ORAO provider randomness to commit-reveal in
`MAINNET_RELEASE`.

## ORAO Provider Flow

1. The round closes.
2. A keeper builds and signs `request_randomness`.
3. The program records the provider sidecar and ORAO randomness request PDA.
4. The keeper polls the provider account until fulfilled.
5. A keeper builds and signs `settle_round_with_provider_randomness`.
6. The program verifies owner, seed, request PDA, sidecar state, fulfillment,
   and provider randomness hash before deriving winner and jackpot result.

## Timeout And Refund

Refund state remains available if settlement cannot complete after the configured
timeout. Each entry owner can sign a refund transaction for their own entry.

## Validation

```bash
npm test
NO_DNA=1 anchor build --provider.cluster localnet
npm run test:anchor
```

Anchor integration coverage includes buy, duplicate entry rejection, settlement,
refund mode, provider request sidecar, missing provider fulfillment rejection,
and vault balance checks.
