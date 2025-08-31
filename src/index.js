import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

import aiClassificationRoutes from './routes/aiClassification.js';
import walletMonitoringRoutes from './routes/walletMonitoring.js';
import ogIntegrationRoutes from './routes/ogIntegration.js';
import { setupWebSocketServer } from './services/websocket.js';
import { transactionMonitor } from './services/transactionMonitor.js';
import { logger } from './utils/logger.js';
import { errorHandler } from './middleware/errorHandler.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true
}));

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'chainsage-backend'
  });
});

// API routes
app.use('/api/ai', aiClassificationRoutes);
app.use('/api/wallet', walletMonitoringRoutes);
app.use('/api/0g', ogIntegrationRoutes);

// Error handling middleware
app.use(errorHandler);

// Create HTTP server and WebSocket server
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Setup WebSocket for real-time updates
setupWebSocketServer(wss);

server.listen(PORT, () => {
  logger.info(`ChainSage Backend running on port ${PORT}`);
  logger.info(`Environment: ${process.env.NODE_ENV}`);
  
  // Start transaction monitoring service
  transactionMonitor.startMonitoring();
});

export default app;
