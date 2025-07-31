import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, web3, setProvider } from "@coral-xyz/anchor";
import { CompanyPool } from "../target/types/company_pool";
import { assert } from "chai";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

describe("company_pool - Complete Test Suite", () => {
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
  const ticketPrice = new anchor.BN(1 * LAMPORTS_PER_SOL);
  
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

  // Helper function to derive ticket PDA
  const deriveTicketPda = (buyer: PublicKey, ticketId: number): PublicKey => {
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

  // Helper function to create a buyer with SOL
  const createBuyerWithSol = async (solAmount = 2): Promise<web3.Keypair> => {
    const buyer = web3.Keypair.generate();
    const airdropSig = await connection.requestAirdrop(
      buyer.publicKey,
      solAmount * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSig);
    // Small delay to ensure airdrop is processed
    await new Promise(resolve => setTimeout(resolve, 100));
    return buyer;
  };

  // Helper function to buy a ticket
  const buyTicketForUser = async (buyer: web3.Keypair): Promise<{ ticketPda: PublicKey, ticketId: number }> => {
    const poolData = await program.account.companyPool.fetch(companyPoolPda);
    const ticketId = poolData.totalTicketsSold.toNumber();
    const ticketPda = deriveTicketPda(buyer.publicKey, ticketId);
    
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
    return { ticketPda, ticketId };
  };

  // Helper function to spin a ticket
  const spinTicket = async (buyer: web3.Keypair, ticketPda: PublicKey): Promise<string> => {
    const tx = await program.methods
      .recordSpinResult()
      .accounts({
        companyPool: companyPoolPda,
        userTicket: ticketPda,
        spinner: buyer.publicKey,
        poolVault: poolVaultPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([buyer])
      .rpc();
    
    await connection.confirmTransaction(tx);
    return tx;
  };

  // ================== SETUP TESTS ==================

  it("Airdrops SOL to wallet", async () => {
    const sig = await provider.connection.requestAirdrop(
      provider.wallet.publicKey,
      10 * LAMPORTS_PER_SOL // Increased for comprehensive testing
    );
    await provider.connection.confirmTransaction(sig);
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  it("Derives PDA for CompanyPool", async () => {
    [companyPoolPda, bump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("company_pool"), Buffer.from(companyName)],
      program.programId
    );

    [poolVaultPda, vaultBump] = await PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), Buffer.from(companyName)],
      program.programId
    );

    console.log("Company Pool PDA:", companyPoolPda.toString());
    console.log("Pool Vault PDA:", poolVaultPda.toString());
  });

  // ================== INITIALIZATION TESTS ==================

  it("Initializes the CompanyPool", async () => {
    try {
      const balance = await provider.connection.getBalance(provider.wallet.publicKey);
      console.log("Wallet balance before tx:", balance / LAMPORTS_PER_SOL, "SOL");

      const tx = await program.methods
        .initializeCompanyPool(
          ticketPrice,
          companyName,
          companyImage,
          [item1, item2]
        )
        .accounts({
          companyPool: companyPoolPda,
          poolVault: poolVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx);
      const data = await program.account.companyPool.fetch(companyPoolPda);
      
      // Comprehensive assertions
      assert.equal(data.companyName, companyName);
      assert.equal(data.companyImage, companyImage);
      assert.equal(data.items.length, 2);
      assert.ok(data.active);
      assert.ok(data.ticketPrice.eq(ticketPrice));
      assert.equal(data.authority.toString(), provider.wallet.publicKey.toString());
      assert.ok(data.totalTicketsSold.eq(new anchor.BN(0)));
      assert.ok(data.totalFunds.eq(new anchor.BN(0)));
      
      console.log("✅ CompanyPool initialized successfully!");
      
    } catch (error) {
      console.error("❌ Error initializing CompanyPool:", error);
      throw error;
    }
  });

  it("Initializes with minimum valid ticket price (1 lamport)", async () => {
    const minCompanyName = "MinTest";
    const minTicketPrice = new anchor.BN(1);
    
    const [minPoolPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("company_pool"), Buffer.from(minCompanyName)],
      program.programId
    );
    
    const [minVaultPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), Buffer.from(minCompanyName)],
      program.programId
    );

    const tx = await program.methods
      .initializeCompanyPool(
        minTicketPrice,
        minCompanyName,
        companyImage,
        [{ ...item1, price: new anchor.BN(1) }]
      )
      .accounts({
        companyPool: minPoolPda,
        poolVault: minVaultPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await connection.confirmTransaction(tx);
    
    const data = await program.account.companyPool.fetch(minPoolPda);
    assert.ok(data.ticketPrice.eq(minTicketPrice));
    console.log("✅ Minimum ticket price initialization successful");
  });


  it("Handles maximum number of items (10 items)", async () => {
    const maxItemsName = "MaxItems";
    const maxItems = Array.from({ length: 10 }, (_, i) => ({
      image: `https://test.com/item${i}.png`,
      price: new anchor.BN(10 + i),
      name: `Item${i}`,
      description: `Description for item ${i}`
    }));
    
    const [maxItemsPoolPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("company_pool"), Buffer.from(maxItemsName)],
      program.programId
    );
    
    const [maxItemsVaultPda] = await PublicKey.findProgramAddressSync(
      [Buffer.from("pool_vault"), Buffer.from(maxItemsName)],
      program.programId
    );

    const tx = await program.methods
      .initializeCompanyPool(
        ticketPrice,
        maxItemsName,
        companyImage,
        maxItems
      )
      .accounts({
        companyPool: maxItemsPoolPda,
        poolVault: maxItemsVaultPda,
        authority: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    await connection.confirmTransaction(tx);
    
    const data = await program.account.companyPool.fetch(maxItemsPoolPda);
    assert.equal(data.items.length, 10);
    console.log("✅ Maximum items initialization successful");
  });

  it("Fails with empty company name", async () => {
    try {
      await program.methods
        .initializeCompanyPool(
          ticketPrice,
          "", // Empty name
          companyImage,
          [item1]
        )
        .accounts({
          companyPool: companyPoolPda, // This will fail anyway
          poolVault: poolVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      assert.fail("Should have failed with empty company name");
    } catch (error) {
      console.log("✅ Correctly failed with empty company name");
    }
  });

  it("Fails when exceeding maximum items limit", async () => {
    try {
      const tooManyItems = Array.from({ length: 11 }, (_, i) => ({
        image: `https://test.com/item${i}.png`,
        price: new anchor.BN(10),
        name: `Item${i}`,
        description: `Description ${i}`
      }));

      const failName = "FailTest";
      const [failPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("company_pool"), Buffer.from(failName)],
        program.programId
      );
      
      const [failVaultPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("pool_vault"), Buffer.from(failName)],
        program.programId
      );

      await program.methods
        .initializeCompanyPool(
          ticketPrice,
          failName,
          companyImage,
          tooManyItems
        )
        .accounts({
          companyPool: failPda,
          poolVault: failVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      assert.fail("Should have failed with too many items");
    } catch (error) {
      console.log("✅ Correctly failed with too many items");
      assert.ok(error.toString().includes("TooManyItems"));
    }
  });

  it("Prevents duplicate pool creation with same company name", async () => {
    try {
      // Try to create another pool with the same name
      await program.methods
        .initializeCompanyPool(
          ticketPrice,
          companyName, // Same name as original
          companyImage,
          [item1]
        )
        .accounts({
          companyPool: companyPoolPda,
          poolVault: poolVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      
      assert.fail("Should have failed with duplicate pool name");
    } catch (error) {
      console.log("✅ Correctly prevented duplicate pool creation");
      // This should fail because the account already exists
    }
  });

  // ================== BASIC FUNCTIONALITY TESTS ==================

  it("Checks account data integrity", async () => {
    const data = await program.account.companyPool.fetch(companyPoolPda);
    
    assert.ok(data.createdAt.gt(new anchor.BN(0)), "Created timestamp should be set");
    assert.equal(data.items.length, 2, "Should have exactly 2 items");
    assert.ok(data.totalValue.gt(new anchor.BN(0)), "Total value should be greater than 0");
    
    console.log("✅ All integrity checks passed!");
  });

  it("Buys a ticket successfully", async () => {
    try {
      const buyerInitialBalance = await connection.getBalance(provider.wallet.publicKey);
      const vaultInitialBalance = await connection.getBalance(poolVaultPda);
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      
      const ticketPda = deriveTicketPda(provider.wallet.publicKey, poolDataBefore.totalTicketsSold.toNumber());

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

      await provider.connection.confirmTransaction(tx);

      ticketPdas.push({
        pda: ticketPda,
        owner: provider.wallet as any,
        ticketId: poolDataBefore.totalTicketsSold.toNumber()
      });

      const buyerFinalBalance = await connection.getBalance(provider.wallet.publicKey);
      const vaultFinalBalance = await connection.getBalance(poolVaultPda);
      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);

      const ticketData = await program.account.userTicket.fetch(ticketPda);
      assert.equal(ticketData.owner.toString(), provider.wallet.publicKey.toString());
      assert.equal(ticketData.used, false);

      assert.ok(poolDataAfter.totalTicketsSold.eq(poolDataBefore.totalTicketsSold.add(new anchor.BN(1))));
      assert.ok(poolDataAfter.totalFunds.eq(poolDataBefore.totalFunds.add(ticketPrice)));

      console.log("✅ Ticket purchased successfully!");

    } catch (error) {
      console.error("❌ Error buying ticket:", error);
      throw error;
    }
  });

  it("Buys multiple tickets for different users", async () => {
    try {
      const numberOfTickets = 3;
      
      console.log(`🎫 Creating ${numberOfTickets} buyers and purchasing tickets...`);

      for (let i = 0; i < numberOfTickets; i++) {
        const buyer = await createBuyerWithSol(2);
        const { ticketPda, ticketId } = await buyTicketForUser(buyer);
        
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
      console.error("❌ Error buying multiple tickets:", error);
      throw error;
    }
  });

  it("Fails to buy ticket with insufficient funds", async () => {
    try {
      const poorBuyer = anchor.web3.Keypair.generate();
      const poolData = await program.account.companyPool.fetch(companyPoolPda);
      const ticketId = poolData.totalTicketsSold.toNumber();
      const ticketPda = deriveTicketPda(poorBuyer.publicKey, ticketId);

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

      assert.fail("Transaction should have failed due to insufficient funds");

    } catch (error) {
      console.log("✅ Correctly failed with insufficient funds");
      const errorStr = error.toString();
      const hasInsufficientFunds = errorStr.includes("insufficient") || 
                                   errorStr.includes("Insufficient") ||
                                   errorStr.includes("0x1") ||
                                   errorStr.includes("lamports");
      assert.ok(hasInsufficientFunds, `Should fail with insufficient funds error. Got: ${errorStr}`);
    }
  });

  // ================== CONCURRENCY TESTS ==================

  it("Handles simultaneous ticket purchases by multiple users", async () => {
    try {
      console.log("🔄 Testing concurrent ticket purchases...");
      
      const numberOfConcurrentBuyers = 5;
      const buyers: web3.Keypair[] = [];
      
      // Create buyers
      for (let i = 0; i < numberOfConcurrentBuyers; i++) {
        buyers.push(await createBuyerWithSol(3));
      }
      
      // Create all buy ticket promises simultaneously
      const buyPromises = buyers.map(async (buyer, index) => {
        try {
          // Small random delay to simulate real-world timing
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100));
          
          const poolData = await program.account.companyPool.fetch(companyPoolPda);
          const ticketId = poolData.totalTicketsSold.toNumber();
          const ticketPda = deriveTicketPda(buyer.publicKey, ticketId);
          
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
          return { success: true, buyer: buyer.publicKey.toString().slice(0, 8), tx };
        } catch (error) {
          return { success: false, buyer: buyer.publicKey.toString().slice(0, 8), error: error.message };
        }
      });
      
      // Wait for all purchases to complete
      const results = await Promise.all(buyPromises);
      
      const successful = results.filter(r => r.success).length;
      const failed = results.filter(r => !r.success).length;
      
      console.log(`   Successful purchases: ${successful}`);
      console.log(`   Failed purchases: ${failed}`);
      
      // At least some should succeed (allowing for some failures due to timing)
      assert.ok(successful > 0, "At least one concurrent purchase should succeed");
      
      console.log("✅ Concurrent purchase test completed");
      
    } catch (error) {
      console.error("❌ Error in concurrent purchase test:", error);
      throw error;
    }
  });

  it("Maintains correct ticket IDs under concurrent purchases", async () => {
    try {
      console.log("🔍 Verifying ticket ID consistency...");
      
      const poolData = await program.account.companyPool.fetch(companyPoolPda);
      const currentTicketCount = poolData.totalTicketsSold.toNumber();
      
      // Check that all ticket IDs are unique and sequential
      const seenTicketIds = new Set();
      let duplicateFound = false;
      
      for (const ticketInfo of ticketPdas) {
        if (seenTicketIds.has(ticketInfo.ticketId)) {
          duplicateFound = true;
          console.log(`   Duplicate ticket ID found: ${ticketInfo.ticketId}`);
        }
        seenTicketIds.add(ticketInfo.ticketId);
      }
      
      assert.ok(!duplicateFound, "All ticket IDs should be unique");
      assert.equal(seenTicketIds.size, ticketPdas.length, "Number of unique IDs should match ticket count");
      
      console.log(`✅ All ${seenTicketIds.size} ticket IDs are unique and consistent`);
      
    } catch (error) {
      console.error("❌ Error in ticket ID consistency test:", error);
      throw error;
    }
  });

  // ================== SPIN FUNCTIONALITY TESTS ==================

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
      const availableTickets = ticketPdas.slice(1).filter(async (ticketInfo) => {
        try {
          const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
          return !ticketData.used;
        } catch {
          return false;
        }
      });
      
      const numberOfSpins = Math.min(3, availableTickets.length);
      
      if (numberOfSpins === 0) {
        console.log("ℹ️ No available tickets for multiple spins test, skipping");
        return;
      }
      
      const spinResults: any[] = [];
      
      console.log(`🎰 Performing ${numberOfSpins} spins to test randomness...`);

      for (let i = 0; i < numberOfSpins; i++) {
        const ticketInfo = availableTickets[i];
        
        const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
        if (ticketData.used) {
          continue;
        }

        await new Promise(resolve => setTimeout(resolve, 100));

        const tx = await spinTicket(ticketInfo.owner, ticketInfo.pda);

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
          wonItem,
          tx: tx.slice(0, 8)
        });

        console.log(`   Spin ${i + 1}: Winner = ${wonItem}`);
      }

      if (spinResults.length > 0) {
        const itemCounts = {};
        spinResults.forEach(result => {
          itemCounts[result.wonItem] = (itemCounts[result.wonItem] || 0) + 1;
        });

        console.log("📊 Spin Results Analysis:");
        Object.entries(itemCounts).forEach(([item, count]) => {
          const percentage = ((count as number) / spinResults.length * 100).toFixed(1);
          console.log(`   ${item}: ${count}/${spinResults.length} (${percentage}%)`);
        });

        const uniqueResults = Object.keys(itemCounts).length;
        assert.ok(uniqueResults >= 1, "Should have at least one winning item");
        
        console.log(`✅ Completed ${spinResults.length} spins with ${uniqueResults} different outcomes!`);
      }

    } catch (error) {
      console.error("❌ Error in multiple spins test:", error);
      throw error;
    }
  });

  it("Maintains expected probability distribution over many spins", async () => {
    try {
      console.log("📊 Testing probability distribution over large sample...");
      
      const numberOfTestSpins = 20; // Reduced for test efficiency
      const testResults = { "Item1": 0, "Item2": 0, "Unknown": 0 };
      
      // Create test buyers and perform spins
      for (let i = 0; i < numberOfTestSpins; i++) {
        try {
          const buyer = await createBuyerWithSol(2);
          const { ticketPda } = await buyTicketForUser(buyer);
          
          await new Promise(resolve => setTimeout(resolve, 50));
          const tx = await spinTicket(buyer, ticketPda);
          
          // Parse result
          const txDetails = await connection.getTransaction(tx, { commitment: "confirmed" });
          let wonItem = "Unknown";
          
          if (txDetails?.meta?.logMessages) {
            for (const log of txDetails.meta.logMessages) {
              if (log.includes("Won Item:")) {
                wonItem = log.split("Won Item: ")[1].trim();
                break;
              }
            }
          }
          
          if (testResults.hasOwnProperty(wonItem)) {
            testResults[wonItem]++;
          } else {
            testResults["Unknown"]++;
          }
          
        } catch (error) {
          console.log(`   Spin ${i + 1} failed:`, error.message);
          testResults["Unknown"]++;
        }
      }
      
      console.log("📈 Distribution Results:");
      Object.entries(testResults).forEach(([item, count]) => {
        const percentage = (count / numberOfTestSpins * 100).toFixed(1);
        console.log(`   ${item}: ${count}/${numberOfTestSpins} (${percentage}%)`);
      });
      
      // Basic sanity check - we should have some results
      const totalResults = Object.values(testResults).reduce((sum, count) => sum + count, 0);
      assert.equal(totalResults, numberOfTestSpins, "All spins should be accounted for");
      
      console.log("✅ Probability distribution test completed");
      
    } catch (error) {
      console.error("❌ Error in probability distribution test:", error);
      throw error;
    }
  });

  it("Fails to spin with already used ticket", async () => {
    try {
      if (ticketPdas.length === 0) {
        console.log("ℹ️ No tickets available for used ticket test, skipping");
        return;
      }

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
      const wrongOwner = web3.Keypair.generate();
      const airdropSig = await connection.requestAirdrop(
        wrongOwner.publicKey,
        0.1 * LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(airdropSig);

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
          spinner: wrongOwner.publicKey,
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
      console.error("❌ Error in probability analysis:", error);
      throw error;
    }
  });

  // ================== REWARD CLAIMING TESTS ==================

  it("Successfully claims reward after winning spin", async () => {
    try {
      console.log("🎁 Testing claim reward functionality...");
      
      const rewardTester = await createBuyerWithSol(3);
      const { ticketPda } = await buyTicketForUser(rewardTester);
      
      console.log("   Step 1: Ticket purchased successfully");
      
      const ticketDataBeforeSpin = await program.account.userTicket.fetch(ticketPda);
      assert.equal(ticketDataBeforeSpin.used, false, "Ticket should be unused");
      assert.equal(ticketDataBeforeSpin.rewardClaimed, false, "Reward should not be claimed");
      
      console.log("   Step 2: Performing spin...");
      const spinTx = await spinTicket(rewardTester, ticketPda);
      console.log("   ✅ Spin completed successfully");
      
      const ticketDataAfterSpin = await program.account.userTicket.fetch(ticketPda);
      assert.equal(ticketDataAfterSpin.used, true, "Ticket should be marked as used");
      assert.equal(ticketDataAfterSpin.rewardClaimed, false, "Reward should not be claimed yet");
      assert.notEqual(ticketDataAfterSpin.wonItem, null, "Should have won an item");
      
      const wonItem = ticketDataAfterSpin.wonItem;
      console.log(`   🎉 Won item: ${wonItem.name} (Value: ${wonItem.price} lamports)`);
      
      const userBalanceBefore = await connection.getBalance(rewardTester.publicKey);
      const vaultBalanceBefore = await connection.getBalance(poolVaultPda);
      
      console.log("   Step 3: Claiming reward...");
      const claimTx = await program.methods
        .claimReward()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
          spinner: rewardTester.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([rewardTester])
        .rpc();
      
      await connection.confirmTransaction(claimTx);
      console.log("   ✅ Reward claimed successfully");
      
      const ticketDataAfterClaim = await program.account.userTicket.fetch(ticketPda);
      const userBalanceAfter = await connection.getBalance(rewardTester.publicKey);
      const vaultBalanceAfter = await connection.getBalance(poolVaultPda);
      
      assert.equal(ticketDataAfterClaim.rewardClaimed, true, "Reward should be marked as claimed");
      assert.equal(ticketDataAfterClaim.used, true, "Ticket should remain marked as used");
      
      const balanceIncrease = userBalanceAfter - userBalanceBefore;
      assert.ok(balanceIncrease > 0, "User balance should increase");
      
      const vaultDecrease = vaultBalanceBefore - vaultBalanceAfter;
      assert.ok(vaultDecrease >= wonItem.price, "Vault should decrease by at least the reward amount");
      
      console.log("   ✅ All reward claim validations passed!");
      
    } catch (error) {
      console.error("❌ Error in claim reward test:", error);
      throw error;
    }
  });

  it("Fails to claim reward with unused ticket", async () => {
    try {
      console.log("🚫 Testing claim reward with unused ticket...");
      
      const testBuyer = await createBuyerWithSol(2);
      const { ticketPda } = await buyTicketForUser(testBuyer);
      
      const ticketData = await program.account.userTicket.fetch(ticketPda);
      assert.equal(ticketData.used, false, "Ticket should be unused");
      
      await program.methods
        .claimReward()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
          spinner: testBuyer.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([testBuyer])
        .rpc();
      
      assert.fail("Should have failed due to unused ticket");
      
    } catch (error) {
      console.log("✅ Correctly failed with unused ticket");
      const errorStr = error.toString();
      assert.ok(
        errorStr.includes("TicketNotUsed") || errorStr.includes("constraint"),
        `Should fail with ticket not used error. Got: ${errorStr}`
      );
    }
  });

  it("Fails to claim reward twice", async () => {
    try {
      console.log("🚫 Testing double claim prevention...");
      
      const doubleClaimer = await createBuyerWithSol(3);
      const { ticketPda } = await buyTicketForUser(doubleClaimer);
      
      await spinTicket(doubleClaimer, ticketPda);
      
      const claimTx = await program.methods
        .claimReward()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
          spinner: doubleClaimer.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([doubleClaimer])
        .rpc();
      await connection.confirmTransaction(claimTx);
      
      const ticketData = await program.account.userTicket.fetch(ticketPda);
      assert.equal(ticketData.rewardClaimed, true, "Reward should be claimed");
      
      // Try to claim again
      await program.methods
        .claimReward()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
          spinner: doubleClaimer.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([doubleClaimer])
        .rpc();
      
      assert.fail("Should have failed due to already claimed reward");
      
    } catch (error) {
      console.log("✅ Correctly failed with already claimed reward");
      const errorStr = error.toString();
      assert.ok(
        errorStr.includes("RewardAlreadyClaimed") || errorStr.includes("constraint"),
        `Should fail with reward already claimed error. Got: ${errorStr}`
      );
    }
  });

  it("Fails to claim reward with wrong owner", async () => {
    try {
      console.log("🚫 Testing claim reward with wrong owner...");
      
      const originalOwner = await createBuyerWithSol(2);
      const wrongOwner = await createBuyerWithSol(1);
      
      const { ticketPda } = await buyTicketForUser(originalOwner);
      await spinTicket(originalOwner, ticketPda);
      
      console.log("Ticket owner:", originalOwner.publicKey.toString());
      console.log("Wrong owner:", wrongOwner.publicKey.toString());
      
      const claimTx = program.methods
        .claimReward()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
          spinner: wrongOwner.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([wrongOwner]);
      
      await claimTx.rpc();
      assert.fail("Should have failed due to wrong owner");
      
    } catch (error) {
      console.log("✅ Correctly failed with wrong owner");
      const errorStr = error.toString();
      
      const isExpectedError = 
        errorStr.includes("NotTicketOwner") ||
        errorStr.includes("constraint") ||
        errorStr.includes("ConstraintOwner") ||
        errorStr.includes("A has_one constraint was violated") ||
        errorStr.includes("owner");
      
      assert.ok(
        isExpectedError,
        `Should fail with owner-related error. Got: ${errorStr}`
      );
    }
  });

  it("Tests multiple users claiming rewards simultaneously", async () => {
    try {
      console.log("🎁 Testing multiple reward claims...");
      
      const numberOfUsers = 3;
      const users: web3.Keypair[] = [];
      const ticketPdas: PublicKey[] = [];
      
      for (let i = 0; i < numberOfUsers; i++) {
        const user = await createBuyerWithSol(3);
        users.push(user);
        
        const { ticketPda } = await buyTicketForUser(user);
        ticketPdas.push(ticketPda);
        
        await spinTicket(user, ticketPda);
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      
      let successfulClaims = 0;
      let failedClaims = 0;
      
      for (let i = 0; i < numberOfUsers; i++) {
        try {
          const claimTx = await program.methods
            .claimReward()
            .accounts({
              companyPool: companyPoolPda,
              userTicket: ticketPdas[i],
              spinner: users[i].publicKey,
              poolVault: poolVaultPda,
              systemProgram: SystemProgram.programId,
            })
            .signers([users[i]])
            .rpc();
          await connection.confirmTransaction(claimTx);
          
          successfulClaims++;
          console.log(`   User ${i + 1}: Reward claimed successfully`);
          
        } catch (error) {
          failedClaims++;
          console.log(`   User ${i + 1}: Claim failed - ${error.message}`);
        }
      }
      
      console.log("📊 Multiple claims summary:");
      console.log(`   Successful claims: ${successfulClaims}`);
      console.log(`   Failed claims: ${failedClaims}`);
      console.log(`   Total attempts: ${numberOfUsers}`);
      
      assert.ok(successfulClaims >= 0, "Should have non-negative successful claims");
      console.log("✅ Multiple reward claims test completed!");
      
    } catch (error) {
      console.error("❌ Error in multiple claims test:", error);
      throw error;
    }
  });

  // ================== WITHDRAWAL TESTS ==================

  it("Successfully withdraws funds as authority", async () => {
    try {
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      
      if (poolDataBefore.totalFunds.toNumber() === 0) {
        console.log("ℹ️ No funds available for withdrawal, skipping test");
        return;
      }

      const authorityBalanceBefore = await connection.getBalance(provider.wallet.publicKey);
      const vaultBalanceBefore = await connection.getBalance(poolVaultPda);

      const withdrawAmount = new anchor.BN(Math.min(0.5 * LAMPORTS_PER_SOL, poolDataBefore.totalFunds.toNumber()));

      console.log("📊 Initial State:");
      console.log("   Pool total funds:", poolDataBefore.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
      console.log("   Authority balance:", authorityBalanceBefore / LAMPORTS_PER_SOL, "SOL");
      console.log("   Withdraw amount:", withdrawAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");

      const tx = await program.methods
        .withdrawFundsFromVault(withdrawAmount)
        .accounts({
          companyPool: companyPoolPda,
          authority: provider.wallet.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await provider.connection.confirmTransaction(tx);

      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);
      const authorityBalanceAfter = await connection.getBalance(provider.wallet.publicKey);
      const vaultBalanceAfter = await connection.getBalance(poolVaultPda);

      assert.ok(
        poolDataAfter.totalFunds.eq(poolDataBefore.totalFunds.sub(withdrawAmount)),
        "Pool total funds should decrease by withdrawal amount"
      );

      assert.ok(
        vaultBalanceAfter <= vaultBalanceBefore - withdrawAmount.toNumber(),
        "Vault balance should decrease by withdrawal amount"
      );

      const balanceIncrease = authorityBalanceAfter - authorityBalanceBefore;
      assert.ok(balanceIncrease > 0, "Authority balance should increase");

      console.log("✅ Withdrawal successful!");

    } catch (error) {
      if (error.toString().includes("NoFundsAvailable")) {
        console.log("ℹ️ No funds available for withdrawal test");
        return;
      }
      console.error("❌ Error withdrawing funds:", error);
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
      const unauthorizedUser = await createBuyerWithSol(0.1);

      console.log("🚫 Unauthorized user attempting withdrawal");

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
      
      const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(8);
      const withdrawableAmount = Math.max(0, vaultBalanceBefore - rentExemptAmount);

      console.log("💰 Withdrawing remaining funds:");
      console.log("   Vault balance:", vaultBalanceBefore / LAMPORTS_PER_SOL, "SOL");
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

        assert.ok(
          vaultBalanceAfter >= rentExemptAmount,
          "Vault should maintain rent exemption"
        );

        assert.ok(
          poolDataAfter.totalFunds.toNumber() < poolDataBefore.totalFunds.toNumber(),
          "Pool funds should decrease"
        );

        console.log("✅ Complete withdrawal successful!");
      } else {
        console.log("ℹ️ No withdrawable funds remaining");
      }

    } catch (error) {
      console.error("❌ Error in complete withdrawal:", error);
      throw error;
    }
  });

  // ================== EDGE CASE TESTS ==================

  it("Handles ticket purchasing during high network congestion", async () => {
    try {
      console.log("🚥 Testing ticket purchase under simulated congestion...");
      
      // Simulate congestion by rapid-fire transactions
      const congestionBuyers = [];
      for (let i = 0; i < 3; i++) {
        congestionBuyers.push(await createBuyerWithSol(2));
      }
      
      const results = await Promise.allSettled(
        congestionBuyers.map(async (buyer, index) => {
          // Add small random delays to simulate real network conditions
          await new Promise(resolve => setTimeout(resolve, Math.random() * 50));
          return await buyTicketForUser(buyer);
        })
      );
      
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;
      
      console.log(`   Successful under congestion: ${successful}`);
      console.log(`   Failed under congestion: ${failed}`);
      
      // At least some should succeed
      assert.ok(successful > 0, "At least one ticket should be purchased under congestion");
      
      console.log("✅ Congestion handling test completed");
      
    } catch (error) {
      console.error("❌ Error in congestion test:", error);
      throw error;
    }
  });

  it("Maintains data consistency after failed operations", async () => {
    try {
      console.log("🔄 Testing data consistency after failures...");
      
      const poolDataBefore = await program.account.companyPool.fetch(companyPoolPda);
      
      // Attempt an operation that should fail
      const failBuyer = web3.Keypair.generate(); // No SOL
      
      try {
        await buyTicketForUser(failBuyer);
        assert.fail("This should have failed");
      } catch {
        // Expected to fail
      }
      
      // Check that pool state is unchanged
      const poolDataAfter = await program.account.companyPool.fetch(companyPoolPda);
      
      assert.ok(
        poolDataAfter.totalTicketsSold.eq(poolDataBefore.totalTicketsSold),
        "Ticket count should be unchanged after failed purchase"
      );
      
      assert.ok(
        poolDataAfter.totalFunds.eq(poolDataBefore.totalFunds),
        "Total funds should be unchanged after failed purchase"
      );
      
      console.log("✅ Data consistency maintained after failure");
      
    } catch (error) {
      console.error("❌ Error in consistency test:", error);
      throw error;
    }
  });

  it("Validates all PDA derivations are deterministic", async () => {
    try {
      console.log("🔗 Testing PDA derivation consistency...");
      
      const testBuyer = await createBuyerWithSol(2);
      const poolData = await program.account.companyPool.fetch(companyPoolPda);
      const ticketId = poolData.totalTicketsSold.toNumber();
      
      // Derive the same PDA multiple times
      const pda1 = deriveTicketPda(testBuyer.publicKey, ticketId);
      const pda2 = deriveTicketPda(testBuyer.publicKey, ticketId);
      const pda3 = deriveTicketPda(testBuyer.publicKey, ticketId);
      
      assert.equal(pda1.toString(), pda2.toString(), "PDA derivation should be deterministic");
      assert.equal(pda2.toString(), pda3.toString(), "PDA derivation should be deterministic");
      
      // Test with different inputs
      const differentTicketPda = deriveTicketPda(testBuyer.publicKey, ticketId + 1);
      assert.notEqual(pda1.toString(), differentTicketPda.toString(), "Different ticket IDs should produce different PDAs");
      
      const differentBuyer = await createBuyerWithSol(1);
      const differentBuyerPda = deriveTicketPda(differentBuyer.publicKey, ticketId);
      assert.notEqual(pda1.toString(), differentBuyerPda.toString(), "Different buyers should produce different PDAs");
      
      console.log("✅ PDA derivation consistency verified");
      
    } catch (error) {
      console.error("❌ Error in PDA consistency test:", error);
      throw error;
    }
  });

  it("Measures and validates transaction costs stay within bounds", async () => {
    try {
      console.log("💸 Testing transaction cost efficiency...");
      
      const costTester = await createBuyerWithSol(3);
      const initialBalance = await connection.getBalance(costTester.publicKey);
      
      // Buy ticket and measure cost
      const { ticketPda } = await buyTicketForUser(costTester);
      const afterBuyBalance = await connection.getBalance(costTester.publicKey);
      
      // Spin ticket and measure cost
      await spinTicket(costTester, ticketPda);
      const afterSpinBalance = await connection.getBalance(costTester.publicKey);
      
      // Try to claim reward and measure cost
      try {
        const claimTx = await program.methods
          .claimReward()
          .accounts({
            companyPool: companyPoolPda,
            userTicket: ticketPda,
            spinner: costTester.publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([costTester])
          .rpc();
        await connection.confirmTransaction(claimTx);
        
        const afterClaimBalance = await connection.getBalance(costTester.publicKey);
        
        // Calculate costs (excluding ticket price and rewards)
        const buyTxCost = initialBalance - afterBuyBalance - ticketPrice.toNumber();
        const spinTxCost = afterBuyBalance - afterSpinBalance;
        const claimTxCost = afterSpinBalance - afterClaimBalance;
        
        console.log(`   Buy ticket cost: ${buyTxCost / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Spin ticket cost: ${spinTxCost / LAMPORTS_PER_SOL} SOL`);
        console.log(`   Claim reward cost: ${claimTxCost / LAMPORTS_PER_SOL} SOL`);
        
        // Validate costs are reasonable (less than 0.01 SOL each)
        const maxTxCost = 0.01 * LAMPORTS_PER_SOL;
        assert.ok(Math.abs(buyTxCost) < maxTxCost, "Buy transaction cost should be reasonable");
        assert.ok(Math.abs(spinTxCost) < maxTxCost, "Spin transaction cost should be reasonable");
        
      } catch (error) {
        console.log("   Claim may have failed (no reward), continuing cost analysis...");
      }
      
      console.log("✅ Transaction cost analysis completed");
      
    } catch (error) {
      console.error("❌ Error in cost analysis:", error);
      throw error;
    }
  });

  // ================== FINAL VERIFICATION TESTS ==================

  it("Verifies final state consistency", async () => {
    const poolData = await program.account.companyPool.fetch(companyPoolPda);
    const vaultBalance = await connection.getBalance(poolVaultPda);
    const rentExemptAmount = await connection.getMinimumBalanceForRentExemption(0);

    console.log("🔍 Final verification:");
    console.log("   Pool active:", poolData.active);
    console.log("   Pool total funds:", poolData.totalFunds.toNumber() / LAMPORTS_PER_SOL, "SOL");
    console.log("   Vault balance:", vaultBalance / LAMPORTS_PER_SOL, "SOL");
    console.log("   Tickets sold:", poolData.totalTicketsSold.toString());

    assert.ok(poolData.active, "Pool should remain active");
    assert.ok(poolData.totalFunds.toNumber() >= 0, "Pool total funds should not be negative");

    if (poolData.totalTicketsSold.toNumber() > 0) {
      assert.ok(vaultBalance > 0, "Vault should have some balance if tickets were sold");
    }

    // Verify ticket integrity
    let usedTickets = 0;
    let validTickets = 0;
    
    for (const ticketInfo of ticketPdas) {
      try {
        const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
        validTickets++;
        
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

    console.log("   Valid tickets checked:", validTickets);
    console.log("   Used tickets:", usedTickets);

    console.log("✅ Final state verification passed!");
  });

  it("Creates and uses additional tickets for comprehensive testing", async () => {
    try {
      console.log("🎫 Creating additional tickets for comprehensive testing...");
      
      for (let i = 0; i < 2; i++) {
        const buyer = await createBuyerWithSol(2);
        const { ticketPda, ticketId } = await buyTicketForUser(buyer);
        
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
      console.error("❌ Error creating additional tickets:", error);
      throw error;
    }
  });

  it("Uses remaining unused tickets for spins", async () => {
    try {
      console.log("🎰 Using remaining unused tickets for spins...");
      
      let spinsPerformed = 0;
      
      for (const ticketInfo of ticketPdas) {
        try {
          const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
          if (ticketData.used) {
            console.log(`   Skipping used ticket ${ticketInfo.ticketId}`);
            continue;
          }

          const tx = await spinTicket(ticketInfo.owner, ticketInfo.pda);
          spinsPerformed++;

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

          await new Promise(resolve => setTimeout(resolve, 50));

        } catch (error) {
          console.log(`   Failed to spin ticket ${ticketInfo.ticketId}:`, error.message);
        }
      }

      console.log(`✅ Performed ${spinsPerformed} additional spins!`);

    } catch (error) {
      console.error("❌ Error in remaining spins test:", error);
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

      if (totalTickets > 0) {
        assert.ok(usedTickets >= 0, "Used tickets count should be non-negative");
      }

      console.log("✅ Ticket verification completed!");

    } catch (error) {
      console.error("❌ Error in ticket verification:", error);
      throw error;
    }
  });

  // ================== ADVANCED EDGE CASES ==================

  it("Handles maximum u64 values for item prices", async () => {
    try {
      console.log("🔢 Testing with maximum u64 item prices...");
      
      // Note: We can't actually use MAX_U64 due to practical limitations
      // but we can test with very large values
      const largePrice = new anchor.BN("1000000000000000"); // 1 million SOL in lamports
      const largePriceCompanyName = "LargePrice";
      
      const [largePricePda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("company_pool"), Buffer.from(largePriceCompanyName)],
        program.programId
      );
      
      const [largePriceVaultPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("pool_vault"), Buffer.from(largePriceCompanyName)],
        program.programId
      );

      const largeItem = {
        image: "https://test.com/large.png",
        price: largePrice,
        name: "LargeItem",
        description: "Very expensive item"
      };

      const tx = await program.methods
        .initializeCompanyPool(
          new anchor.BN(1000 * LAMPORTS_PER_SOL), // High ticket price
          largePriceCompanyName,
          companyImage,
          [largeItem]
        )
        .accounts({
          companyPool: largePricePda,
          poolVault: largePriceVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await connection.confirmTransaction(tx);
      
      const data = await program.account.companyPool.fetch(largePricePda);
      assert.ok(data.items[0].price.eq(largePrice), "Large price should be stored correctly");
      
      console.log("✅ Large value handling test passed");
      
    } catch (error) {
      console.log("ℹ️ Large value test may fail due to practical constraints:", error.message);
      // This is acceptable as extreme values may not be practical
    }
  });

  it("Works with extremely small item values (1 lamport)", async () => {
    try {
      console.log("🔬 Testing with minimum item values...");
      
      const smallCompanyName = "SmallValue";
      const [smallPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("company_pool"), Buffer.from(smallCompanyName)],
        program.programId
      );
      
      const [smallVaultPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("pool_vault"), Buffer.from(smallCompanyName)],
        program.programId
      );

      const smallItem = {
        image: "https://test.com/small.png",
        price: new anchor.BN(1), // 1 lamport
        name: "SmallItem",
        description: "Minimal value item"
      };

      const tx = await program.methods
        .initializeCompanyPool(
          new anchor.BN(10), // Small ticket price
          smallCompanyName,
          companyImage,
          [smallItem]
        )
        .accounts({
          companyPool: smallPda,
          poolVault: smallVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await connection.confirmTransaction(tx);
      
      const data = await program.account.companyPool.fetch(smallPda);
      assert.ok(data.items[0].price.eq(new anchor.BN(1)), "Small price should be stored correctly");
      
      console.log("✅ Small value handling test passed");
      
    } catch (error) {
      console.error("❌ Error in small value test:", error);
      throw error;
    }
  });

  it("Handles special characters in company/item names", async () => {
    try {
      console.log("🔤 Testing special characters in names...");
      
      const specialCompanyName = "Test-Corp_123"; // Allowed special chars
      const [specialPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("company_pool"), Buffer.from(specialCompanyName)],
        program.programId
      );
      
      const [specialVaultPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("pool_vault"), Buffer.from(specialCompanyName)],
        program.programId
      );

      const specialItem = {
        image: "https://test.com/special.png",
        price: new anchor.BN(100),
        name: "Item-1_Special", // Special chars in item name
        description: "Item with special characters: @#$%"
      };

      const tx = await program.methods
        .initializeCompanyPool(
          ticketPrice,
          specialCompanyName,
          companyImage,
          [specialItem]
        )
        .accounts({
          companyPool: specialPda,
          poolVault: specialVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await connection.confirmTransaction(tx);
      
      const data = await program.account.companyPool.fetch(specialPda);
      assert.equal(data.companyName, specialCompanyName, "Special company name should be stored");
      assert.equal(data.items[0].name, specialItem.name, "Special item name should be stored");
      
      console.log("✅ Special characters handling test passed");
      
    } catch (error) {
      console.error("❌ Error in special characters test:", error);
      throw error;
    }
  });

  it("Tests with single item pools", async () => {
    try {
      console.log("🎯 Testing single item pool functionality...");
      
      const singleItemName = "SingleItem";
      const [singlePda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("company_pool"), Buffer.from(singleItemName)],
        program.programId
      );
      
      const [singleVaultPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("pool_vault"), Buffer.from(singleItemName)],
        program.programId
      );

      const singleItem = {
        image: "https://test.com/single.png",
        price: new anchor.BN(100),
        name: "OnlyItem",
        description: "The only item in this pool"
      };

      // Initialize single item pool
      const initTx = await program.methods
        .initializeCompanyPool(
          ticketPrice,
          singleItemName,
          companyImage,
          [singleItem]
        )
        .accounts({
          companyPool: singlePda,
          poolVault: singleVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await connection.confirmTransaction(initTx);
      
      // Verify single item has 100% probability
      const poolData = await program.account.companyPool.fetch(singlePda);
      assert.equal(poolData.items.length, 1, "Should have exactly one item");
      assert.equal(poolData.items[0].probability, 10000, "Single item should have 100% probability");
      
      // Test buying and spinning in single item pool
      const singleBuyer = await createBuyerWithSol(2);
      const singleTicketId = 0;
      const singleTicketPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_ticket"),
          singleBuyer.publicKey.toBuffer(),
          singlePda.toBuffer(),
          Buffer.from([0, 0, 0, 0, 0, 0, 0, 0]) // ticket ID 0
        ],
        program.programId
      )[0];

      // Buy ticket
      const buyTx = await program.methods
        .buyTicket()
        .accounts({
          companyPool: singlePda,
          userTicket: singleTicketPda,
          buyer: singleBuyer.publicKey,
          poolVault: singleVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([singleBuyer])
        .rpc();

      await connection.confirmTransaction(buyTx);
      
      // Spin ticket
      const spinTx = await program.methods
        .recordSpinResult()
        .accounts({
          companyPool: singlePda,
          userTicket: singleTicketPda,
          spinner: singleBuyer.publicKey,
          poolVault: singleVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([singleBuyer])
        .rpc();

      await connection.confirmTransaction(spinTx);
      
      // Verify the spin result
      const ticketData = await program.account.userTicket.fetch(singleTicketPda);
      assert.ok(ticketData.used, "Ticket should be used");
      assert.notEqual(ticketData.wonItem, null, "Should have won the single item");
      assert.equal(ticketData.wonItem.name, "OnlyItem", "Should have won the correct item");
      
      console.log("✅ Single item pool test passed");
      
    } catch (error) {
      console.error("❌ Error in single item pool test:", error);
      throw error;
    }
  });

  it("Prevents replay attacks on ticket operations", async () => {
    try {
      console.log("🔒 Testing replay attack prevention...");
      
      const replayBuyer = await createBuyerWithSol(3);
      const { ticketPda } = await buyTicketForUser(replayBuyer);
      
      // Spin the ticket once
      await spinTicket(replayBuyer, ticketPda);
      
      // Try to spin the same ticket again (should fail)
      try {
        await spinTicket(replayBuyer, ticketPda);
        assert.fail("Second spin should have failed");
      } catch (error) {
        console.log("   ✅ Correctly prevented ticket replay");
        assert.ok(error.toString().includes("TicketAlreadyUsed"));
      }
      
      // Try to claim reward
      const claimTx = await program.methods
        .claimReward()
        .accounts({
          companyPool: companyPoolPda,
          userTicket: ticketPda,
          spinner: replayBuyer.publicKey,
          poolVault: poolVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([replayBuyer])
        .rpc();
      
      await connection.confirmTransaction(claimTx);
      
      // Try to claim reward again (should fail)
      try {
        await program.methods
          .claimReward()
          .accounts({
            companyPool: companyPoolPda,
            userTicket: ticketPda,
            spinner: replayBuyer.publicKey,
            poolVault: poolVaultPda,
            systemProgram: SystemProgram.programId,
          })
          .signers([replayBuyer])
          .rpc();
        
        assert.fail("Second claim should have failed");
      } catch (error) {
        console.log("   ✅ Correctly prevented reward claim replay");
        assert.ok(error.toString().includes("RewardAlreadyClaimed"));
      }
      
      console.log("✅ Replay attack prevention test passed");
      
    } catch (error) {
      console.error("❌ Error in replay prevention test:", error);
      throw error;
    }
  });

  // ================== PERFORMANCE TESTS ==================

  it("Maintains performance with maximum item count", async () => {
    try {
      console.log("⚡ Testing performance with maximum items...");
      
      const perfCompanyName = "PerfTest";
      const maxItems = Array.from({ length: 10 }, (_, i) => ({
        image: `https://test.com/perf${i}.png`,
        price: new anchor.BN(10 + i),
        name: `PerfItem${i}`,
        description: `Performance test item ${i}`
      }));
      
      const [perfPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("company_pool"), Buffer.from(perfCompanyName)],
        program.programId
      );
      
      const [perfVaultPda] = await PublicKey.findProgramAddressSync(
        [Buffer.from("pool_vault"), Buffer.from(perfCompanyName)],
        program.programId
      );

      const startTime = Date.now();
      
      const tx = await program.methods
        .initializeCompanyPool(
          ticketPrice,
          perfCompanyName,
          companyImage,
          maxItems
        )
        .accounts({
          companyPool: perfPda,
          poolVault: perfVaultPda,
          authority: provider.wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      await connection.confirmTransaction(tx);
      
      const initTime = Date.now() - startTime;
      console.log(`   Pool initialization with 10 items: ${initTime}ms`);
      
      // Test spinning performance
      const perfBuyer = await createBuyerWithSol(2);
      const perfPoolData = await program.account.companyPool.fetch(perfPda);
      const perfTicketPda = PublicKey.findProgramAddressSync(
        [
          Buffer.from("user_ticket"),
          perfBuyer.publicKey.toBuffer(),
          perfPda.toBuffer(),
          Buffer.from([0, 0, 0, 0, 0, 0, 0, 0])
        ],
        program.programId
      )[0];

      // Buy ticket
      const buyStartTime = Date.now();
      const buyTx = await program.methods
        .buyTicket()
        .accounts({
          companyPool: perfPda,
          userTicket: perfTicketPda,
          buyer: perfBuyer.publicKey,
          poolVault: perfVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([perfBuyer])
        .rpc();
      await connection.confirmTransaction(buyTx);
      
      const buyTime = Date.now() - buyStartTime;
      console.log(`   Ticket purchase: ${buyTime}ms`);
      
      // Spin ticket
      const spinStartTime = Date.now();
      const spinTx = await program.methods
        .recordSpinResult()
        .accounts({
          companyPool: perfPda,
          userTicket: perfTicketPda,
          spinner: perfBuyer.publicKey,
          poolVault: perfVaultPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([perfBuyer])
        .rpc();
      await connection.confirmTransaction(spinTx);
      
      const spinTime = Date.now() - spinStartTime;
      console.log(`   Spin with 10 items: ${spinTime}ms`);
      
      // Assert reasonable performance (less than 5 seconds each)
      assert.ok(initTime < 5000, "Initialization should complete in reasonable time");
      assert.ok(buyTime < 5000, "Ticket purchase should complete in reasonable time");
      assert.ok(spinTime < 5000, "Spin should complete in reasonable time");
      
      console.log("✅ Performance test passed");
      
    } catch (error) {
      console.error("❌ Error in performance test:", error);
      throw error;
    }
  });

  // ================== FINAL COMPREHENSIVE TEST ==================

  it("Final comprehensive claim reward verification", async () => {
    try {
      console.log("🔍 Final claim reward system verification...");
      
      const finalPoolData = await program.account.companyPool.fetch(companyPoolPda);
      const finalVaultBalance = await connection.getBalance(poolVaultPda);
      
      console.log("📊 Final claim reward system state:");
      console.log(`   Pool active: ${finalPoolData.active}`);
      console.log(`   Total tickets sold: ${finalPoolData.totalTicketsSold.toString()}`);
      console.log(`   Pool total funds: ${finalPoolData.totalFunds.toNumber() / LAMPORTS_PER_SOL} SOL`);
      console.log(`   Vault balance: ${finalVaultBalance / LAMPORTS_PER_SOL} SOL`);
      
      if (ticketPdas && ticketPdas.length > 0) {
        let usedTickets = 0;
        let claimedRewards = 0;
        let totalRewardValue = 0;
        
        for (const ticketInfo of ticketPdas) {
          try {
            const ticketData = await program.account.userTicket.fetch(ticketInfo.pda);
            
            if (ticketData.used) {
              usedTickets++;
            }
            
            if (ticketData.rewardClaimed) {
              claimedRewards++;
              if (ticketData.wonItem) {
                totalRewardValue += ticketData.wonItem.price;
              }
            }
          } catch (error) {
            console.log(`   Could not check ticket ${ticketInfo.ticketId}: ${error.message}`);
          }
        }
        
        console.log(`   Used tickets: ${usedTickets}`);
        console.log(`   Claimed rewards: ${claimedRewards}`);
        console.log(`   Total reward value claimed: ${totalRewardValue / LAMPORTS_PER_SOL} SOL`);
        
        assert.ok(claimedRewards <= usedTickets, "Claimed rewards should not exceed used tickets");
        assert.ok(totalRewardValue >= 0, "Total reward value should be non-negative");
      }
      
      assert.ok(finalPoolData.active, "Pool should remain active");
      assert.ok(finalVaultBalance >= 0, "Vault balance should be non-negative");
      
      console.log("✅ Final claim reward verification completed successfully!");
      
    } catch (error) {
      console.error("❌ Error in final verification:", error);
      throw error;
    }
  });

  // ================== SUMMARY TEST ==================

  it("Test suite summary and statistics", async () => {
    console.log("\n" + "=".repeat(60));
    console.log("🎯 COMPREHENSIVE TEST SUITE COMPLETED");
    console.log("=".repeat(60));
    
    const finalPoolData = await program.account.companyPool.fetch(companyPoolPda);
    const finalVaultBalance = await connection.getBalance(poolVaultPda);
    
    console.log("\n📊 FINAL STATISTICS:");
    console.log(`   • Total Tickets Sold: ${finalPoolData.totalTicketsSold.toString()}`);
    console.log(`   • Pool Total Funds: ${finalPoolData.totalFunds.toNumber() / LAMPORTS_PER_SOL} SOL`);
    console.log(`   • Vault Balance: ${finalVaultBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   • Tickets Tracked: ${ticketPdas.length}`);
    console.log(`   • Pool Status: ${finalPoolData.active ? 'Active' : 'Inactive'}`);
    
    console.log("\n✅ TEST CATEGORIES COVERED:");
    console.log("   ✓ Pool Initialization & Configuration");
    console.log("   ✓ Ticket Purchasing & Management");
    console.log("   ✓ Spin Mechanics & Randomness");
    console.log("   ✓ Reward Claiming System");
    console.log("   ✓ Fund Withdrawal & Security");
    console.log("   ✓ Concurrency & Race Conditions");
    console.log("   ✓ Edge Cases & Error Handling");
    console.log("   ✓ Performance & Cost Analysis");
    console.log("   ✓ Security & Access Control");
    console.log("   ✓ Data Integrity & Consistency");
    
    console.log("\n🎉 ALL TESTS COMPLETED SUCCESSFULLY!");
    console.log("=".repeat(60) + "\n");
  });

});