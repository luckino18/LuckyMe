# LuckyMe scalable round rotation — mainnet approval plan

Date: 2026-07-14

Status: implemented and tested locally only. No VPS or mainnet state was changed.

## Result

- A settled round no longer has to wait for every historical Entry account to be closed before the next round opens.
- Refund-mode rounds still block rotation until every refundable player has been paid.
- Historical Entry accounts are closed in batches of up to 8 per transaction.
- Every batch is simulated before submission.
- The keeper keeps the global limit of one submitted transaction per run.
- Live actions for all four pools have priority over historical cleanup.
- Player Entry rent is still returned to the original player.

For 1,000 players, cleanup drops from 1,000 transactions to 125 transactions, but the next round can open immediately after settlement and archive instead of waiting for cleanup.

## Verification

- Anchor localnet lifecycle test: passed.
- Full project suite: 149 passed, 0 failed.
- Dedicated 1,000-player model: passed.
- Real local-validator stress: 1,000 funded wallets, 1,000 confirmed buys, and 1,000 real Entry PDAs passed.
- Measured settlement-to-next-round rotation in the 1,000-player stress run: 514 ms.
- Measured cleanup for all 1,000 Entry PDAs: 125 transactions in 8,355 ms locally.
- The new round remained open throughout historical cleanup, and sampled players received the exact Entry rent.
- Refund-pending rotation rejection: passed.
- Eight Entry close instructions serialize to 910 bytes, below Solana's 1,232-byte packet limit.
- Production program size: 376,752 bytes.
- Existing mainnet ProgramData capacity: 398,120 bytes.
- Remaining capacity: 21,368 bytes.

## Production artifacts

- `target/deploy/luckyme.so`: `eac891b994cac2373bb729be3c845703061b4d59a141e1945868c60e4f8ecb41`
- `idl/luckyme.json`: `f9e120ec8ec66727b8ed02a20e49194d3a2e69d5df9f25beacb44791ceeabf80`
- `sdk/luckyme.ts`: `4249a1a47aad5a6f3a1cfc1c289c41f2d38e93b5f1c6e8b24520a960d23ea60e`

## Mainnet funding snapshot

- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Current authority balance: 2.41754244 SOL.
- Required rent-exempt buffer balance for 376,797 bytes: 2.623398 SOL.
- Minimum shortage before transaction fees: 0.20585556 SOL.
- Recommended top-up: 0.21 SOL.

Buffer rent is recoverable after a successful upgrade and buffer close. No buffer or mainnet transaction may be created from this plan without a separate explicit approval.

## Approved deployment sequence when authorized

1. Reconfirm program, ProgramData address, Ledger authority, keeper, and current pool state.
2. Stop the settlement keeper temporarily.
3. Create and upload a new buffer, then verify its authority, size, and hash.
4. Present the final buffer and upgrade transaction for explicit approval.
5. Execute the program upgrade with the Ledger authority.
6. Deploy the matching keeper and systemd configuration.
7. Run dry-run checks and verify all four pools before enabling writes.
8. Restart the keeper and monitor immediate rotation plus background cleanup.
9. Close the buffer and verify returned rent.
