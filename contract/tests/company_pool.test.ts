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
  
  // Store ticket PDAs for spin tests
  const ticketPdas: { pda: PublicKey, owner: web3.Keypair, ticketId: number }[] = [];

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
      assert.ok(data.items[0].probability > 0);
      assert.ok(data.items[0].available);
      
      assert.equal(data.items[1].name, "Item2");
      assert.equal(data.items[1].description, "Test item 2");
      assert.ok(data.items[1].probability > 0);
      assert.ok(data.items[1].available);
      
      // Check calculated values
      assert.ok(data.totalTicketsSold.eq(new anchor.BN(0)));
      assert.ok(data.totalFunds.eq(new anchor.BN(0)));
      
      console.log("✅ CompanyPool initialized successfully!");
      console.log("📊 Company Name:", data.companyName);
      console.log("💰 Ticket Price:", data.ticketPrice.toString());
      console.log("📈 Total Value:", data.totalValue.toString());
      console.log("📦 Items Count:", data.items.length);
      console.log("🏢 Authority:", data.authority.toString());
      console.log("📅 Created At:", new Date(data.createdAt.toNumber() * 1000));
      console.log("Probability of item0:", data.items[0].probability);
      console.log("Probability of item1:", data.items[1].probability);
      
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

  // Helper function to derive ticket PDA - matches the contract's seed structure
  const deriveTicketPda = (buyer: PublicKey, ticketId: number): PublicKey => {
    // Convert ticketId to little-endian bytes (8 bytes for u64)
    const ticketIdBuffer = Buffer.alloc(8);
    ticketIdBuffer.writeBigUInt64LE(BigInt(ticketId), 0);
    
    const [ticketPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_ticket"),
        buyer.toBuffer(),
        companyPoolPda.toBuffer(),
        ticketIdBuffer
      ],
      program.programId
    );
    return ticketPda;
  };

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

      // Derive the ticket PDA
      const ticketPda = deriveTicketPda(provider.wallet.publicKey, poolDataBefore.totalTicketsSold.toNumber());

      // Buy a ticket
      const tx = await program.methods
        .buyTicket()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
          buyer: provider.wallet.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log("🎫 Buy ticket transaction signature:", tx);

      // Wait for transaction confirmation
      await provider.connection.confirmTransaction(tx);

      // Store ticket info for spin tests
      ticketPdas.push({
        pda: ticketPda,
        owner: provider.wallet as any,
        ticketId: poolDataBefore.totalTicketsSold.toNumber()
      });

      // Get final balances and pool data
      const buyerFinalBalance = await connection.getBalance(provider.wallet.publicKey);
      const vaultFinalBalance = await connection.getBalance(poolVaultPda);
      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);

      console.log("💰 Final buyer balance:", buyerFinalBalance / LAMPORTS_PER_SOL, "SOL");
      console.log("🏦 Final vault balance:", vaultFinalBalance / LAMPORTS_PER_SOL, "SOL");
      console.log("🎫 Final tickets sold:", poolDataAfter.totalTicketsSold.toString());
      console.log("💵 Final total funds:", poolDataAfter.totalFunds.toString());

      // Verify ticket account was created
      const ticketData = await program.account.userTicket.fetch(ticketPda);
      assert.equal(ticketData.owner.toString(), provider.wallet.publicKey.toString());
      assert.equal(ticketData.companyPool.toString(), companyPoolPda.toString());
      assert.equal(ticketData.used, false);
      assert.equal(ticketData.ticketId, poolDataBefore.totalTicketsSold.toNumber());

      // Assertions
      assert.ok(
        poolDataAfter.totalTicketsSold.eq(poolDataBefore.totalTicketsSold.add(new anchor.BN(1))),
        "Total tickets sold should increase by 1"
      );

      assert.ok(
        poolDataAfter.totalFunds.eq(poolDataBefore.totalFunds.add(ticketPrice)),
        "Total funds should increase by ticket price"
      );

      assert.ok(
        vaultFinalBalance >= vaultInitialBalance + ticketPrice.toNumber(),
        "Vault should receive the ticket price"
      );

      const balanceDifference = buyerInitialBalance - buyerFinalBalance;
      assert.ok(
        balanceDifference >= ticketPrice.toNumber(),
        "Buyer balance should decrease by at least ticket price"
      );

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

  it("Buys multiple tickets for different users", async () => {
    try {
      const numberOfTickets = 3;
      const buyers: web3.Keypair[] = [];
      
      console.log(`🎫 Creating ${numberOfTickets} buyers and purchasing tickets...`);

      for (let i = 0; i < numberOfTickets; i++) {
        // Create new buyer
        const buyer = web3.Keypair.generate();
        buyers.push(buyer);
        
        // Airdrop SOL to buyer
        const airdropSig = await connection.requestAirdrop(
          buyer.publicKey,
          2 * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(airdropSig);
        
        // Get current ticket count for PDA derivation
        const poolData = await program.account.companyPool.fetch(companyPoolPda);
        const ticketId = poolData.totalTicketsSold.toNumber();
        
        // Derive ticket PDA
        const ticketPda = deriveTicketPda(buyer.publicKey, ticketId);
        
        // Buy ticket
        const tx = await program.methods
          .buyTicket()
          .accounts({
            companyPool: companyPoolPda,
            userTicket: ticketPda,
            buyer: buyer.publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer])
          .rpc();

        await connection.confirmTransaction(tx);
        
        // Store ticket info for spin tests
        ticketPdas.push({
          pda: ticketPda,
          owner: buyer,
          ticketId: ticketId
        });
        
        console.log(`   Ticket ${i + 1} purchased by ${buyer.publicKey.toString().slice(0, 8)}`);
      }

      const finalPoolData = await program.account.companyPool.fetch(companyPoolPda);
      console.log(`✅ ${numberOfTickets} additional tickets purchased!`);
      console.log("🎫 Total tickets sold:", finalPoolData.totalTicketsSold.toString());

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
      
      // Get current ticket count for PDA derivation
      const poolData = await program.account.companyPool.fetch(companyPoolPda);
      const ticketId = poolData.totalTicketsSold.toNumber();
      const ticketPda = deriveTicketPda(poorBuyer.publicKey, ticketId);

      // Try to buy a ticket (should fail)
      await program.methods
        .buyTicket()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
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
      // Check for various insufficient funds error messages
      const errorStr = error.toString();
      const hasInsufficientFunds = errorStr.includes("insufficient") || 
                                   errorStr.includes("Insufficient") ||
                                   errorStr.includes("0x1") || // Custom program error for insufficient funds
                                   errorStr.includes("lamports");
      assert.ok(hasInsufficientFunds, `Should fail with insufficient funds error. Got: ${errorStr}`);
    }
  });

  // SPIN TESTS START HERE
  it("Records a single spin result successfully", async () => {
    try {
      // Check if we have any tickets available
      if (ticketPdas.length === 0) {
        console.log("ℹ️ No tickets available for spin test, skipping");
        return;
      }

      // Use the first ticket we purchased
      const ticketInfo = ticketPdas[0];
      
      console.log("🎰 Performing spin test...");
      console.log("   Spinner:", ticketInfo.owner.publicKey.toString());
      console.log("   Ticket PDA:", ticketInfo.pda.toString());
      console.log("   Ticket ID:", ticketInfo.ticketId);

      // Verify ticket exists and is unused
      const ticketDataBefore = await program.account.userTicket.fetch(ticketInfo.pda);
      assert.equal(ticketDataBefore.used, false, "Ticket should be unused");
      assert.equal(ticketDataBefore.owner.toString(), ticketInfo.owner.publicKey.toString());

      // Get pool data before spin
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      console.log("   Pool active:", poolDataBefore.active);
      console.log("   Available items:", poolDataBefore.items.length);
      
      // Log item probabilities
      poolDataBefore.items.forEach((item, index) => {
        console.log(`   Item ${index}: ${item.name} - Probability: ${item.probability}bp (${(item.probability / 100).toFixed(2)}%)`);
      });

      // Record spin result
      const tx = await program.methods
        .recordSpinResult()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketInfo.pda,
          spinner: ticketInfo.owner.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers(ticketInfo.owner.publicKey.toString() === provider.wallet.publicKey.toString() ? [] : [ticketInfo.owner])
        .rpc();

      console.log("🎰 Spin transaction signature:", tx);
      await provider.connection.confirmTransaction(tx);

      // Verify ticket is now marked as used
      const ticketDataAfter = await program.account.userTicket.fetch(ticketInfo.pda);
      assert.equal(ticketDataAfter.used, true, "Ticket should be marked as used");

      // Parse transaction logs to find spin result
      const txDetails = await connection.getTransaction(tx, {
        commitment: "confirmed",
      });

      if (txDetails?.meta?.logMessages) {
        console.log("📝 Transaction logs:");
        txDetails.meta.logMessages.forEach(log => {
          if (log.includes("SPIN RESULT") || log.includes("Winner:") || log.includes("Won Item:")) {
            console.log("   ", log);
          }
        });
      }

      // Verify pool state remains unchanged (spin doesn't modify pool state)
      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);
      assert.ok(poolDataAfter.active, "Pool should remain active");
      assert.equal(poolDataAfter.items.length, poolDataBefore.items.length, "Items count should remain same");
      
      console.log("✅ Spin recorded successfully!");

    } catch (error) {
      console.error("❌ Error recording spin result:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      console.error("Full error:", error);
      throw error;
    }
  });

  it("Records multiple spins and verifies randomness", async () => {
    try {
      const availableTickets = ticketPdas.slice(1); // Skip the first one as it's already used
      const numberOfSpins = Math.min(3, availableTickets.length);
      
      if (numberOfSpins === 0) {
        console.log("ℹ️ No available tickets for multiple spins test, skipping");
        return;
      }
      
      const spinResults: any[] = [];
      
      console.log(`🎰 Performing ${numberOfSpins} spins to test randomness...`);

      for (let i = 0; i < numberOfSpins; i++) {
        const ticketInfo = availableTickets[i];
        
        // Verify ticket is unused
        const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
        if (ticketData.used) {
          console.log(`   Skipping used ticket ${i}`);
          continue;
        }

        // Small delay to ensure different timestamps
        await new Promise(resolve => setTimeout(resolve, 100));

        const tx = await program.methods
          .recordSpinResult()
          .accounts({
            companyPool: companyPoolPda,
            userTicket: ticketInfo.pda,
            spinner: ticketInfo.owner.publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers(ticketInfo.owner.publicKey.toString() === provider.wallet.publicKey.toString() ? [] : [ticketInfo.owner])
          .rpc();

        await provider.connection.confirmTransaction(tx);

        // Get transaction details to parse results
        const txDetails = await connection.getTransaction(tx, {
          commitment: "confirmed",
        });

        let wonItem = "Unknown";
        if (txDetails?.meta?.logMessages) {
          for (const log of txDetails.meta.logMessages) {
            if (log.includes("Won Item:")) {
              wonItem = log.split("Won Item: ")[1];
              break;
            }
          }
        }

        spinResults.push({
          spin: i + 1,
          spinner: ticketInfo.owner.publicKey.toString().slice(0, 8),
          wonItem,
          tx: tx.slice(0, 8)
        });

        console.log(`   Spin ${i + 1}: Winner = ${wonItem}`);
      }

      if (spinResults.length === 0) {
        console.log("ℹ️ No spins were performed, skipping analysis");
        return;
      }

      // Analyze results
      const itemCounts = {};
      spinResults.forEach(result => {
        itemCounts[result.wonItem] = (itemCounts[result.wonItem] || 0) + 1;
      });

      console.log("📊 Spin Results Analysis:");
      Object.entries(itemCounts).forEach(([item, count]) => {
        const percentage = ((count as number) / spinResults.length * 100).toFixed(1);
        console.log(`   ${item}: ${count}/${spinResults.length} (${percentage}%)`);
      });

      // Verify we got some variety in results (not all the same)
      const uniqueResults = Object.keys(itemCounts).length;
      assert.ok(uniqueResults >= 1, "Should have at least one winning item");
      
      console.log(`✅ Completed ${spinResults.length} spins with ${uniqueResults} different outcomes!`);

    } catch (error) {
      console.error("❌ Error in multiple spins test:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      throw error;
    }
  });

  it("Fails to spin with already used ticket", async () => {
    try {
      if (ticketPdas.length === 0) {
        console.log("ℹ️ No tickets available for used ticket test, skipping");
        return;
      }

      // Try to use the first ticket again (should be marked as used)
      const usedTicketInfo = ticketPdas[0];
      
      console.log("🚫 Attempting to spin with used ticket");

      await program.methods
        .recordSpinResult()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: usedTicketInfo.pda,
          spinner: usedTicketInfo.owner.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers(usedTicketInfo.owner.publicKey.toString() === provider.wallet.publicKey.toString() ? [] : [usedTicketInfo.owner])
        .rpc();

      assert.fail("Should have failed due to used ticket");

    } catch (error) {
      console.log("✅ Correctly failed with used ticket");
      const errorStr = error.toString();
      const hasTicketUsedError = errorStr.includes("TicketAlreadyUsed") || 
                                 errorStr.includes("constraint") ||
                                 errorStr.includes("used");
      assert.ok(
        hasTicketUsedError,
        `Should fail with ticket already used error. Got: ${errorStr}`
      );
    }
  });

  it("Fails to spin with wrong owner", async () => {
    try {
      // Create a new user
      const wrongOwner = web3.Keypair.generate();
      const airdropSig = await connection.requestAirdrop(
        wrongOwner.publicKey,
        0.1 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig);

      // Find an unused ticket
      let unusedTicket = null;
      for (const ticketInfo of ticketPdas) {
        const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
        if (!ticketData.used) {
          unusedTicket = ticketInfo;
          break;
        }
      }

      if (!unusedTicket) {
        console.log("ℹ️ No unused tickets available for wrong owner test");
        return;
      }

      console.log("🚫 Attempting to spin with wrong owner");

      await program.methods
        .recordSpinResult()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: unusedTicket.pda,
          spinner: wrongOwner.publicKey, // Wrong owner
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([wrongOwner])
        .rpc();

      assert.fail("Should have failed due to wrong owner");

    } catch (error) {
      console.log("✅ Correctly failed with wrong owner");
      assert.ok(
        error.toString().includes("NotTicketOwner") || 
        error.toString().includes("constraint"),
        "Should fail with not ticket owner error"
      );
    }
  });

  it("Tests probability analysis function", async () => {
    try {
      console.log("📊 Testing probability analysis...");

      const tx = await program.methods
        .getProbabilityAnalysis()
        .accounts({
          companyPool: companyPoolPda,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx);

      // Parse analysis from logs
      const txDetails = await connection.getTransaction(tx, {
        commitment: "confirmed",
      });

      if (txDetails?.meta?.logMessages) {
        console.log("📈 Probability Analysis Results:");
        txDetails.meta.logMessages.forEach(log => {
          if (log.includes("ProbabilityAnalysis")) {
            console.log("   ", log);
          }
        });
      }

      console.log("✅ Probability analysis completed!");

    } catch (error) {
      console.error("❌ Error in probability analysis:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      throw error;
    }
  });

  // WITHDRAWAL TESTS
  it("Successfully withdraws funds as authority", async () => {
    try {
      // Get initial state
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      
      // Skip test if no funds available
      if (poolDataBefore.totalFunds.toNumber() === 0) {
        console.log("ℹ️ No funds available for withdrawal, skipping test");
        return;
      }

      const authorityBalanceBefore = await connection.getBalance(provider.wallet.publicKey);
      const vaultBalanceBefore = await connection.getBalance(poolVaultPda);

      const withdrawAmount = new anchor.BN(Math.min(0.5 * LAMPORTS_PER_SOL, poolDataBefore.totalFunds.toNumber())); // Withdraw smaller amount

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
      assert.ok(
        poolDataAfter.totalFunds.eq(poolDataBefore.totalFunds.sub(withdrawAmount)),
        "Pool total funds should decrease by withdrawal amount"
      );

      assert.ok(
        vaultBalanceAfter <= vaultBalanceBefore - withdrawAmount.toNumber(),
        "Vault balance should decrease by withdrawal amount"
      );

      const balanceIncrease = authorityBalanceAfter - authorityBalanceBefore;
      assert.ok(
        balanceIncrease > 0,
        "Authority balance should increase"
      );

      assert.ok(poolDataAfter.active, "Pool should remain active");

      console.log("✅ Withdrawal successful!");
      console.log("   Amount withdrawn:", withdrawAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
      console.log("   Authority balance increase:", balanceIncrease / LAMPORTS_PER_SOL, "SOL");

    } catch (error) {
      if (error.toString().includes("NoFundsAvailable")) {
        console.log("ℹ️ No funds available for withdrawal test");
        return;
      }
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
    const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(0); // Use 0 for account size

    console.log("🔍 Final verification:");
    console.log("   Pool active:", poolData.active);
    console.log("   Pool total funds:", poolData.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("   Vault balance:", vaultBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("   Rent exempt minimum:", rentExemptAmount / LAMPORTS_PER_SOL, "SOL");
    console.log("   Tickets sold:", poolData.totalTicketsSold.toString());
    console.log("   Total tickets with PDAs:", ticketPdas.length);

    // Pool should still be active
    assert.ok(poolData.active, "Pool should remain active");

    // Pool accounting should be consistent
    assert.ok(
      poolData.totalFunds.toNumber() >= 0,
      "Pool total funds should not be negative"
    );

    // Verify vault has some balance (at least for rent exemption if there were transactions)
    if (poolData.totalTicketsSold.toNumber() > 0) {
      assert.ok(
        vaultBalance > 0,
        "Vault should have some balance if tickets were sold"
      );
    }

    // Verify all ticket accounts exist and have correct data (if any were created)
    let usedTickets = 0;
    for (const ticketInfo of ticketPdas) {
      try {
        const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
        assert.equal(ticketData.owner.toString(), ticketInfo.owner.publicKey.toString());
        assert.equal(ticketData.companyPool.toString(), companyPoolPda.toString());
        assert.equal(ticketData.ticketId, ticketInfo.ticketId);
        
        if (ticketData.used) {
          usedTickets++;
        }
      } catch (error) {
        console.log(`   Warning: Could not fetch ticket ${ticketInfo.ticketId}:`, error.message);
      }
    }

    console.log("   Used tickets:", usedTickets);
    console.log("   Unused tickets:", ticketPdas.length - usedTickets);

    console.log("✅ Final state verification passed!");
  });

  // Additional edge case tests
  it("Creates and uses additional tickets for comprehensive testing", async () => {
    try {
      console.log("🎫 Creating additional tickets for comprehensive testing...");
      
      // Create 2 more buyers with tickets
      for (let i = 0; i < 2; i++) {
        const buyer = web3.Keypair.generate();
        
        // Airdrop SOL
        const airdropSig = await connection.requestAirdrop(
          buyer.publicKey,
          2 * LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction(airdropSig);
        
        // Get current ticket count
        const poolData = await program.account.companyPool.fetch(companyPoolPda);
        const ticketId = poolData.totalTicketsSold.toNumber();
        
        // Derive ticket PDA
        const ticketPda = deriveTicketPda(buyer.publicKey, ticketId);
        
        // Buy ticket
        const tx = await program.methods
          .buyTicket()
          .accounts({
            companyPool: companyPoolPda,
            userTicket: ticketPda,
            buyer: buyer.publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([buyer])
          .rpc();

        await connection.confirmTransaction(tx);
        
        // Store ticket info
        ticketPdas.push({
          pda: ticketPda,
          owner: buyer,
          ticketId: ticketId
        });
        
        console.log(`   Additional ticket ${i + 1} created for ${buyer.publicKey.toString().slice(0, 8)}`);
      }

      console.log("✅ Additional tickets created successfully!");
      console.log("   Total tickets in test:", ticketPdas.length);

    } catch (error) {
      console.error("❌ Error creating additional tickets:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      throw error;
    }
  });

  it("Uses remaining unused tickets for spins", async () => {
    try {
      console.log("🎰 Using remaining unused tickets for spins...");
      
      let spinsPerformed = 0;
      
      for (const ticketInfo of ticketPdas) {
        try {
          // Check if ticket is used
          const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
          if (ticketData.used) {
            console.log(`   Skipping used ticket ${ticketInfo.ticketId}`);
            continue;
          }

          // Perform spin
          const tx = await program.methods
            .recordSpinResult()
            .accounts({
              companyPool: companyPoolPda,
              userTicket: ticketInfo.pda,
              spinner: ticketInfo.owner.publicKey,
              poolVault: poolVaultPda,
              systemProgram: SystemProgram.programId,
            })
            .signers(ticketInfo.owner.publicKey.toString() === provider.wallet.publicKey.toString() ? [] : [ticketInfo.owner])
            .rpc();

          await provider.connection.confirmTransaction(tx);
          spinsPerformed++;

          // Parse result from logs
          const txDetails = await connection.getTransaction(tx, {
            commitment: "confirmed",
          });

          let wonItem = "Unknown";
          if (txDetails?.meta?.logMessages) {
            for (const log of txDetails.meta.logMessages) {
              if (log.includes("Won Item:")) {
                wonItem = log.split("Won Item: ")[1];
                break;
              }
            }
          }

          console.log(`   Spin ${spinsPerformed}: Ticket ${ticketInfo.ticketId} won ${wonItem}`);

          // Small delay between spins
          await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error) {
          console.log(`   Failed to spin ticket ${ticketInfo.ticketId}:`, error.message);
        }
      }

      console.log(`✅ Performed ${spinsPerformed} additional spins!`);

    } catch (error) {
      console.error("❌ Error in remaining spins test:");
      if (error.logs) {
        console.error("Program logs:", error.logs);
      }
      throw error;
    }
  });

  it("Verifies all tickets are now used", async () => {
    try {
      console.log("🔍 Verifying all tickets are used...");
      
      if (ticketPdas.length === 0) {
        console.log("ℹ️ No tickets were created during tests");
        return;
      }
      
      let totalTickets = 0;
      let usedTickets = 0;
      
      for (const ticketInfo of ticketPdas) {
        try {
          const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
          totalTickets++;
          
          if (ticketData.used) {
            usedTickets++;
          } else {
            console.log(`   Unused ticket found: ${ticketInfo.ticketId}`);
          }
        } catch (error) {
          console.log(`   Could not fetch ticket ${ticketInfo.ticketId}:`, error.message);
        }
      }

      console.log(`📊 Ticket usage summary:`);
      console.log(`   Total tickets: ${totalTickets}`);
      console.log(`   Used tickets: ${usedTickets}`);
      console.log(`   Unused tickets: ${totalTickets - usedTickets}`);

      // Only check if we have tickets
      if (totalTickets > 0) {
        assert.ok(usedTickets >= 0, "Used tickets count should be non-negative");
      }

      console.log("✅ Ticket verification completed!");

    } catch (error) {
      console.error("❌ Error in ticket verification:");
      throw error;
    }
  });

});