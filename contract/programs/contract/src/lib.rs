use anchor_lang::prelude::*;

// Import the probability module
mod probability;
use probability::*;

declare_id!("3z5DJ8k16cB8oAtbS45ye4PdtFQZBrFjNKhqks2AAxxr");

#[program]
pub mod company_pool {
    use super::*;

    pub fn initialize_company_pool(
        ctx: Context<InitializeCompanyPool>,
        ticket_price: u64,
        company_name: String,
        company_image: String,
        items: Vec<PoolItemInput>,
    ) -> Result<()> {
        let company_pool = &mut ctx.accounts.company_pool;
        let clock = Clock::get()?;

        // Validate inputs
        require!(ticket_price > 0, ErrorCode::InvalidTicketPrice);
        require!(!items.is_empty(), ErrorCode::NoItemsProvided);
        require!(company_name.len() <= 50, ErrorCode::CompanyNameTooLong);
        require!(company_image.len() <= 200, ErrorCode::CompanyImageTooLong);
        require!(items.len() <= 10, ErrorCode::TooManyItems);

        // Validate all items before processing
        for item in &items {
            require!(item.price > 0, ErrorCode::InvalidItemPrice);
            require!(item.name.len() <= 50, ErrorCode::ItemNameTooLong);
            require!(item.image.len() <= 200, ErrorCode::ItemImageTooLong);
            require!(
                item.description.len() <= 200,
                ErrorCode::ItemDescriptionTooLong
            );
        }

        company_pool.authority = ctx.accounts.authority.key();
        company_pool.company_name = company_name;
        company_pool.company_image = company_image;
        company_pool.ticket_price = ticket_price;
        company_pool.total_tickets_sold = 0;
        company_pool.total_funds = 0;
        company_pool.active = true;
        company_pool.created_at = clock.unix_timestamp;

        let mut total_value = 0u64;
        let mut pool_items = Vec::new();

        // Prepare items for probability calculation
        let items_for_probability: Vec<(String, u64)> = items
            .iter()
            .map(|item| (item.name.clone(), item.price))
            .collect();

        // Calculate probabilities using the advanced weighted algorithm
        let probabilities = calculate_item_probabilities(&items_for_probability, ticket_price)
            .map_err(|_| ErrorCode::InvalidProbabilityCalculation)?;

        // Create pool items with calculated probabilities
        for (i, item) in items.into_iter().enumerate() {
            pool_items.push(PoolItem {
                image: item.image,
                price: item.price,
                name: item.name,
                description: item.description,
                probability: probabilities[i],
                available: true,
            });

            total_value = total_value
                .checked_add(item.price)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        company_pool.items = pool_items;
        company_pool.total_value = total_value;

        // Log probability information for debugging
        msg!("=== ITEM PROBABILITIES ===");
        for (_i, item) in company_pool.items.iter().enumerate() {
            msg!(
                "{}: {}% (Value: {} SOL)",
                item.name,
                (item.probability as f64) / 100.0,
                item.price
            );
        }

        // Verify probabilities sum correctly
        let total_probability: u32 = company_pool.items.iter().map(|item| item.probability).sum();
        require!(
            total_probability == 10000,
            ErrorCode::ProbabilitySumMismatch
        );

        // Create the vault PDA
        let rent = Rent::get()?;
        let minimum_balance = rent.minimum_balance(0);

        if ctx.accounts.pool_vault.lamports() < minimum_balance {
            let cpi_accounts = anchor_lang::system_program::Transfer {
                from: ctx.accounts.authority.to_account_info(),
                to: ctx.accounts.pool_vault.to_account_info(),
            };
            let cpi_context =
                CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
            anchor_lang::system_program::transfer(cpi_context, minimum_balance)?;
        }

        emit!(PoolInitializedEvent {
            company_name: company_pool.company_name.clone(),
            ticket_price,
            item_count: company_pool.items.len() as u32,
            authority: ctx.accounts.authority.key(),
            total_probability_check: total_probability,
        });

        Ok(())
    }

    pub fn buy_ticket(ctx: Context<BuyTicket>) -> Result<()> {
        let company_pool = &mut ctx.accounts.company_pool;
        let clock = Clock::get()?;

        // Validate pool state
        require!(company_pool.active, ErrorCode::PoolInactive);
        require!(!company_pool.items.is_empty(), ErrorCode::NoItemsProvided);

        let ticket_price = company_pool.ticket_price;

        // Transfer SOL from buyer to pool vault
        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
        };
        let cpi_context =
            CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        anchor_lang::system_program::transfer(cpi_context, ticket_price)?;

        // Initialize the ticket account
        let user_ticket = &mut ctx.accounts.user_ticket;
        user_ticket.owner = ctx.accounts.buyer.key();
        user_ticket.company_pool = company_pool.key();
        user_ticket.purchased_at = clock.unix_timestamp;
        user_ticket.used = false;
        user_ticket.ticket_id = company_pool.total_tickets_sold;
        user_ticket.won_item = None; // Initialize as no item won yet
        user_ticket.reward_claimed = false; // Initialize as not claimed

        // Update the company pool state
        company_pool.total_tickets_sold = company_pool
            .total_tickets_sold
            .checked_add(1)
            .ok_or(ErrorCode::MathOverflow)?;

        company_pool.total_funds = company_pool
            .total_funds
            .checked_add(ticket_price)
            .ok_or(ErrorCode::MathOverflow)?;

        // Emit event
        emit!(TicketPurchasedEvent {
            buyer: ctx.accounts.buyer.key(),
            ticket_price,
            total_tickets_sold: company_pool.total_tickets_sold,
            ticket_id: user_ticket.ticket_id,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn withdraw_funds_from_vault(
        ctx: Context<WithdrawFundsFromVault>,
        amount_to_withdraw: u64,
    ) -> Result<()> {
        let company_pool = &mut ctx.accounts.company_pool;
        let clock = Clock::get()?;

        // Validate pool state
        require!(company_pool.active, ErrorCode::PoolInactive);
        require!(company_pool.total_funds > 0, ErrorCode::NoFundsAvailable);

        // Validate authority
        require!(
            company_pool.authority == ctx.accounts.authority.key(),
            ErrorCode::UnauthorizedWithdrawal
        );

        // Validate the amount to withdraw
        require!(amount_to_withdraw > 0, ErrorCode::InvalidAmount);
        require!(
            amount_to_withdraw <= company_pool.total_funds,
            ErrorCode::InsufficientFunds
        );

        // Get vault balance to ensure we have enough funds
        let vault_balance = ctx.accounts.pool_vault.lamports();
        let rent_exempt_minimum = Rent::get()?.minimum_balance(0);
        let withdrawable_balance = vault_balance.saturating_sub(rent_exempt_minimum);

        require!(
            amount_to_withdraw <= withdrawable_balance,
            ErrorCode::InsufficientVaultFunds
        );

        // Create seeds for PDA signing
        let company_name_bytes = company_pool.company_name.as_bytes();
        let seeds = &[b"pool_vault", company_name_bytes, &[ctx.bumps.pool_vault]];
        let signer_seeds = &[&seeds[..]];

        // Transfer funds from vault to authority
        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.authority.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_lang::system_program::transfer(cpi_context, amount_to_withdraw)?;

        // Update the company pool state
        company_pool.total_funds = company_pool
            .total_funds
            .checked_sub(amount_to_withdraw)
            .ok_or(ErrorCode::MathOverflow)?;

        // Emit event
        emit!(FundsWithdrawnEvent {
            authority: ctx.accounts.authority.key(),
            amount_withdrawn: amount_to_withdraw,
            remaining_funds: company_pool.total_funds,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn record_spin_result(ctx: Context<RecordSpinResult>) -> Result<()> {
        let company_pool = &mut ctx.accounts.company_pool;
        let user_ticket = &mut ctx.accounts.user_ticket;
        let clock = Clock::get()?;

        // Validate pool state
        require!(company_pool.active, ErrorCode::PoolInactive);
        require!(!company_pool.items.is_empty(), ErrorCode::NoItemsProvided);

        // CRITICAL: Validate ticket ownership and usage
        require!(
            user_ticket.owner == ctx.accounts.spinner.key(),
            ErrorCode::NotTicketOwner
        );
        require!(
            user_ticket.company_pool == company_pool.key(),
            ErrorCode::InvalidTicketPool
        );
        require!(!user_ticket.used, ErrorCode::TicketAlreadyUsed);

        // Mark ticket as used
        user_ticket.used = true;

        // Get available items with their pre-calculated probabilities
        let available_items: Vec<(usize, &PoolItem)> = company_pool
            .items
            .iter()
            .enumerate()
            .filter(|(_, item)| item.available && item.probability > 0)
            .collect();

        require!(!available_items.is_empty(), ErrorCode::NoAvailableItems);

        // Generate enhanced pseudo-random seed using multiple on-chain sources
        let random_seed = clock.unix_timestamp as u64
            ^ ctx.accounts.spinner.key().to_bytes()[0..8]
                .iter()
                .enumerate()
                .fold(0u64, |acc, (i, &byte)| acc ^ ((byte as u64) << (i * 8)))
            ^ company_pool.total_tickets_sold
            ^ ctx.accounts.pool_vault.lamports()
            ^ (clock.slot as u64)
            ^ user_ticket.ticket_id;

        // Extract probabilities for available items
        let probabilities: Vec<u32> = available_items
            .iter()
            .map(|(_, item)| item.probability)
            .collect();

        // Select winning item using weighted probability algorithm
        let winning_index = select_winning_item_index(&probabilities, random_seed)
            .ok_or(ErrorCode::ProbabilitySelectionFailed)?;

        let (actual_index, winning_item) = available_items[winning_index];

        // Store the won item in the ticket for later claiming
        user_ticket.won_item = Some(WonItem {
            name: winning_item.name.clone(),
            price: winning_item.price,
            image: winning_item.image.clone(),
            description: winning_item.description.clone(),
            item_index: actual_index as u32,
        });

        // Clone the winning item for the event
        let won_item = winning_item.clone();

        // Log detailed winning information
        msg!("🎉 SPIN RESULT 🎉");
        msg!("Winner: {}", ctx.accounts.spinner.key());
        msg!("Won Item: {}", winning_item.name);
        msg!("Item Value: {} SOL", winning_item.price);
        msg!(
            "Win Probability: {}%",
            (winning_item.probability as f64) / 100.0
        );
        msg!("Random Seed: {}", random_seed);
        msg!("Ticket ID: {}", user_ticket.ticket_id);

        // Emit success event
        emit!(SpinResultEvent {
            spinner: ctx.accounts.spinner.key(),
            won_item: Some(won_item),
            item_index: Some(actual_index as u32),
            item_value: winning_item.price,
            win_probability: winning_item.probability,
            random_seed,
            ticket_id: user_ticket.ticket_id,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn claim_reward(ctx: Context<ClaimReward>) -> Result<()> {
        let company_pool = &mut ctx.accounts.company_pool;
        let user_ticket = &mut ctx.accounts.user_ticket;
        let clock = Clock::get()?;

        // Validate pool state
        require!(company_pool.active, ErrorCode::PoolInactive);

        // Validate ticket ownership and state
        require!(
            user_ticket.owner == ctx.accounts.spinner.key(),
            ErrorCode::NotTicketOwner
        );
        require!(
            user_ticket.company_pool == company_pool.key(),
            ErrorCode::InvalidTicketPool
        );
        require!(user_ticket.used, ErrorCode::TicketNotUsed);
        require!(!user_ticket.reward_claimed, ErrorCode::RewardAlreadyClaimed);

        // Check if user won an item and clone it to avoid borrowing issues
        let won_item = user_ticket.won_item.as_ref()
            .ok_or(ErrorCode::NoRewardToClaim)?
            .clone();

        let reward_amount = won_item.price;

        // Validate vault has sufficient funds
        let vault_balance = ctx.accounts.pool_vault.lamports();
        let rent_exempt_minimum = Rent::get()?.minimum_balance(0);
        let available_balance = vault_balance.saturating_sub(rent_exempt_minimum);

        require!(
            reward_amount <= available_balance,
            ErrorCode::InsufficientVaultFunds
        );

        // Create seeds for PDA signing
        let company_name_bytes = company_pool.company_name.as_bytes();
        let seeds = &[b"pool_vault", company_name_bytes, &[ctx.bumps.pool_vault]];
        let signer_seeds = &[&seeds[..]];

        // Transfer reward from vault to winner
        let cpi_accounts = anchor_lang::system_program::Transfer {
            from: ctx.accounts.pool_vault.to_account_info(),
            to: ctx.accounts.spinner.to_account_info(),
        };
        let cpi_context = CpiContext::new_with_signer(
            ctx.accounts.system_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        anchor_lang::system_program::transfer(cpi_context, reward_amount)?;

        // Mark reward as claimed
        user_ticket.reward_claimed = true;

        // Update pool's total funds (tracking purposes)
        company_pool.total_funds = company_pool
            .total_funds
            .saturating_sub(reward_amount);

        // Log reward claim
        msg!("🎁 REWARD CLAIMED 🎁");
        msg!("Winner: {}", ctx.accounts.spinner.key());
        msg!("Item: {}", won_item.name);
        msg!("Reward Amount: {} lamports", reward_amount);
        msg!("Ticket ID: {}", user_ticket.ticket_id);

        // Emit reward claimed event
        emit!(RewardClaimedEvent {
            winner: ctx.accounts.spinner.key(),
            ticket_id: user_ticket.ticket_id,
            won_item: won_item.clone(),
            reward_amount,
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }

    pub fn get_probability_analysis(ctx: Context<GetProbabilityAnalysis>) -> Result<()> {
        let company_pool = &ctx.accounts.company_pool;

        // Create probability calculator for analysis
        let items_for_analysis: Vec<(String, u64)> = company_pool
            .items
            .iter()
            .map(|item| (item.name.clone(), item.price))
            .collect();

        let calculator =
            WeightedProbabilityCalculator::new(items_for_analysis, company_pool.ticket_price);

        // Emit analysis event for each item
        for item in &company_pool.items {
            if let Some(analysis) = calculator.get_profitability_analysis(&item.name) {
                emit!(ProbabilityAnalysisEvent {
                    item_name: item.name.clone(),
                    item_value: item.price,
                    probability_basis_points: item.probability,
                    expected_spins: analysis.expected_spins,
                    expected_cost: analysis.expected_cost,
                    profit: analysis.profit,
                    profit_ratio: analysis.profit_ratio,
                });
            }
        }

        Ok(())
    }

    pub fn get_user_tickets(_ctx: Context<GetUserTickets>) -> Result<()> {
        // This function can be used to query user tickets
        // Implementation depends on your specific needs
        Ok(())
    }
}

#[derive(Accounts)]
pub struct ClaimReward<'info> {
    #[account(
        mut,
        constraint = company_pool.active @ ErrorCode::PoolInactive
    )]
    pub company_pool: Account<'info, CompanyPool>,

    #[account(
        mut,
        constraint = user_ticket.owner == spinner.key() @ ErrorCode::NotTicketOwner,
        constraint = user_ticket.company_pool == company_pool.key() @ ErrorCode::InvalidTicketPool,
        constraint = user_ticket.used @ ErrorCode::TicketNotUsed,
        constraint = !user_ticket.reward_claimed @ ErrorCode::RewardAlreadyClaimed
    )]
    pub user_ticket: Account<'info, UserTicket>,

    #[account(mut)]
    pub spinner: Signer<'info>,

    /// CHECK: This is the pool vault PDA that holds the funds
    #[account(
        mut,
        seeds = [b"pool_vault", company_pool.company_name.as_bytes()],
        bump,
    )]
    pub pool_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

// Account Structures
#[derive(Accounts)]
pub struct GetProbabilityAnalysis<'info> {
    pub company_pool: Account<'info, CompanyPool>,
}

#[derive(Accounts)]
pub struct GetUserTickets<'info> {
    pub user: Signer<'info>,
}

#[derive(Accounts)]
pub struct RecordSpinResult<'info> {
    #[account(
        mut,
        constraint = company_pool.active @ ErrorCode::PoolInactive
    )]
    pub company_pool: Account<'info, CompanyPool>,

    #[account(
        mut,
        constraint = user_ticket.owner == spinner.key() @ ErrorCode::NotTicketOwner,
        constraint = user_ticket.company_pool == company_pool.key() @ ErrorCode::InvalidTicketPool,
        constraint = !user_ticket.used @ ErrorCode::TicketAlreadyUsed
    )]
    pub user_ticket: Account<'info, UserTicket>,

    #[account(mut)]
    pub spinner: Signer<'info>,

    /// CHECK: This is the pool vault PDA that holds the funds
    #[account(
        mut,
        seeds = [b"pool_vault", company_pool.company_name.as_bytes()],
        bump,
    )]
    pub pool_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct WithdrawFundsFromVault<'info> {
    #[account(
        mut,
        has_one = authority @ ErrorCode::UnauthorizedWithdrawal
    )]
    pub company_pool: Account<'info, CompanyPool>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: This is the pool vault PDA that holds the funds
    #[account(
        mut,
        seeds = [b"pool_vault", company_pool.company_name.as_bytes()],
        bump,
    )]
    pub pool_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub company_pool: Account<'info, CompanyPool>,

    #[account(
        init,
        payer = buyer,
        space = UserTicket::SPACE,
        seeds = [
        b"user_ticket",
        buyer.key().as_ref(),
        company_pool.key().as_ref(),
        &company_pool.total_tickets_sold.to_le_bytes()
        ],
        bump
    )]
    pub user_ticket: Account<'info, UserTicket>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    /// CHECK: This is the pool vault PDA that holds the funds
    #[account(
        mut,
        seeds = [b"pool_vault", company_pool.company_name.as_bytes()],
        bump,
    )]
    pub pool_vault: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(ticket_price: u64, company_name: String)]
