use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use solana_sha256_hasher::hashv;

declare_id!("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");

const BPS_DENOMINATOR: u64 = 10_000;
const BPS_DENOMINATOR_U16: u16 = 10_000;
const MAX_FEE_BPS: u16 = 200;
const MAX_JACKPOT_BPS: u16 = 300;
const MAX_WINNERS: usize = 3;
const MAX_TICKETS_PER_ENTRY: u64 = 1_000;
const PREMIUM_POOL_ID: u8 = 4;
const PREMIUM_MAX_TICKETS_PER_ENTRY: u64 = 1;
#[cfg(not(feature = "test-short-timers"))]
const MIN_ROUND_DURATION_SECS: i64 = 60;
#[cfg(feature = "test-short-timers")]
const MIN_ROUND_DURATION_SECS: i64 = 1;
const MAX_ROUND_DURATION_SECS: i64 = 86_400;
#[cfg(not(feature = "test-short-timers"))]
const REFUND_DELAY_SECS: i64 = 600;
#[cfg(feature = "test-short-timers")]
const REFUND_DELAY_SECS: i64 = 2;
const ORAO_RANDOMNESS_ACCOUNT_SEED: &[u8] = b"orao-vrf-randomness-request";
const ORAO_VRF_PROGRAM_ID: Pubkey = pubkey!("VRFzZoJdhFWL8rkvu87LpKM3RbcVezpMEc6X5GVDr7y");

