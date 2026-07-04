# Manual Settlement And Refund

LuckyMe settlement is permissionless only if the caller can provide the correct
entry accounts. This document describes the devnet tooling for finding those
accounts without relying on private backend state.

The current commit-reveal design is still not mainnet-ready. A reveal provider
can withhold a bad reveal. The refund path only prevents permanent pool-vault
lockup after the reveal timeout.

## Requirements

- a Solana wallet that will pay the settlement transaction fee
- the pool slug: `mini`, `normal`, or `high`
- the round id
- the 32-byte randomness reveal in hex
- RPC access to the selected cluster

The wallet that settles does not need to be the winner or the keeper that opened
the round.

## Build A Settlement Transaction

Start the backend against devnet. Keep the submit relay disabled for public
deployments:

```bash
NO_DNA=1 \
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ENABLE_TRANSACTION_SUBMIT=false \
npm run backend:start
```

Ask the backend to compute the settlement accounts and build an unsigned
transaction:

```bash
curl -s -X POST http://localhost:8788/transactions/settle-round \
  -H 'content-type: application/json' \
  -d '{
    "settler": "<wallet-paying-fees>",
    "pool": "mini",
    "roundId": 9,
    "randomnessReveal": "<32-byte-hex-reveal>"
  }'
```

The response includes:

- `transactionBase64`: unsigned transaction for wallet signing
- `summary.accounts.winnerEntry`: entry account containing the winning ticket
- `summary.accounts.jackpotEntry`: entry account containing the jackpot ticket
- `summary.winnerTicket`, `summary.jackpotRoll`, and `summary.jackpotTicket`
- `simulation.ok`, `simulation.err`, logs, and compute units

The backend does not sign the transaction. Submit it through a wallet or your own
RPC relay after verifying the summary.

## What The Tool Verifies

The builder:

1. fetches the round and rejects settled, open, or empty rounds
2. checks `hash("luckyme-commit", reveal)` against the on-chain commitment
3. scans all `Entry` accounts for the round with `getProgramAccounts`
4. derives the on-chain randomness with:

```text
sha256("luckyme-round-randomness" || round_pubkey || total_tickets_le || reveal)
```

5. selects the winner ticket from bytes `0..8`
6. selects the jackpot roll from bytes `8..16`
7. selects the jackpot ticket from bytes `16..24`
8. builds and simulates `settle_round` with the computed accounts

If no entry contains a derived ticket, the builder returns an error instead of
guessing an account.

## Empty Rounds

Rounds with zero entries cannot be settled because no valid `winner_entry`
exists. After the round expires, a keeper can close the empty round without a
reveal and without moving funds:

```bash
DRY_RUN=true POOL=mini ROUND_ID=9 npm run round:close-empty
POOL=mini ROUND_ID=9 npm run round:close-empty
```

## Refund After Missing Reveal

If the reveal does not arrive, each entrant can build a refund transaction after
`round.end_ts + 600` seconds:

```bash
curl -s -X POST http://localhost:8788/transactions/refund-entry \
  -H 'content-type: application/json' \
  -d '{
    "player": "<entrant-wallet>",
    "pool": "mini",
    "roundId": 9
  }'
```

The refund always pays `entry.player`. A third party can help build or submit the
transaction, but cannot redirect the refund.

The backend can also discover refundable abandoned entries:

```bash
curl -s 'http://localhost:8788/refunds?pool=mini&roundId=9'
```

A keeper can crank refunds from a local fee-paying wallet:

```bash
DRY_RUN=true npm run refund:crank
POOL=mini ROUND_ID=9 npm run refund:crank
```

`DRY_RUN=true` only prints the refundable entries. Without dry run, the script
sends `refund_entry_after_timeout` transactions from the configured
`ANCHOR_WALLET` fee payer.
