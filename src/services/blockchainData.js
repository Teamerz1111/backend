import { logger } from '../utils/logger.js';

class BlockchainDataService {
  constructor() {
    this.etherscanApiKey = null;
    this.etherscanBaseUrl = null;
    this.requestDelay = null;
    this.chainId = null;
  }

  _initialize() {
    if (!this.etherscanApiKey) {
      this.etherscanApiKey = process.env.ETHERSCAN_API_KEY || 'YourApiKeyToken'; // Free tier
      this.etherscanBaseUrl = process.env.ETHERSCAN_BASE_URL || 'https://api.etherscan.io/v2/api';
      this.requestDelay = 200; // 5 requests per second for free tier
      this.chainId = process.env.ETHERSCAN_CHAIN_ID || '1'; // Default to Ethereum Mainnet
    }
  }

  async delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async makeEtherscanRequest(params) {
    try {
      this._initialize();
      const url = new URL(this.etherscanBaseUrl);
      url.searchParams.append('apikey', this.etherscanApiKey);
      url.searchParams.append('chainid', this.chainId);

      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.append(key, value);
      });

      logger.info('Making Etherscan API request', { 
        module: params.module, 
        action: params.action,
        chainId: this.chainId,
        address: params.address?.substring(0, 10) + '...'
      });

      const response = await fetch(url.toString());
      const data = await response.json();

      if (data.status === '0' && data.message !== 'No transactions found') {
        throw new Error(data.result || 'Etherscan API error');
      }

      // Rate limiting delay
      await this.delay(this.requestDelay);