#[program]
pub mod luckyme {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        treasury: Pubkey,
        house_fee_bps: u16,
        jackpot_bps: u16,
        jackpot_odds_denominator: u32,
        round_duration_secs: i64,
    ) -> Result<()> {
        require!(house_fee_bps <= MAX_FEE_BPS, LuckyMeError::FeeTooHigh);
        require!(
            jackpot_bps <= MAX_JACKPOT_BPS,
            LuckyMeError::JackpotFeeTooHigh
        );
        require!(
            u64::from(house_fee_bps) + u64::from(jackpot_bps) < BPS_DENOMINATOR,
            LuckyMeError::InvalidFeeConfig
        );
        require!(jackpot_odds_denominator > 0, LuckyMeError::InvalidOdds);
        require!(
            (MIN_ROUND_DURATION_SECS..=MAX_ROUND_DURATION_SECS).contains(&round_duration_secs),
            LuckyMeError::InvalidRoundDuration
        );

        let config = &mut ctx.accounts.config;
        config.authority = ctx.accounts.authority.key();
        config.treasury = treasury;
        config.house_fee_bps = house_fee_bps;
        config.jackpot_bps = jackpot_bps;
        config.jackpot_odds_denominator = jackpot_odds_denominator;
        config.round_duration_secs = round_duration_secs;
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(ConfigInitialized {
            authority: config.authority,
            treasury,
            house_fee_bps,
            jackpot_bps,
            jackpot_odds_denominator,
            round_duration_secs,
        });
        Ok(())
    }

    pub fn initialize_pool(
        ctx: Context<InitializePool>,
        pool_id: u8,
        ticket_price_lamports: u64,
    ) -> Result<()> {
        require!(ticket_price_lamports > 0, LuckyMeError::InvalidTicketPrice);
        let spec = pool_spec(pool_id)?;
        require!(
            ticket_price_lamports == spec.ticket_price_lamports,
            LuckyMeError::InvalidTicketPrice
        );

        let pool = &mut ctx.accounts.pool;
        pool.config = ctx.accounts.config.key();
        pool.pool_id = pool_id;
        pool.ticket_price_lamports = ticket_price_lamports;
        pool.current_round = 0;
        pool.jackpot_lamports = 0;
        pool.winner_count = spec.winner_count;
        pool.prize_split_bps = spec.prize_split_bps;
        pool.max_tickets_per_entry = spec.max_tickets_per_entry;
        pool.bump = ctx.bumps.pool;
        pool.vault_bump = ctx.bumps.pool_vault;
        pool.jackpot_bump = ctx.bumps.jackpot_vault;
        emit!(PoolInitialized {
            config: pool.config,
            pool: pool.key(),
            pool_id,
            ticket_price_lamports,
            pool_vault: ctx.accounts.pool_vault.key(),
            jackpot_vault: ctx.accounts.jackpot_vault.key(),
        });
        Ok(())
    }

    pub fn open_round(ctx: Context<OpenRound>, randomness_commitment: [u8; 32]) -> Result<()> {
        require!(!ctx.accounts.config.paused, LuckyMeError::Paused);
        require!(
            randomness_commitment != [0; 32],
            LuckyMeError::InvalidRandomnessCommitment
        );

        let now = Clock::get()?.unix_timestamp;
        let pool = &mut ctx.accounts.pool;
        let round = &mut ctx.accounts.round;
        let round_id = pool
            .current_round
            .checked_add(1)
            .ok_or(LuckyMeError::MathOverflow)?;

        pool.current_round = round_id;

        round.pool = pool.key();
        round.round_id = round_id;
        round.start_ts = now;
        round.end_ts = now
            .checked_add(ctx.accounts.config.round_duration_secs)
            .ok_or(LuckyMeError::MathOverflow)?;
        round.ticket_price_lamports = pool.ticket_price_lamports;
        round.total_tickets = 0;
        round.total_lamports = 0;
        round.entrant_count = 0;
        round.settled = false;
        round.jackpot_triggered = false;
        round.winner_count = 0;
        round.winner = Pubkey::default();
        round.winner_second = Pubkey::default();
        round.winner_third = Pubkey::default();
        round.jackpot_winner = Pubkey::default();
        round.randomness_commitment = randomness_commitment;
        round.randomness = [0; 32];
        round.bump = ctx.bumps.round;
        emit!(RoundOpened {
            pool: pool.key(),
            round: round.key(),
            round_id,
            start_ts: round.start_ts,
            end_ts: round.end_ts,
            ticket_price_lamports: round.ticket_price_lamports,
            randomness_commitment,
        });
        Ok(())
    }

    pub fn buy_tickets(ctx: Context<BuyTickets>, ticket_count: u64) -> Result<()> {
        require!(!ctx.accounts.config.paused, LuckyMeError::Paused);
        require!(ticket_count > 0, LuckyMeError::InvalidTicketCount);
        require!(
            ticket_count <= ctx.accounts.pool.max_tickets_per_entry,
            LuckyMeError::InvalidTicketCount
        );

        let now = Clock::get()?.unix_timestamp;
        require!(now < ctx.accounts.round.end_ts, LuckyMeError::RoundClosed);
        require!(!ctx.accounts.round.settled, LuckyMeError::RoundSettled);
        require!(
            ctx.accounts.entry.ticket_count == 0,
            LuckyMeError::AlreadyEnteredRound
        );

        let amount = ctx
            .accounts
            .round
            .ticket_price_lamports
            .checked_mul(ticket_count)
            .ok_or(LuckyMeError::MathOverflow)?;

        let was_empty = ctx.accounts.entry.ticket_count == 0;
        if was_empty {
            ctx.accounts.entry.round = ctx.accounts.round.key();
            ctx.accounts.entry.player = ctx.accounts.player.key();
            ctx.accounts.entry.ticket_start = ctx.accounts.round.total_tickets;
            ctx.accounts.entry.ticket_count = 0;
            ctx.accounts.entry.lamports = 0;
            ctx.accounts.entry.bump = ctx.bumps.entry;
            ctx.accounts.round.entrant_count = ctx
                .accounts
                .round
                .entrant_count
                .checked_add(1)
                .ok_or(LuckyMeError::MathOverflow)?;
        }

        ctx.accounts.entry.ticket_count = ctx
            .accounts
            .entry
            .ticket_count
            .checked_add(ticket_count)
            .ok_or(LuckyMeError::MathOverflow)?;
        ctx.accounts.entry.lamports = ctx
            .accounts
            .entry
            .lamports
            .checked_add(amount)
            .ok_or(LuckyMeError::MathOverflow)?;
        ctx.accounts.round.total_tickets = ctx
            .accounts
            .round
            .total_tickets
            .checked_add(ticket_count)
            .ok_or(LuckyMeError::MathOverflow)?;
        ctx.accounts.round.total_lamports = ctx
            .accounts
            .round
            .total_lamports
            .checked_add(amount)
            .ok_or(LuckyMeError::MathOverflow)?;

        transfer(
            CpiContext::new(
                ctx.accounts.system_program.key(),
                Transfer {
                    from: ctx.accounts.player.to_account_info(),
                    to: ctx.accounts.pool_vault.to_account_info(),
                },
            ),
            amount,
        )?;

        emit!(TicketsBought {
            pool: ctx.accounts.pool.key(),
            round: ctx.accounts.round.key(),
            entry: ctx.accounts.entry.key(),
            player: ctx.accounts.player.key(),
            ticket_start: ctx.accounts.entry.ticket_start,
            ticket_count,
            entry_ticket_count: ctx.accounts.entry.ticket_count,
            amount_lamports: amount,
            round_total_tickets: ctx.accounts.round.total_tickets,
            round_total_lamports: ctx.accounts.round.total_lamports,
        });

        Ok(())
    }

    pub fn settle_round<'info>(
        ctx: Context<'info, SettleRound<'info>>,
        randomness_reveal: [u8; 32],
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.round.end_ts,
            LuckyMeError::RoundStillOpen
        );
        require!(!ctx.accounts.round.settled, LuckyMeError::RoundSettled);
        require!(
            ctx.accounts.round.total_tickets > 0,
            LuckyMeError::EmptyRound
        );
        require!(
            commitment_for(&randomness_reveal) == ctx.accounts.round.randomness_commitment,
            LuckyMeError::InvalidRandomnessReveal
        );

        let total = ctx.accounts.round.total_lamports;
        let house_fee = bps_amount(total, ctx.accounts.config.house_fee_bps)?;
        let jackpot_add = bps_amount(total, ctx.accounts.config.jackpot_bps)?;
        let main_prize = total
            .checked_sub(house_fee)
            .and_then(|v| v.checked_sub(jackpot_add))
            .ok_or(LuckyMeError::MathOverflow)?;

        let randomness = derive_round_randomness(
            &ctx.accounts.round.key(),
            ctx.accounts.round.total_tickets,
            &randomness_reveal,
        );

        let winner_count = ctx.accounts.pool.winner_count;
        require_valid_winner_count(winner_count)?;
        require!(
            ctx.accounts.round.entrant_count >= u32::from(winner_count),
            LuckyMeError::NotEnoughEntrants
        );
        let winner_tickets =
            select_winner_tickets(&randomness, ctx.accounts.round.total_tickets, winner_count)?;
        let winning_ticket = winner_tickets[0];
        require!(
            entry_contains_ticket(&ctx.accounts.winner_entry, winning_ticket),
            LuckyMeError::WrongWinnerEntry
        );
        require!(
            ctx.accounts.winner_entry.player == ctx.accounts.winner.key(),
            LuckyMeError::WinnerMismatch
        );

        let mut winner_keys = [Pubkey::default(); MAX_WINNERS];
        let mut winner_entry_keys = [Pubkey::default(); MAX_WINNERS];
        winner_keys[0] = ctx.accounts.winner.key();
        winner_entry_keys[0] = ctx.accounts.winner_entry.key();
        let mut winner_second_info = None;
        let mut winner_third_info = None;

        if winner_count == 3 {
            let second = validate_remaining_winner(
                ctx.remaining_accounts,
                0,
                &ctx.accounts.round.key(),
                winner_tickets[1],
            )?;
            let third = validate_remaining_winner(
                ctx.remaining_accounts,
                2,
                &ctx.accounts.round.key(),
                winner_tickets[2],
            )?;
            winner_keys[1] = second.winner;
            winner_entry_keys[1] = second.entry;
            winner_second_info = Some(second.winner_info);
            winner_keys[2] = third.winner;
            winner_entry_keys[2] = third.entry;
            winner_third_info = Some(third.winner_info);
            require_distinct_winners(&winner_keys, winner_count)?;
        }

        let jackpot_roll = random_mod_domain(
            &randomness,
            b"jackpot-roll",
            0,
            u64::from(ctx.accounts.config.jackpot_odds_denominator),
        );
        let jackpot_triggered = jackpot_roll == 0;

        let jackpot_ticket = random_mod_domain(
            &randomness,
            b"jackpot-winner",
            0,
            ctx.accounts.round.total_tickets,
        );
        if jackpot_triggered {
            require!(
                entry_contains_ticket(&ctx.accounts.jackpot_entry, jackpot_ticket),
                LuckyMeError::WrongJackpotEntry
            );
            require!(
                ctx.accounts.jackpot_entry.player == ctx.accounts.jackpot_winner.key(),
                LuckyMeError::WinnerMismatch
            );
        }

        let prize_payouts = main_prize_payouts(main_prize, &ctx.accounts.pool)?;
        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            prize_payouts[0],
        )?;
        if winner_count == 3 {
            transfer_lamports(
                &ctx.accounts.pool_vault.to_account_info(),
                winner_second_info
                    .as_ref()
                    .ok_or(LuckyMeError::MissingWinnerAccounts)?,
                prize_payouts[1],
            )?;
            transfer_lamports(
                &ctx.accounts.pool_vault.to_account_info(),
                winner_third_info
                    .as_ref()
                    .ok_or(LuckyMeError::MissingWinnerAccounts)?,
                prize_payouts[2],
            )?;
        }
        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            house_fee,
        )?;
        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.jackpot_vault.to_account_info(),
            jackpot_add,
        )?;

        ctx.accounts.pool.jackpot_lamports = ctx
            .accounts
            .pool
            .jackpot_lamports
            .checked_add(jackpot_add)
            .ok_or(LuckyMeError::MathOverflow)?;

        if jackpot_triggered {
            let jackpot_payout = ctx.accounts.pool.jackpot_lamports;
            transfer_lamports(
                &ctx.accounts.jackpot_vault.to_account_info(),
                &ctx.accounts.jackpot_winner.to_account_info(),
                jackpot_payout,
            )?;
            ctx.accounts.pool.jackpot_lamports = 0;
        }

        let round = &mut ctx.accounts.round;
        round.settled = true;
        round.jackpot_triggered = jackpot_triggered;
        round.winner_count = winner_count;
        round.winner = ctx.accounts.winner.key();
        round.winner_second = if winner_count == 3 {
            winner_keys[1]
        } else {
            Pubkey::default()
        };
        round.winner_third = if winner_count == 3 {
            winner_keys[2]
        } else {
            Pubkey::default()
        };
        round.jackpot_winner = if jackpot_triggered {
            ctx.accounts.jackpot_winner.key()
        } else {
            Pubkey::default()
        };
        round.randomness = randomness;

        emit!(RoundSettled {
            pool: ctx.accounts.pool.key(),
            round: round.key(),
            round_id: round.round_id,
            winner_count,
            winner: round.winner,
            winner_entry: ctx.accounts.winner_entry.key(),
            winner_second: round.winner_second,
            winner_second_entry: winner_entry_keys[1],
            winner_third: round.winner_third,
            winner_third_entry: winner_entry_keys[2],
            winning_ticket,
            winner_second_ticket: winner_tickets[1],
            winner_third_ticket: winner_tickets[2],
            main_prize_lamports: main_prize,
            first_prize_lamports: prize_payouts[0],
            second_prize_lamports: prize_payouts[1],
            third_prize_lamports: prize_payouts[2],
            house_fee_lamports: house_fee,
            jackpot_add_lamports: jackpot_add,
            jackpot_triggered,
            jackpot_winner: round.jackpot_winner,
            jackpot_entry: ctx.accounts.jackpot_entry.key(),
            jackpot_ticket,
            randomness,
            randomness_provider: RandomnessProvider::CommitRevealDemo,
        });

        Ok(())
    }

    pub fn request_randomness(ctx: Context<RequestRandomness>) -> Result<()> {
        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        require!(
            now >= ctx.accounts.round.end_ts,
            LuckyMeError::RoundStillOpen
        );
        require!(!ctx.accounts.round.settled, LuckyMeError::RoundSettled);
        require!(
            ctx.accounts.round.total_tickets > 0,
            LuckyMeError::EmptyRound
        );

        let seed = derive_orao_randomness_seed(
            &ctx.accounts.round.key(),
            &ctx.accounts.pool.key(),
            ctx.accounts.round.round_id,
            ctx.accounts.round.total_tickets,
            ctx.accounts.round.entrant_count,
            clock.slot,
        );
        let request = orao_randomness_request_address(&seed);
        let round_randomness = &mut ctx.accounts.round_randomness;
        round_randomness.round = ctx.accounts.round.key();
        round_randomness.provider = RandomnessProvider::OraoVrf;
        round_randomness.status = RandomnessStatus::Requested;
        round_randomness.request = request;
        round_randomness.randomness_seed = seed;
        round_randomness.randomness_value = [0; 32];
        round_randomness.randomness_requested_at = now;
        round_randomness.randomness_fulfilled_at = 0;
        round_randomness.bump = ctx.bumps.round_randomness;

        emit!(RandomnessRequested {
            pool: ctx.accounts.pool.key(),
            round: ctx.accounts.round.key(),
            round_id: ctx.accounts.round.round_id,
            provider: RandomnessProvider::OraoVrf,
            request,
            seed,
            timestamp: now,
        });

        Ok(())
    }

    pub fn settle_round_with_provider_randomness<'info>(
        ctx: Context<'info, SettleRoundWithProviderRandomness<'info>>,
    ) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.round.end_ts,
            LuckyMeError::RoundStillOpen
        );
        require!(!ctx.accounts.round.settled, LuckyMeError::RoundSettled);
        require!(
            ctx.accounts.round.total_tickets > 0,
            LuckyMeError::EmptyRound
        );
        require!(
            ctx.accounts.round_randomness.provider == RandomnessProvider::OraoVrf,
            LuckyMeError::InvalidRandomnessProvider
        );
        require!(
            matches!(
                ctx.accounts.round_randomness.status,
                RandomnessStatus::Requested | RandomnessStatus::Fulfilled
            ),
            LuckyMeError::InvalidRandomnessStatus
        );
        require!(
            ctx.accounts.provider_randomness.owner == &ORAO_VRF_PROGRAM_ID,
            LuckyMeError::InvalidRandomnessProviderAccount
        );
        require!(
            ctx.accounts.provider_randomness.key() == ctx.accounts.round_randomness.request,
            LuckyMeError::InvalidRandomnessProviderAccount
        );

        let expected_request =
            orao_randomness_request_address(&ctx.accounts.round_randomness.randomness_seed);
        require!(
            expected_request == ctx.accounts.provider_randomness.key(),
            LuckyMeError::InvalidRandomnessProviderAccount
        );

        let provider_data = ctx.accounts.provider_randomness.data.borrow();
        let fulfilled = parse_orao_v2_fulfilled_randomness(&provider_data)?;
        require!(
            fulfilled.seed == ctx.accounts.round_randomness.randomness_seed,
            LuckyMeError::InvalidRandomnessProviderAccount
        );

        let randomness = derive_provider_round_randomness(
            &ctx.accounts.round.key(),
            ctx.accounts.round.total_tickets,
            &fulfilled.randomness,
        );
        let randomness_hash = hashv(&[
            b"luckyme-provider-randomness-hash",
            fulfilled.randomness.as_ref(),
        ])
        .to_bytes();

        let total = ctx.accounts.round.total_lamports;
        let house_fee = bps_amount(total, ctx.accounts.config.house_fee_bps)?;
        let jackpot_add = bps_amount(total, ctx.accounts.config.jackpot_bps)?;
        let main_prize = total
            .checked_sub(house_fee)
            .and_then(|v| v.checked_sub(jackpot_add))
            .ok_or(LuckyMeError::MathOverflow)?;

        let winner_count = ctx.accounts.pool.winner_count;
        require_valid_winner_count(winner_count)?;
        require!(
            ctx.accounts.round.entrant_count >= u32::from(winner_count),
            LuckyMeError::NotEnoughEntrants
        );
        let winner_tickets =
            select_winner_tickets(&randomness, ctx.accounts.round.total_tickets, winner_count)?;
        let winning_ticket = winner_tickets[0];
        require!(
            entry_contains_ticket(&ctx.accounts.winner_entry, winning_ticket),
            LuckyMeError::WrongWinnerEntry
        );
        require!(
            ctx.accounts.winner_entry.player == ctx.accounts.winner.key(),
            LuckyMeError::WinnerMismatch
        );

        let mut winner_keys = [Pubkey::default(); MAX_WINNERS];
        let mut winner_entry_keys = [Pubkey::default(); MAX_WINNERS];
        winner_keys[0] = ctx.accounts.winner.key();
        winner_entry_keys[0] = ctx.accounts.winner_entry.key();
        let mut winner_second_info = None;
        let mut winner_third_info = None;

        if winner_count == 3 {
            let second = validate_remaining_winner(
                ctx.remaining_accounts,
                0,
                &ctx.accounts.round.key(),
                winner_tickets[1],
            )?;
            let third = validate_remaining_winner(
                ctx.remaining_accounts,
                2,
                &ctx.accounts.round.key(),
                winner_tickets[2],
            )?;
            winner_keys[1] = second.winner;
            winner_entry_keys[1] = second.entry;
            winner_second_info = Some(second.winner_info);
            winner_keys[2] = third.winner;
            winner_entry_keys[2] = third.entry;
            winner_third_info = Some(third.winner_info);
            require_distinct_winners(&winner_keys, winner_count)?;
        }

        let jackpot_roll = random_mod_domain(
            &randomness,
            b"jackpot-roll",
            0,
            u64::from(ctx.accounts.config.jackpot_odds_denominator),
        );
        let jackpot_triggered = jackpot_roll == 0;

        let jackpot_ticket = random_mod_domain(
            &randomness,
            b"jackpot-winner",
            0,
            ctx.accounts.round.total_tickets,
        );
        if jackpot_triggered {
            require!(
                entry_contains_ticket(&ctx.accounts.jackpot_entry, jackpot_ticket),
                LuckyMeError::WrongJackpotEntry
            );
            require!(
                ctx.accounts.jackpot_entry.player == ctx.accounts.jackpot_winner.key(),
                LuckyMeError::WinnerMismatch
            );
        }

        emit!(RandomnessFulfilled {
            pool: ctx.accounts.pool.key(),
            round: ctx.accounts.round.key(),
            round_id: ctx.accounts.round.round_id,
            provider: RandomnessProvider::OraoVrf,
            request: ctx.accounts.provider_randomness.key(),
            seed: fulfilled.seed,
            client: fulfilled.client,
            randomness_hash,
            timestamp: now,
        });

        let prize_payouts = main_prize_payouts(main_prize, &ctx.accounts.pool)?;
        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            prize_payouts[0],
        )?;
        if winner_count == 3 {
            transfer_lamports(
                &ctx.accounts.pool_vault.to_account_info(),
                winner_second_info
                    .as_ref()
                    .ok_or(LuckyMeError::MissingWinnerAccounts)?,
                prize_payouts[1],
            )?;
            transfer_lamports(
                &ctx.accounts.pool_vault.to_account_info(),
                winner_third_info
                    .as_ref()
                    .ok_or(LuckyMeError::MissingWinnerAccounts)?,
                prize_payouts[2],
            )?;
        }
        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.treasury.to_account_info(),
            house_fee,
        )?;
        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.jackpot_vault.to_account_info(),
            jackpot_add,
        )?;

        ctx.accounts.pool.jackpot_lamports = ctx
            .accounts
            .pool
            .jackpot_lamports
            .checked_add(jackpot_add)
            .ok_or(LuckyMeError::MathOverflow)?;

        if jackpot_triggered {
            let jackpot_payout = ctx.accounts.pool.jackpot_lamports;
            transfer_lamports(
                &ctx.accounts.jackpot_vault.to_account_info(),
                &ctx.accounts.jackpot_winner.to_account_info(),
                jackpot_payout,
            )?;
            ctx.accounts.pool.jackpot_lamports = 0;
        }

        let round = &mut ctx.accounts.round;
        round.settled = true;
        round.jackpot_triggered = jackpot_triggered;
        round.winner_count = winner_count;
        round.winner = ctx.accounts.winner.key();
        round.winner_second = if winner_count == 3 {
            winner_keys[1]
        } else {
            Pubkey::default()
        };
        round.winner_third = if winner_count == 3 {
            winner_keys[2]
        } else {
            Pubkey::default()
        };
        round.jackpot_winner = if jackpot_triggered {
            ctx.accounts.jackpot_winner.key()
        } else {
            Pubkey::default()
        };
        round.randomness = randomness;

        let round_randomness = &mut ctx.accounts.round_randomness;
        round_randomness.status = RandomnessStatus::Settled;
        round_randomness.randomness_value = randomness;
        round_randomness.randomness_fulfilled_at = now;

        emit!(RoundSettled {
            pool: ctx.accounts.pool.key(),
            round: round.key(),
            round_id: round.round_id,
            winner_count,
            winner: round.winner,
            winner_entry: ctx.accounts.winner_entry.key(),
            winner_second: round.winner_second,
            winner_second_entry: winner_entry_keys[1],
            winner_third: round.winner_third,
            winner_third_entry: winner_entry_keys[2],
            winning_ticket,
            winner_second_ticket: winner_tickets[1],
            winner_third_ticket: winner_tickets[2],
            main_prize_lamports: main_prize,
            first_prize_lamports: prize_payouts[0],
            second_prize_lamports: prize_payouts[1],
            third_prize_lamports: prize_payouts[2],
            house_fee_lamports: house_fee,
            jackpot_add_lamports: jackpot_add,
            jackpot_triggered,
            jackpot_winner: round.jackpot_winner,
            jackpot_entry: ctx.accounts.jackpot_entry.key(),
            jackpot_ticket,
            randomness,
            randomness_provider: RandomnessProvider::OraoVrf,
        });

        Ok(())
    }

    pub fn refund_entry_after_timeout(ctx: Context<RefundEntryAfterTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        let refund_after = refund_deadline(ctx.accounts.round.end_ts)?;
        require!(now >= refund_after, LuckyMeError::RefundNotAvailable);
        require!(
            !ctx.accounts.round.settled || round_is_refund_mode(&ctx.accounts.round),
            LuckyMeError::RoundSettled
        );
        require!(
            ctx.accounts.entry.lamports > 0,
            LuckyMeError::NothingToRefund
        );

        let refund_lamports = ctx.accounts.entry.lamports;
        let refund_tickets = ctx.accounts.entry.ticket_count;

        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.player.to_account_info(),
            refund_lamports,
        )?;

        let round = &mut ctx.accounts.round;
        round.settled = true;
        round.jackpot_triggered = false;
        round.winner_count = 0;
        round.winner = Pubkey::default();
        round.winner_second = Pubkey::default();
        round.winner_third = Pubkey::default();
        round.jackpot_winner = Pubkey::default();
        round.randomness = [0; 32];
        round.total_lamports = round
            .total_lamports
            .checked_sub(refund_lamports)
            .ok_or(LuckyMeError::MathOverflow)?;
        round.total_tickets = round
            .total_tickets
            .checked_sub(refund_tickets)
            .ok_or(LuckyMeError::MathOverflow)?;
        round.entrant_count = round
            .entrant_count
            .checked_sub(1)
            .ok_or(LuckyMeError::MathOverflow)?;

        let entry = &mut ctx.accounts.entry;
        entry.ticket_count = 0;
        entry.lamports = 0;

        emit!(EntryRefunded {
            pool: ctx.accounts.pool.key(),
            round: round.key(),
            entry: entry.key(),
            player: ctx.accounts.player.key(),
            refund_lamports,
            refund_tickets,
            round_total_tickets: round.total_tickets,
            round_total_lamports: round.total_lamports,
            remaining_entrant_count: round.entrant_count,
        });

        Ok(())
    }

    pub fn close_empty_round_after_timeout(ctx: Context<CloseEmptyRoundAfterTimeout>) -> Result<()> {
        let now = Clock::get()?.unix_timestamp;
        require!(
            now >= ctx.accounts.round.end_ts,
            LuckyMeError::RoundStillOpen
        );
        require!(!ctx.accounts.round.settled, LuckyMeError::RoundSettled);
        require!(
            ctx.accounts.round.total_tickets == 0
                && ctx.accounts.round.total_lamports == 0
                && ctx.accounts.round.entrant_count == 0,
            LuckyMeError::RoundHasEntries
        );

        let round = &mut ctx.accounts.round;
        round.settled = true;
        round.jackpot_triggered = false;
        round.winner_count = 0;
        round.winner = Pubkey::default();
        round.winner_second = Pubkey::default();
        round.winner_third = Pubkey::default();
        round.jackpot_winner = Pubkey::default();
        round.randomness = [0; 32];

        emit!(EmptyRoundClosed {
            pool: ctx.accounts.pool.key(),
            round: round.key(),
            round_id: round.round_id,
        });

        Ok(())
    }

    pub fn set_paused(ctx: Context<SetPaused>, paused: bool) -> Result<()> {
        ctx.accounts.config.paused = paused;
        emit!(PausedSet {
            authority: ctx.accounts.authority.key(),
            config: ctx.accounts.config.key(),
            paused,
        });
        Ok(())
    }
}

