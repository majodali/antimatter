import { WebSocketServer, WebSocket } from 'ws';

interface WebSocketMessage {
  type: 'build-update' | 'file-change' | 'agent-message' | 'ping' | 'pong';
  payload?: any;
  timestamp: string;
}

const clients = new Set<WebSocket>();

export function setupWebSocket(wss: WebSocketServer) {
  wss.on('connection', (ws: WebSocket) => {
    console.log('✓ WebSocket client connected');
    clients.add(ws);

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'connected',
        payload: { message: 'Connected to Antimatter Dev Server' },
        timestamp: new Date().toISOString(),
      })
    );

    // Handle messages from client
    ws.on('message', (data: Buffer) => {
      try {
        const message: WebSocketMessage = JSON.parse(data.toString());

        // Handle ping/pong for keep-alive
        if (message.type === 'ping') {
          ws.send(
            JSON.stringify({
              type: 'pong',
              timestamp: new Date().toISOString(),
            })
          );
        }

        // Echo other messages for now (can be extended)
        console.log('Received WebSocket message:', message.type);
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error);
      }
    });

    // Handle client disconnect
    ws.on('close', () => {
      console.log('✗ WebSocket client disconnected');
      clients.delete(ws);
    });

    // Handle errors
    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
    });
  });

  // Keep-alive ping every 30 seconds
  setInterval(() => {
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(
          JSON.stringify({
            type: 'ping',
            timestamp: new Date().toISOString(),
          })
        );
      }
    });
  }, 30000);
}

// Broadcast message to all connected clients
export function broadcast(message: WebSocketMessage) {
  const data = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}

// Send build update to all clients
export function broadcastBuildUpdate(targetId: string, status: string) {
  broadcast({
    type: 'build-update',
    payload: { targetId, status },
    timestamp: new Date().toISOString(),
  });
}

// Send file change notification to all clients
export function broadcastFileChange(path: string, changeType: 'created' | 'modified' | 'deleted') {
  broadcast({
    type: 'file-change',
    payload: { path, changeType },
    timestamp: new Date().toISOString(),
  });
}
