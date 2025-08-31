import express from 'express';
import { geminiService } from '../services/gemini.js';
import { ogBlockchainService } from '../services/ogBlockchain.js';
import { asyncHandler } from '../middleware/errorHandler.js';
import { logger } from '../utils/logger.js';

const router = express.Router();

// Classify a single transaction
router.post('/classify', asyncHandler(async (req, res) => {
  const { transactionData } = req.body;

  if (!transactionData || !transactionData.hash) {
    return res.status(400).json({
      error: 'Transaction data with hash is required'
    });
  }

  // Classify with Gemini AI
  const classification = await geminiService.classifyTransaction(transactionData);
  
  // Store the classification result to 0G
  const logData = {
    type: 'ai_classification',
    transactionHash: transactionData.hash,
    classification,
    originalTransaction: transactionData,
    timestamp: Date.now()
  };

  const ogResult = await ogBlockchainService.storeActivityLog(logData);

  res.json({
    classification,
    storage: ogResult,
    timestamp: Date.now()
  });
}));

// Batch classify multiple transactions
router.post('/classify-batch', asyncHandler(async (req, res) => {
  const { transactions } = req.body;

  if (!Array.isArray(transactions) || transactions.length === 0) {
    return res.status(400).json({
      error: 'Array of transactions is required'
    });
  }

  const results = [];
  const storagePromises = [];

  for (const transaction of transactions) {
    try {
      const classification = await geminiService.classifyTransaction(transaction);
      
      const logData = {
        type: 'ai_classification_batch',
        transactionHash: transaction.hash,
        classification,
        originalTransaction: transaction,
        timestamp: Date.now()
      };

      // Store to 0G (async)
      storagePromises.push(ogBlockchainService.storeActivityLog(logData));

      results.push({
        transactionHash: transaction.hash,
        classification,
        success: true
      });
    } catch (error) {
      logger.error('Error classifying transaction in batch', {
        hash: transaction.hash,
        error: error.message
      });
      
      results.push({
        transactionHash: transaction.hash,
        error: error.message,
        success: false
      });
    }
  }

  // Wait for all storage operations to complete
  const storageResults = await Promise.allSettled(storagePromises);

  res.json({
    results,
    totalProcessed: transactions.length,
    successCount: results.filter(r => r.success).length,
    timestamp: Date.now()
  });
}));

// Get classification history for a transaction
router.get('/history/:hash', asyncHandler(async (req, res) => {
  const { hash } = req.params;

  const logs = await ogBlockchainService.retrieveActivityLogs({
    type: 'ai_classification',
    transactionHash: hash
  });

  res.json({
    transactionHash: hash,
    history: logs.logs,
    total: logs.total
  });
}));

// Get classification statistics
router.get('/stats', asyncHandler(async (req, res) => {
  const { timeframe = '24h' } = req.query;

  // TODO: Implement proper stats aggregation from 0G
  const mockStats = {
    timeframe,
    totalClassified: 1250,
    normal: 1100,
    suspicious: 120,
    risky: 30,
    averageConfidence: 0.87,
    timestamp: Date.now()
  };

  res.json(mockStats);
}));

export default router;