#[event]
pub struct ConfigInitialized {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub house_fee_bps: u16,
    pub jackpot_bps: u16,
    pub jackpot_odds_denominator: u32,
    pub round_duration_secs: i64,
}

#[event]
pub struct PoolInitialized {
    pub config: Pubkey,
    pub pool: Pubkey,
    pub pool_id: u8,
    pub ticket_price_lamports: u64,
    pub pool_vault: Pubkey,
    pub jackpot_vault: Pubkey,
}

#[event]
pub struct RoundOpened {
    pub pool: Pubkey,
    pub round: Pubkey,
    pub round_id: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub ticket_price_lamports: u64,
    pub randomness_commitment: [u8; 32],
}

#[event]
pub struct TicketsBought {
    pub pool: Pubkey,
    pub round: Pubkey,
    pub entry: Pubkey,
    pub player: Pubkey,
    pub ticket_start: u64,
    pub ticket_count: u64,
    pub entry_ticket_count: u64,
    pub amount_lamports: u64,
    pub round_total_tickets: u64,
    pub round_total_lamports: u64,
}

#[event]
pub struct RoundSettled {
    pub pool: Pubkey,
    pub round: Pubkey,
    pub round_id: u64,
    pub winner_count: u8,
    pub winner: Pubkey,
    pub winner_entry: Pubkey,
    pub winner_second: Pubkey,
    pub winner_second_entry: Pubkey,
    pub winner_third: Pubkey,
    pub winner_third_entry: Pubkey,
    pub winning_ticket: u64,
    pub winner_second_ticket: u64,
    pub winner_third_ticket: u64,
    pub main_prize_lamports: u64,
    pub first_prize_lamports: u64,
    pub second_prize_lamports: u64,
    pub third_prize_lamports: u64,
    pub house_fee_lamports: u64,
    pub jackpot_add_lamports: u64,
    pub jackpot_triggered: bool,
    pub jackpot_winner: Pubkey,
    pub jackpot_entry: Pubkey,
    pub jackpot_ticket: u64,
    pub randomness: [u8; 32],
    pub randomness_provider: RandomnessProvider,
}

