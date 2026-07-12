# LuckyMe mainnet open-round-only execution — 2026-07-12

Status: **complete and verified**.

The approved strict `open_round_only` workflow opened the three remaining
waiting rounds. The timer stayed disabled, `SETTLEMENT_KEEPER_MAX_ACTIONS=1`
limited every invocation to one transaction, and the temporary write override
was removed immediately after Premium.

## Transactions

| Pool | Round | PDA | Slot | Signature | Fee |
| --- | ---: | --- | ---: | --- | ---: |
| Normal | 6 | `7HxPngqLTDmJuePj5TFB2ECG3tQrmVgkm6HA1p8YECyG` | 432466639 | `4g2YtXookJEbDbJdQqpK33vLHYkSz7TrT8yka1iPVGEqYoxCveKrWTuNGYmoLpHLa7xUsF3b4GfjGNc4VraW4q1U` | 5000 lamports |
| High | 6 | `6rNBUDzgMMGkMHjqkWxk9iL34qXEz1wefNwidfoV97uf` | 432466719 | `3gx3P7L9SPS9qHbqmXBw4ods864ZqDdCa32PRLqiS2tSacDHagajR944pdG69tgwngoqgwHBEicgRUGx9ZGUcHQE` | 5000 lamports |
| Premium | 6 | `6p83YiP3bxhYAMWEUkBpXxCMB8Dn1xAc6JnAL3aV1omd` | 432466781 | `4g81gc8bi9e3mhNbbtP3w86aRdYQJQNKLZPyNQtcs15Z3Ko8B3uQkZWt3qy76eGrmrs7vfeJYbXW7YojuTw9shDS` | 5000 lamports |

Every transaction has `err=null` and exactly one LuckyMe instruction:
`OpenRound`.

## Cost and state

- Round rent: `2895360` lamports each, `8686080` lamports total.
- Fees: `15000` lamports total.
- Keeper reduction: `8701080` lamports (`0.00870108 SOL`).
- Keeper before: `598533265` lamports.
- Keeper after: `589832185` lamports.

All four live waiting rounds, including the previously opened Mini 5, decode
with `startTs=0`, `endTs=0`, zero tickets, zero lamports, zero entrants and
`settled=false`. The countdown starts only with the first paid ticket.

## Final safety state

- `luckyme-settlement-keeper.timer`: `disabled`, `inactive`.
- `luckyme-settlement-keeper.service`: `inactive`.
- `write-approved.conf`: absent.
- Base service: `DRY_RUN=true` and
  `CONFIRM_MAINNET_SETTLEMENT_KEEPER=false`.
- No cleanup, refund, ORAO or settlement action was executed in the three
  approved invocations.