      return data.result;
    } catch (error) {
      logger.error('Etherscan API request failed', error);
      throw error;
    }
  }

  async getWalletTransactions(address, limit = 50) {
    try {
      this._initialize();
      const transactions = await this.makeEtherscanRequest({
        module: 'account',
        action: 'txlist',
        address: address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: limit,
        sort: 'desc'
      });

      return this.formatTransactions(transactions || []);
    } catch (error) {
      logger.error('Failed to fetch wallet transactions', { address, error: error.message });
      return [];
    }
  }

  async getTokenTransfers(address, limit = 50) {
    try {
      this._initialize();
      const transfers = await this.makeEtherscanRequest({
        module: 'account',
        action: 'tokentx',
        address: address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: limit,
        sort: 'desc'
      });

      return this.formatTokenTransfers(transfers || []);
    } catch (error) {
      logger.error('Failed to fetch token transfers', { address, error: error.message });
      return [];
    }
  }

  async getNFTTransfers(address, limit = 50) {
    try {
      this._initialize();
      const transfers = await this.makeEtherscanRequest({
        module: 'account',
        action: 'tokennfttx',
        address: address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: limit,
        sort: 'desc'
      });

      return this.formatNFTTransfers(transfers || []);
    } catch (error) {
      logger.error('Failed to fetch NFT transfers', { address, error: error.message });
      return [];
    }
  }

  async getInternalTransactions(address, limit = 50) {
    try {
      this._initialize();
      const transactions = await this.makeEtherscanRequest({
        module: 'account',
        action: 'txlistinternal',
        address: address,
        startblock: 0,
        endblock: 99999999,
        page: 1,
        offset: limit,
        sort: 'desc'
      });

      return this.formatInternalTransactions(transactions || []);
    } catch (error) {
      logger.error('Failed to fetch internal transactions', { address, error: error.message });
      return [];
    }
  }

  formatTransactions(transactions) {
    return transactions.map(tx => ({
      type: 'transaction',
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      valueEth: (parseInt(tx.value) / 1e18).toFixed(6),
      gasUsed: tx.gasUsed,
      gasPrice: tx.gasPrice,
      timestamp: parseInt(tx.timeStamp) * 1000,
      blockNumber: parseInt(tx.blockNumber),
      isError: tx.isError === '1',
      methodId: tx.methodId,
      functionName: tx.functionName || 'Transfer'
    }));
  }

  formatTokenTransfers(transfers) {
    return transfers.map(transfer => ({
      type: 'token_transfer',
      hash: transfer.hash,
      from: transfer.from,
      to: transfer.to,
      value: transfer.value,
      tokenName: transfer.tokenName,
      tokenSymbol: transfer.tokenSymbol,
      tokenDecimal: parseInt(transfer.tokenDecimal),
      contractAddress: transfer.contractAddress,
      timestamp: parseInt(transfer.timeStamp) * 1000,
      blockNumber: parseInt(transfer.blockNumber),
      formattedValue: this.formatTokenValue(transfer.value, parseInt(transfer.tokenDecimal))
    }));
  }

  formatNFTTransfers(transfers) {
    return transfers.map(transfer => ({
      type: 'nft_transfer',
      hash: transfer.hash,
      from: transfer.from,
      to: transfer.to,
      tokenID: transfer.tokenID,
      tokenName: transfer.tokenName,
      tokenSymbol: transfer.tokenSymbol,
      contractAddress: transfer.contractAddress,
      timestamp: parseInt(transfer.timeStamp) * 1000,
      blockNumber: parseInt(transfer.blockNumber)
    }));
  }

  formatInternalTransactions(transactions) {
    return transactions.map(tx => ({
      type: 'internal_transaction',
      hash: tx.hash,
      from: tx.from,
      to: tx.to,
      value: tx.value,
      valueEth: (parseInt(tx.value) / 1e18).toFixed(6),
      timestamp: parseInt(tx.timeStamp) * 1000,
      blockNumber: parseInt(tx.blockNumber),
      isError: tx.isError === '1',
      type: tx.type
    }));
  }

  formatTokenValue(value, decimals) {
    try {
      const divisor = Math.pow(10, decimals);
      const formatted = (parseInt(value) / divisor).toFixed(6);
      return parseFloat(formatted).toString(); // Remove trailing zeros
    } catch (error) {
      return value;
    }
  }

  async getWalletBalance(address) {
    try {
      this._initialize();
      const balance = await this.makeEtherscanRequest({
        module: 'account',
        action: 'balance',
        address: address,
        tag: 'latest'
      });

      return {
        address,
        balance: balance,
        balanceEth: (parseInt(balance) / 1e18).toFixed(6),
        timestamp: Date.now()
      };
    } catch (error) {
      logger.error('Failed to fetch wallet balance', { address, error: error.message });
      return null;
    }
  }

  async getTokenContractActivity(contractAddress, limit = 50) {
    try {
      this._initialize();
      // For token contracts, we want to get recent transfers involving this token
      const transfers = await this.makeEtherscanRequest({
        module: 'account',
        action: 'tokentx',
        contractaddress: contractAddress,
        offset: limit,
        sort: 'desc'
      });

      return this.formatTokenTransfers(transfers || []);
    } catch (error) {
      logger.error('Failed to fetch token contract activity', { contractAddress, error: error });
      return [];
    }
  }

  async getAggregatedWalletActivity(address, limit = 20) {
    try {
      // Fetch all types of activities concurrently
      const [transactions, tokenTransfers, nftTransfers, internalTxs] = await Promise.all([
        this.getWalletTransactions(address, limit),
        this.getTokenTransfers(address, limit),
        this.getNFTTransfers(address, limit),
        this.getInternalTransactions(address, limit)
      ]);

      // Combine all activities
      const allActivities = [
        ...transactions,
        ...tokenTransfers,
        ...nftTransfers,
        ...internalTxs
      ];

      // Sort by timestamp (newest first) and limit results
      allActivities.sort((a, b) => b.timestamp - a.timestamp);
      
      return allActivities.slice(0, limit);
    } catch (error) {
      logger.error('Failed to fetch aggregated wallet activity', { address, error: error.message });
      return [];
    }
  }
}

export const blockchainDataService = new BlockchainDataService();