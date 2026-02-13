import serverlessExpress from '@codegenie/serverless-express';
import express from 'express';
import { LocalFileSystem } from '@antimatter/filesystem';
import { SubprocessRunner } from '@antimatter/tool-integration';
import { fileRouter } from './routes/filesystem.js';
import { buildRouter } from './routes/build.js';
import { agentRouter } from './routes/agent.js';

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

// API Routes
app.use('/api/files', fileRouter);
app.use('/api/build', buildRouter);
app.use('/api/agent', agentRouter);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Export Lambda handler
export const handler = serverlessExpress({ app });
