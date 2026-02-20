import { Bot, User } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Markdown } from '../ui/markdown';

interface ChatMessageProps {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  agentRole?: string;
}

const roleColors: Record<string, string> = {
  implementer: 'bg-blue-500/20 text-blue-400',
  reviewer: 'bg-amber-500/20 text-amber-400',
  tester: 'bg-green-500/20 text-green-400',
};

export function ChatMessage({ role, content, timestamp, agentRole }: ChatMessageProps) {
  const isUser = role === 'user';
  const isSystem = role === 'system';

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  if (isSystem) {
    return (
      <div className="flex justify-center py-2">
        <div className="text-xs text-muted-foreground bg-muted px-3 py-1 rounded-full">
          {content}
        </div>
      </div>
    );
  }

  return (
    <div className={cn('flex gap-3 px-4 py-3', isUser && 'bg-muted/30')}>
      <div className="flex-shrink-0">
        {isUser ? (
          <div className="h-8 w-8 rounded-full bg-primary flex items-center justify-center">
            <User className="h-5 w-5 text-primary-foreground" />
          </div>
        ) : (
          <div className="h-8 w-8 rounded-full bg-secondary flex items-center justify-center">
            <Bot className="h-5 w-5 text-secondary-foreground" />
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">
            {isUser ? 'You' : 'AI Assistant'}
          </span>
          {agentRole && (
            <span className={cn(
              'text-xs px-1.5 py-0.5 rounded font-medium',
              roleColors[agentRole] ?? 'bg-muted text-muted-foreground',
            )}>
              {agentRole}
            </span>
          )}
          <span className="text-xs text-muted-foreground">
            {formatTime(timestamp)}
          </span>
        </div>
        <div className="text-sm text-foreground">
          <Markdown content={content} />
        </div>
      </div>
    </div>
  );
}