#[event]
pub struct RandomnessRequested {
    pub pool: Pubkey,
    pub round: Pubkey,
    pub round_id: u64,
    pub provider: RandomnessProvider,
    pub request: Pubkey,
    pub seed: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct RandomnessFulfilled {
    pub pool: Pubkey,
    pub round: Pubkey,
    pub round_id: u64,
    pub provider: RandomnessProvider,
    pub request: Pubkey,
    pub seed: [u8; 32],
    pub client: Pubkey,
    pub randomness_hash: [u8; 32],
    pub timestamp: i64,
}

#[event]
pub struct EntryRefunded {
    pub pool: Pubkey,
    pub round: Pubkey,
    pub entry: Pubkey,
    pub player: Pubkey,
    pub refund_lamports: u64,
    pub refund_tickets: u64,
    pub round_total_tickets: u64,
    pub round_total_lamports: u64,
    pub remaining_entrant_count: u32,
}

#[event]
pub struct EmptyRoundClosed {
    pub pool: Pubkey,
    pub round: Pubkey,
    pub round_id: u64,
}

#[event]
pub struct PausedSet {
    pub authority: Pubkey,
    pub config: Pubkey,
    pub paused: bool,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        init,
        payer = authority,
        space = 8 + Config::LEN,
        seeds = [b"config"],
        bump
    )]
    pub config: Account<'info, Config>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(pool_id: u8)]
