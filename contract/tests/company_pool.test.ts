import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3, setProvider } from "@coral-xyz/anchor";
import { CompanyPool } from "../target/types/company_pool";
import { assert } from "chai";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("company_pool", () => {
  // Configure the client to use the local cluster.
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.CompanyPool as Program<CompanyPool>;
  const wallet = provider.wallet;
  const connection = provider.connection;
  
  let companyPoolPda: PublicKey;
  let poolVaultPda: PublicKey;
  let bump: number;
  let vaultBump: number;

  // Use shorter strings to reduce memory usage
  const companyName = "TestCorp";
  const companyImage = "https://test.com/img.png";
  const ticketPrice = new anchor.BN(1 * LAMPORTS_PER_SOL); // Reduced from 2 SOL
  
  // Simplified items with shorter strings
  const item1 = {
    image: "https://test.com/item1.png",
    price: new anchor.BN(50),
    name: "Item1",
    description: "Test item 1"
  };

  const item2 = {
    image: "https://test.com/item2.png", 
    price: new anchor.BN(100),
    name: "Item2",
    description: "Test item 2"
  };

  it("Airdrops SOL to wallet", async () => {
    const sig = await provider.connection.requestAirdrop(
      provider.wallet.publicKey,
      5 * LAMPORTS_PER_SOL // Increase airdrop amount
    );
    await provider.connection.confirmTransaction(sig);
    
    // Wait a bit to ensure the airdrop is processed
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it("Derives PDA for CompanyPool", async () => {
    [companyPoolPda, bump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("company_pool"), Buffer.from(companyName)],
      program.programId
    );

    // Also derive the pool vault PDA
    [poolVaultPda, vaultBump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), Buffer.from(companyName)],
      program.programId
    );

    console.log("Company Pool PDA:", companyPoolPda.toString());
    console.log("Pool Vault PDA:", poolVaultPda.toString());
  });

  it("Initializes the CompanyPool", async () => {
    try {
      // Check wallet balance before transaction
      const balance = await provider.connection.getBalance(provider.wallet.publicKey);
      console.log("Wallet balance before tx:", balance / LAMPORTS_PER_SOL, "SOL");

      const tx = await program.methods
        .initializeCompanyPool(
          ticketPrice,        // First parameter: ticket_price (u64)
          companyName,        // Second parameter: company_name (String)
          companyImage,       // Third parameter: company_image (String)
          [item1, item2]      // Fourth parameter: items (Vec<PoolItemInput>)
        )
        .accounts({
          companyPool: companyPoolPda,
          poolVault: poolVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("Transaction signature:", tx);

      // Wait for transaction confirmation
      await provider.connection.confirmTransaction(tx);

      const data = await program.account.companyPool.fetch(companyPoolPda);
      
      // Assertions
      assert.equal(data.companyName, companyName);
      assert.equal(data.companyImage, companyImage);
      assert.equal(data.items.length, 2);
      assert.ok(data.active);
      assert.ok(data.ticketPrice.eq(ticketPrice));
      assert.equal(data.authority.toString(), provider.wallet.publicKey.toString());
      
      // Check items
      assert.equal(data.items[0].name, "Item1");
      assert.equal(data.items[0].description, "Test item 1");
      assert.ok(data.items[0].price.eq(new anchor.BN(50)));
      assert.equal(data.items[0].probability, 0);
      assert.ok(data.items[0].available);
      
      assert.equal(data.items[1].name, "Item2");
      assert.equal(data.items[1].description, "Test item 2");
      assert.ok(data.items[1].price.eq(new anchor.BN(100)));
      assert.equal(data.items[1].probability, 0);
      assert.ok(data.items[1].available);
      
      // Check calculated values
      assert.ok(data.totalValue.eq(new anchor.BN(150))); // 50 + 100
      assert.ok(data.totalTicketsSold.eq(new anchor.BN(0)));
      assert.ok(data.totalFunds.eq(new anchor.BN(0)));
      
      console.log("✅ CompanyPool initialized successfully!");
      console.log("📊 Company Name:", data.companyName);
      console.log("💰 Ticket Price:", data.ticketPrice.toString());
      console.log("📈 Total Value:", data.totalValue.toString());
      console.log("📦 Items Count:", data.items.length);
      console.log("🏢 Authority:", data.authority.toString());
      console.log("📅 Created At:", new Date(data.createdAt.toNumber() * 1000));
      
    } catch (error) {
      console.error("❌ Error initializing CompanyPool:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      console.error("Full error:", error);
      throw error;
    }
  });

  it("Checks account data integrity", async () => {
    const data = await program.account.companyPool.fetch(companyPoolPda);
    
    // Additional integrity checks
    assert.ok(data.createdAt.gt(new anchor.BN(0)), "Created timestamp should be set");
    assert.equal(data.items.length, 2, "Should have exactly 2 items");
    assert.ok(data.totalValue.gt(new anchor.BN(0)), "Total value should be greater than 0");
    
    console.log("✅ All integrity checks passed!");
  });
});