pub struct InitializeCompanyPool<'info> {
    #[account(
        init,
        payer = authority,
        space = CompanyPool::SPACE,
        seeds = [b"company_pool", company_name.as_bytes()],
        bump
    )]
    pub company_pool: Account<'info, CompanyPool>,

    /// CHECK: This is a SOL-only PDA vault that will be created manually.
    #[account(
        mut,
        seeds = [b"pool_vault", company_name.as_bytes()],
        bump
    )]
    pub pool_vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

// Data Structures
#[account]
pub struct CompanyPool {
    pub authority: Pubkey,
    pub company_name: String,
    pub company_image: String,
    pub ticket_price: u64,
    pub items: Vec<PoolItem>,
    pub total_value: u64,
    pub total_tickets_sold: u64,
    pub total_funds: u64,
    pub active: bool,
    pub created_at: i64,
}

impl CompanyPool {
    pub const SPACE: usize = 8 + 32 + 54 + 204 + 8 + 4 + (10 * 471) + 8 + 8 + 8 + 1 + 8;
}

#[account]
pub struct UserTicket {
    pub owner: Pubkey,
    pub company_pool: Pubkey,
    pub purchased_at: i64,
    pub used: bool,
    pub ticket_id: u64,
    pub won_item: Option<WonItem>, // Store the item they won
    pub reward_claimed: bool, // Track if reward has been claimed
}

