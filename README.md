# LuckyMe

LuckyMe is a transparent Solana mobile-first luck pool MVP for fixed-entry
rounds. The current release target is a safe devnet store demo, not a real-money
mainnet game.

The repository is public so the Anchor program, pool math, transaction builders,
mobile app, CI, and launch limitations can be reviewed before any production
claim.

## Status

- Current mode: `DEVNET_STORE_DEMO`
- Network target: devnet/localnet only
- Program id: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- Anchor target: `1.1.2`
- Solana CLI target: `3.x`
- Audit status: not independently audited
- Legal status: not reviewed for gambling, lottery, or sweepstakes compliance

Do not use this code with mainnet funds.

## Release Modes

`DEVNET_STORE_DEMO` is the only enabled release mode. It is intended for Solana
dApp Store / Seeker Store review. It uses devnet SOL only, has no real prizes,
displays a devnet/no-real-funds banner in the app, and can run either the
documented `commit_reveal_demo` path or the `orao_vrf` provider path for
testing.

`MAINNET_BETA_CANDIDATE` is disabled by default. The backend refuses this mode
unless `LUCKYME_RANDOMNESS_MODE=orao_vrf` and production randomness are enabled.
Mainnet RPC is blocked unless mainnet, legal, production randomness, and
multisig signoff environment gates are all set. Do not enable it until
`docs/mainnet-readiness.md` is complete.

## Game Model

The current default economics are:

- fixed pools: `0.005 SOL`, `0.01 SOL`, `0.1 SOL`
- round duration: 1 hour
- one main winner per round
- main prize: 98% of the round pool
- house fee: 1% of the round pool
- jackpot contribution: 1% of the round pool
- no-reveal recovery: after a 10 minute reveal timeout, entrants can refund
  their own entry from the pool vault
- abandoned-round recovery can also be cranked by a third-party fee payer; the
  refund always goes to `entry.player`

Each pool has a fixed ticket price. A wallet can buy one or more tickets in a
single purchase per round. The winner is selected by ticket number, so
probability is proportional to tickets bought.

```text
player_chance = player_tickets / total_round_tickets
main_prize = total_pool * 98%
house_fee = total_pool * 1%
jackpot_add = total_pool * 1%
```

## Randomness

The devnet demo path uses single-provider commit-reveal:

1. a round opens with `hash("luckyme-commit", reveal)`
2. users buy tickets while the commitment is public
3. settlement reveals the secret
4. the program verifies the commitment and derives winning tickets from the
   reveal, round key, and ticket count

This is acceptable only for `DEVNET_STORE_DEMO`. A reveal provider can still
withhold unfavorable reveals. Refunds prevent permanent pool-vault lockup, but
they do not make commit-reveal fair enough for real-money mainnet.

The provider path uses ORAO Classic VRF:

1. after the round closes, `request_randomness` records an ORAO seed and request
   PDA in a `RoundRandomness` sidecar; the seed includes final round state and
   the request slot
2. a keeper pays the ORAO request through the ORAO SDK
3. `settle_round_with_provider_randomness` verifies the ORAO request owner,
   PDA, seed, and fulfilled `RandomnessV2` data before deriving winners
4. if fulfillment never arrives, entrants can still refund after the timeout

See `docs/randomness.md` and `docs/randomness-provider-investigation.md`.

## Repository Layout

```text
programs/luckyme/   Anchor program
sim/                Local economic model and tests
backend/            Local/devnet API, transaction builders, and safety guards
app-seeker/         Solana Seeker mobile app prototype
idl/                Public client-facing Anchor IDL
sdk/                Public generated TypeScript types
docs/               Store, deployment, settlement, legal, and launch checklists
```

Audit follow-up status is tracked in `docs/audit-closure.md`. Store submission
readiness is tracked in `docs/store-readiness.md`. Mainnet blockers are tracked
in `docs/mainnet-readiness.md`.

## Local Verification

Install dependencies:

```bash
npm ci
npm install --prefix app-seeker --omit=optional
```

Run the full local verification set:

```bash
npm test
cargo check
cargo test
npm run app:typecheck
npm --prefix app-seeker run doctor
NO_DNA=1 anchor build --provider.cluster localnet
npm run test:anchor
```

## Backend

Start the backend safely:

```bash
npm run backend:start
```

Safe defaults:

- `ANCHOR_PROVIDER_URL=https://api.devnet.solana.com`
- `LUCKYME_RELEASE_MODE=DEVNET_STORE_DEMO`
- `LUCKYME_RANDOMNESS_MODE=commit_reveal_demo`
- `LUCKYME_ORAO_PROGRAM_ID=VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y`
- `HOST=127.0.0.1`
- `ENABLE_TRANSACTION_SUBMIT=false`
- read/build endpoints do not load a local private wallet

Useful endpoints:

- `GET /health`
- `GET /config`
- `GET /pools?player=<wallet-public-key>`
- `GET /refunds`
- `GET /rounds/:round/randomness?pool=<pool>`
- `POST /transactions/buy-tickets`
- `POST /transactions/settle-round`
- `POST /transactions/request-randomness`
- `POST /transactions/settle-provider-round`
- `POST /transactions/refund-entry`

For a trusted LAN dev session with a physical Seeker device:

```bash
HOST=0.0.0.0 ENABLE_TRANSACTION_SUBMIT=true npm run backend:start
```

Do not expose that LAN pattern as production infrastructure.

## App

Run the Expo dev build:

```bash
cd app-seeker
npm run android
EXPO_PUBLIC_LUCKYME_API_URL=http://<backend-host>:8788 npm run start -- --host lan
```

For store/demo builds, `EXPO_PUBLIC_LUCKYME_API_URL` must be set. The app shows a
blocking configuration error instead of silently falling back to localhost.

The app displays:

- `DEVNET MODE - no real funds` banner
- ticket price, total pool, countdown, and user chance
- 98% / 1% / 1% split
- treasury, vaults, program id, and cluster
- randomness mode and proof status
- recent winners, refund state, and transaction review before wallet signing
- safety, transparency, terms, privacy, and support placeholders

## Keeper Scripts

All keeper scripts print cluster and wallet, support dry-run where applicable,
and refuse mainnet unless `CONFIRM_MAINNET=true`.

```bash
DRY_RUN=true npm run round:open
DRY_RUN=true POOL=mini ROUND_ID=1 RANDOMNESS_REVEAL=<32-byte-hex> npm run round:settle
DRY_RUN=true POOL=mini ROUND_ID=1 npm run round:close-empty
DRY_RUN=true npm run refund:crank
LUCKYME_RANDOMNESS_MODE=orao_vrf DRY_RUN=true POOL=mini ROUND_ID=1 npm run randomness:request
LUCKYME_RANDOMNESS_MODE=orao_vrf POOL=mini ROUND_ID=1 npm run randomness:status
LUCKYME_RANDOMNESS_MODE=orao_vrf DRY_RUN=true POOL=mini ROUND_ID=1 npm run randomness:settle
```

## Store Submission

Use `DEVNET_STORE_DEMO` for the first Solana dApp Store / Seeker Store
submission. See `docs/store-readiness.md` for the APK, metadata, policy, KYC/KYB,
publisher wallet, screenshot, privacy, and terms checklist.

## Mainnet Blockers

LuckyMe must remain devnet-only until these are complete:

- funded devnet ORAO request, fulfillment, provider settlement transcript, and
  monitoring/runbook evidence
- independent smart-contract audit
- written legal review for intended jurisdictions
- multisig treasury, pause/admin, and upgrade authority
- production backend behind proxy/WAF with strict CORS, persistent rate limits,
  monitoring, and no private key on the server
- private security contact and bug bounty/disclosure process
- responsible gaming, age gate, geofencing, terms, privacy, and payout policy
