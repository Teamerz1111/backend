import express from 'express';
import { geminiService } from '../services/gemini.js';
import { ogBlockchainService } from '../services/ogBlockchain.js';
import { broadcastToClients, sendToSubscribedClients } from '../services/websocket.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Monitor a specific wallet address
router.post('/monitor/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;
  const { threshold = 1000 } = req.body; // Default threshold for unusual activity

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid wallet address'
    });
  }

  // TODO: Add wallet to monitoring list
  // For now, simulate monitoring setup
  
  logger.info('Started monitoring wallet', { address, threshold });

  res.json({
    success: true,
    walletAddress: address,
    threshold,
    status: 'monitoring_active',
    timestamp: Date.now()
  });
}));

// Analyze wallet activity
router.post('/analyze/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid wallet address'
    });
  }

  // Get recent transactions for the wallet
  // TODO: Implement actual transaction fetching from 0G or other sources
  const mockWalletData = {
    address,
    recentTransactions: [
      // Mock transaction data
      {
        hash: '0x123...',
        amount: '1000000000000000000', // 1 ETH in wei
        timestamp: Date.now() - 3600000,
        from: address,
        to: '0xabc...'
      }
    ],
    dailyVolume: '5000000000000000000', // 5 ETH in wei
    dailyTxCount: 25,
    avgAmount: '200000000000000000' // 0.2 ETH in wei
  };

  // Analyze with Gemini AI
  const analysis = await geminiService.analyzeWalletActivity(mockWalletData);

  // If unusual activity detected, stream to 0G and notify clients
  if (analysis.isUnusual) {
    const streamData = {
      walletAddress: address,
      analysis,
      walletData: mockWalletData,
      timestamp: Date.now()
    };

    // Stream to 0G blockchain
    const streamResult = await ogBlockchainService.streamUnusualActivity(streamData);

    // Notify connected clients via WebSocket
    sendToSubscribedClients(address, {
      type: 'unusual_activity_detected',
      data: streamData
    });

    logger.warn('Unusual wallet activity detected', {
      address,
      riskLevel: analysis.riskLevel,
      anomalies: analysis.anomalies
    });
  }

  res.json({
    walletAddress: address,
    analysis,
    timestamp: Date.now()
  });
}));

// Get monitoring status for all wallets
router.get('/status', asyncHandler(async (req, res) => {
  // TODO: Implement actual monitoring status from database or cache
  
  const mockStatus = {
    totalMonitored: 45,
    activeAlerts: 3,
    lastUpdate: Date.now(),
    monitoredWallets: [
      // Mock wallet statuses
    ]
  };

  res.json(mockStatus);
}));

// Get unusual activity alerts
router.get('/alerts', asyncHandler(async (req, res) => {
  const { limit = 50, severity } = req.query;

  const filters = {
    type: 'unusual_activity',
    limit: parseInt(limit)
  };

  if (severity) {
    filters.severity = severity;
  }

  const alerts = await ogBlockchainService.retrieveActivityLogs(filters);

  res.json({
    alerts: alerts.logs,
    total: alerts.total,
    timestamp: Date.now()
  });
}));

// Stop monitoring a wallet
router.delete('/monitor/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid wallet address'
    });
  }

  // TODO: Remove wallet from monitoring list
  
  logger.info('Stopped monitoring wallet', { address });

  res.json({
    success: true,
    walletAddress: address,
    status: 'monitoring_stopped',
    timestamp: Date.now()
  });
}));

export default router;