impl UserTicket {
    // Updated space calculation to include new fields
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1 + 8 + 1 + (4 + 54 + 8 + 204 + 204 + 4) + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PoolItem {
    pub image: String,
    pub price: u64,
    pub name: String,
    pub description: String,
    pub probability: u32,
    pub available: bool,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PoolItemInput {
    pub image: String,
    pub price: u64,
    pub name: String,
    pub description: String,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct WonItem {
    pub name: String,
    pub price: u64,
    pub image: String,
    pub description: String,
    pub item_index: u32,
}

// Events
#[event]
pub struct RewardClaimedEvent {
    pub winner: Pubkey,
    pub ticket_id: u64,
    pub won_item: WonItem,
    pub reward_amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct SpinResultEvent {
    pub spinner: Pubkey,
    pub won_item: Option<PoolItem>,
    pub item_index: Option<u32>,
    pub item_value: u64,
    pub win_probability: u32,
    pub random_seed: u64,
    pub ticket_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct ProbabilityAnalysisEvent {
    pub item_name: String,
    pub item_value: u64,
    pub probability_basis_points: u32,
    pub expected_spins: f64,
    pub expected_cost: f64,
    pub profit: f64,
    pub profit_ratio: f64,
}

#[event]
pub struct PoolInitializedEvent {
    pub company_name: String,
    pub ticket_price: u64,
    pub item_count: u32,
    pub authority: Pubkey,
    pub total_probability_check: u32,
}

#[event]
pub struct TicketPurchasedEvent {
    pub buyer: Pubkey,
    pub ticket_price: u64,
    pub total_tickets_sold: u64,
    pub ticket_id: u64,
    pub timestamp: i64,
}

#[event]
pub struct FundsWithdrawnEvent {
    pub authority: Pubkey,
    pub amount_withdrawn: u64,
    pub remaining_funds: u64,
    pub timestamp: i64,
}

// Error Codes
#[error_code]
pub enum ErrorCode {
    #[msg("Ticket price must be greater than 0")]
    InvalidTicketPrice,
    #[msg("At least one item must be provided")]
    NoItemsProvided,
    #[msg("Company name is too long (max 50 characters)")]
    CompanyNameTooLong,
    #[msg("Company image URL is too long (max 200 characters)")]
    CompanyImageTooLong,
    #[msg("Too many items (max 10 allowed)")]
    TooManyItems,
    #[msg("Item price must be greater than 0")]
    InvalidItemPrice,
    #[msg("Item price cannot be lower than ticket price")]
    ItemPriceTooLow,
    #[msg("Item name is too long (max 50 characters)")]
    ItemNameTooLong,
    #[msg("Item image URL is too long (max 200 characters)")]
    ItemImageTooLong,
    #[msg("Item description is too long (max 200 characters)")]
    ItemDescriptionTooLong,
    #[msg("Pool is not active")]
    PoolInactive,
    #[msg("No available items to spin")]
    NoAvailableItems,
    #[msg("Unauthorized withdrawal attempt")]
    UnauthorizedWithdrawal,
    #[msg("No funds available for withdrawal")]
    NoFundsAvailable,
    #[msg("Invalid withdrawal amount")]
    InvalidAmount,
    #[msg("Insufficient funds for withdrawal")]
    InsufficientFunds,
    #[msg("Insufficient vault funds")]
    InsufficientVaultFunds,
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Invalid probability calculation")]
    InvalidProbabilityCalculation,
    #[msg("Probability sum mismatch")]
    ProbabilitySumMismatch,
    #[msg("Failed to select winning item")]
    ProbabilitySelectionFailed,
    #[msg("You don't own this ticket")]
    NotTicketOwner,
    #[msg("Ticket belongs to different pool")]
    InvalidTicketPool,
    #[msg("This ticket has already been used")]
    TicketAlreadyUsed,
    #[msg("Ticket must be used (spun) before claiming reward")]
    TicketNotUsed,
    #[msg("Reward has already been claimed")]
    RewardAlreadyClaimed,
    #[msg("No reward to claim for this ticket")]
    NoRewardToClaim,
}