pub struct InitializePool<'info> {
    #[account(mut, address = config.authority)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        init,
        payer = authority,
        space = 8 + Pool::LEN,
        seeds = [b"pool", config.key().as_ref(), &[pool_id]],
        bump
    )]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"vault", pool.key().as_ref()],
        bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub pool_vault: UncheckedAccount<'info>,
    #[account(
        init,
        payer = authority,
        space = 0,
        seeds = [b"jackpot", pool.key().as_ref()],
        bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub jackpot_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OpenRound<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(mut, has_one = config)]
    pub pool: Account<'info, Pool>,
    #[account(
        init,
        payer = keeper,
        space = 8 + Round::LEN,
        seeds = [b"round", pool.key().as_ref(), &(pool.current_round + 1).to_le_bytes()],
        bump
    )]
    pub round: Account<'info, Round>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTickets<'info> {
    #[account(mut)]
    pub player: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(has_one = config)]
    pub pool: Account<'info, Pool>,
    #[account(mut, has_one = pool)]
    pub round: Account<'info, Round>,
    #[account(
        init_if_needed,
        payer = player,
        space = 8 + Entry::LEN,
        seeds = [b"entry", round.key().as_ref(), player.key().as_ref()],
        bump
    )]
    pub entry: Account<'info, Entry>,
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub pool_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleRound<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = config)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, has_one = pool)]
    pub round: Box<Account<'info, Round>>,
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub pool_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"jackpot", pool.key().as_ref()],
        bump = pool.jackpot_bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub jackpot_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub winner: SystemAccount<'info>,
    #[account(constraint = winner_entry.round == round.key())]
    pub winner_entry: Box<Account<'info, Entry>>,
    #[account(mut)]
    pub jackpot_winner: SystemAccount<'info>,
    #[account(constraint = jackpot_entry.round == round.key())]
    pub jackpot_entry: Box<Account<'info, Entry>>,
    #[account(mut, address = config.treasury)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(has_one = config)]
    pub pool: Account<'info, Pool>,
    #[account(has_one = pool)]
    pub round: Account<'info, Round>,
    #[account(
        init,
        payer = keeper,
        space = 8 + RoundRandomness::LEN,
        seeds = [b"round_randomness", round.key().as_ref()],
        bump
    )]
    pub round_randomness: Account<'info, RoundRandomness>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SettleRoundWithProviderRandomness<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Box<Account<'info, Config>>,
    #[account(mut, has_one = config)]
    pub pool: Box<Account<'info, Pool>>,
    #[account(mut, has_one = pool)]
    pub round: Box<Account<'info, Round>>,
    #[account(
        mut,
        seeds = [b"round_randomness", round.key().as_ref()],
        bump = round_randomness.bump,
        constraint = round_randomness.round == round.key()
    )]
    pub round_randomness: Box<Account<'info, RoundRandomness>>,
    /// CHECK: ORAO VRF request account. Owner, PDA, seed, and fulfilled data are verified in the handler.
    pub provider_randomness: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub pool_vault: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [b"jackpot", pool.key().as_ref()],
        bump = pool.jackpot_bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub jackpot_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub winner: SystemAccount<'info>,
    #[account(constraint = winner_entry.round == round.key())]
    pub winner_entry: Box<Account<'info, Entry>>,
    #[account(mut)]
    pub jackpot_winner: SystemAccount<'info>,
    #[account(constraint = jackpot_entry.round == round.key())]
    pub jackpot_entry: Box<Account<'info, Entry>>,
    #[account(mut, address = config.treasury)]
    pub treasury: SystemAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RefundEntryAfterTimeout<'info> {
    #[account(mut)]
    pub player: SystemAccount<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(has_one = config)]
    pub pool: Account<'info, Pool>,
    #[account(mut, has_one = pool)]
    pub round: Account<'info, Round>,
    #[account(
        mut,
        constraint = entry.round == round.key(),
        constraint = entry.player == player.key()
    )]
    pub entry: Account<'info, Entry>,
    #[account(
        mut,
        seeds = [b"vault", pool.key().as_ref()],
        bump = pool.vault_bump
    )]
    /// CHECK: PDA vault owned by this program; it only stores lamports.
    pub pool_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CloseEmptyRoundAfterTimeout<'info> {
    #[account(mut)]
    pub keeper: Signer<'info>,
    #[account(seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(has_one = config)]
    pub pool: Account<'info, Pool>,
    #[account(mut, has_one = pool)]
    pub round: Account<'info, Round>,
}

