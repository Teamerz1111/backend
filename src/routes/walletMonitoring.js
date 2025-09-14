import express from 'express';
import { ethers } from 'ethers';
import { geminiService } from '../services/gemini.js';
import { ogBlockchainService } from '../services/ogBlockchain.js';
import { blockchainDataService } from '../services/blockchainData.js';
import { broadcastToClients, sendToSubscribedClients } from '../services/websocket.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Monitor a specific wallet address or contract
router.post('/monitor/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;
  const { threshold = 1000, type = 'wallet' } = req.body; // Default threshold and type

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid address format'
    });
  }

  // Analyze wallet risk before adding to monitoring
  let riskAnalysis = null;
  try {
    // Get mock wallet data for analysis (in production, fetch real transaction data)
    const mockWalletData = {
      address: address.toLowerCase(),
      recentTransactions: [],
      dailyVolume: '0',
      dailyTxCount: 0,
      avgAmount: '0'
    };
    
    riskAnalysis = await geminiService.analyzeWalletActivity(mockWalletData);
  } catch (error) {
    logger.warn('Failed to analyze wallet risk', { address, error: error.message });
  }

  // Add wallet/contract to monitoring list
  const monitoredItem = {
    address: address.toLowerCase(),
    type: type, // 'wallet', 'token', 'contract', 'project'
    threshold,
    status: 'monitoring_active',
    addedAt: Date.now(),
    lastChecked: Date.now(),
    hasAlerts: false,
    alertCount: 0,
    riskAnalysis: riskAnalysis,
    riskLevel: riskAnalysis?.riskLevel || 'low',
    riskScore: riskAnalysis ? getRiskScore(riskAnalysis.riskLevel) : 25
  };
  
  monitoredWallets.set(address.toLowerCase(), monitoredItem);
  
  // Store wallet addition event to 0G Storage
  try {
    await ogBlockchainService.storeWalletEvent({
      eventType: 'added',
      walletAddress: address.toLowerCase(),
      threshold,
      metadata: {
        userAgent: req.get('User-Agent') || 'unknown',
        source: 'admin_dashboard'
      }
    });
    
    // Sync entire wallet list to 0G Storage
    await syncWalletsTo0G();
  } catch (error) {
    logger.warn('Failed to store wallet event to 0G Storage', error);
    // Continue execution even if 0G storage fails
  }
  
  logger.info('Started monitoring wallet', { address, threshold });

  // Broadcast wallet monitoring update to connected clients
  broadcastToClients({
    type: 'wallet_monitoring_update',
    action: 'added',
    walletAddress: address.toLowerCase(),
    threshold,
    riskLevel: monitoredItem.riskLevel,
    timestamp: Date.now()
  });

  res.json({
    success: true,
    address: address,
    type: type,
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

// In-memory cache for monitored wallets (backed by 0G Storage)
const monitoredWallets = new Map();

// Helper function to sync wallets to 0G Storage
async function syncWalletsTo0G() {
  try {
    const walletsArray = Array.from(monitoredWallets.values());
    if (walletsArray.length > 0) {
      await ogBlockchainService.storeMonitoredWallets(walletsArray);
      logger.info('Synced monitored wallets to 0G Storage', { count: walletsArray.length });
    }
  } catch (error) {
    logger.error('Failed to sync wallets to 0G Storage', error);
  }
}

// Load monitored wallets from 0G Storage on startup
async function loadWalletsFrom0G() {
  try {
    const result = await ogBlockchainService.retrieveMonitoredWallets();
    if (result.wallets && result.wallets.length > 0) {
      result.wallets.forEach(wallet => {
        monitoredWallets.set(wallet.address.toLowerCase(), wallet);
      });
      logger.info('Loaded monitored wallets from 0G Storage', { count: result.wallets.length });
    }
  } catch (error) {
    logger.error('Failed to load wallets from 0G Storage', error);
  }
}

// Helper function to convert risk level to numeric score
function getRiskScore(riskLevel) {
  switch (riskLevel) {
    case 'critical': return 90;
    case 'high': return 75;
    case 'medium': return 50;
    case 'low': return 25;
    default: return 25;
  }
}

// Initialize wallet loading
loadWalletsFrom0G();

// Get monitoring status for all wallets
router.get('/status', asyncHandler(async (req, res) => {
  const walletsArray = Array.from(monitoredWallets.values());
  
  const status = {
    totalMonitored: walletsArray.length,
    activeAlerts: walletsArray.filter(w => w.hasAlerts).length,
    lastUpdate: Date.now(),
    monitoredWallets: walletsArray
  };

  res.json(status);
}));

// Get list of monitored wallets
router.get('/monitored', asyncHandler(async (req, res) => {
  const walletsArray = Array.from(monitoredWallets.values());
  
  res.json({
    wallets: walletsArray,
    total: walletsArray.length,
    timestamp: Date.now()
  });
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

  // Get wallet data before removal for event logging
  const walletData = monitoredWallets.get(address.toLowerCase());
  
  // Remove wallet from monitoring list
  const removed = monitoredWallets.delete(address.toLowerCase());
  
  if (!removed) {
    return res.status(404).json({
      error: 'Wallet not found in monitoring list'
    });
  }
  
  // Store wallet removal event to 0G Storage
  try {
    await ogBlockchainService.storeWalletEvent({
      eventType: 'removed',
      walletAddress: address.toLowerCase(),
      threshold: walletData?.threshold || 0,
      metadata: {
        userAgent: req.get('User-Agent') || 'unknown',
        source: 'admin_dashboard',
        monitoredDuration: walletData ? Date.now() - walletData.addedAt : 0
      }
    });
    
    // Sync updated wallet list to 0G Storage
    await syncWalletsTo0G();
  } catch (error) {
    logger.warn('Failed to store wallet removal event to 0G Storage', error);
    // Continue execution even if 0G storage fails
  }
  
  logger.info('Stopped monitoring wallet', { address });

  // Broadcast wallet monitoring update to connected clients
  broadcastToClients({
    type: 'wallet_monitoring_update',
    action: 'removed',
    walletAddress: address.toLowerCase(),
    timestamp: Date.now()
  });

  res.json({
    success: true,
    walletAddress: address,
    status: 'monitoring_stopped',
    timestamp: Date.now()
  });
}));

// Get wallet events from 0G Storage
router.get('/events', asyncHandler(async (req, res) => {
  const { limit = 50, eventType, walletAddress } = req.query;

  const filters = {
    type: 'wallet_event',
    limit: parseInt(limit)
  };

  if (eventType) {
    filters.eventType = eventType;
  }

  try {
    const events = await ogBlockchainService.retrieveActivityLogs(filters);
    
    // Filter by wallet address if specified
    let filteredEvents = events.logs;
    if (walletAddress) {
      filteredEvents = events.logs.filter(event => 
        event.data?.payload?.walletAddress === walletAddress.toLowerCase()
      );
    }

    res.json({
      events: filteredEvents,
      total: filteredEvents.length,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('Failed to retrieve wallet events from 0G Storage', error);
    res.json({
      events: [],
      total: 0,
      error: 'Failed to retrieve events from 0G Storage',
      timestamp: Date.now()
    });
  }
}));

// Force sync wallets to 0G Storage (admin endpoint)
router.post('/sync-to-0g', asyncHandler(async (req, res) => {
  try {
    await syncWalletsTo0G();
    const walletsArray = Array.from(monitoredWallets.values());
    
    res.json({
      success: true,
      message: 'Wallets synced to 0G Storage successfully',
      walletCount: walletsArray.length,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('Failed to sync wallets to 0G Storage', error);
    res.status(500).json({
      success: false,
      error: 'Failed to sync wallets to 0G Storage',
      timestamp: Date.now()
    });
  }
}));

// Get real blockchain activities for a specific wallet
router.get('/activity/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;
  const { limit = 20, type = 'all' } = req.query;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid wallet address'
    });
  }

  try {
    let activities = [];

    switch (type) {
      case 'transactions':
        activities = await blockchainDataService.getWalletTransactions(address, parseInt(limit));
        break;
      case 'tokens':
        activities = await blockchainDataService.getTokenTransfers(address, parseInt(limit));
        break;
      case 'nfts':
        activities = await blockchainDataService.getNFTTransfers(address, parseInt(limit));
        break;
      case 'internal':
        activities = await blockchainDataService.getInternalTransactions(address, parseInt(limit));
        break;
      case 'all':
      default:
        activities = await blockchainDataService.getAggregatedWalletActivity(address, parseInt(limit));
        break;
    }

    res.json({
      walletAddress: address,
      activityType: type,
      activities,
      count: activities.length,
      timestamp: Date.now()
    });

  } catch (error) {
    logger.error('Failed to fetch wallet activities', { address, error: error.message });
    res.status(500).json({
      error: 'Failed to fetch wallet activities',
      timestamp: Date.now()
    });
  }
}));

// Get aggregated activity feed for all monitored wallets
router.get('/activity-feed', asyncHandler(async (req, res) => {
  const { limit = 50 } = req.query;

  try {
    const monitoredWalletsArray = Array.from(monitoredWallets.values());
    
    if (monitoredWalletsArray.length === 0) {
      return res.json({
        activities: [],
        walletsCount: 0,
        totalActivities: 0,
        timestamp: Date.now()
      });
    }

    // Fetch activities for all monitored items (wallets and tokens)
    const itemActivities = await Promise.all(
      monitoredWalletsArray.map(async (item) => {
        try {
          let activities = [];
          
          if (item.type === 'token') {
            // For tokens, get token transfer activities
            activities = await blockchainDataService.getTokenContractActivity(
              item.address, 
              Math.floor(parseInt(limit) / monitoredWalletsArray.length) + 10
            );
          } else {
            // For wallets, contracts, and projects, get wallet activities
            activities = await blockchainDataService.getAggregatedWalletActivity(
              item.address, 
              Math.floor(parseInt(limit) / monitoredWalletsArray.length) + 5
            );
          }
          
          // Add monitoring context to each activity
          return activities.map(activity => ({
            ...activity,
            monitoredItem: item.address,
            monitoredType: item.type,
            itemThreshold: item.threshold,
            itemRiskLevel: item.riskLevel
          }));
        } catch (error) {
          logger.warn('Failed to fetch activities for monitored item', { 
            address: item.address,
            type: item.type,
            error: error.message 
          });
          return [];
        }
      })
    );

    // Flatten and sort all activities
    const allActivities = itemActivities.flat();
    allActivities.sort((a, b) => b.timestamp - a.timestamp);

    // Apply final limit
    const limitedActivities = allActivities.slice(0, parseInt(limit));

    res.json({
      activities: limitedActivities,
      walletsCount: monitoredWalletsArray.length,
      totalActivities: limitedActivities.length,
      timestamp: Date.now()
    });

  } catch (error) {
    logger.error('Failed to fetch activity feed', error);
    res.status(500).json({
      error: 'Failed to fetch activity feed',
      activities: [],
      timestamp: Date.now()
    });
  }
}));

// Get wallet balance and basic info
router.get('/balance/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;

  if (!ethers.isAddress(address)) {
    return res.status(400).json({
      error: 'Invalid wallet address'
    });
  }

  try {
    const balance = await blockchainDataService.getWalletBalance(address);
    
    if (!balance) {
      return res.status(500).json({
        error: 'Failed to fetch wallet balance'
      });
    }

    res.json(balance);
  } catch (error) {
    logger.error('Failed to fetch wallet balance', { address, error: error.message });
    res.status(500).json({
      error: 'Failed to fetch wallet balance',
      timestamp: Date.now()
    });
  }
}));

