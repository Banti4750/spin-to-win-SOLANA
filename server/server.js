// server.js
const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { createHash, randomBytes } = require('crypto');
const { Connection, PublicKey, clusterApiUrl } = require('@solana/web3.js');
const { AnchorProvider, Program, web3 } = require('@project-serum/anchor');
const Redis = require('redis');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Redis client for caching and rate limiting
const redisClient = Redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

// MongoDB connection
mongoose.connect(process.env.MONGODB_URL || 'mongodb://localhost:27017/spintowin');

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const spinLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5, // 5 spins per minute per IP
  message: { error: 'Too many spin attempts. Try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// MongoDB Schemas
const UserSchema = new mongoose.Schema({
  walletAddress: { type: String, required: true, unique: true },
  totalSpins: { type: Number, default: 0 },
  totalWinnings: { type: Number, default: 0 },
  lastSpinTime: { type: Date },
  isBlacklisted: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now }
});

const SpinResultSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  walletAddress: { type: String, required: true },
  poolId: { type: String, required: true },
  spinId: { type: String, required: true, unique: true },
  resultIndex: { type: Number, required: true },
  rewardName: { type: String, required: true },
  rewardValue: { type: Number, required: true },
  nonce: { type: String, required: true },
  randomSeed: { type: String, required: true },
  isClaimed: { type: Boolean, default: false },
  transactionHash: { type: String },
  createdAt: { type: Date, default: Date.now }
});

