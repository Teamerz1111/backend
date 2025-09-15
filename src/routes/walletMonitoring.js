import express from 'express';
import { ethers } from 'ethers';
import { geminiService } from '../services/gemini.js';
import { ogBlockchainService } from '../services/ogBlockchain.js';
import { blockchainDataService } from '../services/blockchainData.js';
import { broadcastToClients, sendToSubscribedClients } from '../services/websocket.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';
import fs from 'fs/promises';
import path from 'path';

const router = express.Router();

// Fallback analysis function when AI services are unavailable
function generateFallbackAnalysis(walletData) {
  const { dailyTxCount, dailyVolume, recentTransactions, recentTokenTransfers, totalTransactions } = walletData;
  
  // Simple rule-based analysis
  let riskLevel = 'low';
  let isUnusual = false;
  const anomalies = [];
  
  // Check transaction frequency
  if (dailyTxCount > 100) {
    riskLevel = 'high';
    isUnusual = true;
    anomalies.push('high_frequency_transactions');
  } else if (dailyTxCount > 50) {
    riskLevel = 'medium';
    anomalies.push('moderate_frequency_transactions');
  }
  
  // Check daily volume (convert from wei to ETH)
  const dailyVolumeEth = parseFloat(dailyVolume) / 1e18;
  if (dailyVolumeEth > 100) {
    riskLevel = 'high';
    isUnusual = true;
    anomalies.push('large_volume_spike');
  } else if (dailyVolumeEth > 10) {
    if (riskLevel === 'low') riskLevel = 'medium';
    anomalies.push('elevated_volume');
  }
  
  // Check for failed transactions
  const failedTxCount = recentTransactions.filter(tx => tx.isError).length;
  if (failedTxCount > dailyTxCount * 0.3) {
    if (riskLevel === 'low') riskLevel = 'medium';
    anomalies.push('high_failure_rate');
  }
  
  // Check token activity
  if (recentTokenTransfers.length > 20) {
    if (riskLevel === 'low') riskLevel = 'medium';
    anomalies.push('high_token_activity');
  }
  
  // Set unusual activity for high risk
  if (riskLevel === 'high') {
    isUnusual = true;
  }
  
  // Calculate confidence based on data availability
  let confidence = 0.6; // Base confidence for rule-based analysis
  if (totalTransactions > 100) confidence += 0.1;
  if (dailyTxCount > 0) confidence += 0.1;
  if (recentTokenTransfers.length > 0) confidence += 0.1;
  
  return {
    isUnusual,
    riskLevel,
    confidence: Math.min(confidence, 0.9),
    anomalies,
    reason: `Rule-based analysis: ${anomalies.length > 0 ? anomalies.join(', ') : 'normal activity patterns'}`,
    fallbackAnalysis: true,
    dailyVolume: dailyVolumeEth.toFixed(4) + ' ETH',
    dailyTxCount,
    avgAmount: dailyTxCount > 0 ? (dailyVolumeEth / dailyTxCount).toFixed(4) + ' ETH' : '0 ETH'
  };
}

