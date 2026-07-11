# LuckyMe

LuckyMe is a Solana mobile-first luck pool game for fixed-entry rounds.

Connect a Solana wallet, choose a pool, review the ticket transaction, and sign
with your wallet. Each pool shows the fixed ticket price, active round, total
tickets, jackpot, wallet entry state, winner chance, prize split, treasury fee,
jackpot contribution, Program ID, and randomness/refund status.

The one-hour timer begins with the first confirmed ticket. A valid draw needs
25 Mini tickets, 13 Normal tickets, 3 High tickets, or 3 Premium tickets from 3
wallets. Mini, Normal, and High count total tickets, not distinct players. If a
target is missed, no winner is drawn and the full ticket purchase amount plus
Entry rent is returned automatically to the buying wallet; Solana network fees
are not refundable and no claim button is required.

The backend builds and simulates unsigned transactions. Your wallet signs the
transaction, and the LuckyMe Solana program executes ticket purchases,
settlement, payouts, jackpot accounting, and keeper-authorized automatic
refunds.

Category: Games
