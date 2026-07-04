# Randomness Provider Investigation

Date: 2026-07-04

## Recommendation

Use ORAO Classic VRF as the first production-randomness provider, integrated as
a keeper-paid off-chain request plus on-chain verification at settlement.

Do not wire ORAO through a LuckyMe CPI in the first pass. LuckyMe currently uses
Anchor `1.1.2`, while ORAO `orao-solana-vrf` `0.7.0` is documented with
Anchor `0.32.1`. Pulling the ORAO CPI crate into the on-chain program would add
version-coupling risk. The safer minimum path is:

1. keep LuckyMe's current commit-reveal path for `DEVNET_STORE_DEMO` only
2. add a provider sidecar account for ORAO request metadata
3. let a keeper request ORAO randomness with the ORAO JS SDK
4. settle only after LuckyMe verifies the ORAO request PDA is owned by the ORAO
   program and contains fulfilled randomness for the expected seed

Primary references:

- ORAO Solana VRF repo: https://github.com/orao-network/solana-vrf
- ORAO Rust docs: https://docs.rs/orao-solana-vrf
- ORAO JS SDK package: `@orao-network/solana-vrf`
- Switchboard randomness docs: https://docs.switchboard.xyz/docs-by-chain/solana-svm/randomness
- Pyth Entropy docs: https://docs.pyth.network/entropy

## 1. Current LuckyMe Randomness Flow

`open_round` stores a 32-byte `randomness_commitment`. After `round.end_ts`, any
settler can call `settle_round` with a 32-byte reveal. The program verifies:

```text
sha256("luckyme-commit" || reveal) == round.randomness_commitment
```

Then it derives the settlement randomness:

```text
sha256("luckyme-round-randomness" || round_pubkey || total_tickets_le || reveal)
```

This prevents arbitrary reveal substitution but does not prevent selective
withholding by whoever knew the reveal in advance. The refund path prevents
permanent lockup, not outcome censorship.

## 2. Current Round Fields And What Should Change

Current `Round` fields:

- `pool`
- `round_id`
- `start_ts`
- `end_ts`
- `ticket_price_lamports`
- `total_tickets`
- `total_lamports`
- `entrant_count`
- `settled`
- `jackpot_triggered`
- `winner`
- `jackpot_winner`
- `randomness_commitment`
- `randomness`
- `bump`

Changing `Round` layout would make existing devnet round accounts harder to read
after an upgrade. The safer path is to keep `Round` stable and add a sidecar PDA:

```text
seeds = ["round_randomness", round_pubkey]
```

The sidecar tracks:

- provider enum: `commit_reveal_demo`, `orao_vrf`, future provider
- status enum: `NotRequested`, `Requested`, `Fulfilled`, `Settled`, `RefundMode`
- ORAO request pubkey
- 32-byte ORAO seed derived at post-close request execution from final round
  state and request slot
- fulfilled 32-byte LuckyMe randomness value
- requested timestamp
- fulfilled timestamp

`round.randomness` remains the final 32-byte value used for settlement history.

## 3. Provider Choice

Recommended provider: ORAO Classic VRF.

Reasons:

- ORAO has a Solana-native VRF program and SDK.
- The documented program id for Classic VRF is
  `VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`.
- ORAO exposes deterministic request PDA helpers:
  `networkStateAccountAddress()` and `randomnessAccountAddress(seed)`.
- ORAO request accounts store a fulfilled randomness value that LuckyMe can
  verify on-chain by owner, PDA derivation, seed, and fulfilled state.
- The request is asynchronous, which matches LuckyMe's existing
  post-round settlement model.

Switchboard remains a good fallback if ORAO operations are unavailable. Pyth
Entropy is attractive for EVM and multi-chain use, but the current public docs
center on Entropy as a 2-party commit-reveal design; for this Solana Anchor repo,
ORAO is the smallest provider-specific integration.

## 4. Exact Dependencies Required

Backend/keeper dependency:

```json
"@orao-network/solana-vrf": "0.8.0"
```

On-chain LuckyMe dependency:

No ORAO Rust crate in the minimum path. LuckyMe verifies ORAO account data
manually to avoid Anchor version coupling.

## 5. Exact On-Chain Accounts Required

LuckyMe `request_randomness`:

- keeper signer
- LuckyMe config PDA
- pool PDA
- round PDA
- `round_randomness` PDA
- system program

The LuckyMe seed is:

```text
sha256(
  "luckyme-orao-vrf-seed" ||
  round_pubkey ||
  pool_pubkey ||
  round_id_le ||
  total_tickets_le ||
  entrant_count_le ||
  request_slot_le
)
```

