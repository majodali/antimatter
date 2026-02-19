import { useEffect, useRef } from 'react';
import { Bot, Trash2, Settings } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStore } from '@/stores/chatStore';
import { useProjectStore } from '@/stores/projectStore';
import { sendChatMessage, clearChatHistory } from '@/lib/api';

export function ChatPanel() {
  const { messages, isTyping, setTyping, addMessage, clearMessages } =
    useChatStore();
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const scrollRef = useRef<HTMLDivElement>(null);

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

  const handleSend = async (message: string) => {
    // Add user message
    addMessage({
      role: 'user',
      content: message,
    });

    // Show typing indicator
    setTyping(true);

    try {
      const { response } = await sendChatMessage(message, currentProjectId ?? undefined);

      // Add assistant response
      addMessage({
        role: 'assistant',
        content: response,
      });
    } catch (error) {
      addMessage({
        role: 'system',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
      });
    } finally {
      setTyping(false);
    }
  };

  const handleClear = async () => {
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
            />
          ))}

          {/* Typing indicator */}
          {isTyping && (
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