#[derive(Accounts)]
pub struct SetPaused<'info> {
    #[account(address = config.authority)]
    pub authority: Signer<'info>,
    #[account(mut, seeds = [b"config"], bump = config.bump)]
    pub config: Account<'info, Config>,
}

#[account]
pub struct Config {
    pub authority: Pubkey,
    pub treasury: Pubkey,
    pub house_fee_bps: u16,
    pub jackpot_bps: u16,
    pub jackpot_odds_denominator: u32,
    pub round_duration_secs: i64,
    pub paused: bool,
    pub bump: u8,
}

impl Config {
    pub const LEN: usize = 32 + 32 + 2 + 2 + 4 + 8 + 1 + 1;
}

#[account]
pub struct Pool {
    pub config: Pubkey,
    pub pool_id: u8,
    pub ticket_price_lamports: u64,
    pub current_round: u64,
    pub jackpot_lamports: u64,
    pub winner_count: u8,
    pub prize_split_bps: [u16; MAX_WINNERS],
    pub max_tickets_per_entry: u64,
    pub bump: u8,
    pub vault_bump: u8,
    pub jackpot_bump: u8,
}

impl Pool {
    pub const LEN: usize = 32 + 1 + 8 + 8 + 8 + 1 + (2 * MAX_WINNERS) + 8 + 1 + 1 + 1;
}

#[account]
pub struct Round {
    pub pool: Pubkey,
    pub round_id: u64,
    pub start_ts: i64,
    pub end_ts: i64,
    pub ticket_price_lamports: u64,
    pub total_tickets: u64,
    pub total_lamports: u64,
    pub entrant_count: u32,
    pub settled: bool,
    pub jackpot_triggered: bool,
    pub winner_count: u8,
    pub winner: Pubkey,
    pub winner_second: Pubkey,
    pub winner_third: Pubkey,
    pub jackpot_winner: Pubkey,
    pub randomness_commitment: [u8; 32],
    pub randomness: [u8; 32],
    pub bump: u8,
}

impl Round {
    pub const LEN: usize =
        32 + 8 + 8 + 8 + 8 + 8 + 8 + 4 + 1 + 1 + 1 + 32 + 32 + 32 + 32 + 32 + 32 + 1;
}

#[account]
pub struct RoundRandomness {
    pub round: Pubkey,
    pub provider: RandomnessProvider,
    pub status: RandomnessStatus,
    pub request: Pubkey,
    pub randomness_seed: [u8; 32],
    pub randomness_value: [u8; 32],
    pub randomness_requested_at: i64,
    pub randomness_fulfilled_at: i64,
    pub bump: u8,
}

impl RoundRandomness {
    pub const LEN: usize = 32 + 1 + 1 + 32 + 32 + 32 + 8 + 8 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RandomnessProvider {
    CommitRevealDemo,
    OraoVrf,
    FutureProvider,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum RandomnessStatus {
    NotRequested,
    Requested,
    Fulfilled,
    Settled,
    RefundMode,
}

#[account]
pub struct Entry {
    pub round: Pubkey,
    pub player: Pubkey,
    pub ticket_start: u64,
    pub ticket_count: u64,
    pub lamports: u64,
    pub bump: u8,
}

impl Entry {
    pub const LEN: usize = 32 + 32 + 8 + 8 + 8 + 1;
}

struct PoolSpec {
    ticket_price_lamports: u64,
    winner_count: u8,
    prize_split_bps: [u16; MAX_WINNERS],
    max_tickets_per_entry: u64,
}

struct RemainingWinner<'info> {
    winner: Pubkey,
    entry: Pubkey,
    winner_info: AccountInfo<'info>,
}

fn pool_spec(pool_id: u8) -> Result<PoolSpec> {
    match pool_id {
        1 => Ok(PoolSpec {
            ticket_price_lamports: 5_000_000,
            winner_count: 1,
            prize_split_bps: [BPS_DENOMINATOR_U16, 0, 0],
            max_tickets_per_entry: MAX_TICKETS_PER_ENTRY,
        }),
        2 => Ok(PoolSpec {
            ticket_price_lamports: 10_000_000,
            winner_count: 1,
            prize_split_bps: [BPS_DENOMINATOR_U16, 0, 0],
            max_tickets_per_entry: MAX_TICKETS_PER_ENTRY,
        }),
        3 => Ok(PoolSpec {
            ticket_price_lamports: 50_000_000,
            winner_count: 1,
            prize_split_bps: [BPS_DENOMINATOR_U16, 0, 0],
            max_tickets_per_entry: MAX_TICKETS_PER_ENTRY,
        }),
        PREMIUM_POOL_ID => Ok(PoolSpec {
            ticket_price_lamports: 100_000_000,
            winner_count: 3,
            prize_split_bps: [7_000, 2_000, 1_000],
            max_tickets_per_entry: PREMIUM_MAX_TICKETS_PER_ENTRY,
        }),
        _ => err!(LuckyMeError::InvalidPool),
    }
}

fn bps_amount(total: u64, bps: u16) -> Result<u64> {
    total
        .checked_mul(u64::from(bps))
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(LuckyMeError::MathOverflow.into())
}

fn require_valid_winner_count(winner_count: u8) -> Result<()> {
    require!(
        winner_count == 1 || winner_count == MAX_WINNERS as u8,
        LuckyMeError::InvalidWinnerConfig
    );
    Ok(())
}

fn require_distinct_winners(winner_keys: &[Pubkey; MAX_WINNERS], winner_count: u8) -> Result<()> {
    let count = winner_count as usize;
    for left in 0..count {
        for right in (left + 1)..count {
            require!(
                winner_keys[left] != winner_keys[right],
                LuckyMeError::DuplicateWinner
            );
        }
    }
    Ok(())
}

fn main_prize_payouts(main_prize: u64, pool: &Pool) -> Result<[u64; MAX_WINNERS]> {
    require_valid_winner_count(pool.winner_count)?;

    let mut split_sum = 0_u16;
    for index in 0..pool.winner_count as usize {
        split_sum = split_sum
            .checked_add(pool.prize_split_bps[index])
            .ok_or(LuckyMeError::MathOverflow)?;
    }
    require!(
        split_sum == BPS_DENOMINATOR_U16,
        LuckyMeError::InvalidPrizeSplit
    );

    let mut payouts = [0_u64; MAX_WINNERS];
    let mut allocated = 0_u64;
    for index in 1..pool.winner_count as usize {
        payouts[index] = bps_amount(main_prize, pool.prize_split_bps[index])?;
        allocated = allocated
            .checked_add(payouts[index])
            .ok_or(LuckyMeError::MathOverflow)?;
    }
    payouts[0] = main_prize
        .checked_sub(allocated)
        .ok_or(LuckyMeError::MathOverflow)?;
    Ok(payouts)
}

fn select_winner_tickets(
    randomness: &[u8; 32],
    total_tickets: u64,
    winner_count: u8,
) -> Result<[u64; MAX_WINNERS]> {
    require_valid_winner_count(winner_count)?;
    require!(
        total_tickets >= u64::from(winner_count),
        LuckyMeError::NotEnoughEntrants
    );

    let first = random_mod_domain(randomness, b"main-winner", 0, total_tickets);
    if winner_count == 1 {
        return Ok([first, 0, 0]);
    }

    let second_raw = random_mod_domain(randomness, b"main-winner", 1, total_tickets - 1);
    let second = ticket_from_available_index(second_raw, &[first, 0], 1);
    let third_raw = random_mod_domain(randomness, b"main-winner", 2, total_tickets - 2);
    let third = ticket_from_available_index(third_raw, &[first, second], 2);
    Ok([first, second, third])
}

fn ticket_from_available_index(mut index: u64, excluded: &[u64; 2], excluded_len: usize) -> u64 {
    let mut sorted = [0_u64; 2];
    sorted[..excluded_len].copy_from_slice(&excluded[..excluded_len]);
    if excluded_len == 2 && sorted[0] > sorted[1] {
        sorted.swap(0, 1);
    }

    for excluded_ticket in sorted.iter().take(excluded_len) {
        if index >= *excluded_ticket {
            index += 1;
        }
    }
    index
}

fn validate_remaining_winner<'info>(
    remaining_accounts: &'info [AccountInfo<'info>],
    start_index: usize,
    round_key: &Pubkey,
    winning_ticket: u64,
) -> Result<RemainingWinner<'info>> {
    require!(
        remaining_accounts.len() >= start_index + 2,
        LuckyMeError::MissingWinnerAccounts
    );

    let winner_info = remaining_accounts[start_index].clone();
    require_system_wallet(&winner_info)?;
    let entry_info = &remaining_accounts[start_index + 1];
    let entry = Account::<Entry>::try_from(entry_info)?;
    require!(entry.round == *round_key, LuckyMeError::WrongWinnerEntry);
    require!(
        entry_contains_ticket(&entry, winning_ticket),
        LuckyMeError::WrongWinnerEntry
    );
    require!(entry.player == winner_info.key(), LuckyMeError::WinnerMismatch);

    Ok(RemainingWinner {
        winner: winner_info.key(),
        entry: entry_info.key(),
        winner_info,
    })
}

