import express from 'express';
import { ogBlockchainService } from '../services/ogBlockchain.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Store data to 0G blockchain
router.post('/store', asyncHandler(async (req, res) => {
  const { data, type = 'general' } = req.body;

  if (!data) {
    return res.status(400).json({
      error: 'Data is required'
    });
  }

  const logData = {
    type,
    payload: data,
    source: 'chainsage_backend',
    timestamp: Date.now()
  };

  const result = await ogBlockchainService.storeActivityLog(logData);

  res.json({
    success: true,
    storage: result,
    timestamp: Date.now()
  });
}));

// Retrieve data from 0G blockchain
router.get('/retrieve', asyncHandler(async (req, res) => {
  const { 
    type, 
    limit = 100, 
    page = 1, 
    startTime, 
    endTime 
  } = req.query;

  const filters = {
    limit: parseInt(limit),
    page: parseInt(page)
  };

  if (type) filters.type = type;
  if (startTime) filters.startTime = parseInt(startTime);
  if (endTime) filters.endTime = parseInt(endTime);

  const result = await ogBlockchainService.retrieveActivityLogs(filters);

  res.json(result);
}));

// Get 0G network information
router.get('/network-info', asyncHandler(async (req, res) => {
  const networkInfo = await ogBlockchainService.getNetworkInfo();
  
  res.json({
    network: '0G Blockchain',
    ...networkInfo,
    timestamp: Date.now()
  });
}));

// Stream real-time data to 0G
router.post('/stream', asyncHandler(async (req, res) => {
  const { streamData, metadata = {} } = req.body;

  if (!streamData) {
    return res.status(400).json({
      error: 'Stream data is required'
    });
  }

  const enrichedData = {
    ...streamData,
    metadata: {
      ...metadata,
      source: 'chainsage_backend',
      streamedAt: Date.now()
    }
  };

  const result = await ogBlockchainService.streamUnusualActivity(enrichedData);

  res.json({
    success: true,
    stream: result,
    timestamp: Date.now()
  });
}));

// Health check for 0G connection
router.get('/health', asyncHandler(async (req, res) => {
  try {
    const networkInfo = await ogBlockchainService.getNetworkInfo();
    
    res.json({
      status: 'healthy',
      connected: true,
      chainId: networkInfo.chainId,
      latestBlock: networkInfo.blockNumber,
      timestamp: Date.now()
    });
  } catch (error) {
    logger.error('0G health check failed', error);
    
    res.status(503).json({
      status: 'unhealthy',
      connected: false,
      error: error.message,
      timestamp: Date.now()
    });
  }
}));

export default router;
