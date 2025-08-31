import { GoogleGenerativeAI } from '@google/generative-ai';
import { logger } from '../utils/logger.js';

class GeminiService {
  constructor() {
    if (!process.env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required');
    }
    
    this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });
  }

  async classifyTransaction(transactionData) {
    try {
      const prompt = `
        Analyze this blockchain transaction and classify it as Normal, Suspicious, or Risky.
        
        Transaction Data:
        - From: ${transactionData.from}
        - To: ${transactionData.to}
        - Amount: ${transactionData.amount}
        - Gas Used: ${transactionData.gasUsed}
        - Transaction Hash: ${transactionData.hash}
        - Block Number: ${transactionData.blockNumber}
        - Timestamp: ${transactionData.timestamp}
        
        Classification Criteria:
        - Normal: Regular transactions with typical patterns
        - Suspicious: Unusual amounts, gas usage, or timing patterns that warrant monitoring
        - Risky: Potential malicious activity, huge amounts, or known bad actor addresses
        
        Respond with JSON format:
        {
          "classification": "Normal|Suspicious|Risky",
          "confidence": 0.95,
          "reasons": ["reason1", "reason2"],
          "riskScore": 0.2
        }
      `;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      // Parse JSON response
      const classification = JSON.parse(response.replace(/```json\n?|\n?```/g, ''));
      
      logger.info('Transaction classified', {
        hash: transactionData.hash,
        classification: classification.classification,
        riskScore: classification.riskScore
      });

      return classification;
    } catch (error) {
      logger.error('Error classifying transaction with Gemini', error);
      throw new Error('Failed to classify transaction');
    }
  }

  async analyzeWalletActivity(walletData) {
    try {
      const prompt = `
        Analyze this wallet's activity patterns and identify any unusual behavior.
        
        Wallet Data:
        - Address: ${walletData.address}
        - Recent Transactions: ${JSON.stringify(walletData.recentTransactions)}
        - Total Volume (24h): ${walletData.dailyVolume}
        - Transaction Count (24h): ${walletData.dailyTxCount}
        - Average Transaction Amount: ${walletData.avgAmount}
        
        Look for:
        - Unusual transaction patterns
        - Sudden spikes in activity
        - Large or suspicious amounts
        - Potential money laundering patterns
        
        Respond with JSON format:
        {
          "isUnusual": true,
          "anomalies": ["large_amount_spike", "unusual_timing"],
          "riskLevel": "medium",
          "confidence": 0.85,
          "recommendations": ["monitor_closely", "flag_for_review"]
        }
      `;

      const result = await this.model.generateContent(prompt);
      const response = result.response.text();
      
      const analysis = JSON.parse(response.replace(/```json\n?|\n?```/g, ''));
      
      logger.info('Wallet activity analyzed', {
        address: walletData.address,
        isUnusual: analysis.isUnusual,
        riskLevel: analysis.riskLevel
      });

      return analysis;
    } catch (error) {
      logger.error('Error analyzing wallet activity with Gemini', error);
      throw new Error('Failed to analyze wallet activity');
    }
  }
}

export const geminiService = new GeminiService();
