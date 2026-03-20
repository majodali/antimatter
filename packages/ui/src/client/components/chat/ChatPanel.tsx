import { useEffect, useRef } from 'react';
import { Bot, Trash2, Settings } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { sendChatMessage, clearChatHistory } from '@/lib/api';
import { workspaceConnection } from '@/lib/workspace-connection';
import { eventLog } from '@/lib/eventLog';

export function ChatPanel() {
  const {
    messages,
    isTyping,
    streamingMessageId,
    setTyping,
    addMessage,
    addStreamingMessage,
    finalizeStreaming,
    clearMessages,
    pendingMessage,
    setPendingMessage,
  } = useChatStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const streamingMsgIdRef = useRef<string | null>(null);

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  // Add welcome message on mount
  useEffect(() => {
    if (messages.length === 0) {
      addMessage({
        role: 'system',
        content: 'Connected to AI Assistant',
      });
      addMessage({
        role: 'assistant',
        content: 'Hi! I\'m your AI assistant. How can I help you today?',
      });
    }
  }, []);

  // Subscribe to agent:chat WebSocket events
  useEffect(() => {
    const unsub = workspaceConnection.onMessage((msg: any) => {
      const msgId = streamingMsgIdRef.current;
      if (!msgId) return;

      switch (msg.event) {
        case 'text':
          if (msg.delta) {
            useChatStore.getState().appendToMessage(msgId, msg.delta);
          }
          break;
        case 'tool-call':
          if (msg.toolCall) {
            useChatStore.getState().appendToMessage(
              msgId,
              `\n\n> Using tool: **${msg.toolCall.name}**\n`,
            );
          }
          break;
        case 'tool-result':
          // Tool results handled server-side
          break;
        case 'handoff':
          eventLog.info('chat', `Agent handoff: ${msg.fromRole} → ${msg.toRole}`);
          useChatStore.getState().addMessage({
            role: 'system',
            content: `Agent handoff: ${msg.fromRole} → ${msg.toRole}`,
          });
          break;
        case 'error':
          eventLog.error('chat', 'Agent error', msg.error);
          useChatStore.getState().appendToMessage(msgId, `\n\n**Error:** ${msg.error}`);
          useChatStore.getState().finalizeStreaming();
          useChatStore.getState().setTyping(false);
          streamingMsgIdRef.current = null;
          break;
        case 'done':
          eventLog.info('chat', 'Response complete');
          if (msg.agentRole) {
            useChatStore.getState().setMessageAgentRole(msgId, msg.agentRole);
          }
          useChatStore.getState().finalizeStreaming();
          useChatStore.getState().setTyping(false);
          streamingMsgIdRef.current = null;
          break;
      }
    }, { type: 'agent:chat' });

    return unsub;
  }, []);

  // Process pending messages from code actions
  useEffect(() => {
    if (pendingMessage && !isTyping) {
      const msg = pendingMessage;
      setPendingMessage(null);
      handleSend(msg);
    }
  }, [pendingMessage, isTyping]);

  const handleSend = async (message: string) => {
    addMessage({ role: 'user', content: message });
    setTyping(true);

    eventLog.info('chat', `Message sent: "${message.slice(0, 80)}${message.length > 80 ? '...' : ''}"`);

    // Create streaming message placeholder — events arrive via WebSocket
    const msgId = addStreamingMessage();
    streamingMsgIdRef.current = msgId;

    try {
      await sendChatMessage(message, currentProjectId ?? undefined);
      // Server accepted — events will arrive via WebSocket agent:chat subscription
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : 'Failed to send message';
      eventLog.error('chat', 'Chat request failed', errMsg);
      addMessage({ role: 'system', content: `Error: ${errMsg}` });
      finalizeStreaming();
      setTyping(false);
      streamingMsgIdRef.current = null;
    }
  };

  const handleClear = async () => {
    streamingMsgIdRef.current = null;
    clearMessages();
    try {
      await clearChatHistory(currentProjectId ?? undefined);
    } catch {
      // local state already cleared, server failure is non-critical
    }
  };

  return (
    <div className="h-full flex flex-col bg-card">
      {/* Header */}
      <div className="px-3 py-2 border-b border-border flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-medium">AI Chat</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={handleClear}
            title="Clear chat"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            title="Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col">
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              role={message.role}
              content={message.content}
              timestamp={message.timestamp}
              agentRole={message.agentRole}
            />
          ))}

          {/* Typing indicator (only when waiting for first token) */}
          {isTyping && !streamingMessageId && (
            <div className="flex gap-3 px-4 py-3">
              <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
                <Bot className="h-5 w-5 text-secondary-foreground" />
              </div>
              <div className="flex items-center gap-1 pt-2">
                <div className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce" />
                <div
                  className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: '0.2s' }}
                />
                <div
                  className="h-2 w-2 rounded-full bg-muted-foreground animate-bounce"
                  style={{ animationDelay: '0.4s' }}
                />
              </div>
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Input */}
      <ChatInput onSend={handleSend} disabled={isTyping} />
    </div>
  );
}
