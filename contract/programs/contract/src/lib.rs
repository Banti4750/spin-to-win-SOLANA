use anchor_lang::prelude::*;

declare_id!("3z5DJ8k16cB8oAtbS45ye4PdtFQZBrFjNKhqks2AAxxr");

#[program]
pub mod spin_to_win {
    use super::*;

    pub fn initialize_company_pool(
        ctx: Context<InitializeCompanyPool>,
        ticket_price: u64,
        rewards: Vec<RewardItem>,
        max_rewards_per_user: u8,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        pool.admin = ctx.accounts.admin.key();
        pool.ticket_price = ticket_price;
        pool.rewards = rewards;
        pool.total_tickets_sold = 0;
        pool.total_rewards_claimed = 0;
        pool.max_rewards_per_user = max_rewards_per_user;
        pool.is_active = true;
        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;

        require!(pool.is_active, CustomError::PoolInactive);

        // Transfer SOL from user to reward vaul
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.reward_vault.key(),
            pool.ticket_price,
        );

        anchor_lang::solana_program::program::invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.reward_vault.to_account_info(),
            ],
        )?;

        pool.total_tickets_sold = pool
            .total_tickets_sold
            .checked_add(1)
            .ok_or(CustomError::MathOverflow)?;

        Ok(())
    }

    pub fn record_spin_result(
        ctx: Context<RecordSpin>,
        result_index: u8,
        nonce: u64, // For randomness verificati
    ) -> Result<()> {
        let pool = &ctx.accounts.pool;
        let user_state = &mut ctx.accounts.user_spin_state;

        require!(pool.is_active, CustomError::PoolInactive);
        require!(
            (result_index as usize) < pool.rewards.len(),
            CustomError::InvalidRewardIndex
        );
        require!(
            user_state.spins_count < pool.max_rewards_per_user,
            CustomError::MaxSpinsReached
        );

        // Verify the spin result using on-chain randomness (simplified)
        let recent_blockhash = &ctx.accounts.recent_blockhashes.data.borrow();
        let seed = [
            ctx.accounts.user.key().as_ref(),
            &nonce.to_le_bytes(),
            &recent_blockhash[0..8],
        ]
        .concat();

        let hash = anchor_lang::solana_program::keccak::hash(&seed);
        let random_number = u64::from_le_bytes([
            hash.0[0], hash.0[1], hash.0[2], hash.0[3], hash.0[4], hash.0[5], hash.0[6], hash.0[7],
        ]) % 100; // 0-99 for percentage

        // Verify the result matches expected probability
        let mut cumulative_probability = 0u64;
        let mut expected_index = 0;
        for (i, reward) in pool.rewards.iter().enumerate() {
            cumulative_probability += reward.probability;
            if random_number < cumulative_probability {
                expected_index = i;
                break;
            }
        }

        require!(
            result_index == expected_index as u8,
            CustomError::InvalidSpinResult
        );

        user_state.user = ctx.accounts.user.key();
        user_state.last_result = result_index;
        user_state.is_claimed = false;
        user_state.spins_count = user_state
            .spins_count
            .checked_add(1)
            .ok_or(CustomError::MathOverflow)?;
        user_state.last_spin_slot = Clock::get()?.slot;

        Ok(())
    }

    pub fn claim_reward(ctx: Context<ClaimReward>) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        let user_state = &mut ctx.accounts.user_spin_state;

        require!(!user_state.is_claimed, CustomError::AlreadyClaimed);
        require!(
            user_state.user == ctx.accounts.user.key(),
            CustomError::UnauthorizedUser
        );

        let reward = &pool.rewards[user_state.last_result as usize];
        let reward_value = reward.value;

        require!(reward_value > 0, CustomError::NoRewardValue);

        // Check if enough time has passed (prevent immediate claims)
        let current_slot = Clock::get()?.slot;
        require!(
            current_slot > user_state.last_spin_slot + 1, // At least 1 slot
            CustomError::ClaimTooEarly
        );

        // Transfer reward from vault to user
        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.reward_vault.key(),
            &ctx.accounts.user.key(),
            reward_value,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.user.to_account_info(),
            ],
            &[&[
                b"reward_vault",
                pool.key().as_ref(),
                &[ctx.bumps.reward_vault],
            ]],
        )?;

        user_state.is_claimed = true;
        pool.total_rewards_claimed = pool
            .total_rewards_claimed
            .checked_add(1)
            .ok_or(CustomError::MathOverflow)?;

        Ok(())
    }

    pub fn update_pool_status(ctx: Context<UpdatePool>, is_active: bool) -> Result<()> {
        let pool = &mut ctx.accounts.pool;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            CustomError::UnauthorizedAdmin
        );
        pool.is_active = is_active;
        Ok(())
    }

    pub fn withdraw_funds(ctx: Context<WithdrawFunds>, amount: u64) -> Result<()> {
        let pool = &ctx.accounts.pool;
        require!(
            pool.admin == ctx.accounts.admin.key(),
            CustomError::UnauthorizedAdmin
        );

        let ix = anchor_lang::solana_program::system_instruction::transfer(
            &ctx.accounts.reward_vault.key(),
            &ctx.accounts.admin.key(),
            amount,
        );

        anchor_lang::solana_program::program::invoke_signed(
            &ix,
            &[
                ctx.accounts.reward_vault.to_account_info(),
                ctx.accounts.admin.to_account_info(),
            ],
            &[&[
                b"reward_vault",
                pool.key().as_ref(),
                &[ctx.bumps.reward_vault],
            ]],
        )?;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializeCompanyPool<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + 32 + 8 + 4 + (32 + 8 + 8) * 20 + 8 + 8 + 1 + 1 // Increased space for more data
    )]
    pub pool: Account<'info, CompanyPool>,

    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(mut)]
    pub pool: Account<'info, CompanyPool>,

    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RecordSpin<'info> {
    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 1 + 1 + 1 + 8,
        seeds = [b"user_spin", user.key().as_ref(), pool.key().as_ref()],
        bump
    )]
    pub user_spin_state: Account<'info, UserSpinState>,

    #[account(mut)]
    pub user: Signer<'info>,

    pub pool: Account<'info, CompanyPool>,

    /// CHECK: Recent blockhashes sysvar
    #[account(address = anchor_lang::solana_program::sysvar::recent_blockhashes::ID)]
    pub recent_blockhashes: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,

    #[account(mut)]
    pub pool: Account<'info, CompanyPool>,

    #[account(
        mut,
        seeds = [b"user_spin", user.key().as_ref(), pool.key().as_ref()],
        bump
    )]
    pub user_spin_state: Account<'info, UserSpinState>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdatePool<'info> {
    #[account(mut)]
    pub pool: Account<'info, CompanyPool>,

    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct WithdrawFunds<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    pub pool: Account<'info, CompanyPool>,

    #[account(
        mut,
        seeds = [b"reward_vault", pool.key().as_ref()],
        bump
    )]
    pub reward_vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct CompanyPool {
    pub admin: Pubkey,
    pub ticket_price: u64,
    pub rewards: Vec<RewardItem>,
    pub total_tickets_sold: u64,
    pub total_rewards_claimed: u64,
    pub max_rewards_per_user: u8,
    pub is_active: bool,
}

#[account]
pub struct UserSpinState {
    pub user: Pubkey,
    pub last_result: u8,
    pub is_claimed: bool,
    pub spins_count: u8,
    pub last_spin_slot: u64,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RewardItem {
    pub name: String,
    pub value: u64,       // in lamports
    pub probability: u64, // percentage (0-100)
}

#[error_code]
pub enum CustomError {
    #[msg("Reward already claimed.")]
    AlreadyClaimed,

    #[msg("Pool is not active.")]
    PoolInactive,

    #[msg("Invalid reward index.")]
    InvalidRewardIndex,

    #[msg("Maximum spins reached for this user.")]
    MaxSpinsReached,

    #[msg("Invalid spin result.")]
    InvalidSpinResult,

    #[msg("Unauthorized user.")]
    UnauthorizedUser,

    #[msg("No reward value.")]
    NoRewardValue,

    #[msg("Claim too early.")]
    ClaimTooEarly,

    #[msg("Unauthorized admin.")]
    UnauthorizedAdmin,

    #[msg("Math overflow.")]
    MathOverflow,
}
