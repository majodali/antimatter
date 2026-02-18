export type WsEventType = 'build-update' | 'file-change' | 'agent-message' | 'connected';

type WsMessageType = WsEventType | 'ping' | 'pong';

export interface WsMessage {
  type: WsMessageType;
  payload?: Record<string, unknown>;
  timestamp: string;
}

type Listener = (payload: Record<string, unknown>) => void;

const listeners = new Map<WsEventType, Set<Listener>>();
let socket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function getWsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws`;
}

function handleMessage(event: MessageEvent) {
  try {
    const msg: WsMessage = JSON.parse(event.data);
    if (msg.type === 'ping') {
      socket?.send(JSON.stringify({ type: 'pong', timestamp: new Date().toISOString() }));
      return;
    }
    const set = listeners.get(msg.type);
    if (set) {
      for (const fn of set) fn(msg.payload ?? {});
    }
  } catch {
    // ignore unparseable messages
  }
}

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectWebSocket();
  }, reconnectDelay);
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
}

export function connectWebSocket(): WebSocket {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return socket;
  }

  socket = new WebSocket(getWsUrl());

  socket.addEventListener('open', () => {
    reconnectDelay = 1000; // reset backoff on successful connect
  });

  socket.addEventListener('message', handleMessage);

  socket.addEventListener('close', () => {
    socket = null;
    scheduleReconnect();
  });

  socket.addEventListener('error', () => {
    socket?.close();
  });

  return socket;
}

function subscribe(type: WsEventType, callback: Listener): () => void {
  let set = listeners.get(type);
  if (!set) {
    set = new Set();
    listeners.set(type, set);
  }
  set.add(callback);
  // ensure we're connected
  connectWebSocket();
  return () => {
    set!.delete(callback);
  };
}

export function onBuildUpdate(callback: (payload: { targetId: string; status: string }) => void) {
  return subscribe('build-update', callback as Listener);
}

export function onFileChange(callback: (payload: { path: string; changeType: string }) => void) {
  return subscribe('file-change', callback as Listener);
}
