# LuckyMe

LuckyMe is a transparent Solana devnet MVP for fixed-entry luck pools.

The repository is public from the first build stage so the program logic, pool math, client-facing IDL, simulator, and launch limitations can be reviewed early.

## Status

- Network target: devnet/localnet only
- Program id: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Anchor target: `1.1.2`
- Solana CLI target: `3.x`
- Audit status: not audited
- Legal status: not reviewed for gambling, lottery, or sweepstakes compliance

Do not use this code with mainnet funds.

## Game Model

The first protocol target is deliberately small:

- fixed pools: `0.005 SOL`, `0.01 SOL`, `0.1 SOL`
- round duration: 5 minutes
- one main winner per round
- main prize: 95% of the round pool
- house fee: 3% of the round pool
- jackpot contribution: 2% of the round pool
- settlement is permissionless once a round has ended and the reveal is available
- no-reveal recovery: after a 10 minute reveal timeout, entrants can refund
  their own entry from the pool vault

Each pool has a fixed ticket price. Users buy one or more tickets in a single purchase per wallet per round. The round winner is selected by ticket number, so probability is proportional to tickets bought:

```text
player_chance = player_tickets / total_round_tickets
```

Round settlement:

```text
house_fee = total_pool * 3%
jackpot_add = total_pool * 2%
main_prize = total_pool - house_fee - jackpot_add
```

The jackpot is tracked per pool in the MVP to avoid cross-subsidizing low-stake and high-stake players.

## Repository Layout

```text
programs/luckyme/   Anchor program
sim/                Local economic model and tests
backend/            Local dev API for pool metadata and simulations
app-seeker/         Solana Seeker app screen prototype
idl/                Public client-facing Anchor IDL
sdk/                Public generated TypeScript types
docs/               Deployment, settlement, and launch checklists
```

## Local Verification

Install Node development dependencies:

```bash
npm ci
```

Run the simulator tests:

```bash
npm test
```

Check the Rust program:

```bash
cargo check
```

Install and typecheck the Seeker app:

```bash
npm install --prefix app-seeker --omit=optional
npm run app:typecheck
npm --prefix app-seeker run doctor
```

Build the Anchor/SBF artifact:

```bash
anchor build
```

Run the local Anchor test flow. This uses the `test-short-timers` feature so
localnet can exercise settlement and refund timeout paths without waiting for
the production 60 second round duration plus 10 minute refund delay:

```bash
npm run test:anchor
```

Start the local dev API:

```bash
npm run backend:start
```

Initialize config and the three fixed pools on the selected Anchor provider:

```bash
npm run init:pools
```

Run a full localnet smoke test after deploying the program to a local validator:

```bash
LUCKYME_ROUND_DURATION_SECS=60 npm run localnet:smoke
```

The smoke test initializes config and pools if needed, opens a Normal pool round, buys tickets, waits until the round can settle, and settles the round on-chain. The production target remains 300 seconds; the 60 second value is only for fast local verification.

## Randomness

The current MVP uses commit-reveal:

1. a round opens with `hash("luckyme-commit", reveal)`
2. users buy tickets while the commitment is already public
3. settlement reveals the secret
4. the program verifies the commitment and derives the winning tickets from the reveal, round key, and ticket count

This is better than backend RNG, but it is not production-complete. The reveal provider can withhold an unfavorable reveal. If the reveal is withheld, the MVP allows each entrant to claim a refund after a 10 minute timeout, preventing permanent pool-vault lockup for that round. This refund path does not make the randomness fair for mainnet because the reveal provider can still selectively abandon unfavorable rounds.

Before any mainnet launch, the randomness design must use a verifiable source such as Switchboard, ORAO, Pyth Entropy, or a hardened multi-party commit-reveal design with slashing and fallback paths.

## Settlement Tooling

For devnet operations, the backend exposes unsigned transaction builders for:

- `buy_tickets`
- `settle_round`
- `refund_entry_after_timeout`

`POST /transactions/settle-round` accepts a reveal, scans the on-chain `Entry`
accounts for the round, computes the winner and jackpot entry, and returns a
simulated unsigned transaction. See `docs/manual-settlement.md`.

## Launch Gates

LuckyMe should stay on devnet until these are complete:

- independent smart contract audit
- legal review for the intended jurisdictions
- public verified program id and reproducible build notes
- production randomness integration
- multisig treasury and upgrade authority
- responsible gaming controls
