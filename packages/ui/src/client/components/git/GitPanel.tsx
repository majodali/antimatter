import { useEffect, useState } from 'react';
import {
  GitBranch,
  GitCommit,
  Plus,
  Minus,
  RefreshCw,
  Upload,
  Download,
  AlertCircle,
  FolderGit2,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { useGitStore } from '@/stores/gitStore';
import { useProjectStore } from '@/stores/projectStore';
import { useTerminalStore } from '@/stores/terminalStore';

function FileChangeRow({
  path,
  status,
  action,
  actionIcon: ActionIcon,
  actionTitle,
}: {
  path: string;
  status: string;
  action: () => void;
  actionIcon: React.ElementType;
  actionTitle: string;
}) {
  return (
    <div className="flex items-center justify-between px-2 py-0.5 hover:bg-accent/50 rounded text-xs group">
      <div className="flex items-center gap-1.5 min-w-0 flex-1">
        <span className={`shrink-0 font-medium ${statusColor(status)}`}>
          {statusLetter(status)}
        </span>
        <span className="truncate text-foreground">{path}</span>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
        onClick={action}
        title={actionTitle}
      >
        <ActionIcon className="h-3 w-3" />
      </Button>
    </div>
  );
}

function statusColor(status: string): string {
  switch (status) {
    case 'modified': return 'text-yellow-500';
    case 'added': return 'text-green-500';
    case 'deleted': return 'text-red-500';
    case 'renamed': return 'text-blue-500';
    default: return 'text-muted-foreground';
  }
}

function statusLetter(status: string): string {
  switch (status) {
    case 'modified': return 'M';
    case 'added': return 'A';
    case 'deleted': return 'D';
    case 'renamed': return 'R';
    default: return '?';
  }
}

function CollapsibleSection({
  title,
  count,
  defaultOpen = true,
  children,
}: {
  title: string;
  count: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (count === 0) return null;

  return (
    <div>
      <button
        className="flex items-center gap-1 w-full px-2 py-1 text-xs font-medium text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {title}
        <span className="ml-auto text-xs tabular-nums">{count}</span>
      </button>
      {open && children}
    </div>
  );
}

export function GitPanel() {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const connectionState = useTerminalStore((s) => s.connectionState);
  const {
    status,
    isLoading,
    error,
    commitMessage,
    loadStatus,
    loadRemotes,
    loadLog,
    stageFiles,
    unstageFiles,
    commit,
    push,
    pull,
    initRepo,
    addRemote,
    setCommitMessage,
    clearError,
    remotes,
  } = useGitStore();

  const [remoteUrl, setRemoteUrl] = useState('');

  // Load status when panel mounts and workspace is connected
  useEffect(() => {
    if (connectionState === 'connected' && currentProjectId) {
      loadStatus(currentProjectId);
      loadRemotes(currentProjectId);
      loadLog(currentProjectId);
    }
  }, [connectionState, currentProjectId]);

  const workspaceReady = connectionState === 'connected';

  // Workspace not running
  if (!workspaceReady) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="h-8 px-3 flex items-center gap-2 border-b border-border bg-card">
          <FolderGit2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Source Control</span>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-xs text-muted-foreground text-center">
            Workspace must be running for git operations.
            <br />
            Waiting for connection...
          </p>
        </div>
      </div>
    );
  }

  // Loading
  if (isLoading && !status) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="h-8 px-3 flex items-center gap-2 border-b border-border bg-card">
          <FolderGit2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Source Control</span>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  // Git not initialized
  if (status && !status.initialized) {
    return (
      <div className="h-full flex flex-col bg-background">
        <div className="h-8 px-3 flex items-center gap-2 border-b border-border bg-card">
          <FolderGit2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Source Control</span>
        </div>
        <div className="flex-1 flex flex-col items-center justify-center gap-3 p-4">
          <FolderGit2 className="h-8 w-8 text-muted-foreground" />
          <p className="text-xs text-muted-foreground text-center">
            This project is not a git repository.
          </p>
          <Button
            size="sm"
            className="text-xs"
            onClick={() => initRepo(currentProjectId ?? undefined)}
          >
            <GitBranch className="h-3.5 w-3.5 mr-1" />
            Initialize Repository
          </Button>
          <div className="w-full max-w-xs mt-2">
            <label className="text-xs text-muted-foreground block mb-1">
              Remote URL (optional)
            </label>
            <div className="flex gap-1">
              <input
                type="text"
                value={remoteUrl}
                onChange={(e) => setRemoteUrl(e.target.value)}
                placeholder="https://github.com/..."
                className="flex-1 text-xs px-2 py-1 rounded border border-border bg-background outline-none focus:ring-1 focus:ring-ring"
              />
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                disabled={!remoteUrl.trim()}
                onClick={async () => {
                  await initRepo(currentProjectId ?? undefined);
                  if (remoteUrl.trim()) {
                    await addRemote('origin', remoteUrl.trim(), currentProjectId ?? undefined);
                    setRemoteUrl('');
                  }
                }}
              >
                Init + Add Remote
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Git initialized — show full panel
  const staged = status?.staged ?? [];
  const unstaged = status?.unstaged ?? [];
  const untracked = status?.untracked ?? [];
  const hasChanges = staged.length > 0 || unstaged.length > 0 || untracked.length > 0;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="h-8 px-3 flex items-center justify-between border-b border-border bg-card">
        <div className="flex items-center gap-2">
          <FolderGit2 className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Source Control</span>
          {status?.branch && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <GitBranch className="h-3 w-3" />
              {status.branch}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              loadStatus(currentProjectId ?? undefined);
              loadLog(currentProjectId ?? undefined);
            }}
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </Button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-3 py-1.5 bg-destructive/10 border-b border-border flex items-center gap-2">
          <AlertCircle className="h-3 w-3 text-destructive shrink-0" />
          <span className="text-xs text-destructive flex-1 truncate">{error}</span>
          <Button variant="ghost" size="icon" className="h-5 w-5" onClick={clearError}>
            <span className="text-xs">&times;</span>
          </Button>
        </div>
      )}

      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {/* Commit section */}
          <div className="space-y-1.5">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              placeholder="Commit message..."
              rows={2}
              className="w-full text-xs px-2 py-1.5 rounded border border-border bg-background outline-none focus:ring-1 focus:ring-ring resize-none"
            />
            <div className="flex gap-1">
              <Button
                size="sm"
                className="flex-1 text-xs h-7"
                disabled={!commitMessage.trim() || staged.length === 0}
                onClick={() => commit(commitMessage, currentProjectId ?? undefined)}
              >
                <GitCommit className="h-3 w-3 mr-1" />
                Commit
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                onClick={() => pull(currentProjectId ?? undefined)}
                title="Pull"
              >
                <Download className="h-3 w-3" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="text-xs h-7"
                onClick={() => push(currentProjectId ?? undefined)}
                title="Push"
              >
                <Upload className="h-3 w-3" />
              </Button>
            </div>
          </div>

          {/* Staged changes */}
          <CollapsibleSection title="Staged Changes" count={staged.length}>
            {staged.map((f) => (
              <FileChangeRow
                key={`staged-${f.path}`}
                path={f.path}
                status={f.status}
                action={() => unstageFiles([f.path], currentProjectId ?? undefined)}
                actionIcon={Minus}
                actionTitle="Unstage"
              />
            ))}
          </CollapsibleSection>

          {/* Unstaged changes */}
          <CollapsibleSection title="Changes" count={unstaged.length}>
            {unstaged.map((f) => (
              <FileChangeRow
                key={`unstaged-${f.path}`}
                path={f.path}
                status={f.status}
                action={() => stageFiles([f.path], currentProjectId ?? undefined)}
                actionIcon={Plus}
                actionTitle="Stage"
              />
            ))}
            {unstaged.length > 1 && (
              <div className="px-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 w-full"
                  onClick={() =>
                    stageFiles(unstaged.map((f) => f.path), currentProjectId ?? undefined)
                  }
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Stage All
                </Button>
              </div>
            )}
          </CollapsibleSection>

          {/* Untracked files */}
          <CollapsibleSection title="Untracked" count={untracked.length}>
            {untracked.map((path) => (
              <FileChangeRow
                key={`untracked-${path}`}
                path={path}
                status="added"
                action={() => stageFiles([path], currentProjectId ?? undefined)}
                actionIcon={Plus}
                actionTitle="Stage"
              />
            ))}
            {untracked.length > 1 && (
              <div className="px-2 pt-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-xs h-6 w-full"
                  onClick={() => stageFiles(untracked, currentProjectId ?? undefined)}
                >
                  <Plus className="h-3 w-3 mr-1" />
                  Stage All Untracked
                </Button>
              </div>
            )}
          </CollapsibleSection>

          {/* No changes */}
          {!hasChanges && status?.initialized && (
            <div className="text-center py-4 text-xs text-muted-foreground">
              No changes to commit
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
