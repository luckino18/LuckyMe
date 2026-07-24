use crate::{
    LuckyMeError, PromotionDispatch, PromotionRandomnessCallback, RequestPromotionRandomness,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::{invoke, invoke_signed},
    system_instruction, system_program as solana_system_program,
};
use anchor_lang::Discriminator;
use ephemeral_vrf_sdk::{
    consts::{scoped_vrf_identity, DEFAULT_QUEUE, IDENTITY, VRF_PROGRAM_ID},
    instructions::{create_request_scoped_randomness_ix, RequestRandomnessParams},
    types::SerializableAccountMeta,
};
use solana_sha256_hasher::hashv;

const OP_INITIALIZE: u8 = 0;
const OP_ENTER: u8 = 1;
const OP_SETTLE: u8 = 2;
const OP_CANCEL: u8 = 3;
const OP_CLOSE_ENTRY: u8 = 4;
const OP_ARCHIVE: u8 = 5;
const OP_INITIALIZE_TOKEN: u8 = 6;
const OP_SETTLE_TOKEN: u8 = 7;
const OP_CANCEL_TOKEN: u8 = 8;
const OP_ARCHIVE_TOKEN: u8 = 9;

const SPL_TOKEN_PROGRAM_ID: Pubkey = pubkey!("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const ASSOCIATED_TOKEN_PROGRAM_ID: Pubkey = pubkey!("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL");
const TOKEN_ACCOUNT_LEN: usize = 165;
const MINT_LEN: usize = 82;

const STATUS_OPEN: u8 = 2;
const STATUS_LOCKED: u8 = 3;
const STATUS_RANDOMNESS_PENDING: u8 = 4;
const STATUS_WINNER_READY: u8 = 5;
const STATUS_PAID: u8 = 6;
const STATUS_CANCELLED: u8 = 7;

const PROMOTION_MAGIC: &[u8; 8] = b"LMPRM001";
const ENTRY_MAGIC: &[u8; 8] = b"LMPEN001";
const PROMOTION_LEN: usize = 248;
const ENTRY_LEN: usize = 80;
const PRIZE_MAGIC: &[u8; 8] = b"LMPRZ001";
const PRIZE_LEN: usize = 146;

const STATUS_OFFSET: usize = 9;
const CONFIG_OFFSET: usize = 12;
const PROMOTION_ID_OFFSET: usize = 44;
const RULES_HASH_OFFSET: usize = 52;
const PRIZE_AMOUNT_OFFSET: usize = 84;
const CAPACITY_OFFSET: usize = 92;
const ENTRY_COUNT_OFFSET: usize = 96;
const AUTHORIZER_OFFSET: usize = 100;
const REQUEST_SEED_OFFSET: usize = 132;
const WINNER_INDEX_OFFSET: usize = 164;
const WINNER_OFFSET: usize = 168;
const OUTSTANDING_ENTRIES_OFFSET: usize = 200;
const EXPIRES_AT_OFFSET: usize = 204;
const SPONSOR_OFFSET: usize = 212;
const PRIZE_KIND_OFFSET: usize = 244;
const PRIZE_KIND_SOL: u8 = 0;
const PRIZE_KIND_TOKEN: u8 = 1;

pub fn dispatch<'info>(
    ctx: Context<'info, PromotionDispatch<'info>>,
    operation: u8,
    data: Vec<u8>,
) -> Result<()> {
    match operation {
        OP_INITIALIZE => initialize(ctx, &data),
        OP_ENTER => enter(ctx, &data),
        OP_SETTLE => settle(ctx, &data),
        OP_CANCEL => cancel(ctx, &data),
        OP_CLOSE_ENTRY => close_entry(ctx, &data),
        OP_ARCHIVE => archive(ctx, &data),
        OP_INITIALIZE_TOKEN => initialize_token(ctx, &data),
        OP_SETTLE_TOKEN => settle_token(ctx, &data),
        OP_CANCEL_TOKEN => cancel_token(ctx, &data),
        OP_ARCHIVE_TOKEN => archive_token(ctx, &data),
        _ => err!(LuckyMeError::InvalidPromotionInstruction),
    }
}

pub fn request_randomness<'info>(
    ctx: Context<'info, RequestPromotionRandomness<'info>>,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, LuckyMeError::Paused);
    let promotion_info = ctx.accounts.promotion.to_account_info();
    let snapshot = read_promotion_account(&promotion_info)?;
    require_keys_eq!(
        snapshot.config,
        ctx.accounts.config.key(),
        LuckyMeError::InvalidPromotionAccount
    );
    require!(
        snapshot.status == STATUS_LOCKED && snapshot.entry_count == snapshot.capacity,
        LuckyMeError::InvalidPromotionState
    );
    require_keys_eq!(
        ctx.accounts.authorizer.key(),
        snapshot.authorizer,
        LuckyMeError::InvalidPromotionAuthority
    );
    validate_promotion_pda(
        &ctx.accounts.config.key(),
        snapshot.promotion_id,
        &ctx.accounts.promotion.key(),
    )?;

    let (program_identity, identity_bump) = Pubkey::find_program_address(&[IDENTITY], &crate::ID);
    require_keys_eq!(
        ctx.accounts.program_identity.key(),
        program_identity,
        LuckyMeError::InvalidPromotionRandomnessAccount
    );
    require_keys_eq!(
        ctx.accounts.oracle_queue.key(),
        DEFAULT_QUEUE,
        LuckyMeError::InvalidPromotionRandomnessAccount
    );
    require_keys_eq!(
        ctx.accounts.vrf_program.key(),
        VRF_PROGRAM_ID,
        LuckyMeError::InvalidPromotionRandomnessAccount
    );
    require_keys_eq!(
        ctx.accounts.slot_hashes.key(),
        ephemeral_vrf_sdk::compat::slot_hashes::ID,
        LuckyMeError::InvalidPromotionRandomnessAccount
    );

    let caller_seed = hashv(&[
        b"luckyme-promotion-vrf-v1",
        ctx.accounts.promotion.key().as_ref(),
        snapshot.rules_hash.as_ref(),
        &snapshot.entry_count.to_le_bytes(),
    ])
    .to_bytes();
    let callback_discriminator =
        crate::instruction::PromotionRandomnessCallback::DISCRIMINATOR.to_vec();
    let request_ix = create_request_scoped_randomness_ix(RequestRandomnessParams {
        payer: ctx.accounts.payer.key(),
        oracle_queue: ctx.accounts.oracle_queue.key(),
        callback_program_id: crate::ID,
        callback_discriminator,
        accounts_metas: Some(vec![SerializableAccountMeta {
            pubkey: ctx.accounts.promotion.key(),
            is_signer: false,
            is_writable: true,
        }]),
        caller_seed,
        callback_args: None,
    });

    {
        let mut state = ctx.accounts.promotion.try_borrow_mut_data()?;
        state[STATUS_OFFSET] = STATUS_RANDOMNESS_PENDING;
        state[REQUEST_SEED_OFFSET..REQUEST_SEED_OFFSET + 32].copy_from_slice(&caller_seed);
    }

    let identity_bump_seed = [identity_bump];
    invoke_signed(
        &request_ix,
        &[
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.program_identity.to_account_info(),
            ctx.accounts.oracle_queue.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
            ctx.accounts.slot_hashes.to_account_info(),
            ctx.accounts.vrf_program.to_account_info(),
        ],
        &[&[IDENTITY, identity_bump_seed.as_ref()]],
    )?;
    Ok(())
}

