# LuckyMe Backend

The backend should not decide winners or custody funds.

MVP responsibilities:

- index pools, rounds, entries, winners, and payouts from Solana
- expose a fast read API for the mobile app
- find the entry account that contains the winning ticket so anyone can call settlement
- send push notifications after joins, wins, and jackpot hits

Do not put game-critical randomness here.
