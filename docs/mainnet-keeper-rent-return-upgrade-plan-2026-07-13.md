# Keeper rent-return upgrade plan — 2026-07-13

Status: **implemented and tested locally; not deployed to mainnet.**

## Correction

Operational rent funded by the authorized keeper is returned to that keeper
instead of the Treasury when LuckyMe closes:

- a provider-settlement `RoundRandomness` sidecar;
- a separately cleaned `RoundRandomness` sidecar;
- a settled `Round`;
- an eligible empty `Round`.

Player `Entry` rent still returns to the exact player. The economic 2% house
fee still goes to Treasury, and the 3% jackpot contribution still goes to the
jackpot vault. No account layout, PDA derivation, instruction discriminator,
pool setting, or existing round data changes.

## Fixed mainnet identities

- Cluster: Solana mainnet-beta
- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`
- ProgramData capacity: `398120` bytes
- Upgrade authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`
- Keeper: `6BUwjY5uQhmbkH6L8xx6YhT4ByzSWm6SMpKgop9RDV8N`
- Treasury: `87jw8LSagc3NdcyPixwXFYZRNPYes7YqFFmqU5WUeJtd`
- Temporary upload payer: `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`

## Exact release artifact

- Program size: `359616` bytes
- Program SHA-256: `d40def532680f1cfdd063e5895597f6543934e4a37089f295b21f9d7435e9732`
- IDL SHA-256: `9c1f764c6aa94a739e3e1c6ecb42c0b1bb59164ea918b4006d6a86bba230aa6d`
- SDK SHA-256: `5deaee360230078a034ec4da2584d1d6bf48f2a718215d273b26022ee92734c9`
- Remaining ProgramData capacity: `38504` bytes

## Verification completed

- application/static suite: `108/108` passed;
- Rust program unit suite: `11/11` passed;
- full Anchor localnet state-machine suite: passed;
- localnet asserts that keeper receives Round and RoundRandomness rent;
- localnet asserts that Treasury receives none of that operational rent;
- production SBF build completed successfully.

## Funding ceiling

- Buffer size: `359661` bytes
- Mainnet rent-exempt minimum: `2.50413144 SOL`
- Upload chunks: `356`
- Conservative temporary upload funding ceiling: `2.50593644 SOL`
- Current authority balance at preflight: `2.04418144 SOL`
- Current temporary payer balance: `0 SOL`

If the authority funds the upload payer, top it up by at least `0.46176 SOL`
before execution. Buffer rent is recoverable after a successful upgrade; only
ordinary transaction and ORAO operation fees remain spent.

## Mainnet execution boundary

No mainnet transaction is authorized by this document. Before deployment:

1. temporarily stop the settlement keeper timer and confirm no transaction is
   in flight;
2. refresh program, authority, pool, round, keeper, and balance snapshots;
3. rebuild and reconfirm the exact hashes above;
4. fund the temporary payer only up to the recalculated ceiling;
5. upload and byte-verify the buffer;
6. transfer buffer authority to the fixed upgrade authority;
7. simulate and explicitly approve the program upgrade transaction;
8. deploy the matching IDL, SDK, and settlement keeper source;
9. run a mainnet dry-run and verify `executed: []`;
10. restore the timer only after the coordinated smoke checks pass;
11. sweep recovered buffer rent and all remaining upload funds back to the
    authority;
12. verify a later completed round returns Round and RoundRandomness rent to
    keeper while Treasury receives only the 2% house fee.

