import { ScrollArea } from '../ui/scroll-area';

export function ChatPanel() {
  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b border-border">
        <h3 className="text-sm font-medium">AI Chat</h3>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-4">
          <p className="text-xs text-muted-foreground">
            Start a conversation with an AI agent...
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