fn require_system_wallet(account: &AccountInfo) -> Result<()> {
    require!(
        account.owner == &System::id() && !account.executable && account.data_is_empty(),
        LuckyMeError::InvalidWinnerAccount
    );
    Ok(())
}

fn entry_contains_ticket(entry: &Entry, ticket: u64) -> bool {
    let Some(end) = entry.ticket_start.checked_add(entry.ticket_count) else {
        return false;
    };
    ticket >= entry.ticket_start && ticket < end
}

fn refund_deadline(end_ts: i64) -> Result<i64> {
    end_ts
        .checked_add(REFUND_DELAY_SECS)
        .ok_or(LuckyMeError::MathOverflow.into())
}

fn round_is_refund_mode(round: &Round) -> bool {
    round.settled
        && !round.jackpot_triggered
        && round.winner_count == 0
        && round.winner == Pubkey::default()
        && round.winner_second == Pubkey::default()
        && round.winner_third == Pubkey::default()
        && round.jackpot_winner == Pubkey::default()
        && round.randomness == [0; 32]
}

fn random_mod_domain(randomness: &[u8; 32], domain: &[u8], nonce: u8, modulo: u64) -> u64 {
    let nonce_bytes = [nonce];
    let hash = hashv(&[
        b"luckyme-random-mod-v2",
        randomness.as_ref(),
        domain,
        nonce_bytes.as_ref(),
    ])
    .to_bytes();
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&hash[..8]);
    u64::from_le_bytes(bytes) % modulo
}

fn commitment_for(reveal: &[u8; 32]) -> [u8; 32] {
    hashv(&[b"luckyme-commit".as_ref(), reveal.as_ref()]).to_bytes()
}

fn derive_round_randomness(round_key: &Pubkey, total_tickets: u64, reveal: &[u8; 32]) -> [u8; 32] {
    hashv(&[
        b"luckyme-round-randomness",
        round_key.as_ref(),
        &total_tickets.to_le_bytes(),
        reveal,
    ])
    .to_bytes()
}

fn derive_orao_randomness_seed(
    round_key: &Pubkey,
    pool_key: &Pubkey,
    round_id: u64,
    total_tickets: u64,
    entrant_count: u32,
    request_slot: u64,
) -> [u8; 32] {
    hashv(&[
        b"luckyme-orao-vrf-seed",
        round_key.as_ref(),
        pool_key.as_ref(),
        &round_id.to_le_bytes(),
        &total_tickets.to_le_bytes(),
        &entrant_count.to_le_bytes(),
        &request_slot.to_le_bytes(),
    ])
    .to_bytes()
}

fn orao_randomness_request_address(seed: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[ORAO_RANDOMNESS_ACCOUNT_SEED, seed], &ORAO_VRF_PROGRAM_ID).0
}

fn derive_provider_round_randomness(
    round_key: &Pubkey,
    total_tickets: u64,
    provider_randomness: &[u8; 64],
) -> [u8; 32] {
    hashv(&[
        b"luckyme-provider-round-randomness",
        round_key.as_ref(),
        &total_tickets.to_le_bytes(),
        provider_randomness.as_ref(),
    ])
    .to_bytes()
}

struct OraoFulfilledRandomness {
    client: Pubkey,
    seed: [u8; 32],
    randomness: [u8; 64],
}

fn parse_orao_v2_fulfilled_randomness(data: &[u8]) -> Result<OraoFulfilledRandomness> {
    const DISCRIMINATOR_LEN: usize = 8;
    const VARIANT_LEN: usize = 1;
    const PUBKEY_LEN: usize = 32;
    const SEED_LEN: usize = 32;
    const RANDOMNESS_LEN: usize = 64;
    const FULFILLED_VARIANT: u8 = 1;
    const FULFILLED_LEN: usize =
        DISCRIMINATOR_LEN + VARIANT_LEN + PUBKEY_LEN + SEED_LEN + RANDOMNESS_LEN;

    require!(
        data.len() >= FULFILLED_LEN,
        LuckyMeError::InvalidRandomnessProviderAccount
    );

    let expected_discriminator = account_discriminator(b"account:RandomnessV2");
    require!(
        data[..DISCRIMINATOR_LEN] == expected_discriminator,
        LuckyMeError::InvalidRandomnessProviderAccount
    );
    require!(
        data[DISCRIMINATOR_LEN] == FULFILLED_VARIANT,
        LuckyMeError::RandomnessNotFulfilled
    );

    let mut cursor = DISCRIMINATOR_LEN + VARIANT_LEN;

    let mut client = [0_u8; PUBKEY_LEN];
    client.copy_from_slice(&data[cursor..cursor + PUBKEY_LEN]);
    cursor += PUBKEY_LEN;

    let mut seed = [0_u8; SEED_LEN];
    seed.copy_from_slice(&data[cursor..cursor + SEED_LEN]);
    cursor += SEED_LEN;

    let mut randomness = [0_u8; RANDOMNESS_LEN];
    randomness.copy_from_slice(&data[cursor..cursor + RANDOMNESS_LEN]);
    require!(
        randomness.iter().any(|byte| *byte != 0),
        LuckyMeError::RandomnessNotFulfilled
    );

    Ok(OraoFulfilledRandomness {
        client: Pubkey::new_from_array(client),
        seed,
        randomness,
    })
}

