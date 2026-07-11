# 2026-07-11 Idle Pools, Rent, Keeper, And Wallet Incident

> Resolution update: the lifecycle upgrade and approved Stage 2 recovery are
> complete. All 18 eligible empty rounds were closed. The later economic rule is
> now fixed at Mini/Normal/High/Premium `25/13/3/3`; source implements automatic
> keeper-only refunds without ORAO for below-target rounds, but that follow-up
> minimum-ticket upgrade is not deployed.

## Confirmed cause

- `open_round` started the one-hour clock before any player bought a ticket.
- The keeper repeatedly marked empty rounds settled and opened another round.
- The instruction named `close_empty_round_after_timeout` did not close the
  Solana account, so every idle cycle locked another Round rent deposit.
- The VPS signer was a newly generated operational wallet rather than the
  funded keeper address from the original wallet plan.
- The web wallet selector was an inline list, not a modal, and its injected
  wallet detection omitted several common browser extensions.

## Local correction

- New rounds use `start_ts = 0` and `end_ts = 0`.
- The first `buy_tickets` instruction starts the one-hour timer atomically.
- Waiting rounds are buyable and the keeper does not rotate them.
- Empty legacy rounds are actually closed, with rent returned to treasury.
- Settled history is written to an append-only archive before cleanup.
- LuckyMe sidecar rent returns to the on-chain treasury; Entry rent returns to
  the player; archived Round rent returns to treasury.
- The website uses a wallet modal with detected injected extensions and a
  separate Reown / WalletConnect option.
- Keeper-only instructions use the `KeeperConfig` PDA. The single production
  keeper is `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`; the originally planned
  `8TN3gVGp86EUnmpa3ncMpPHoWDAV7t997RuXaLesRWqV` address is not the VPS signer.

## Mainnet boundary

These changes require a program upgrade plus coordinated backend, keeper, and
web deployment. No mainnet upgrade or deployment is authorized by this local
implementation. The current live program continues using the old lifecycle
until an explicit upgrade approval and transaction review.

The pre-upgrade read-only inventory found 18 empty legacy Round accounts with
an estimated `52,116,480` lamports (`0.05211648 SOL`) recoverable to the on-chain
treasury. This is an estimate, not an authorization to close them. Mainnet
recovery remains blocked until after the program upgrade and KeeperConfig
initialization, then requires a fresh dry-run, reviewed plan hash, and separate
approval.

The ORAO request account is owned by ORAO. The installed ORAO v0.8 IDL exposes
request and fulfillment instructions but no close or withdraw instruction, so
its retained rent is not recoverable by LuckyMe.

## Economic decision still required

Mini round 2 showed a net keeper cost of about `0.0023494 SOL` for the ORAO
request after the provider returned its temporary fulfillment deposit. Normal
transaction fees add a little more. With the current 2% treasury share, the
approximate ticket counts required merely to cover that fixed provider cost are:

- Mini: 24 tickets;
- Normal: 12 tickets;
- High: 3 tickets;
- Premium: 3 tickets because the pool already requires three distinct winners.

Rent cleanup stops idle-pool leakage, but it does not make a one-ticket Mini or
Normal round profitable. Before mainnet deployment, choose explicitly between a
minimum funded-round threshold with automatic refunds, a different fee model,
or accepting an operator subsidy. No hidden economic threshold was added by
this incident fix.
