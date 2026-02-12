import { ScrollArea } from '../ui/scroll-area';

export function FileExplorer() {
  return (
    <div className="h-full flex flex-col">
      <div className="p-2 border-b border-border">
        <h3 className="text-sm font-medium">Explorer</h3>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2">
          <p className="text-xs text-muted-foreground">
            File explorer will go here...
          </p>
        </div>
      </ScrollArea>
    </div>
  );
}