fn account_discriminator(seed: &[u8]) -> [u8; 8] {
    let hash = hashv(&[seed]).to_bytes();
    let mut discriminator = [0_u8; 8];
    discriminator.copy_from_slice(&hash[..8]);
    discriminator
}

fn transfer_lamports<'info>(
    from: &AccountInfo<'info>,
    to: &AccountInfo<'info>,
    lamports: u64,
) -> Result<()> {
    if lamports == 0 {
        return Ok(());
    }

    let from_balance = from.lamports();
    require!(
        from_balance >= lamports,
        LuckyMeError::InsufficientVaultFunds
    );
    let to_balance = to.lamports();

    **from.try_borrow_mut_lamports()? = from_balance
        .checked_sub(lamports)
        .ok_or(LuckyMeError::MathOverflow)?;
    **to.try_borrow_mut_lamports()? = to_balance
        .checked_add(lamports)
        .ok_or(LuckyMeError::MathOverflow)?;

    Ok(())
}

#[error_code]
pub enum LuckyMeError {
    #[msg("Fee is too high")]
    FeeTooHigh,
    #[msg("Jackpot fee is too high")]
    JackpotFeeTooHigh,
    #[msg("Invalid fee configuration")]
    InvalidFeeConfig,
    #[msg("Invalid jackpot odds")]
    InvalidOdds,
    #[msg("Invalid round duration")]
    InvalidRoundDuration,
    #[msg("Invalid ticket price")]
    InvalidTicketPrice,
    #[msg("Invalid pool")]
    InvalidPool,
    #[msg("Invalid ticket count")]
    InvalidTicketCount,
    #[msg("Invalid winner configuration")]
    InvalidWinnerConfig,
    #[msg("Invalid prize split")]
    InvalidPrizeSplit,
    #[msg("Not enough entrants for this pool winner count")]
    NotEnoughEntrants,
    #[msg("Missing premium winner accounts")]
    MissingWinnerAccounts,
    #[msg("Duplicate winner")]
    DuplicateWinner,
    #[msg("Invalid winner account")]
    InvalidWinnerAccount,
    #[msg("Program is paused")]
    Paused,
    #[msg("Round is closed")]
    RoundClosed,
    #[msg("Round is still open")]
    RoundStillOpen,
    #[msg("Round is already settled")]
    RoundSettled,
    #[msg("Round has no tickets")]
    EmptyRound,
    #[msg("Invalid randomness commitment")]
    InvalidRandomnessCommitment,
    #[msg("Invalid randomness reveal")]
    InvalidRandomnessReveal,
    #[msg("Wrong winner entry was provided")]
    WrongWinnerEntry,
    #[msg("Wrong jackpot entry was provided")]
    WrongJackpotEntry,
    #[msg("Winner account does not match entry")]
    WinnerMismatch,
    #[msg("Vault does not have enough lamports")]
    InsufficientVaultFunds,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Wallet already entered this round")]
    AlreadyEnteredRound,
    #[msg("Refund is not available yet")]
    RefundNotAvailable,
    #[msg("Entry has nothing to refund")]
    NothingToRefund,
    #[msg("Round already has entries")]
    RoundHasEntries,
    #[msg("Invalid randomness provider")]
    InvalidRandomnessProvider,
    #[msg("Invalid randomness status")]
    InvalidRandomnessStatus,
    #[msg("Invalid randomness provider account")]
    InvalidRandomnessProviderAccount,
    #[msg("Provider randomness is not fulfilled")]
    RandomnessNotFulfilled,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn refund_deadline_adds_delay() {
        assert_eq!(refund_deadline(1_000).unwrap(), 1_600);
    }

    #[test]
    fn refund_deadline_rejects_overflow() {
        assert!(refund_deadline(i64::MAX).is_err());
    }

    #[test]
    fn detects_refund_mode() {
        let round = Round {
            pool: Pubkey::new_unique(),
            round_id: 1,
            start_ts: 0,
            end_ts: 60,
            ticket_price_lamports: 1,
            total_tickets: 0,
            total_lamports: 0,
            entrant_count: 0,
            settled: true,
            jackpot_triggered: false,
            winner_count: 0,
            winner: Pubkey::default(),
            winner_second: Pubkey::default(),
            winner_third: Pubkey::default(),
            jackpot_winner: Pubkey::default(),
            randomness_commitment: [1; 32],
            randomness: [0; 32],
            bump: 255,
        };

        assert!(round_is_refund_mode(&round));
    }

    #[test]
    fn derives_orao_request_pda_from_seed() {
        let round = Pubkey::new_unique();
        let pool = Pubkey::new_unique();
        let seed = derive_orao_randomness_seed(&round, &pool, 9, 123, 4, 456);
        let expected = Pubkey::find_program_address(
            &[ORAO_RANDOMNESS_ACCOUNT_SEED, &seed],
            &ORAO_VRF_PROGRAM_ID,
        )
        .0;

        assert_eq!(orao_randomness_request_address(&seed), expected);
    }

    #[test]
    fn parses_fulfilled_orao_v2_randomness() {
        let client = Pubkey::new_unique();
        let seed = [7_u8; 32];
        let mut randomness = [0_u8; 64];
        randomness[0] = 11;
        randomness[63] = 99;

        let data = fulfilled_orao_v2_account_data(client, seed, randomness);
        let parsed = parse_orao_v2_fulfilled_randomness(&data).unwrap();

        assert_eq!(parsed.client, client);
        assert_eq!(parsed.seed, seed);
        assert_eq!(parsed.randomness, randomness);
    }

    #[test]
    fn rejects_pending_orao_v2_randomness() {
        let client = Pubkey::new_unique();
        let seed = [9_u8; 32];
        let mut data = Vec::new();
        data.extend_from_slice(&account_discriminator(b"account:RandomnessV2"));
        data.push(0);
        data.extend_from_slice(client.as_ref());
        data.extend_from_slice(&seed);
        data.extend_from_slice(&0_u32.to_le_bytes());

        assert!(parse_orao_v2_fulfilled_randomness(&data).is_err());
    }

    fn fulfilled_orao_v2_account_data(
        client: Pubkey,
        seed: [u8; 32],
        randomness: [u8; 64],
    ) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&account_discriminator(b"account:RandomnessV2"));
        data.push(1);
        data.extend_from_slice(client.as_ref());
        data.extend_from_slice(&seed);
        data.extend_from_slice(&randomness);
        data
    }
}
