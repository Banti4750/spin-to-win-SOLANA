use anchor_lang::prelude::*;

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
        require!(items.len() <= 10, ErrorCode::TooManyItems); // Limit items to prevent memory issues

        // Validate all items before processing
        for item in &items {
            require!(item.price > 0, ErrorCode::InvalidItemPrice);
            require!(item.name.len() <= 50, ErrorCode::ItemNameTooLong);
            require!(item.image.len() <= 200, ErrorCode::ItemImageTooLong);
            require!(item.description.len() <= 200, ErrorCode::ItemDescriptionTooLong);
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

        // Add items and calculate total value
        for item in items {
            pool_items.push(PoolItem {
                image: item.image,
                price: item.price,
                name: item.name,
                description: item.description,
                probability: 0, // Will be calculated later
                available: true,
            });

            total_value = total_value
                .checked_add(item.price)
                .ok_or(ErrorCode::MathOverflow)?;
        }

        company_pool.items = pool_items;
        company_pool.total_value = total_value;

        emit!(PoolInitializedEvent {
            company_name: company_pool.company_name.clone(),
            ticket_price,
            item_count: company_pool.items.len() as u32,
            authority: ctx.accounts.authority.key(),
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
        let transfer_ix = anchor_lang::system_program::Transfer {
            from: ctx.accounts.buyer.to_account_info(),
            to: ctx.accounts.pool_vault.to_account_info(),
        };
        
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_ix,
        );
        
        anchor_lang::system_program::transfer(cpi_ctx, ticket_price)?;
        
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
            timestamp: clock.unix_timestamp,
        });

        Ok(())
    }
}

#[derive(Accounts)]
pub struct BuyTicket<'info> {
    #[account(mut)]
    pub company_pool: Account<'info, CompanyPool>,
    
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
        space = CompanyPool::SPACE, // Use fixed space
        seeds = [b"company_pool", company_name.as_bytes()],
        bump
    )]
    pub company_pool: Account<'info, CompanyPool>,

    #[account(
        init,
        payer = authority,
        space = 8, // Minimal space for empty PDA
        seeds = [b"pool_vault", company_name.as_bytes()],
        bump
    )]
    /// CHECK: This is a SOL-only PDA vault. No data is read or written to it.
    /// It's only used to hold lamports and transfer them securely.
    pub pool_vault: AccountInfo<'info>,

    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct CompanyPool {
    pub authority: Pubkey,          // 32 bytes
    pub company_name: String,       // 4 + 50 bytes max
    pub company_image: String,      // 4 + 200 bytes max
    pub ticket_price: u64,          // 8 bytes
    pub items: Vec<PoolItem>,       // 4 + (max 10 items * 471 bytes each)
    pub total_value: u64,           // 8 bytes
    pub total_tickets_sold: u64,    // 8 bytes
    pub total_funds: u64,           // 8 bytes
    pub active: bool,               // 1 byte
    pub created_at: i64,            // 8 bytes
}

impl CompanyPool {
    // Fixed space calculation to prevent memory allocation issues
    // 8 (discriminator) + 32 (authority) + 54 (company_name) + 204 (company_image) 
    // + 8 (ticket_price) + 4 + (10 * 471) (items) + 8 (total_value) 
    // + 8 (total_tickets_sold) + 8 (total_funds) + 1 (active) + 8 (created_at)
    pub const SPACE: usize = 8 + 32 + 54 + 204 + 8 + 4 + (10 * 471) + 8 + 8 + 8 + 1 + 8;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PoolItem {
    pub image: String,          // 4 + 200 bytes max
    pub price: u64,             // 8 bytes
    pub name: String,           // 4 + 50 bytes max
    pub description: String,    // 4 + 200 bytes max
    pub probability: u32,       // 4 bytes
    pub available: bool,        // 1 byte
}
// Total per item: 4 + 200 + 8 + 4 + 50 + 4 + 200 + 4 + 1 = 471 bytes

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PoolItemInput {
    pub image: String,
    pub price: u64,
    pub name: String,
    pub description: String,
}

#[event]
pub struct PoolInitializedEvent {
    pub company_name: String,
    pub ticket_price: u64,
    pub item_count: u32,
    pub authority: Pubkey,
}

#[event]
pub struct TicketPurchasedEvent {
    pub buyer: Pubkey,
    pub ticket_price: u64,
    pub total_tickets_sold: u64,
    pub timestamp: i64,
}

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
    #[msg("Item price must be greater than 0")]
    InvalidItemPrice,
    #[msg("Item name is too long (max 50 characters)")]
    ItemNameTooLong,
    #[msg("Item image URL is too long (max 200 characters)")]
    ItemImageTooLong,
    #[msg("Item description is too long (max 200 characters)")]
    ItemDescriptionTooLong,
    #[msg("Too many items provided (max 10 items)")]
    TooManyItems,
    #[msg("Math overflow occurred")]
    MathOverflow,
    #[msg("Pool is not active")]
    PoolInactive,
}