Including the request slot prevents a third party from fully knowing and
fulfilling the exact LuckyMe ORAO seed before ticket sales end. The seed becomes
public after the post-close `request_randomness` transaction lands.

ORAO keeper request:

- fee payer signer
- ORAO network state PDA
- ORAO treasury from network state
- ORAO randomness request PDA derived from the LuckyMe seed
- system program
- optional token fee accounts if ORAO network state enables token fees

LuckyMe `settle_round_with_provider_randomness`:

- keeper signer
- LuckyMe config PDA
- pool PDA
- round PDA
- `round_randomness` PDA
- ORAO randomness request account
- pool vault PDA
- jackpot vault PDA
- winner system account
- winner entry account
- jackpot winner system account
- jackpot entry account
- treasury system account
- system program

## 6. Funding, Fees, Rent, Queue, Callback, Keeper

ORAO Classic VRF request cost is read from ORAO `NetworkState.config.requestFee`
at runtime. It is not hardcoded in LuckyMe.

The ORAO request payer must also cover:

- Solana transaction fee
- rent/account creation for the ORAO request PDA
- optional priority fee configured by the ORAO SDK
- optional token fee path if the ORAO network state uses token fees

No oracle queue account is required in the ORAO Classic VRF flow. No callback is
used in this minimum integration. A keeper/cranker is required to request
randomness and settle once fulfilled.

## 7. Who Pays

The keeper fee payer pays the ORAO request. It must not be the deploy authority
or treasury by default. The public backend must not load that signer.

## 8. Where Randomness Is Requested

The app should not request ORAO randomness directly in the first production path.
The backend public API can build unsigned LuckyMe record/settle transactions,
but any ORAO request that requires a signer belongs in a separate keeper script.

The program verifies provider randomness during settlement. It does not trust
random bytes supplied by a user.

## 9. What Can Be Tested On Localnet/Devnet

Localnet:

- commit-reveal demo remains green
- mainnet mode rejects commit-reveal
- LuckyMe `request_randomness` rejects early requests
- LuckyMe records deterministic ORAO request metadata after round close
- provider settlement rejects missing/unfulfilled/incorrect ORAO accounts
- refund still works if randomness is never fulfilled
- mock/unit tests can cover the ORAO account parser

Devnet:

- keeper can request ORAO randomness
- keeper can poll ORAO request fulfillment
- backend/script can compute winner entries from fulfilled ORAO randomness
- LuckyMe can settle with verified ORAO request account

## 10. What Cannot Be Completed Without Provider Accounts/Funding

- A real ORAO fulfillment test requires a funded keeper and ORAO devnet network
  state/treasury availability.
- Mainnet beta cannot be enabled until ORAO request/fulfillment/settlement has
  been exercised on devnet and operational monitoring is in place.

## 11. Required Environment Variables

Common:

- `LUCKYME_RELEASE_MODE=DEVNET_STORE_DEMO | MAINNET_BETA_CANDIDATE`
- `LUCKYME_RANDOMNESS_MODE=commit_reveal_demo | orao_vrf`
- `LUCKYME_ENABLE_MAINNET=false`
- `LUCKYME_PRODUCTION_RANDOMNESS=false`
- `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com`

ORAO:

- `LUCKYME_ORAO_PROGRAM_ID=VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`
- `ANCHOR_WALLET=<keeper wallet path>` for keeper scripts only
- `CONFIRM_MAINNET=true` only for explicit mainnet keeper runs

## 12. Security Risks Introduced

- Keeper liveness now matters. Refund-after-timeout remains the fallback if the
  keeper fails to request or settle.
- The ORAO request payer can be griefed if scripts request randomness for wrong
  rounds. Scripts must print cluster, pool, round, seed, request PDA, and dry-run
  by default.
- Settlement must verify ORAO account owner, PDA derivation, seed, fulfilled
  status, and nonzero randomness before paying funds.
- Mainnet must not silently fall back to commit-reveal if ORAO is unavailable.
- Public backend endpoints must never load keeper/private keys.

## 13. Estimated Code Changes

- Add on-chain provider sidecar account and enums.
- Add `request_randomness`.
- Add `settle_round_with_provider_randomness`.
- Add ORAO request account parser and deterministic seed derivation.
- Add backend config/provider fields and provider transaction builders.
- Add keeper scripts:
  - `npm run randomness:request`
  - `npm run randomness:status`
  - `npm run randomness:settle`
- Add tests for guardrails and parser/state behavior.
- Update README, randomness docs, mainnet readiness, store readiness, and backend
  docs.
