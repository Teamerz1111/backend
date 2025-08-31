import cron from 'node-cron';
import { ogBlockchainService } from './ogBlockchain.js';
import { geminiService } from './gemini.js';
import { broadcastToClients } from './websocket.js';
import { logger } from '../utils/logger.js';

class TransactionMonitorService {
  constructor() {
    this.isMonitoring = false;
    this.monitoredWallets = new Set();
    this.lastProcessedBlock = 0;
  }

  async startMonitoring() {
    if (this.isMonitoring) {
      logger.warn('Transaction monitoring already active');
      return;
    }

    this.isMonitoring = true;
    logger.info('Starting transaction monitoring service');

    // Monitor new blocks every 10 seconds
    cron.schedule('*/10 * * * * *', async () => {
      try {
        await this.processNewBlocks();
      } catch (error) {
        logger.error('Error in transaction monitoring cycle', error);
      }
    });

    // Analyze monitored wallets every minute
    cron.schedule('* * * * *', async () => {
      try {
        await this.analyzeMonitoredWallets();
      } catch (error) {
        logger.error('Error in wallet analysis cycle', error);
      }
    });
  }

  stopMonitoring() {
    this.isMonitoring = false;
    logger.info('Stopped transaction monitoring service');
  }

  addWalletToMonitoring(address) {
    this.monitoredWallets.add(address.toLowerCase());
    logger.info('Added wallet to monitoring', { address });
  }

  removeWalletFromMonitoring(address) {
    this.monitoredWallets.delete(address.toLowerCase());
    logger.info('Removed wallet from monitoring', { address });
  }

  async processNewBlocks() {
    try {
      const networkInfo = await ogBlockchainService.getNetworkInfo();
      const currentBlock = networkInfo.blockNumber;

      if (currentBlock <= this.lastProcessedBlock) {
        return; // No new blocks
      }

      logger.info('Processing new blocks', {
        from: this.lastProcessedBlock + 1,
        to: currentBlock
      });

      // TODO: Implement actual block processing
      // For now, simulate processing
      for (let blockNum = this.lastProcessedBlock + 1; blockNum <= currentBlock; blockNum++) {
        // In a real implementation, you'd fetch the block and its transactions
        // then process each transaction
      }

      this.lastProcessedBlock = currentBlock;
    } catch (error) {
      logger.error('Error processing new blocks', error);
    }
  }

  async analyzeMonitoredWallets() {
    if (this.monitoredWallets.size === 0) {
      return;
    }

    logger.info('Analyzing monitored wallets', {
      count: this.monitoredWallets.size
    });

    for (const address of this.monitoredWallets) {
      try {
        // TODO: Fetch real wallet data
        const mockWalletData = {
          address,
          recentTransactions: [],
          dailyVolume: '0',
          dailyTxCount: 0,
          avgAmount: '0'
        };

        const analysis = await geminiService.analyzeWalletActivity(mockWalletData);

        if (analysis.isUnusual) {
          // Stream to 0G
          await ogBlockchainService.streamUnusualActivity({
            walletAddress: address,
            analysis,
            walletData: mockWalletData
          });

          // Notify clients
          broadcastToClients({
            type: 'unusual_wallet_activity',
            walletAddress: address,
            analysis,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        logger.error('Error analyzing wallet', { address, error: error.message });
      }
    }
  }

  getMonitoringStatus() {
    return {
      isActive: this.isMonitoring,
      monitoredWallets: Array.from(this.monitoredWallets),
      lastProcessedBlock: this.lastProcessedBlock,
      walletCount: this.monitoredWallets.size
    };
  }
}

export const transactionMonitor = new TransactionMonitorService();