// Monitor a specific wallet address or contract
router.post('/monitor/:address', asyncHandler(async (req, res) => {
  const { address } = req.params;
  const { threshold = 1000, type = 'wallet', chainId = '1' } = req.body; // Default threshold, type, and chainId
  logger.info('req.body', req.body)

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
    chainId: chainId, // Store chainId for this monitored item
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
  console.log('monitoredWallets', monitoredWallets)
  
  // Immediately save to backup file
  await saveToBackupFile();
  
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

  try {
    // Fetch real blockchain data for the wallet with error handling
    logger.info('Fetching real blockchain data for wallet analysis', { address });
    
    let transactions = [];
    let tokenTransfers = [];
    let balance = null;
    
    // Fetch data with individual error handling
    try {
      transactions = await blockchainDataService.getWalletTransactions(address, 100);
    } catch (txError) {
      logger.warn('Failed to fetch transactions, using empty array', { address, error: txError.message });
    }
    
    try {
      tokenTransfers = await blockchainDataService.getTokenTransfers(address, 50);
    } catch (tokenError) {
      logger.warn('Failed to fetch token transfers, using empty array', { address, error: tokenError.message });
    }
    
    try {
      balance = await blockchainDataService.getWalletBalance(address);
    } catch (balanceError) {
      logger.warn('Failed to fetch balance, using null', { address, error: balanceError.message });
    }

    // Calculate analytics from real transaction data
    const now = Date.now();
    const oneDayAgo = now - (24 * 60 * 60 * 1000);
    
    // Filter transactions from last 24 hours
    const recentTransactions = transactions.filter(tx => tx.timestamp > oneDayAgo);
    const recentTokenTransfers = tokenTransfers.filter(tx => tx.timestamp > oneDayAgo);
    
    // Calculate daily metrics
    const dailyTxCount = recentTransactions.length + recentTokenTransfers.length;
    
    // Calculate daily volume (ETH only)
    const dailyVolume = recentTransactions.reduce((total, tx) => {
      return total + parseFloat(tx.value || 0);
    }, 0);
    
    // Calculate average transaction amount
    const avgAmount = dailyTxCount > 0 ? dailyVolume / recentTransactions.length : 0;
    
    // Prepare real wallet data for analysis
    const realWalletData = {
      address: address.toLowerCase(),
      recentTransactions: transactions.slice(0, 20).map(tx => ({
        hash: tx.hash,
        amount: tx.value,
        timestamp: tx.timestamp,
        from: tx.from,
        to: tx.to,
        isError: tx.isError,
        gasUsed: tx.gasUsed,
        blockNumber: tx.blockNumber
      })),
      recentTokenTransfers: tokenTransfers.slice(0, 10).map(transfer => ({
        hash: transfer.hash,
        tokenSymbol: transfer.tokenSymbol,
        tokenName: transfer.tokenName,
        value: transfer.value,
        formattedValue: transfer.formattedValue,
        from: transfer.from,
        to: transfer.to,
        timestamp: transfer.timestamp
      })),
      dailyVolume: dailyVolume.toString(),
      dailyTxCount,
      avgAmount: avgAmount.toString(),
      balance: balance?.balance || '0',
      balanceEth: balance?.balanceEth || '0',
      totalTransactions: transactions.length,
      totalTokenTransfers: tokenTransfers.length
    };

    logger.info('Real wallet data prepared for analysis', {
      address,
      dailyTxCount,
      dailyVolumeEth: (dailyVolume / 1e18).toFixed(4),
      totalTransactions: transactions.length,
      totalTokenTransfers: tokenTransfers.length
    });

    // Analyze with Gemini AI using real data, with fallback for quota limits
    let analysis;
    try {
      analysis = await geminiService.analyzeWalletActivity(realWalletData);
    } catch (aiError) {
      logger.warn('Gemini AI analysis failed, using fallback analysis', { 
        address, 
        error: aiError.message 
      });
      
      // Fallback analysis based on real transaction data
      analysis = generateFallbackAnalysis(realWalletData);
    }

    // If unusual activity detected, stream to 0G and notify clients
    if (analysis.isUnusual) {
      const streamData = {
        walletAddress: address,
        analysis,
        walletData: realWalletData,
        timestamp: Date.now()
      };

      try {
        // Stream to 0G blockchain
        const streamResult = await ogBlockchainService.streamUnusualActivity(streamData);
        logger.info('Unusual activity streamed to 0G', { address, streamResult });
      } catch (streamError) {
        logger.warn('Failed to stream to 0G', { address, error: streamError.message });
      }

      // Notify connected clients via WebSocket
      sendToSubscribedClients(address, {
        type: 'unusual_activity_detected',
        data: streamData
      });

      logger.warn('Unusual wallet activity detected with real data', {
        address,
        riskLevel: analysis.riskLevel,
        anomalies: analysis.anomalies,
        dailyTxCount,
        dailyVolumeEth: (dailyVolume / 1e18).toFixed(4)
      });
    }

    res.json({
      walletAddress: address,
      analysis,
      walletData: {
        dailyTxCount,
        dailyVolumeEth: (dailyVolume / 1e18).toFixed(4),
        totalTransactions: transactions.length,
        totalTokenTransfers: tokenTransfers.length,
        currentBalanceEth: balance?.balanceEth || '0'
      },
      dataAvailability: {
        transactionsAvailable: transactions.length > 0,
        tokenTransfersAvailable: tokenTransfers.length > 0,
        balanceAvailable: balance !== null,
        aiAnalysisUsed: !analysis.fallbackAnalysis
      },
      timestamp: Date.now()
    });

  } catch (error) {
    logger.error('Failed to analyze wallet with real data', { 
      address, 
      error: error.message 
    });
    
    res.status(500).json({
      error: 'Failed to analyze wallet activity',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      timestamp: Date.now()
    });
  }
}));

// In-memory cache for monitored wallets (backed by 0G Storage)
const monitoredWallets = new Map();

// Backup file path for local persistence
const BACKUP_FILE_PATH = path.join(process.cwd(), 'data', 'monitored-wallets-backup.json');

// Ensure data directory exists
async function ensureDataDirectory() {
  try {
    await fs.mkdir(path.dirname(BACKUP_FILE_PATH), { recursive: true });
  } catch (error) {
    logger.warn('Failed to create data directory', { error: error.message });
  }
}

// Save to local backup file
async function saveToBackupFile() {
  try {
    await ensureDataDirectory();
    const walletsArray = Array.from(monitoredWallets.values());
    await fs.writeFile(BACKUP_FILE_PATH, JSON.stringify(walletsArray, null, 2));
    logger.info('Saved monitored wallets to backup file', { count: walletsArray.length });
  } catch (error) {
    logger.error('Failed to save to backup file', { error: error.message });
  }
}

