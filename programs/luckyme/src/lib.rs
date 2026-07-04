use anchor_lang::prelude::*;
use anchor_lang::system_program::{transfer, Transfer};
use solana_sha256_hasher::hashv;

declare_id!("4bndxrGfuUcSLJnbCu8vs9WZ4qHdKGwcoeCybNThkrA3");

const BPS_DENOMINATOR: u64 = 10_000;
const MAX_FEE_BPS: u16 = 500;
const MAX_JACKPOT_BPS: u16 = 500;
#[cfg(not(feature = "test-short-timers"))]
const MIN_ROUND_DURATION_SECS: i64 = 60;
#[cfg(feature = "test-short-timers")]
const MIN_ROUND_DURATION_SECS: i64 = 1;
const MAX_ROUND_DURATION_SECS: i64 = 86_400;
#[cfg(not(feature = "test-short-timers"))]
const REFUND_DELAY_SECS: i64 = 600;
#[cfg(feature = "test-short-timers")]
const REFUND_DELAY_SECS: i64 = 2;

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

        let pool = &mut ctx.accounts.pool;
        pool.config = ctx.accounts.config.key();
        pool.pool_id = pool_id;
        pool.ticket_price_lamports = ticket_price_lamports;
        pool.current_round = 0;
        pool.jackpot_lamports = 0;
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
        round.winner = Pubkey::default();
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

    pub fn settle_round(ctx: Context<SettleRound>, randomness_reveal: [u8; 32]) -> Result<()> {
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

        let winning_ticket = random_mod(&randomness, 0, ctx.accounts.round.total_tickets);
        require!(
            entry_contains_ticket(&ctx.accounts.winner_entry, winning_ticket),
            LuckyMeError::WrongWinnerEntry
        );
        require!(
            ctx.accounts.winner_entry.player == ctx.accounts.winner.key(),
            LuckyMeError::WinnerMismatch
        );

        let jackpot_roll = random_mod(
            &randomness,
            8,
            u64::from(ctx.accounts.config.jackpot_odds_denominator),
        );
        let jackpot_triggered = jackpot_roll == 0;

        let jackpot_ticket = random_mod(&randomness, 16, ctx.accounts.round.total_tickets);
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

        transfer_lamports(
            &ctx.accounts.pool_vault.to_account_info(),
            &ctx.accounts.winner.to_account_info(),
            main_prize,
        )?;
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
        round.winner = ctx.accounts.winner.key();
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
            winner: round.winner,
            winner_entry: ctx.accounts.winner_entry.key(),
            winning_ticket,
            main_prize_lamports: main_prize,
            house_fee_lamports: house_fee,
            jackpot_add_lamports: jackpot_add,
            jackpot_triggered,
            jackpot_winner: round.jackpot_winner,
            jackpot_entry: ctx.accounts.jackpot_entry.key(),
            jackpot_ticket,
            randomness,
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
        round.winner = Pubkey::default();
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
    pub winner: Pubkey,
    pub winner_entry: Pubkey,
    pub winning_ticket: u64,
    pub main_prize_lamports: u64,
    pub house_fee_lamports: u64,
    pub jackpot_add_lamports: u64,
    pub jackpot_triggered: bool,
    pub jackpot_winner: Pubkey,
    pub jackpot_entry: Pubkey,
    pub jackpot_ticket: u64,
    pub randomness: [u8; 32],
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
    pub config: Account<'info, Config>,
    #[account(mut, has_one = config)]
    pub pool: Account<'info, Pool>,
    #[account(mut, has_one = pool)]
    pub round: Account<'info, Round>,
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
    pub winner_entry: Account<'info, Entry>,
    #[account(mut)]
    pub jackpot_winner: SystemAccount<'info>,
    #[account(constraint = jackpot_entry.round == round.key())]
    pub jackpot_entry: Account<'info, Entry>,
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
    pub bump: u8,
    pub vault_bump: u8,
    pub jackpot_bump: u8,
}

impl Pool {
    pub const LEN: usize = 32 + 1 + 8 + 8 + 8 + 1 + 1 + 1;
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
    pub winner: Pubkey,
    pub jackpot_winner: Pubkey,
    pub randomness_commitment: [u8; 32],
    pub randomness: [u8; 32],
    pub bump: u8,
}

impl Round {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 8 + 8 + 8 + 4 + 1 + 1 + 32 + 32 + 32 + 32 + 1;
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

fn bps_amount(total: u64, bps: u16) -> Result<u64> {
    total
        .checked_mul(u64::from(bps))
        .and_then(|v| v.checked_div(BPS_DENOMINATOR))
        .ok_or(LuckyMeError::MathOverflow.into())
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
        && round.winner == Pubkey::default()
        && round.jackpot_winner == Pubkey::default()
        && round.randomness == [0; 32]
}

fn random_mod(randomness: &[u8; 32], offset: usize, modulo: u64) -> u64 {
    let mut bytes = [0_u8; 8];
    bytes.copy_from_slice(&randomness[offset..offset + 8]);
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
    #[msg("Invalid ticket count")]
    InvalidTicketCount,
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
            winner: Pubkey::default(),
            jackpot_winner: Pubkey::default(),
            randomness_commitment: [1; 32],
            randomness: [0; 32],
            bump: 255,
        };

        assert!(round_is_refund_mode(&round));
    }
}
