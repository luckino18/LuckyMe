# Production Keeper

The keeper submits operational transactions after rounds close. It does not hold
player funds and does not sign player ticket purchases.

## Environment

```bash
export LUCKYME_RELEASE_MODE=MAINNET_RELEASE
export LUCKYME_SOLANA_CLUSTER=mainnet-beta
export ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com
export LUCKYME_RANDOMNESS_MODE=orao_vrf
export LUCKYME_PRODUCTION_RANDOMNESS=true
export ANCHOR_WALLET=/secure/path/keeper.json
export LUCKYME_EXPECTED_KEEPER_PUBKEY=6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N
export SETTLEMENT_KEEPER_MIN_BALANCE_LAMPORTS=50000000
export SETTLEMENT_KEEPER_MAX_ACTIONS=1
export LUCKYME_SETTLEMENT_ARCHIVE_PATH=/var/lib/luckyme/settlements.jsonl
```

Use a dedicated keeper wallet funded only for transaction fees and provider
operations.

The production timer exits cleanly with `keeper_needs_funding` while the keeper
wallet is below `SETTLEMENT_KEEPER_MIN_BALANCE_LAMPORTS`. The production unit
uses a `50000000` lamport (`0.05 SOL`) safety reserve. This reserve is not a fee:
it leaves room for provider requests and transaction fees without allowing a
nearly empty wallet to begin a paid settlement. Once funded, the next timer
tick continues automatically without manual settlement clicks.

## Commands

Run the automatic one-shot settlement keeper in dry-run mode:

```bash
npm run settlement:keeper
```

The settlement keeper is dry-run by default. It scans the current pool rounds and
prints the next operation it would take:

- leave a new empty round waiting indefinitely for its first ticket;
- start no timer and spend no recurring rent while a pool is idle;
- close legacy empty expired round accounts and return their rent to treasury;
- after expiry, evaluate Mini `25`, Normal `13`, High `3`, and Premium `3`
  ticket targets; Premium additionally requires three distinct wallets;
- for a below-target round, request no ORAO, persist refund progress, return
  every Entry's full ticket principal and rent to its player, then close the
  empty Round to treasury;
- create the LuckyMe ORAO sidecar with `request_randomness`;
- submit the ORAO VRF request;
- wait while ORAO is pending;
- settle fulfilled rounds;
- archive settled history before cleanup;
- close settled Entry accounts back to the players that funded their rent;
- close the LuckyMe randomness sidecar back to the on-chain treasury;
- close archived settled Round accounts back to treasury;
- open one waiting round after settlement.

`open_round` no longer starts the one-hour clock. The first successful
`buy_tickets` call sets `start_ts` and `end_ts` atomically.

To actually submit mainnet keeper transactions, both flags are required:

```bash
DRY_RUN=false \
CONFIRM_MAINNET_SETTLEMENT_KEEPER=true \
npm run settlement:keeper
```

For systemd, use a dedicated operational keypair at:

```text
/etc/luckyme/keeper.json
```

with:

```text
owner: luckyme
mode: 600
```

The provided systemd units are:

```text
deploy/systemd/luckyme-settlement-keeper.service
deploy/systemd/luckyme-settlement-keeper.timer
```

The checked-in service is deliberately dry-run-only even if it is started by
mistake. After the approved upgrade, run it in this state first and inspect its
output. Only after the separate runtime approval should the example write
override be installed as:

```text
source: deploy/systemd/luckyme-settlement-keeper-write-approved.conf.example
destination: /etc/systemd/system/luckyme-settlement-keeper.service.d/write-approved.conf
```

Then reload systemd and review the merged unit before starting the timer. Do not
place the example directly in the live override directory before approval.

The service creates `/var/lib/luckyme` through `StateDirectory=`. The API must
use the same `LUCKYME_SETTLEMENT_ARCHIVE_PATH` so Activity can show a closed
round from its append-only record and settlement signature.

The keeper derives its append-only refund journal from the settlement archive
path as `/var/lib/luckyme/settlements.jsonl.refunds.jsonl`. On restart it
verifies any pending signature
against the exact program instruction, Round, Entry, player credit, and closed
Entry state before advancing. Archive and refund records are pinned to the
Solana genesis hash so data from another cluster cannot be reused.

The service also pins `LUCKYME_EXPECTED_KEEPER_PUBKEY` to the public key above,
requires a `0.05 SOL` reserve, and limits each invocation to one write action.
It exits instead of writing if the signer file, on-chain `KeeperConfig`, and
expected public key do not all match.

## Keeper identity

The only production operational keeper is:

```text
6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N
```

The older planned address
`8TN3gVGp86EUnmpa3ncMpPHoWDAV7t997RuXaLesRWqV` is historical and is not the
automation signer. Do not fund it for keeper operations and do not generate a
third keeper. Never export a seed phrase from a browser wallet.

