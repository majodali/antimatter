import serverlessExpress from '@codegenie/serverless-express';
import express from 'express';
import { WorkspaceService } from './services/workspace-service.js';
import { createFileRouter } from './routes/filesystem.js';
import { createBuildRouter } from './routes/build.js';
import { createAgentRouter } from './routes/agent.js';

const app = express();

// Middleware
app.use(express.json());

// CORS
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

// Export Lambda handler
export const handler = serverlessExpress({ app });