// Test endpoint to generate sample activity data (for development)
router.post('/test/generate-activity', asyncHandler(async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Test endpoints not available in production' });
  }

  try {
    // Generate sample wallet events
    const sampleWallets = [
      '0x3f5ce5fbfe3e9af3971dd833d26ba9b5c936f0be',
      '0x71660c4005ba85c37ccec55d0c4493e66fe775d3',
      '0x2910543af39aba0cd09dbb2d50200b3e800a63d2'
    ];

    const events = [];

    // Create wallet addition events
    for (const wallet of sampleWallets) {
      const addEvent = await ogBlockchainService.storeWalletEvent({
        eventType: 'added',
        walletAddress: wallet,
        threshold: Math.floor(Math.random() * 10000) + 1000,
        metadata: {
          source: 'test_data_generation',
          userAgent: 'test-script'
        }
      });
      events.push(addEvent);

      // Create some analysis/alert data
      const mockAnalysis = {
        isUnusual: Math.random() > 0.5,
        riskLevel: ['low', 'medium', 'high', 'critical'][Math.floor(Math.random() * 4)],
        anomalies: ['large_amount_spike', 'unusual_timing', 'high_frequency'][Math.floor(Math.random() * 3)]
      };

      if (mockAnalysis.isUnusual) {
        const alertEvent = await ogBlockchainService.storeActivityLog({
          type: 'unusual_activity_alert',
          payload: {
            walletAddress: wallet,
            analysis: mockAnalysis,
            transactionHash: `0x${Math.random().toString(16).substr(2, 64)}`,
            timestamp: Date.now() - Math.floor(Math.random() * 86400000) // Random time in last 24h
          },
          source: 'test_alert_generation',
          timestamp: Date.now()
        });
        events.push(alertEvent);

        // Send real-time notification
        broadcastToClients({
          type: 'unusual_activity_detected',
          walletAddress: wallet,
          analysis: mockAnalysis,
          timestamp: Date.now()
        });
      }
    }

    res.json({
      success: true,
      message: 'Generated sample activity data',
      eventsCreated: events.length,
      events: events.map(e => ({ id: e.logId, timestamp: e.timestamp })),
      timestamp: Date.now()
    });

  } catch (error) {
    logger.error('Failed to generate test activity data', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate test data',
      timestamp: Date.now()
    });
  }
}));

export default router;