pub fn consume_randomness(
    ctx: Context<PromotionRandomnessCallback>,
    randomness: [u8; 32],
) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.vrf_program_identity.key(),
        scoped_vrf_identity(&crate::ID),
        LuckyMeError::InvalidPromotionRandomnessAccount
    );
    let promotion_info = ctx.accounts.promotion.to_account_info();
    let snapshot = read_promotion_account(&promotion_info)?;
    require!(
        snapshot.status == STATUS_RANDOMNESS_PENDING && snapshot.entry_count > 0,
        LuckyMeError::InvalidPromotionState
    );
    let winner_index = unbiased_index(randomness, snapshot.entry_count)?;
    let mut state = ctx.accounts.promotion.try_borrow_mut_data()?;
    state[WINNER_INDEX_OFFSET..WINNER_INDEX_OFFSET + 4]
        .copy_from_slice(&winner_index.to_le_bytes());
    state[STATUS_OFFSET] = STATUS_WINNER_READY;
    Ok(())
}

fn initialize_token<'info>(
    ctx: Context<'info, PromotionDispatch<'info>>,
    data: &[u8],
) -> Result<()> {
    require_authority(&ctx)?;
    require!(data.len() == 60, LuckyMeError::InvalidPromotionInstruction);
    require!(
        ctx.remaining_accounts.len() == 5,
        LuckyMeError::InvalidPromotionInstruction
    );
    let promotion_id = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let rules_hash: [u8; 32] = data[8..40].try_into().unwrap();
    let prize_amount = u64::from_le_bytes(data[40..48].try_into().unwrap());
    let capacity = u32::from_le_bytes(data[48..52].try_into().unwrap());
    let expires_at = i64::from_le_bytes(data[52..60].try_into().unwrap());
    let mint = &ctx.remaining_accounts[0];
    let sponsor_token = &ctx.remaining_accounts[1];
    let vault_token = &ctx.remaining_accounts[2];
    let token_program = &ctx.remaining_accounts[3];
    let associated_token_program = &ctx.remaining_accounts[4];
    let now = Clock::get()?.unix_timestamp;
    require!(
        promotion_id > 0
            && rules_hash != [0; 32]
            && prize_amount > 0
            && capacity > 0
            && expires_at > now,
        LuckyMeError::InvalidPromotionInstruction
    );
    validate_token_programs(token_program, Some(associated_token_program))?;
    let decimals = read_mint_decimals(mint)?;
    let sponsor_amount = read_token_amount(sponsor_token, mint.key, &ctx.accounts.actor.key())?;
    require!(
        sponsor_amount >= prize_amount,
        LuckyMeError::InsufficientVaultFunds
    );

    let config_key = ctx.accounts.config.key();
    let id = promotion_id.to_le_bytes();
    let (promotion, bump) = Pubkey::find_program_address(
        &[b"promotion", config_key.as_ref(), id.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.target.key(),
        promotion,
        LuckyMeError::InvalidPromotionAccount
    );
    let (prize_config, prize_bump) =
        Pubkey::find_program_address(&[b"promotion_prize", promotion.as_ref()], &crate::ID);
    require_keys_eq!(
        ctx.accounts.auxiliary.key(),
        prize_config,
        LuckyMeError::InvalidPromotionAccount
    );
    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[
        b"promotion",
        config_key.as_ref(),
        id.as_ref(),
        bump_seed.as_ref(),
    ];
    create_program_pda(
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.target.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        PROMOTION_LEN,
        seeds,
    )?;
    let prize_bump_seed = [prize_bump];
    create_program_pda(
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.auxiliary.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        PRIZE_LEN,
        &[
            b"promotion_prize",
            promotion.as_ref(),
            prize_bump_seed.as_ref(),
        ],
    )?;
    create_associated_token_account_if_needed(
        &ctx.accounts.actor.to_account_info(),
        vault_token,
        &ctx.accounts.target.to_account_info(),
        mint,
        token_program,
        associated_token_program,
        &ctx.accounts.system_program.to_account_info(),
    )?;
    require!(
        read_token_amount(vault_token, mint.key, &promotion)? == 0,
        LuckyMeError::InsufficientVaultFunds
    );

    {
        let mut state = ctx.accounts.target.try_borrow_mut_data()?;
        state.fill(0);
        state[0..8].copy_from_slice(PROMOTION_MAGIC);
        state[8] = 1;
        state[STATUS_OFFSET] = STATUS_OPEN;
        state[10] = bump;
        state[CONFIG_OFFSET..CONFIG_OFFSET + 32].copy_from_slice(config_key.as_ref());
        state[PROMOTION_ID_OFFSET..PROMOTION_ID_OFFSET + 8].copy_from_slice(&id);
        state[RULES_HASH_OFFSET..RULES_HASH_OFFSET + 32].copy_from_slice(&rules_hash);
        state[PRIZE_AMOUNT_OFFSET..PRIZE_AMOUNT_OFFSET + 8]
            .copy_from_slice(&prize_amount.to_le_bytes());
        state[CAPACITY_OFFSET..CAPACITY_OFFSET + 4].copy_from_slice(&capacity.to_le_bytes());
        state[AUTHORIZER_OFFSET..AUTHORIZER_OFFSET + 32]
            .copy_from_slice(ctx.accounts.authorizer.key().as_ref());
        state[EXPIRES_AT_OFFSET..EXPIRES_AT_OFFSET + 8].copy_from_slice(&expires_at.to_le_bytes());
        state[SPONSOR_OFFSET..SPONSOR_OFFSET + 32]
            .copy_from_slice(ctx.accounts.actor.key().as_ref());
        state[PRIZE_KIND_OFFSET] = PRIZE_KIND_TOKEN;
    }
    write_prize_account(
        &ctx.accounts.auxiliary.to_account_info(),
        &promotion,
        mint.key,
        token_program.key,
        vault_token.key,
        prize_amount,
        decimals,
        prize_bump,
    )?;

    transfer_checked(
        sponsor_token,
        mint,
        vault_token,
        &ctx.accounts.actor.to_account_info(),
        token_program,
        prize_amount,
        decimals,
        None,
    )?;
    require!(
        read_token_amount(vault_token, mint.key, &promotion)? == prize_amount,
        LuckyMeError::InsufficientVaultFunds
    );
    Ok(())
}

fn settle_token<'info>(ctx: Context<'info, PromotionDispatch<'info>>, _data: &[u8]) -> Result<()> {
    require!(
        ctx.remaining_accounts.len() == 7,
        LuckyMeError::InvalidPromotionInstruction
    );
    let mint = &ctx.remaining_accounts[0];
    let vault_token = &ctx.remaining_accounts[1];
    let winner_entry = &ctx.remaining_accounts[2];
    let winner = &ctx.remaining_accounts[3];
    let winner_token = &ctx.remaining_accounts[4];
    let token_program = &ctx.remaining_accounts[5];
    let associated_token_program = &ctx.remaining_accounts[6];
    validate_token_programs(token_program, Some(associated_token_program))?;
    let decimals = read_mint_decimals(mint)?;
    let promotion_info = ctx.accounts.target.to_account_info();
    let snapshot = read_promotion_account(&promotion_info)?;
    let prize = read_prize_account(&ctx.accounts.auxiliary.to_account_info())?;
    validate_token_snapshot(
        &snapshot,
        &ctx.accounts.config.key(),
        &ctx.accounts.target.key(),
        &ctx.accounts.authorizer.key(),
        &ctx.accounts.auxiliary.key(),
        &prize,
        mint.key,
        vault_token.key,
        token_program.key,
    )?;
    require!(
        snapshot.status == STATUS_WINNER_READY,
        LuckyMeError::InvalidPromotionState
    );
    require!(
        decimals == prize.decimals,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    require!(
        read_token_amount(vault_token, mint.key, &ctx.accounts.target.key())?
            == snapshot.prize_amount,
        LuckyMeError::InsufficientVaultFunds
    );

    let entry = read_entry(winner_entry)?;
    require_keys_eq!(
        entry.promotion,
        ctx.accounts.target.key(),
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    require!(
        entry.index == snapshot.winner_index,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    require_keys_eq!(entry.player, *winner.key, LuckyMeError::WinnerMismatch);
    let expected_entry = Pubkey::find_program_address(
        &[
            b"promotion_entry",
            ctx.accounts.target.key().as_ref(),
            winner.key.as_ref(),
        ],
        &crate::ID,
    )
    .0;
    require_keys_eq!(
        *winner_entry.key,
        expected_entry,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    create_associated_token_account_if_needed(
        &ctx.accounts.actor.to_account_info(),
        winner_token,
        winner,
        mint,
        token_program,
        associated_token_program,
        &ctx.accounts.system_program.to_account_info(),
    )?;
    read_token_amount(winner_token, mint.key, winner.key)?;

    let id = snapshot.promotion_id.to_le_bytes();
    let bump_seed = [promotion_info.try_borrow_data()?[10]];
    let signer: &[&[u8]] = &[
        b"promotion",
        snapshot.config.as_ref(),
        id.as_ref(),
        bump_seed.as_ref(),
    ];
    transfer_checked(
        vault_token,
        mint,
        winner_token,
        &ctx.accounts.target.to_account_info(),
        token_program,
        snapshot.prize_amount,
        decimals,
        Some(signer),
    )?;

    let mut state = ctx.accounts.target.try_borrow_mut_data()?;
    state[WINNER_OFFSET..WINNER_OFFSET + 32].copy_from_slice(winner.key.as_ref());
    state[STATUS_OFFSET] = STATUS_PAID;
    Ok(())
}

fn cancel_token<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require_authority(&ctx)?;
    require!(data.is_empty(), LuckyMeError::InvalidPromotionInstruction);
    require!(
        ctx.remaining_accounts.len() == 4,
        LuckyMeError::InvalidPromotionInstruction
    );
    let mint = &ctx.remaining_accounts[0];
    let vault_token = &ctx.remaining_accounts[1];
    let sponsor_token = &ctx.remaining_accounts[2];
    let token_program = &ctx.remaining_accounts[3];
    validate_token_programs(token_program, None)?;
    let decimals = read_mint_decimals(mint)?;
    let promotion_info = ctx.accounts.target.to_account_info();
    let snapshot = read_promotion_account(&promotion_info)?;
    let prize = read_prize_account(&ctx.accounts.auxiliary.to_account_info())?;
    validate_token_snapshot(
        &snapshot,
        &ctx.accounts.config.key(),
        &ctx.accounts.target.key(),
        &ctx.accounts.authorizer.key(),
        &ctx.accounts.auxiliary.key(),
        &prize,
        mint.key,
        vault_token.key,
        token_program.key,
    )?;
    require!(
        snapshot.status == STATUS_OPEN && Clock::get()?.unix_timestamp >= snapshot.expires_at,
        LuckyMeError::InvalidPromotionState
    );
    require_keys_eq!(
        ctx.accounts.actor.key(),
        snapshot.sponsor,
        LuckyMeError::InvalidPromotionAuthority
    );

    let signer_seeds = promotion_signer(&snapshot, &promotion_info)?;
    let signer = signer_seeds
        .iter()
        .map(|seed| seed.as_slice())
        .collect::<Vec<_>>();
    let signer_refs: &[&[u8]] = &signer;
    require!(
        decimals == prize.decimals,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    let amount = read_token_amount(vault_token, mint.key, &ctx.accounts.target.key())?;
    read_token_amount(sponsor_token, mint.key, &ctx.accounts.actor.key())?;
    if amount > 0 {
        transfer_checked(
            vault_token,
            mint,
            sponsor_token,
            &ctx.accounts.target.to_account_info(),
            token_program,
            amount,
            decimals,
            Some(signer_refs),
        )?;
    }
    close_token_account(
        vault_token,
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.target.to_account_info(),
        token_program,
        signer_refs,
    )?;
    close_program_account(
        &ctx.accounts.auxiliary.to_account_info(),
        &ctx.accounts.actor.to_account_info(),
    )?;
    let mut state = ctx.accounts.target.try_borrow_mut_data()?;
    state[STATUS_OFFSET] = STATUS_CANCELLED;
    Ok(())
}

fn archive_token<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require_authority(&ctx)?;
    require!(data.is_empty(), LuckyMeError::InvalidPromotionInstruction);
    require!(
        ctx.remaining_accounts.len() == 2,
        LuckyMeError::InvalidPromotionInstruction
    );
    let vault_token = &ctx.remaining_accounts[0];
    let token_program = &ctx.remaining_accounts[1];
    validate_token_programs(token_program, None)?;
    let promotion_info = ctx.accounts.target.to_account_info();
    let snapshot = read_promotion_account(&promotion_info)?;
    let prize = read_prize_account(&ctx.accounts.auxiliary.to_account_info())?;
    validate_token_snapshot(
        &snapshot,
        &ctx.accounts.config.key(),
        &ctx.accounts.target.key(),
        &ctx.accounts.authorizer.key(),
        &ctx.accounts.auxiliary.key(),
        &prize,
        &prize.mint,
        vault_token.key,
        token_program.key,
    )?;
    require!(
        snapshot.status == STATUS_PAID && snapshot.outstanding_entries == 0,
        LuckyMeError::InvalidPromotionState
    );
    require!(
        ctx.accounts.actor.key() == snapshot.sponsor,
        LuckyMeError::InvalidPromotionAuthority
    );
    require!(
        read_token_amount(vault_token, &prize.mint, &ctx.accounts.target.key(),)? == 0,
        LuckyMeError::InsufficientVaultFunds
    );
    let signer_seeds = promotion_signer(&snapshot, &promotion_info)?;
    let signer = signer_seeds
        .iter()
        .map(|seed| seed.as_slice())
        .collect::<Vec<_>>();
    let signer_refs: &[&[u8]] = &signer;
    close_token_account(
        vault_token,
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.target.to_account_info(),
        token_program,
        signer_refs,
    )?;
    close_program_account(
        &ctx.accounts.auxiliary.to_account_info(),
        &ctx.accounts.actor.to_account_info(),
    )?;
    close_program_account(
        &ctx.accounts.target.to_account_info(),
        &ctx.accounts.actor.to_account_info(),
    )
}

fn validate_token_snapshot(
    snapshot: &PromotionSnapshot,
    config: &Pubkey,
    promotion: &Pubkey,
    authorizer: &Pubkey,
    prize_account: &Pubkey,
    prize: &PrizeSnapshot,
    mint: &Pubkey,
    vault_token: &Pubkey,
    token_program: &Pubkey,
) -> Result<()> {
    require_keys_eq!(
        snapshot.config,
        *config,
        LuckyMeError::InvalidPromotionAccount
    );
    validate_promotion_pda(config, snapshot.promotion_id, promotion)?;
    require_keys_eq!(
        snapshot.authorizer,
        *authorizer,
        LuckyMeError::InvalidPromotionAuthority
    );
    require!(
        snapshot.prize_kind == PRIZE_KIND_TOKEN
            && snapshot.prize_amount == prize.amount
            && prize.promotion == *promotion
            && prize.mint == *mint
            && prize.token_program == *token_program
            && prize.vault_token == *vault_token,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    let (expected_prize, expected_bump) =
        Pubkey::find_program_address(&[b"promotion_prize", promotion.as_ref()], &crate::ID);
    require!(
        expected_prize == *prize_account && prize.bump == expected_bump,
        LuckyMeError::InvalidPromotionAccount
    );
    Ok(())
}

fn promotion_signer(
    snapshot: &PromotionSnapshot,
    promotion_info: &AccountInfo,
) -> Result<Vec<Vec<u8>>> {
    Ok(vec![
        b"promotion".to_vec(),
        snapshot.config.to_bytes().to_vec(),
        snapshot.promotion_id.to_le_bytes().to_vec(),
        vec![promotion_info.try_borrow_data()?[10]],
    ])
}

fn require_authority(ctx: &Context<PromotionDispatch>) -> Result<()> {
    require_keys_eq!(
        ctx.accounts.actor.key(),
        ctx.accounts.config.authority,
        LuckyMeError::InvalidPromotionAuthority
    );
    Ok(())
}

fn initialize<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require_authority(&ctx)?;
    require!(data.len() == 60, LuckyMeError::InvalidPromotionInstruction);

    let promotion_id = u64::from_le_bytes(data[0..8].try_into().unwrap());
    let rules_hash: [u8; 32] = data[8..40].try_into().unwrap();
    let prize_amount = u64::from_le_bytes(data[40..48].try_into().unwrap());
    let capacity = u32::from_le_bytes(data[48..52].try_into().unwrap());
    let expires_at = i64::from_le_bytes(data[52..60].try_into().unwrap());
    let now = Clock::get()?.unix_timestamp;
    require!(
        promotion_id > 0
            && rules_hash != [0; 32]
            && prize_amount > 0
            && capacity > 0
            && expires_at > now,
        LuckyMeError::InvalidPromotionInstruction
    );

    let config_key = ctx.accounts.config.key();
    let id = promotion_id.to_le_bytes();
    let (promotion, bump) = Pubkey::find_program_address(
        &[b"promotion", config_key.as_ref(), id.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.target.key(),
        promotion,
        LuckyMeError::InvalidPromotionAccount
    );
    let (vault, _) =
        Pubkey::find_program_address(&[b"promotion_vault", promotion.as_ref()], &crate::ID);
    require_keys_eq!(
        ctx.accounts.auxiliary.key(),
        vault,
        LuckyMeError::InvalidPromotionAccount
    );

    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[
        b"promotion",
        config_key.as_ref(),
        id.as_ref(),
        bump_seed.as_ref(),
    ];
    create_program_pda(
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.target.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        PROMOTION_LEN,
        seeds,
    )?;

    let mut state = ctx.accounts.target.try_borrow_mut_data()?;
    state.fill(0);
    state[0..8].copy_from_slice(PROMOTION_MAGIC);
    state[8] = 1;
    state[STATUS_OFFSET] = STATUS_OPEN;
    state[10] = bump;
    state[CONFIG_OFFSET..CONFIG_OFFSET + 32].copy_from_slice(config_key.as_ref());
    state[PROMOTION_ID_OFFSET..PROMOTION_ID_OFFSET + 8].copy_from_slice(&id);
    state[RULES_HASH_OFFSET..RULES_HASH_OFFSET + 32].copy_from_slice(&rules_hash);
    state[PRIZE_AMOUNT_OFFSET..PRIZE_AMOUNT_OFFSET + 8]
        .copy_from_slice(&prize_amount.to_le_bytes());
    state[CAPACITY_OFFSET..CAPACITY_OFFSET + 4].copy_from_slice(&capacity.to_le_bytes());
    state[AUTHORIZER_OFFSET..AUTHORIZER_OFFSET + 32]
        .copy_from_slice(ctx.accounts.authorizer.key().as_ref());
    state[EXPIRES_AT_OFFSET..EXPIRES_AT_OFFSET + 8].copy_from_slice(&expires_at.to_le_bytes());
    state[SPONSOR_OFFSET..SPONSOR_OFFSET + 32].copy_from_slice(ctx.accounts.actor.key().as_ref());
    state[PRIZE_KIND_OFFSET] = PRIZE_KIND_SOL;
    drop(state);
    invoke(
        &system_instruction::transfer(
            &ctx.accounts.actor.key(),
            &ctx.accounts.auxiliary.key(),
            prize_amount,
        ),
        &[
            ctx.accounts.actor.to_account_info(),
            ctx.accounts.auxiliary.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
    )?;
    Ok(())
}

fn enter<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require!(!ctx.accounts.config.paused, LuckyMeError::Paused);
    require!(data.is_empty(), LuckyMeError::InvalidPromotionInstruction);
    let snapshot = read_promotion(&ctx)?;
    require!(
        ctx.accounts.authorizer.is_signer && ctx.accounts.authorizer.key() == snapshot.authorizer,
        LuckyMeError::InvalidPromotionAuthority
    );
    require!(
        snapshot.status == STATUS_OPEN,
        LuckyMeError::InvalidPromotionState
    );
    require!(
        snapshot.entry_count < snapshot.capacity,
        LuckyMeError::InvalidTicketCount
    );

    let promotion = ctx.accounts.target.key();
    let player = ctx.accounts.actor.key();
    let (entry, bump) = Pubkey::find_program_address(
        &[b"promotion_entry", promotion.as_ref(), player.as_ref()],
        &crate::ID,
    );
    require_keys_eq!(
        ctx.accounts.auxiliary.key(),
        entry,
        LuckyMeError::InvalidPromotionAccount
    );
    require!(
        ctx.accounts.auxiliary.data_is_empty(),
        LuckyMeError::AlreadyEnteredRound
    );

    let bump_seed = [bump];
    let seeds: &[&[u8]] = &[
        b"promotion_entry",
        promotion.as_ref(),
        player.as_ref(),
        bump_seed.as_ref(),
    ];
    create_program_pda(
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.auxiliary.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        ENTRY_LEN,
        seeds,
    )?;

    let mut entry_data = ctx.accounts.auxiliary.try_borrow_mut_data()?;
    entry_data.fill(0);
    entry_data[0..8].copy_from_slice(ENTRY_MAGIC);
    entry_data[8..40].copy_from_slice(promotion.as_ref());
    entry_data[40..72].copy_from_slice(player.as_ref());
    entry_data[72..76].copy_from_slice(&snapshot.entry_count.to_le_bytes());
    entry_data[76] = bump;
    drop(entry_data);

    let next_count = snapshot
        .entry_count
        .checked_add(1)
        .ok_or(LuckyMeError::MathOverflow)?;
    let mut state = ctx.accounts.target.try_borrow_mut_data()?;
    state[ENTRY_COUNT_OFFSET..ENTRY_COUNT_OFFSET + 4].copy_from_slice(&next_count.to_le_bytes());
    state[OUTSTANDING_ENTRIES_OFFSET..OUTSTANDING_ENTRIES_OFFSET + 4]
        .copy_from_slice(&next_count.to_le_bytes());
    if next_count == snapshot.capacity {
        state[STATUS_OFFSET] = STATUS_LOCKED;
    }
    Ok(())
}

fn cancel<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require_authority(&ctx)?;
    require!(data.is_empty(), LuckyMeError::InvalidPromotionInstruction);
    let snapshot = read_promotion(&ctx)?;
    require!(
        snapshot.status == STATUS_OPEN,
        LuckyMeError::InvalidPromotionState
    );
    require!(
        Clock::get()?.unix_timestamp >= snapshot.expires_at,
        LuckyMeError::InvalidPromotionState
    );
    require_keys_eq!(
        ctx.accounts.actor.key(),
        snapshot.sponsor,
        LuckyMeError::InvalidPromotionAuthority
    );

    let promotion = ctx.accounts.target.key();
    let (vault, vault_bump) =
        Pubkey::find_program_address(&[b"promotion_vault", promotion.as_ref()], &crate::ID);
    require_keys_eq!(
        ctx.accounts.auxiliary.key(),
        vault,
        LuckyMeError::InvalidPromotionAccount
    );
    drain_system_vault(
        &ctx.accounts.auxiliary.to_account_info(),
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &promotion,
        vault_bump,
    )?;

    let mut state = ctx.accounts.target.try_borrow_mut_data()?;
    state[STATUS_OFFSET] = STATUS_CANCELLED;
    Ok(())
}

fn close_entry<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require!(data.is_empty(), LuckyMeError::InvalidPromotionInstruction);
    let snapshot = read_promotion(&ctx)?;
    require!(
        snapshot.status == STATUS_PAID || snapshot.status == STATUS_CANCELLED,
        LuckyMeError::InvalidPromotionState
    );
    require_keys_eq!(
        ctx.accounts.authorizer.key(),
        snapshot.authorizer,
        LuckyMeError::InvalidPromotionAuthority
    );

    let promotion = ctx.accounts.target.key();
    let player = ctx.accounts.actor.key();
    let entry = read_entry(&ctx.accounts.auxiliary.to_account_info())?;
    require_keys_eq!(
        entry.promotion,
        promotion,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    require_keys_eq!(
        entry.player,
        player,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    let expected = Pubkey::find_program_address(
        &[b"promotion_entry", promotion.as_ref(), player.as_ref()],
        &crate::ID,
    )
    .0;
    require_keys_eq!(
        ctx.accounts.auxiliary.key(),
        expected,
        LuckyMeError::InvalidPromotionAccount
    );
    require!(
        snapshot.outstanding_entries > 0,
        LuckyMeError::InvalidPromotionState
    );

    close_program_account(
        &ctx.accounts.auxiliary.to_account_info(),
        &ctx.accounts.actor.to_account_info(),
    )?;
    let remaining = snapshot
        .outstanding_entries
        .checked_sub(1)
        .ok_or(LuckyMeError::MathOverflow)?;
    let mut state = ctx.accounts.target.try_borrow_mut_data()?;
    state[OUTSTANDING_ENTRIES_OFFSET..OUTSTANDING_ENTRIES_OFFSET + 4]
        .copy_from_slice(&remaining.to_le_bytes());
    Ok(())
}

fn archive<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require_authority(&ctx)?;
    require!(data.is_empty(), LuckyMeError::InvalidPromotionInstruction);
    let snapshot = read_promotion(&ctx)?;
    require!(
        snapshot.status == STATUS_PAID || snapshot.status == STATUS_CANCELLED,
        LuckyMeError::InvalidPromotionState
    );
    require!(
        snapshot.outstanding_entries == 0,
        LuckyMeError::InvalidPromotionState
    );
    require_keys_eq!(
        ctx.accounts.actor.key(),
        snapshot.sponsor,
        LuckyMeError::InvalidPromotionAuthority
    );

    let promotion = ctx.accounts.target.key();
    let (vault, vault_bump) =
        Pubkey::find_program_address(&[b"promotion_vault", promotion.as_ref()], &crate::ID);
    require_keys_eq!(
        ctx.accounts.auxiliary.key(),
        vault,
        LuckyMeError::InvalidPromotionAccount
    );
    drain_system_vault(
        &ctx.accounts.auxiliary.to_account_info(),
        &ctx.accounts.actor.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &promotion,
        vault_bump,
    )?;
    close_program_account(
        &ctx.accounts.target.to_account_info(),
        &ctx.accounts.actor.to_account_info(),
    )
}

fn settle<'info>(ctx: Context<'info, PromotionDispatch<'info>>, data: &[u8]) -> Result<()> {
    require!(data.is_empty(), LuckyMeError::InvalidPromotionInstruction);
    let snapshot = read_promotion(&ctx)?;
    require!(
        snapshot.status == STATUS_WINNER_READY,
        LuckyMeError::InvalidPromotionState
    );
    require_keys_eq!(
        ctx.accounts.authorizer.key(),
        snapshot.authorizer,
        LuckyMeError::InvalidPromotionAuthority
    );
    require!(
        ctx.remaining_accounts.len() == 2,
        LuckyMeError::InvalidPromotionInstruction
    );

    let promotion = ctx.accounts.target.key();
    let (vault, vault_bump) =
        Pubkey::find_program_address(&[b"promotion_vault", promotion.as_ref()], &crate::ID);
    require_keys_eq!(
        ctx.accounts.auxiliary.key(),
        vault,
        LuckyMeError::InvalidPromotionAccount
    );
    require!(
        ctx.accounts.auxiliary.owner == &solana_system_program::ID
            && ctx.accounts.auxiliary.data_is_empty()
            && ctx.accounts.auxiliary.lamports() >= snapshot.prize_amount,
        LuckyMeError::InsufficientVaultFunds
    );

    let winner_entry = &ctx.remaining_accounts[0];
    let winner = &ctx.remaining_accounts[1];
    let entry = read_entry(winner_entry)?;
    require_keys_eq!(
        entry.promotion,
        promotion,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    require!(
        entry.index == snapshot.winner_index,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    require_keys_eq!(entry.player, *winner.key, LuckyMeError::WinnerMismatch);
    let expected_entry = Pubkey::find_program_address(
        &[b"promotion_entry", promotion.as_ref(), winner.key.as_ref()],
        &crate::ID,
    )
    .0;
    require_keys_eq!(
        *winner_entry.key,
        expected_entry,
        LuckyMeError::InvalidPromotionWinnerEntry
    );

    let vault_bump_seed = [vault_bump];
    invoke_signed(
        &system_instruction::transfer(&vault, winner.key, snapshot.prize_amount),
        &[
            ctx.accounts.auxiliary.to_account_info(),
            winner.clone(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[&[
            b"promotion_vault",
            promotion.as_ref(),
            vault_bump_seed.as_ref(),
        ]],
    )?;

    let mut state = ctx.accounts.target.try_borrow_mut_data()?;
    state[WINNER_OFFSET..WINNER_OFFSET + 32].copy_from_slice(winner.key.as_ref());
    state[STATUS_OFFSET] = STATUS_PAID;
    Ok(())
}

struct PromotionSnapshot {
    status: u8,
    config: Pubkey,
    promotion_id: u64,
    rules_hash: [u8; 32],
    prize_amount: u64,
    capacity: u32,
    entry_count: u32,
    authorizer: Pubkey,
    winner_index: u32,
    outstanding_entries: u32,
    expires_at: i64,
    sponsor: Pubkey,
    prize_kind: u8,
}

struct PrizeSnapshot {
    promotion: Pubkey,
    mint: Pubkey,
    token_program: Pubkey,
    vault_token: Pubkey,
    amount: u64,
    decimals: u8,
    bump: u8,
}

fn read_promotion(ctx: &Context<PromotionDispatch>) -> Result<PromotionSnapshot> {
    read_promotion_account(&ctx.accounts.target.to_account_info())
}

fn read_promotion_account(account: &AccountInfo) -> Result<PromotionSnapshot> {
    require!(
        account.owner == &crate::ID,
        LuckyMeError::InvalidPromotionAccount
    );
    let state = account.try_borrow_data()?;
    require!(
        state.len() == PROMOTION_LEN && &state[0..8] == PROMOTION_MAGIC,
        LuckyMeError::InvalidPromotionAccount
    );
    Ok(PromotionSnapshot {
        status: state[STATUS_OFFSET],
        config: Pubkey::new_from_array(
            state[CONFIG_OFFSET..CONFIG_OFFSET + 32].try_into().unwrap(),
        ),
        promotion_id: u64::from_le_bytes(
            state[PROMOTION_ID_OFFSET..PROMOTION_ID_OFFSET + 8]
                .try_into()
                .unwrap(),
        ),
        rules_hash: state[RULES_HASH_OFFSET..RULES_HASH_OFFSET + 32]
            .try_into()
            .unwrap(),
        prize_amount: u64::from_le_bytes(
            state[PRIZE_AMOUNT_OFFSET..PRIZE_AMOUNT_OFFSET + 8]
                .try_into()
                .unwrap(),
        ),
        capacity: u32::from_le_bytes(
            state[CAPACITY_OFFSET..CAPACITY_OFFSET + 4]
                .try_into()
                .unwrap(),
        ),
        entry_count: u32::from_le_bytes(
            state[ENTRY_COUNT_OFFSET..ENTRY_COUNT_OFFSET + 4]
                .try_into()
                .unwrap(),
        ),
        authorizer: Pubkey::new_from_array(
            state[AUTHORIZER_OFFSET..AUTHORIZER_OFFSET + 32]
                .try_into()
                .unwrap(),
        ),
        winner_index: u32::from_le_bytes(
            state[WINNER_INDEX_OFFSET..WINNER_INDEX_OFFSET + 4]
                .try_into()
                .unwrap(),
        ),
        outstanding_entries: u32::from_le_bytes(
            state[OUTSTANDING_ENTRIES_OFFSET..OUTSTANDING_ENTRIES_OFFSET + 4]
                .try_into()
                .unwrap(),
        ),
        expires_at: i64::from_le_bytes(
            state[EXPIRES_AT_OFFSET..EXPIRES_AT_OFFSET + 8]
                .try_into()
                .unwrap(),
        ),
        sponsor: Pubkey::new_from_array(
            state[SPONSOR_OFFSET..SPONSOR_OFFSET + 32]
                .try_into()
                .unwrap(),
        ),
        prize_kind: state[PRIZE_KIND_OFFSET],
    })
}

#[allow(clippy::too_many_arguments)]
fn write_prize_account(
    account: &AccountInfo,
    promotion: &Pubkey,
    mint: &Pubkey,
    token_program: &Pubkey,
    vault_token: &Pubkey,
    amount: u64,
    decimals: u8,
    bump: u8,
) -> Result<()> {
    require!(
        account.owner == &crate::ID,
        LuckyMeError::InvalidPromotionAccount
    );
    let mut state = account.try_borrow_mut_data()?;
    require!(
        state.len() == PRIZE_LEN,
        LuckyMeError::InvalidPromotionAccount
    );
    state.fill(0);
    state[0..8].copy_from_slice(PRIZE_MAGIC);
    state[8..40].copy_from_slice(promotion.as_ref());
    state[40..72].copy_from_slice(mint.as_ref());
    state[72..104].copy_from_slice(token_program.as_ref());
    state[104..136].copy_from_slice(vault_token.as_ref());
    state[136..144].copy_from_slice(&amount.to_le_bytes());
    state[144] = decimals;
    state[145] = bump;
    Ok(())
}

fn read_prize_account(account: &AccountInfo) -> Result<PrizeSnapshot> {
    require!(
        account.owner == &crate::ID,
        LuckyMeError::InvalidPromotionAccount
    );
    let state = account.try_borrow_data()?;
    require!(
        state.len() == PRIZE_LEN && &state[0..8] == PRIZE_MAGIC,
        LuckyMeError::InvalidPromotionAccount
    );
    Ok(PrizeSnapshot {
        promotion: Pubkey::new_from_array(state[8..40].try_into().unwrap()),
        mint: Pubkey::new_from_array(state[40..72].try_into().unwrap()),
        token_program: Pubkey::new_from_array(state[72..104].try_into().unwrap()),
        vault_token: Pubkey::new_from_array(state[104..136].try_into().unwrap()),
        amount: u64::from_le_bytes(state[136..144].try_into().unwrap()),
        decimals: state[144],
        bump: state[145],
    })
}

struct EntrySnapshot {
    promotion: Pubkey,
    player: Pubkey,
    index: u32,
}

fn read_entry(account: &AccountInfo) -> Result<EntrySnapshot> {
    require!(
        account.owner == &crate::ID,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    let data = account.try_borrow_data()?;
    require!(
        data.len() == ENTRY_LEN && &data[0..8] == ENTRY_MAGIC,
        LuckyMeError::InvalidPromotionWinnerEntry
    );
    Ok(EntrySnapshot {
        promotion: Pubkey::new_from_array(data[8..40].try_into().unwrap()),
        player: Pubkey::new_from_array(data[40..72].try_into().unwrap()),
        index: u32::from_le_bytes(data[72..76].try_into().unwrap()),
    })
}

fn validate_promotion_pda(config: &Pubkey, promotion_id: u64, actual: &Pubkey) -> Result<()> {
    let id = promotion_id.to_le_bytes();
    let expected =
        Pubkey::find_program_address(&[b"promotion", config.as_ref(), id.as_ref()], &crate::ID).0;
    require_keys_eq!(*actual, expected, LuckyMeError::InvalidPromotionAccount);
    Ok(())
}

fn unbiased_index(mut randomness: [u8; 32], capacity: u32) -> Result<u32> {
    require!(capacity > 0, LuckyMeError::InvalidTicketCount);
    let modulus = u64::from(capacity);
    let acceptance_zone = u64::MAX - (u64::MAX % modulus);
    for counter in 0_u8..=u8::MAX {
        let candidate = u64::from_le_bytes(randomness[0..8].try_into().unwrap());
        if candidate < acceptance_zone {
            return Ok((candidate % modulus) as u32);
        }
        randomness = hashv(&[
            b"luckyme-promotion-reroll-v1",
            randomness.as_ref(),
            &[counter],
        ])
        .to_bytes();
    }
    err!(LuckyMeError::InvalidRandomnessStatus)
}

fn create_program_pda<'info>(
    payer: &AccountInfo<'info>,
    account: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    space: usize,
    seeds: &[&[u8]],
) -> Result<()> {
    require!(
        account.data_is_empty() && account.owner == &solana_system_program::ID,
        LuckyMeError::InvalidPromotionAccount
    );
    let rent = Rent::get()?.minimum_balance(space);
    require!(
        account.lamports() == 0,
        LuckyMeError::InvalidPromotionAccount
    );
    invoke_signed(
        &system_instruction::create_account(payer.key, account.key, rent, space as u64, &crate::ID),
        &[payer.clone(), account.clone(), system_program.clone()],
        &[seeds],
    )?;
    Ok(())
}

fn validate_token_programs(
    token_program: &AccountInfo,
    associated_token_program: Option<&AccountInfo>,
) -> Result<()> {
    require_keys_eq!(
        *token_program.key,
        SPL_TOKEN_PROGRAM_ID,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    require!(
        token_program.executable,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    if let Some(associated_token_program) = associated_token_program {
        require_keys_eq!(
            *associated_token_program.key,
            ASSOCIATED_TOKEN_PROGRAM_ID,
            LuckyMeError::InvalidPromotionPrizeAsset
        );
        require!(
            associated_token_program.executable,
            LuckyMeError::InvalidPromotionPrizeAsset
        );
    }
    Ok(())
}

fn read_mint_decimals(mint: &AccountInfo) -> Result<u8> {
    require_keys_eq!(
        *mint.owner,
        SPL_TOKEN_PROGRAM_ID,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    let data = mint.try_borrow_data()?;
    require!(
        data.len() == MINT_LEN && data[45] == 1,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    Ok(data[44])
}

fn read_token_amount(
    token_account: &AccountInfo,
    expected_mint: &Pubkey,
    expected_authority: &Pubkey,
) -> Result<u64> {
    require_keys_eq!(
        *token_account.owner,
        SPL_TOKEN_PROGRAM_ID,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    let data = token_account.try_borrow_data()?;
    require!(
        data.len() == TOKEN_ACCOUNT_LEN && data[108] == 1,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    let mint = Pubkey::new_from_array(data[0..32].try_into().unwrap());
    let authority = Pubkey::new_from_array(data[32..64].try_into().unwrap());
    require_keys_eq!(
        mint,
        *expected_mint,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    require_keys_eq!(
        authority,
        *expected_authority,
        LuckyMeError::InvalidPromotionPrizeAsset
    );
    Ok(u64::from_le_bytes(data[64..72].try_into().unwrap()))
}

fn associated_token_address(owner: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[owner.as_ref(), SPL_TOKEN_PROGRAM_ID.as_ref(), mint.as_ref()],
        &ASSOCIATED_TOKEN_PROGRAM_ID,
    )
    .0
}

#[allow(clippy::too_many_arguments)]
fn create_associated_token_account_if_needed<'info>(
    payer: &AccountInfo<'info>,
    associated_token: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    associated_token_program: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
) -> Result<()> {
    let expected = associated_token_address(owner.key, mint.key);
    require_keys_eq!(
        *associated_token.key,
        expected,
        LuckyMeError::InvalidPromotionPrizeAsset
    );

    if associated_token.owner == &SPL_TOKEN_PROGRAM_ID {
        read_token_amount(associated_token, mint.key, owner.key)?;
        return Ok(());
    }
    require!(
        associated_token.owner == &solana_system_program::ID && associated_token.data_is_empty(),
        LuckyMeError::InvalidPromotionPrizeAsset
    );

    let instruction = Instruction {
        program_id: ASSOCIATED_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*payer.key, true),
            AccountMeta::new(*associated_token.key, false),
            AccountMeta::new_readonly(*owner.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new_readonly(solana_system_program::ID, false),
            AccountMeta::new_readonly(SPL_TOKEN_PROGRAM_ID, false),
        ],
        // CreateIdempotent in the Associated Token Account program.
        data: vec![1],
    };
    invoke(
        &instruction,
        &[
            payer.clone(),
            associated_token.clone(),
            owner.clone(),
            mint.clone(),
            system_program.clone(),
            token_program.clone(),
            associated_token_program.clone(),
        ],
    )?;
    read_token_amount(associated_token, mint.key, owner.key)?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn transfer_checked<'info>(
    source: &AccountInfo<'info>,
    mint: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    amount: u64,
    decimals: u8,
    signer: Option<&[&[u8]]>,
) -> Result<()> {
    require!(amount > 0, LuckyMeError::InvalidPromotionInstruction);
    let mut data = Vec::with_capacity(10);
    data.push(12); // TransferChecked
    data.extend_from_slice(&amount.to_le_bytes());
    data.push(decimals);
    let instruction = Instruction {
        program_id: SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*source.key, false),
            AccountMeta::new_readonly(*mint.key, false),
            AccountMeta::new(*destination.key, false),
            // The token program must always see the transfer authority as a
            // signer. For PDA authorities, `invoke_signed` supplies that
            // signature from the seeds below; marking the meta non-signing
            // causes Tokenkeg to reject an otherwise valid PDA transfer.
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data,
    };
    let account_infos = &[
        source.clone(),
        mint.clone(),
        destination.clone(),
        authority.clone(),
        token_program.clone(),
    ];
    if let Some(signer) = signer {
        invoke_signed(&instruction, account_infos, &[signer])?;
    } else {
        invoke(&instruction, account_infos)?;
    }
    Ok(())
}

fn close_token_account<'info>(
    token_account: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    token_program: &AccountInfo<'info>,
    signer: &[&[u8]],
) -> Result<()> {
    let instruction = Instruction {
        program_id: SPL_TOKEN_PROGRAM_ID,
        accounts: vec![
            AccountMeta::new(*token_account.key, false),
            AccountMeta::new(*destination.key, false),
            // `invoke_signed` supplies the promotion PDA signature, but the
            // token program still requires the authority meta to be marked as
            // a signer in the inner instruction.
            AccountMeta::new_readonly(*authority.key, true),
        ],
        data: vec![9], // CloseAccount
    };
    invoke_signed(
        &instruction,
        &[
            token_account.clone(),
            destination.clone(),
            authority.clone(),
            token_program.clone(),
        ],
        &[signer],
    )?;
    Ok(())
}

fn drain_system_vault<'info>(
    vault: &AccountInfo<'info>,
    destination: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    promotion: &Pubkey,
    vault_bump: u8,
) -> Result<()> {
    require!(
        vault.owner == &solana_system_program::ID && vault.data_is_empty(),
        LuckyMeError::InvalidPromotionAccount
    );
    let amount = vault.lamports();
    if amount == 0 {
        return Ok(());
    }
    let bump_seed = [vault_bump];
    invoke_signed(
        &system_instruction::transfer(vault.key, destination.key, amount),
        &[vault.clone(), destination.clone(), system_program.clone()],
        &[&[b"promotion_vault", promotion.as_ref(), bump_seed.as_ref()]],
    )?;
    Ok(())
}

fn close_program_account(account: &AccountInfo, destination: &AccountInfo) -> Result<()> {
    require!(
        account.owner == &crate::ID,
        LuckyMeError::InvalidPromotionAccount
    );
    let lamports = account.lamports();
    let destination_balance = destination
        .lamports()
        .checked_add(lamports)
        .ok_or(LuckyMeError::MathOverflow)?;
    **destination.try_borrow_mut_lamports()? = destination_balance;
    **account.try_borrow_mut_lamports()? = 0;
    account.try_borrow_mut_data()?.fill(0);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn compact_layouts_are_fixed_and_small() {
        assert_eq!(PROMOTION_LEN, 248);
        assert_eq!(ENTRY_LEN, 80);
        assert_eq!(PRIZE_LEN, 146);
        assert_eq!(PROMOTION_LEN - (SPONSOR_OFFSET + 32), 4);
    }

    #[test]
    fn operation_codes_remain_stable() {
        assert_eq!(
            [
                OP_INITIALIZE,
                OP_ENTER,
                OP_SETTLE,
                OP_CANCEL,
                OP_CLOSE_ENTRY,
                OP_ARCHIVE,
                OP_INITIALIZE_TOKEN,
                OP_SETTLE_TOKEN,
                OP_CANCEL_TOKEN,
                OP_ARCHIVE_TOKEN,
            ],
            [0, 1, 2, 3, 4, 5, 6, 7, 8, 9]
        );
    }

    #[test]
    fn lifecycle_codes_remain_stable() {
        assert_eq!(
            [
                STATUS_OPEN,
                STATUS_LOCKED,
                STATUS_RANDOMNESS_PENDING,
                STATUS_WINNER_READY,
                STATUS_PAID,
                STATUS_CANCELLED,
            ],
            [2, 3, 4, 5, 6, 7]
        );
    }

    #[test]
    fn winner_index_is_always_in_range() {
        for capacity in [1, 2, 3, 10, 1_000] {
            for byte in 0..=255 {
                assert!(unbiased_index([byte; 32], capacity).unwrap() < capacity);
            }
        }
    }
}