const PoolStatsSchema = new mongoose.Schema({
  poolId: { type: String, required: true, unique: true },
  totalTicketsSold: { type: Number, default: 0 },
  totalRewardsPaid: { type: Number, default: 0 },
  totalRevenue: { type: Number, default: 0 },
  activeUsers: { type: Number, default: 0 },
  lastUpdated: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const SpinResult = mongoose.model('SpinResult', SpinResultSchema);
const PoolStats = mongoose.model('PoolStats', PoolStatsSchema);

// Solana connection
const connection = new Connection(
  process.env.SOLANA_RPC_URL || clusterApiUrl('devnet'),
  'confirmed'
);

// Reward probability configuration
const REWARD_PROBABILITIES = [
  { name: "Small Prize", value: 0.1, probability: 60 },      // 60% chance
  { name: "Medium Prize", value: 0.5, probability: 25 },     // 25% chance
  { name: "Large Prize", value: 1.0, probability: 10 },      // 10% chance
  { name: "Jackpot", value: 5.0, probability: 4 },          // 4% chance
  { name: "Super Jackpot", value: 10.0, probability: 1 }    // 1% chance
];

// Utility Functions
class SpinEngine {
  static generateSecureRandom() {
    return randomBytes(32).toString('hex');
  }

  static calculateSpinResult(seed, userWallet, nonce) {
    const combinedSeed = `${seed}:${userWallet}:${nonce}`;
    const hash = createHash('sha256').update(combinedSeed).digest('hex');
    const randomValue = parseInt(hash.substring(0, 8), 16) % 100;

    let cumulativeProbability = 0;
    for (let i = 0; i < REWARD_PROBABILITIES.length; i++) {
      cumulativeProbability += REWARD_PROBABILITIES[i].probability;
      if (randomValue < cumulativeProbability) {
        return {
          index: i,
          reward: REWARD_PROBABILITIES[i],
          randomValue,
          hash: hash.substring(0, 16)
        };
      }
    }

    // Fallback to lowest reward
    return {
      index: 0,
      reward: REWARD_PROBABILITIES[0],
      randomValue,
      hash: hash.substring(0, 16)
    };
  }

  static async validateSpinEligibility(walletAddress) {
    // Check if user exists and is not blacklisted
    const user = await User.findOne({ walletAddress });
    if (user && user.isBlacklisted) {
      throw new Error('User is blacklisted');
    }

    // Check rate limiting in Redis
    const recentSpins = await redisClient.get(`spins:${walletAddress}`);
    if (recentSpins && parseInt(recentSpins) >= 5) {
      throw new Error('Rate limit exceeded');
    }

    return true;
  }

  static async recordSpinAttempt(walletAddress) {
    const key = `spins:${walletAddress}`;
    const current = await redisClient.get(key);
    const count = current ? parseInt(current) + 1 : 1;
    await redisClient.setEx(key, 60, count.toString()); // 1 minute expiry
  }
}

// API Routes

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// Get pool configuration
app.get('/api/pool/:poolId/config', async (req, res) => {
  try {
    const { poolId } = req.params;

    // In a real app, fetch from blockchain
    const poolConfig = {
      poolId,
      ticketPrice: 1.0, // SOL
      rewards: REWARD_PROBABILITIES,
      isActive: true,
      maxSpinsPerUser: 10
    };

    res.json(poolConfig);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Request spin (generates secure random result)
app.post('/api/spin/request', spinLimiter, async (req, res) => {
  try {
    const { walletAddress, poolId, ticketTransactionHash } = req.body;

    if (!walletAddress || !poolId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate spin eligibility
    await SpinEngine.validateSpinEligibility(walletAddress);

    // Record spin attempt for rate limiting
    await SpinEngine.recordSpinAttempt(walletAddress);

    // Generate secure random seed and nonce
    const randomSeed = SpinEngine.generateSecureRandom();
    const nonce = randomBytes(8).toString('hex');
    const spinId = `${walletAddress}_${Date.now()}_${nonce}`;

    // Calculate spin result
    const result = SpinEngine.calculateSpinResult(randomSeed, walletAddress, nonce);

    // Save to database
    let user = await User.findOne({ walletAddress });
    if (!user) {
      user = new User({ walletAddress });
      await user.save();
    }

    const spinResult = new SpinResult({
      userId: user._id,
      walletAddress,
      poolId,
      spinId,
      resultIndex: result.index,
      rewardName: result.reward.name,
      rewardValue: result.reward.value,
      nonce,
      randomSeed,
      transactionHash: ticketTransactionHash
    });

    await spinResult.save();

    // Update user stats
    user.totalSpins += 1;
    user.lastSpinTime = new Date();
    await user.save();

    res.json({
      spinId,
      resultIndex: result.index,
      reward: result.reward,
      nonce,
      hash: result.hash,
      canClaim: true
    });

  } catch (error) {
    console.error('Spin request error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Verify spin result (called by frontend before blockchain submission)
app.post('/api/spin/verify', async (req, res) => {
  try {
    const { spinId, walletAddress, resultIndex } = req.body;

    const spinResult = await SpinResult.findOne({
      spinId,
      walletAddress,
      resultIndex
    });

    if (!spinResult) {
      return res.status(404).json({ error: 'Spin result not found' });
    }

    // Verify the result matches our calculation
    const recalculated = SpinEngine.calculateSpinResult(
      spinResult.randomSeed,
      walletAddress,
      spinResult.nonce
    );

    if (recalculated.index !== resultIndex) {
      return res.status(400).json({ error: 'Invalid spin result' });
    }

    res.json({
      valid: true,
      spinId,
      resultIndex,
      reward: spinResult.rewardName,
      nonce: spinResult.nonce
    });

  } catch (error) {
    console.error('Verification error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get user statistics
app.get('/api/user/:walletAddress/stats', async (req, res) => {
  try {
    const { walletAddress } = req.params;

    const user = await User.findOne({ walletAddress });
    const recentSpins = await SpinResult.find({ walletAddress })
      .sort({ createdAt: -1 })
      .limit(10);

    res.json({
      totalSpins: user?.totalSpins || 0,
      totalWinnings: user?.totalWinnings || 0,
      recentSpins: recentSpins.map(spin => ({
        spinId: spin.spinId,
        rewardName: spin.rewardName,
        rewardValue: spin.rewardValue,
        isClaimed: spin.isClaimed,
        createdAt: spin.createdAt
      }))
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Get pool statistics
app.get('/api/admin/pool/:poolId/stats', async (req, res) => {
  try {
    const { poolId } = req.params;

    const stats = await PoolStats.findOne({ poolId });
    const recentSpins = await SpinResult.find({ poolId })
      .sort({ createdAt: -1 })
      .limit(50);

    const totalSpins = await SpinResult.countDocuments({ poolId });
    const totalRewards = await SpinResult.aggregate([
      { $match: { poolId } },
      { $group: { _id: null, total: { $sum: '$rewardValue' } } }
    ]);

    res.json({
      poolId,
      totalSpins,
      totalRewards: totalRewards[0]?.total || 0,
      recentSpins: recentSpins.map(spin => ({
        walletAddress: spin.walletAddress.substring(0, 8) + '...',
        rewardName: spin.rewardName,
        rewardValue: spin.rewardValue,
        createdAt: spin.createdAt
      }))
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Admin: Update reward probabilities
app.post('/api/admin/pool/:poolId/rewards', async (req, res) => {
  try {
    const { poolId } = req.params;
    const { rewards } = req.body;

    // Validate probabilities sum to 100
    const totalProbability = rewards.reduce((sum, reward) => sum + reward.probability, 0);
    if (totalProbability !== 100) {
      return res.status(400).json({ error: 'Probabilities must sum to 100' });
    }

    // Update configuration (in production, this would update the blockchain)
    // For now, we'll just acknowledge the update
    res.json({ success: true, message: 'Rewards updated successfully' });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Webhook: Handle blockchain events
app.post('/api/webhook/blockchain', async (req, res) => {
  try {
    const { eventType, data } = req.body;

    switch (eventType) {
      case 'reward_claimed':
        await SpinResult.findOneAndUpdate(
          { spinId: data.spinId },
          {
            isClaimed: true,
            transactionHash: data.transactionHash
          }
        );

        // Update user total winnings
        const user = await User.findOne({ walletAddress: data.walletAddress });
        if (user) {
          user.totalWinnings += data.rewardValue;
          await user.save();
        }
        break;

      case 'ticket_purchased':
        // Update pool stats
        await PoolStats.findOneAndUpdate(
          { poolId: data.poolId },
          {
            $inc: {
              totalTicketsSold: 1,
              totalRevenue: data.ticketPrice
            },
            lastUpdated: new Date()
          },
          { upsert: true }
        );
        break;
    }

    res.json({ success: true });

  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function startServer() {
  try {
    await redisClient.connect();
    console.log('Connected to Redis');

    app.listen(PORT, () => {
      console.log(`Spin-to-Win backend running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down gracefully...');
  await redisClient.disconnect();
  await mongoose.connection.close();
  process.exit(0);
});

module.exports = app;