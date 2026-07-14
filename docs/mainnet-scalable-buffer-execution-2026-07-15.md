# LuckyMe scalable rotation buffer — mainnet execution evidence

Date: 2026-07-15

Status: buffer created, uploaded, byte-verified, and transferred to the Ledger upgrade authority. The program was not upgraded. The keeper and application remained online.

## Approved scope

- Maximum Ledger debit: 2.65 SOL.
- Create and upload a mainnet buffer for program SHA-256 `eac891b994cac2373bb729be3c845703061b4d59a141e1945868c60e4f8ecb41`.
- Do not execute the final program upgrade.

## Funding

- Ledger authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- Temporary upload payer: `9DvCoJTwdf8CcQUPiLBWEu5Zx4GiYCg8G7LwKaZtZbFc`.
- Confirmed transfer: 2.649995 SOL.
- Transfer signature: `5ymaJ3EU9YNQCJLe8hrNXWnL2jPfe7ZRy4dpZ1XKD76o6WbarY5gG2jWUujrGKVscpa7xiihMqz9duBuEhaK1yq6`.
- Transfer fee: 0.000005 SOL.
- Total Ledger debit: exactly 2.65 SOL.

## Buffer

- Address: `5bTH1JnxLPce1XbkWnQTNgdTfMpPJzY1QZeiJZmxVSD1`.
- Current authority: `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- Balance: 2.623398 SOL.
- Data length: 376,752 bytes.
- On-chain SHA-256: `eac891b994cac2373bb729be3c845703061b4d59a141e1945868c60e4f8ecb41`.
- Local production artifact SHA-256: `eac891b994cac2373bb729be3c845703061b4d59a141e1945868c60e4f8ecb41`.
- Byte comparison: identical.
- Buffer transaction history: 374 confirmed transactions, 0 failed.
- Creation transaction: `S2bSkvQpBZ8kgX4R9FinoG6V51VvJcbok1su6oSrmw15ko9mxvk6oAeY4Vk3NF8T9XtguLEq5vTnNzTfoVcHuqh`.
- Last write transaction: `4hUvPojwq5mDPe1Sz9zm7WedrMgRSrBVgPpycAN4CNtpLABKa7Mu2zWiP8EKhbeHMwiZ2e21HsymYiG7wnzTPojN`.
- Buffer-authority transfer: `5Z7fsFiq3J7oXE7a5yKamdRUfg5iv18fh9Mfj1caYimetvK4kvFMzbm75taaR9eP1spDESg8o2gqoB98qx5Dk7Lo` (`finalized`, `err: null`).

## Post-upload balances

- Temporary payer after authority transfer: 0.024717 SOL.
- Ledger authority: 0.06754344 SOL.
- Upload transaction fees: 0.001875 SOL.

## Live program safety check

- Program: `4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3`.
- ProgramData: `2BHrg3wqy2bcVtAp682exVGZEmrVJvey1WkjqxGCjWwh`.
- Upgrade authority: unchanged, `AApgoYncyfpadcMwZBvbCtzp3L9QdocgsYTmrPR2wEds`.
- Last deployed slot: unchanged, `432637845`.
- ProgramData capacity: 398,120 bytes.
- No service was stopped and no game transaction was submitted by this operation.

## Remaining approval boundary

The final program upgrade has not been executed. Temporarily stopping the keeper, executing the Ledger-authorized upgrade, deploying the matching keeper configuration, verifying all four pools, and restarting the keeper require a separate explicit approval.
