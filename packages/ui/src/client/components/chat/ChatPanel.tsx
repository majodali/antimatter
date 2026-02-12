import { useEffect, useRef } from 'react';
import { Bot, Trash2, Settings } from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { Button } from '../ui/button';
import { ChatMessage } from './ChatMessage';
import { ChatInput } from './ChatInput';
import { useChatStore } from '@/stores/chatStore';

// Mock agent responses
const MOCK_RESPONSES: Record<string, string> = {
  hello: 'Hello! I\'m your AI assistant. I can help you with:\n\n- **Code review** - I can analyze your code for issues\n- **Documentation** - I can help write clear documentation\n- **Testing** - I can suggest test cases\n- **Refactoring** - I can recommend improvements\n\nWhat would you like help with?',
  help: 'I can assist with various development tasks:\n\n```typescript\n// Example: I can help explain code\nfunction fibonacci(n: number): number {\n  if (n <= 1) return n;\n  return fibonacci(n - 1) + fibonacci(n - 2);\n}\n```\n\nJust ask me anything about your code!',
};

const DEFAULT_RESPONSE = 'I understand you\'re asking about that. While I\'m currently in demo mode with limited responses, in the full version I can:\n\n- Analyze code and suggest improvements\n- Help write tests and documentation\n- Explain complex concepts\n- Assist with debugging\n\nTry saying "hello" or "help" to see example responses!';

function getMockResponse(message: string): string {
  const key = message.toLowerCase().trim();
  return MOCK_RESPONSES[key] || DEFAULT_RESPONSE;
}

export function ChatPanel() {
  const { messages, isTyping, setTyping, addMessage, clearMessages } =
    useChatStore();
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
        content: 'Hi! I\'m your AI assistant. Try saying "hello" or "help" to get started!',
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
      // Simulate network delay
      await new Promise((resolve) => setTimeout(resolve, 800));

      // Get mock response
      const response = getMockResponse(message);

      // Add assistant response
      addMessage({
        role: 'assistant',
        content: response,
      });
    } catch (error) {
      addMessage({
        role: 'system',
        content: 'Error: Failed to get response',
      });
    } finally {
      setTyping(false);
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
            onClick={clearMessages}
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
