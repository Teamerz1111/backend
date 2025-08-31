# ChainSage Backend

Node.js backend service for ChainSage - 0G blockchain integration with AI-powered transaction classification and wallet monitoring.

## Features

- **AI Transaction Classification**: Uses Gemini API to classify transactions as Normal, Suspicious, or Risky
- **Wallet Activity Monitoring**: Real-time monitoring of wallet activities with anomaly detection
- **0G Blockchain Integration**: Stores activity logs and streams unusual activity to 0G network
- **WebSocket Support**: Real-time updates for connected clients
- **RESTful API**: Comprehensive endpoints for all operations

## Getting Started

### Prerequisites

- Node.js >= 18.0.0
- NPM or Yarn
- 0G blockchain access
- Gemini API key

### Installation

```bash
cd backend
npm install
```

### Configuration

1. Copy `.env.example` to `.env`
2. Fill in your configuration values:
   - `GEMINI_API_KEY`: Your Google Gemini API key
   - `OG_RPC_URL`: 0G blockchain RPC endpoint
   - `OG_PRIVATE_KEY`: Your 0G wallet private key (optional, for transactions)

### Development

```bash
npm run dev
```

### Production

```bash
npm start
```

## API Endpoints

### AI Classification

- `POST /api/ai/classify` - Classify a single transaction
- `POST /api/ai/classify-batch` - Batch classify multiple transactions
- `GET /api/ai/history/:hash` - Get classification history
- `GET /api/ai/stats` - Get classification statistics

### Wallet Monitoring

- `POST /api/wallet/monitor/:address` - Start monitoring a wallet
- `POST /api/wallet/analyze/:address` - Analyze wallet activity
- `GET /api/wallet/status` - Get monitoring status
- `GET /api/wallet/alerts` - Get unusual activity alerts
- `DELETE /api/wallet/monitor/:address` - Stop monitoring a wallet

### 0G Integration

- `POST /api/0g/store` - Store data to 0G blockchain
- `GET /api/0g/retrieve` - Retrieve data from 0G blockchain
- `POST /api/0g/stream` - Stream data to 0G network
- `GET /api/0g/network-info` - Get 0G network information
- `GET /api/0g/health` - Check 0G connection health

### WebSocket Events

Connect to WebSocket at `ws://localhost:3001` for real-time updates:

- `unusual_activity_detected` - When unusual wallet activity is found
- `new_classification` - When a transaction is classified
- `monitoring_alert` - General monitoring alerts

## Deployment on Render

The service is configured for easy deployment on Render:

1. Connect your GitHub repository to Render
2. Set environment variables in Render dashboard
3. Deploy as a Web Service
4. Use the start command: `npm start`

## Architecture

The backend follows a modular architecture:

- **Routes**: Express.js route handlers
- **Services**: Business logic and external integrations
- **Middleware**: Error handling and request processing
- **Utils**: Logging and utility functions