// Load from local backup file
async function loadFromBackupFile() {
  try {
    const data = await fs.readFile(BACKUP_FILE_PATH, 'utf-8');
    const walletsArray = JSON.parse(data);
    
    walletsArray.forEach(wallet => {
      monitoredWallets.set(wallet.address.toLowerCase(), wallet);
    });
    
    logger.info('Loaded monitored wallets from backup file', { 
      count: walletsArray.length,
      addresses: walletsArray.map(w => w.address)
    });
    return true;
  } catch (error) {
    logger.info('No backup file found or failed to load', { error: error.message });
    return false;
  }
}

// Helper function to sync wallets to 0G Storage
async function syncWalletsTo0G() {
  try {
    const walletsArray = Array.from(monitoredWallets.values());
    if (walletsArray.length > 0) {
      // Try to save to 0G Storage
      try {
        await ogBlockchainService.storeMonitoredWallets(walletsArray);
        logger.info('Synced monitored wallets to 0G Storage', { count: walletsArray.length });
      } catch (ogError) {
        logger.warn('Failed to sync to 0G Storage, but continuing with backup file', { error: ogError.message });
      }
      
      // Always save to backup file as well
      await saveToBackupFile();
    }
  } catch (error) {
    logger.error('Failed to sync wallets', error);
  }
}

// Load monitored wallets from 0G Storage on startup
async function loadWalletsFrom0G() {
  let loaded = false;
  
  // Try to load from 0G Storage first
  try {
    logger.info('Attempting to load monitored wallets from 0G Storage...');
    const result = await ogBlockchainService.retrieveMonitoredWallets();
    logger.info('0G Storage result received', { result });
    
    if (result && result.wallets && result.wallets.length > 0) {
      result.wallets.forEach(wallet => {
        monitoredWallets.set(wallet.address.toLowerCase(), wallet);
      });
      logger.info('Successfully loaded monitored wallets from 0G Storage', { 
        count: result.wallets.length,
        addresses: result.wallets.map(w => w.address)
      });
      loaded = true;
    } else {
      logger.info('No monitored wallets found in 0G Storage or empty result', { result });
    }
    
  } catch (error) {
    logger.error('Failed to load wallets from 0G Storage, trying backup file', { 
      error: error.message
    });
  }
  
  // If 0G Storage failed or was empty, try backup file
  if (!loaded) {
    logger.info('Attempting to load monitored wallets from backup file...');
    loaded = await loadFromBackupFile();
  }
  
  // Log final state
  const currentWallets = Array.from(monitoredWallets.values());
  logger.info('Final monitored wallets state after loading', { 
    count: currentWallets.length,
    addresses: currentWallets.map(w => w.address),
    loadedFrom: loaded ? (currentWallets.length > 0 ? '0G Storage or backup file' : 'nowhere') : 'nowhere'
  });
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
  
  logger.info('GET /monitored called', {
    mapSize: monitoredWallets.size,
    arrayLength: walletsArray.length,
    wallets: walletsArray.map(w => ({ address: w.address, type: w.type }))
  });
  
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

// Debug endpoint to reload wallets from 0G Storage
router.post('/reload-from-0g', asyncHandler(async (req, res) => {
  try {
    logger.info('Manual reload from 0G Storage requested');
    await loadWalletsFrom0G();
    const walletsArray = Array.from(monitoredWallets.values());
    
    res.json({
      success: true,
      message: 'Wallets reloaded from 0G Storage',
      walletCount: walletsArray.length,
      wallets: walletsArray.map(w => ({ address: w.address, type: w.type })),
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('Failed to reload wallets from 0G Storage', error);
    res.status(500).json({
      success: false,
      error: 'Failed to reload wallets from 0G Storage',
      timestamp: Date.now()
    });
  }
}));

// Debug endpoint to check current state
router.get('/debug/state', asyncHandler(async (req, res) => {
  const walletsArray = Array.from(monitoredWallets.values());
  
  res.json({
    monitoredWallets: {
      mapSize: monitoredWallets.size,
      arrayLength: walletsArray.length,
      wallets: walletsArray
    },
    timestamp: Date.now()
  });
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
  const { limit = 50, chainId } = req.query;

  try {
    const monitoredWalletsArray = Array.from(monitoredWallets.values())
      .filter(w => !chainId || w.chainId === chainId);

    logger.info('Activity feed request - monitoredWallets state', {
      mapSize: monitoredWallets.size,
      arrayLength: monitoredWalletsArray.length,
      wallets: monitoredWalletsArray.map(w => ({ 
        address: w.address, 
        type: w.type,
        addedAt: w.addedAt 
      }))
    });

    if (monitoredWalletsArray.length === 0) {
      return res.json({
        activities: [],
        walletsCount: 0,
        totalActivities: 0,
        timestamp: Date.now()
      });
    }
    const promises = monitoredWalletsArray.map(async (item) => {
      try {
        let activities = [];
        console.log('item', item)
        logger.info('item', item)
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
          monitoredChainId: item.chainId,
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
    });

    // Fetch activities for all monitored items (wallets and tokens)
    const itemActivities = await Promise.all(promises);

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
