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
    price: new anchor.BN(10),
    name: "Item1",
    description: "Test item 1"
  };

  const item2 = {
    image: "https://test.com/item2.png", 
    price: new anchor.BN(50),
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
      // assert.ok(data.items[0].price.eq(new anchor.BN(50000)));
      // The probability is calculated by the contract and will not be 0
      // It's based on the weighted algorithm in probability.rs
      assert.ok(data.items[0].probability > 0);
      assert.ok(data.items[0].available);
      
      assert.equal(data.items[1].name, "Item2");
      assert.equal(data.items[1].description, "Test item 2");
      // assert.ok(data.items[1].price.eq(new anchor.BN(10000)));
      // The probability is calculated by the contract and will not be 0
      // It's based on the weighted algorithm in probability.rs
      assert.ok(data.items[1].probability > 0);
      assert.ok(data.items[1].available);
      
      // Check calculated values
      // assert.ok(data.totalValue.eq(new anchor.BN(60000))); // 50000 + 10000
      assert.ok(data.totalTicketsSold.eq(new anchor.BN(0)));
      assert.ok(data.totalFunds.eq(new anchor.BN(0)));
      
      console.log("✅ CompanyPool initialized successfully!");
      console.log("📊 Company Name:", data.companyName);
      console.log("💰 Ticket Price:", data.ticketPrice.toString());
      console.log("📈 Total Value:", data.totalValue.toString());
      console.log("📦 Items Count:", data.items.length);
      console.log("🏢 Authority:", data.authority.toString());
      console.log("📅 Created At:", new Date(data.createdAt.toNumber() * 1000));
      console.log("probablty of item0"  , data.items[0].probability)
      console.log("probablty of item0"  , data.items[1].probability)
      
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

   it("Buys a ticket successfully", async () => {
    try {
      // Get initial balances
      const buyerInitialBalance = await connection.getBalance(provider.wallet.publicKey);
      const vaultInitialBalance = await connection.getBalance(poolVaultPda);
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      
      console.log("💰 Initial buyer balance:", buyerInitialBalance / LAMPORTS_PER_SOL, "SOL");
      console.log("🏦 Initial vault balance:", vaultInitialBalance / LAMPORTS_PER_SOL, "SOL");
      console.log("🎫 Initial tickets sold:", poolDataBefore.totalTicketsSold.toString());
      console.log("💵 Initial total funds:", poolDataBefore.totalFunds.toString());

      // Buy a ticket
      const tx = await program.methods
        .buyTicket()
        .accounts({
          companyPool: companyPoolPda,
          buyer: provider.wallet.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("🎫 Buy ticket transaction signature:", tx);

      // Wait for transaction confirmation
      await provider.connection.confirmTransaction(tx);

      // Get final balances and pool data
      const buyerFinalBalance = await connection.getBalance(provider.wallet.publicKey);
      const vaultFinalBalance = await connection.getBalance(poolVaultPda);
      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);

      console.log("💰 Final buyer balance:", buyerFinalBalance / LAMPORTS_PER_SOL, "SOL");
      console.log("🏦 Final vault balance:", vaultFinalBalance / LAMPORTS_PER_SOL, "SOL");
      console.log("🎫 Final tickets sold:", poolDataAfter.totalTicketsSold.toString());
      console.log("💵 Final total funds:", poolDataAfter.totalFunds.toString());

      // Assertions
      // Check that tickets sold increased by 1
      assert.ok(
        poolDataAfter.totalTicketsSold.eq(poolDataBefore.totalTicketsSold.add(new anchor.BN(1))),
        "Total tickets sold should increase by 1"
      );

      // Check that total funds increased by ticket price
      assert.ok(
        poolDataAfter.totalFunds.eq(poolDataBefore.totalFunds.add(ticketPrice)),
        "Total funds should increase by ticket price"
      );

      // Check that vault received the funds
      assert.ok(
        vaultFinalBalance >= vaultInitialBalance + ticketPrice.toNumber(),
        "Vault should receive the ticket price"
      );

      // Check that buyer's balance decreased (approximately by ticket price + transaction fees)
      const balanceDifference = buyerInitialBalance - buyerFinalBalance;
      assert.ok(
        balanceDifference >= ticketPrice.toNumber(),
        "Buyer balance should decrease by at least ticket price"
      );

      // Check that pool is still active
      assert.ok(poolDataAfter.active, "Pool should remain active");

      console.log("✅ Ticket purchased successfully!");
      console.log("📊 Balance difference:", balanceDifference / LAMPORTS_PER_SOL, "SOL");
      console.log("🎫 New total tickets:", poolDataAfter.totalTicketsSold.toString());
      console.log("💰 New total funds:", poolDataAfter.totalFunds.toString());

    } catch (error) {
      console.error("❌ Error buying ticket:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      console.error("Full error:", error);
      throw error;
    }
  });

  it("Buys multiple tickets", async () => {
    try {
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      const initialTicketsSold = poolDataBefore.totalTicketsSold;
      const initialTotalFunds = poolDataBefore.totalFunds;

      console.log("🎫 Starting tickets sold:", initialTicketsSold.toString());

      // Buy 3 more tickets
      for (let i = 0; i < 3; i++) {
        const tx = await program.methods
          .buyTicket()
          .accounts({
            companyPool: companyPoolPda,
            buyer: provider.wallet.publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        await provider.connection.confirmTransaction(tx);
        console.log(`🎫 Bought ticket ${i + 1}/3, tx: ${tx}`);
      }

      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);

      // Assertions
      assert.ok(
        poolDataAfter.totalTicketsSold.eq(initialTicketsSold.add(new anchor.BN(3))),
        "Should have 3 more tickets sold"
      );

      assert.ok(
        poolDataAfter.totalFunds.eq(initialTotalFunds.add(ticketPrice.mul(new anchor.BN(3)))),
        "Total funds should increase by 3x ticket price"
      );

      console.log("✅ Multiple tickets purchased successfully!");
      console.log("🎫 Final tickets sold:", poolDataAfter.totalTicketsSold.toString());
      console.log("💰 Final total funds:", poolDataAfter.totalFunds.toString());

    } catch (error) {
      console.error("❌ Error buying multiple tickets:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      throw error;
    }
  });

  it("Fails to buy ticket with insufficient funds", async () => {
    try {
      // Create a new keypair with no funds
      const poorBuyer = anchor.web3.Keypair.generate();

      // Try to buy a ticket (should fail)
      await program.methods
        .buyTicket()
        .accounts({
          companyPool: companyPoolPda,
          buyer: poorBuyer.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([poorBuyer])
        .rpc();

      // If we reach here, the test should fail
      assert.fail("Transaction should have failed due to insufficient funds");

    } catch (error) {
      // This is expected - the transaction should fail
      console.log("✅ Correctly failed with insufficient funds");
      assert.ok(error.toString().includes("insufficient"), "Should fail with insufficient funds error");
    }
  });

  it("Verifies vault accumulates funds correctly", async () => {
    const poolData = await program.account.companyPool.fetch(companyPoolPda);
    const vaultBalance = await connection.getBalance(poolVaultPda);

    console.log("🏦 Vault balance:", vaultBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("📊 Pool total funds:", poolData.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("🎫 Total tickets sold:", poolData.totalTicketsSold.toString());

    // The vault balance should match the pool's total funds (accounting for rent)
    const expectedFunds = poolData.totalFunds.toNumber();
    assert.ok(
      vaultBalance >= expectedFunds,
      `Vault balance (${vaultBalance}) should be at least total funds (${expectedFunds})`
    );

    console.log("✅ Vault funds verification passed!");
  });



  it("Successfully withdraws funds as authority", async () => {
    try {
      // Get initial state
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      const authorityBalanceBefore = await connection.getBalance(provider.wallet.publicKey);
      const vaultBalanceBefore = await connection.getBalance(poolVaultPda);

      const withdrawAmount = new anchor.BN(0.5 * LAMPORTS_PER_SOL); // Withdraw 0.5 SOL

      console.log("📊 Initial State:");
      console.log("   Pool total funds:", poolDataBefore.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
      console.log("   Authority balance:", authorityBalanceBefore / LAMPORTS_PER_SOL, "SOL");
      console.log("   Vault balance:", vaultBalanceBefore / LAMPORTS_PER_SOL, "SOL");
      console.log("   Withdraw amount:", withdrawAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");

      // Perform withdrawal
      const tx = await program.methods
        .withdrawFundsFromVault(withdrawAmount)
        .accounts({
          companyPool: companyPoolPda,
          authority: provider.wallet.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("💰 Withdrawal transaction:", tx);
      await provider.connection.confirmTransaction(tx);

      // Get final state
      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);
      const authorityBalanceAfter = await connection.getBalance(provider.wallet.publicKey);
      const vaultBalanceAfter = await connection.getBalance(poolVaultPda);

      console.log("📊 Final State:");
      console.log("   Pool total funds:", poolDataAfter.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
      console.log("   Authority balance:", authorityBalanceAfter / LAMPORTS_PER_SOL, "SOL");
      console.log("   Vault balance:", vaultBalanceAfter / LAMPORTS_PER_SOL, "SOL");

      // Assertions
      // Pool total funds should decrease by withdrawal amount
      assert.ok(
        poolDataAfter.totalFunds.eq(poolDataBefore.totalFunds.sub(withdrawAmount)),
        "Pool total funds should decrease by withdrawal amount"
      );

      // Vault balance should decrease by withdrawal amount
      assert.ok(
        vaultBalanceAfter <= vaultBalanceBefore - withdrawAmount.toNumber(),
        "Vault balance should decrease by withdrawal amount"
      );

      // Authority balance should increase (minus transaction fees)
      const balanceIncrease = authorityBalanceAfter - authorityBalanceBefore;
      assert.ok(
        balanceIncrease > 0,
        "Authority balance should increase"
      );

      // Pool should remain active
      assert.ok(poolDataAfter.active, "Pool should remain active");

      console.log("✅ Withdrawal successful!");
      console.log("   Amount withdrawn:", withdrawAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
      console.log("   Authority balance increase:", balanceIncrease / LAMPORTS_PER_SOL, "SOL");

    } catch (error) {
      console.error("❌ Error withdrawing funds:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      console.error("Full error:", error);
      throw error;
    }
  });

   it("Fails to withdraw zero amount", async () => {
    try {
      console.log("🚫 Attempting to withdraw zero amount");

      await program.methods
        .withdrawFundsFromVault(new anchor.BN(0))
        .accounts({
          companyPool: companyPoolPda,
          authority: provider.wallet.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      assert.fail("Should have failed due to zero withdrawal amount");

    } catch (error) {
      console.log("✅ Correctly failed with zero withdrawal amount");
      assert.ok(
        error.toString().includes("InvalidAmount"),
        "Should fail with invalid amount error"
      );
    }
  });

  it("Fails when unauthorized user tries to withdraw", async () => {
    try {
      // Create a new keypair (unauthorized user)
      const unauthorizedUser = web3.Keypair.generate();
     
      
      // Airdrop some SOL for transaction fees
      const airdropSig = await connection.requestAirdrop(
        unauthorizedUser.publicKey,
        0.1 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig);

      console.log("🚫 Unauthorized user attempting withdrawal");
      console.log("   Unauthorized user:", unauthorizedUser.publicKey.toString());

      await program.methods
        .withdrawFundsFromVault(new anchor.BN(0.1 * LAMPORTS_PER_SOL))
        .accounts({
          companyPool: companyPoolPda,
          authority: unauthorizedUser.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([unauthorizedUser])
        .rpc();

      assert.fail("Should have failed due to unauthorized access");

    } catch (error) {
      console.log("✅ Correctly failed with unauthorized user");
      assert.ok(
        error.toString().includes("UnauthorizedWithdrawal") ||
        error.toString().includes("has_one"),
        "Should fail with unauthorized error"
      );
    }
  });

  it("Withdraws remaining funds completely", async () => {
    try {
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      const vaultBalanceBefore = await connection.getBalance(poolVaultPda);
      
      // Calculate rent exemption minimum
      const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(8);
      const withdrawableAmount = Math.max(0, vaultBalanceBefore - rentExemptAmount);

      console.log("💰 Withdrawing remaining funds:");
      console.log("   Vault balance:", vaultBalanceBefore / LAMPORTS_PER_SOL, "SOL");
      console.log("   Rent exempt minimum:", rentExemptAmount / LAMPORTS_PER_SOL, "SOL");
      console.log("   Withdrawable amount:", withdrawableAmount / LAMPORTS_PER_SOL, "SOL");

      if (withdrawableAmount > 0) {
        const tx = await program.methods
          .withdrawFundsFromVault(new anchor.BN(withdrawableAmount))
          .accounts({
            companyPool: companyPoolPda,
            authority: provider.wallet.publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        await provider.connection.confirmTransaction(tx);

        const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);
        const vaultBalanceAfter = await connection.getBalance(poolVaultPda);

        console.log("📊 After complete withdrawal:");
        console.log("   Pool total funds:", poolDataAfter.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
        console.log("   Vault balance:", vaultBalanceAfter / LAMPORTS_PER_SOL, "SOL");

        // Vault should only have rent exemption left
        assert.ok(
          vaultBalanceAfter >= rentExemptAmount,
          "Vault should maintain rent exemption"
        );

        // Pool funds should be updated accordingly
        assert.ok(
          poolDataAfter.totalFunds.toNumber() < poolDataBefore.totalFunds.toNumber(),
          "Pool funds should decrease"
        );

        console.log("✅ Complete withdrawal successful!");
      } else {
        console.log("ℹ️ No withdrawable funds remaining");
      }

    } catch (error) {
      console.error("❌ Error in complete withdrawal:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      throw error;
    }
  });

  it("Verifies final state consistency", async () => {
    const poolData = await program.account.companyPool.fetch(companyPoolPda);
    const vaultBalance = await connection.getBalance(poolVaultPda);
    const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(8);

    console.log("🔍 Final verification:");
    console.log("   Pool active:", poolData.active);
    console.log("   Pool total funds:", poolData.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("   Vault balance:", vaultBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("   Tickets sold:", poolData.totalTicketsSold.toString());

    // Pool should still be active
    assert.ok(poolData.active, "Pool should remain active");

    // Vault should maintain minimum rent exemption
    assert.ok(
      vaultBalance >= rentExemptAmount,
      "Vault should maintain rent exemption"
    );

    // Pool accounting should be consistent
    assert.ok(
      poolData.totalFunds.toNumber() >= 0,
      "Pool total funds should not be negative"
    );

    console.log("✅ Final state verification passed!");
  });

});
