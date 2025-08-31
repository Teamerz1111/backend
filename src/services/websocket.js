import { logger } from '../utils/logger.js';

const clients = new Set();

export const setupWebSocketServer = (wss) => {
  wss.on('connection', (ws, req) => {
    logger.info('New WebSocket client connected', {
      clientId: generateClientId(),
      origin: req.headers.origin
    });

    clients.add(ws);

    // Send welcome message
    ws.send(JSON.stringify({
      type: 'connected',
      timestamp: Date.now(),
      message: 'Connected to ChainSage real-time monitoring'
    }));

    // Handle client messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        logger.info('Received WebSocket message', { type: data.type });
        
        // Handle different message types
        switch (data.type) {
          case 'subscribe_wallet':
            handleWalletSubscription(ws, data.address);
            break;
          case 'unsubscribe_wallet':
            handleWalletUnsubscription(ws, data.address);
            break;
          default:
            ws.send(JSON.stringify({
              type: 'error',
              message: 'Unknown message type'
            }));
        }
      } catch (error) {
        logger.error('Error processing WebSocket message', error);
        ws.send(JSON.stringify({
          type: 'error',
          message: 'Invalid message format'
        }));
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      clients.delete(ws);
      logger.info('WebSocket client disconnected', {
        remainingClients: clients.size
      });
    });

    // Handle errors
    ws.on('error', (error) => {
      logger.error('WebSocket error', error);
      clients.delete(ws);
    });
  });
};

export const broadcastToClients = (message) => {
  const messageStr = JSON.stringify(message);
  clients.forEach(client => {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(messageStr);
    }
  });
  
  logger.info('Broadcasted message to clients', {
    clientCount: clients.size,
    messageType: message.type
  });
};

export const sendToSubscribedClients = (walletAddress, message) => {
  // TODO: Implement wallet subscription tracking
  // For now, broadcast to all clients
  broadcastToClients({
    ...message,
    walletAddress
  });
};

const handleWalletSubscription = (ws, address) => {
  // TODO: Implement wallet subscription logic
  logger.info('Client subscribed to wallet', { address });
  ws.send(JSON.stringify({
    type: 'subscribed',
    walletAddress: address,
    timestamp: Date.now()
  }));
};

const handleWalletUnsubscription = (ws, address) => {
  // TODO: Implement wallet unsubscription logic
  logger.info('Client unsubscribed from wallet', { address });
  ws.send(JSON.stringify({
    type: 'unsubscribed',
    walletAddress: address,
    timestamp: Date.now()
  }));
};

const generateClientId = () => {
  return Math.random().toString(36).substring(2, 15);
};