The upgraded program binds operational instructions to the `KeeperConfig` PDA:

```text
8sHT2tgHikQiHdKhtwhpmrXdznoLDjaNRBr7rC6RZR6Y
```

After the program upgrade, but before starting the service, prepare the
configuration plan without a signer:

```bash
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
npm run keeper:configure
```

The mainnet workflow is pinned to the approved program, Config PDA, Ledger
authority and operational keeper. Stage 1 permits initialization only; it
refuses keeper rotation. Run the dry-run first and retain its plan hash. Write
mode additionally requires `DRY_RUN=false`,
`CONFIRM_MAINNET_KEEPER_CONFIG=true`, `CONFIRM_LEDGER_AUTHORITY=true`, and the
reviewed hash in `LUCKYME_APPROVED_KEEPER_CONFIG_PLAN_HASH`. The software-keypair
utility is exposed only as `npm run keeper:configure:localnet` and refuses
mainnet writes.

## Cost boundary

LuckyMe returns Round rent and LuckyMe `RoundRandomness` sidecar rent to the
treasury address read from `config.treasury`. Player Entry rent returns to the
player stored in that Entry. The ORAO request account is owned by the ORAO
program and the SDK does not expose a close instruction. Its provider fee and
retained request rent remain a real fixed cost per eligible settled round.
Below-minimum rounds never submit an ORAO request, so they incur only ordinary
Solana transaction fees for the automatic refund and cleanup instructions.

## Legacy empty-round recovery

Legacy cleanup is separate from the normal settlement keeper so it cannot open
new rounds or request ORAO. Generate the complete read-only inventory with:

```bash
ANCHOR_PROVIDER_URL=https://api.mainnet-beta.solana.com \
LUCKYME_EXPECTED_KEEPER_PUBKEY=6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N \
LUCKYME_RENT_RECOVERY_REPORT_PATH=docs/mainnet-readonly-rent-inventory-2026-07-11.json \
npm run rent:recover:legacy-empty
```

Dry-run is the default and does not load the keeper signer. Review the generated
account list, treasury destination, simulations, estimated fees, and `planHash`.
Execution is intentionally a second approval gate and requires all of:

- the upgraded program and initialized `KeeperConfig`;
- `DRY_RUN=false`;
- `CONFIRM_MAINNET_RENT_RECOVERY=true`;
- `LUCKYME_RENT_RECOVERY_PLAN_HASH` equal to the reviewed plan;
- `LUCKYME_SETTLEMENT_ARCHIVE_PATH` configured;
- the signer public key equal to the configured keeper;
- `RENT_RECOVERY_MAX_ACTIONS` between 1 and 4 (default 1).

Do not use the retired `scripts/crank-empty-rounds.mjs` or the direct
`round:close-empty` script for mainnet recovery.

The direct provider commands below are diagnostics and are dry-run by default.
Production should use `settlement:keeper`, which checks the archive and complete
lifecycle. If an explicitly approved direct mainnet recovery is ever required,
request submission additionally needs
`CONFIRM_MAINNET_RANDOMNESS_REQUEST=true`, while provider settlement needs
`CONFIRM_MAINNET_PROVIDER_SETTLEMENT=true`; both still require `DRY_RUN=false`.
Request provider randomness:

```bash
POOL=normal ROUND_ID=1 npm run randomness:request
```

Check provider status:

```bash
POOL=normal ROUND_ID=1 npm run randomness:status
```

Settle with fulfilled provider randomness:

```bash
POOL=normal ROUND_ID=1 npm run randomness:settle
```

Inspect refundable entries without a write path:

```bash
npm run refund:crank
```

`refund:crank` is retired for writes and throws if `DRY_RUN=false`. Production
refunds are performed only by `settlement:keeper`, which owns the restart-safe
journal and enforces `KeeperConfig` authorization.

## Current deployment boundary (2026-07-12)

The lifecycle/`KeeperConfig` upgrade, legacy empty-round recovery, and the
minimum-ticket/refund program/backend/site deployment are complete. The mainnet
keeper timer remains disabled and inactive, the write override is absent, the
live API reports `activeRound: null` for all four pools, and the dry-run executes
no transaction. Do not fund/start the keeper, install a write override, or open
rounds without separate explicit approval.

## Operating Checks

- Confirm the wallet is the intended keeper before signing.
- Use a dedicated keeper wallet, not treasury, not deploy authority, and not a
  player wallet.
- Confirm RPC endpoint and cluster are mainnet-beta.
- Confirm Program ID in command output.
- Confirm settlement simulation succeeds before submitting.
- Confirm `KeeperConfig` authorizes exactly
  `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`.
- Store transaction signatures and round IDs for release operations records.
