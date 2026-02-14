import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { WorkspaceService } from './services/workspace-service.js';
import { createFileRouter } from './routes/filesystem.js';
import { createBuildRouter } from './routes/build.js';
import { createAgentRouter } from './routes/agent.js';
import { setupWebSocket } from './websocket.js';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Middleware
app.use(express.json());

// CORS for local development
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  if (req.method === 'OPTIONS') {
    res.sendStatus(200);
  } else {
    next();
  }
});

// Create shared workspace service
const workspace = new WorkspaceService({
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
});

// API Routes
app.use('/api/files', createFileRouter(workspace));
app.use('/api/build', createBuildRouter(workspace));
app.use('/api/agent', createAgentRouter(workspace));

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Setup WebSocket
setupWebSocket(wss);

// Start server
const PORT = process.env.PORT || 3100;
server.listen(PORT, () => {
  console.log(`\n🚀 Antimatter Dev Server`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`API Server:  http://localhost:${PORT}`);
  console.log(`WebSocket:   ws://localhost:${PORT}`);
  console.log(`Health:      http://localhost:${PORT}/api/health`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
});
