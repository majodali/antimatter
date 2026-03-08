/**
 * ProblemsPanel — displays all project errors grouped by file.
 *
 * Each row shows the error type icon (colored per errorType.color),
 * the error message, and the file:line:col location.
 * Clicking a row navigates to the file + line in the editor.
 * Errors with `detail` can be expanded to show additional info.
 */

import { useState } from 'react';
import {
  XCircle,
  AlertCircle,
  AlertTriangle,
  Info,
  TestTube2,
  ChevronDown,
  ChevronRight,
  FileText,
} from 'lucide-react';
import { ScrollArea } from '../ui/scroll-area';
import { useErrorStore, type ProjectError } from '@/stores/errorStore';
import { useFileStore } from '@/stores/fileStore';
import type { WorkspacePath } from '@antimatter/filesystem';

/** Map error type icon name to lucide component. */
function getErrorIcon(iconName: string) {
  switch (iconName) {
    case 'circle-x': return XCircle;
    case 'circle-alert': return AlertCircle;
    case 'triangle-alert': return AlertTriangle;
    case 'info': return Info;
    case 'test-tube-diagonal': return TestTube2;
    default: return AlertCircle;
  }
}

function ErrorRow({
  error,
  onNavigate,
}: {
  error: ProjectError;
  onNavigate: (file: string, line?: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const Icon = getErrorIcon(error.errorType.icon);
  const hasDetail = !!error.detail;
  const location = error.line
    ? `${error.file}:${error.line}${error.column ? ':' + error.column : ''}`
    : error.file;

  return (
    <div className="border-b border-border/50 last:border-b-0">
      <div
        className="flex items-center gap-2 px-3 py-1.5 text-xs cursor-pointer hover:bg-accent/50"
        onClick={() => {
          if (hasDetail) {
            setExpanded(!expanded);
          } else {
            onNavigate(error.file, error.line);
          }
        }}
      >
        {hasDetail && (
          <span className="flex-shrink-0 w-3">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
        )}
        {!hasDetail && <span className="w-3" />}
        <Icon
          className="h-3.5 w-3.5 flex-shrink-0"
          style={{ color: error.errorType.color }}
        />
        <span className="flex-1 truncate text-foreground">{error.message}</span>
        <span
          className="text-muted-foreground flex-shrink-0 cursor-pointer hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onNavigate(error.file, error.line);
          }}
        >
          {location}
        </span>
      </div>
      {expanded && error.detail && (
        <div
          className="px-10 py-2 text-xs text-muted-foreground bg-muted/30 border-t border-border/30"
          dangerouslySetInnerHTML={{ __html: error.detail }}
        />
      )}
    </div>
  );
}

export function ProblemsPanel() {
  const errors = useErrorStore((s) => s.errors);
  const selectFile = useFileStore((s) => s.selectFile);

  // Group errors by file
  const byFile = new Map<string, ProjectError[]>();
  for (const err of errors) {
    const list = byFile.get(err.file);
    if (list) {
      list.push(err);
    } else {
      byFile.set(err.file, [err]);
    }
  }

  const fileGroups = Array.from(byFile.entries()).sort((a, b) => a[0].localeCompare(b[0]));

  function handleNavigate(file: string, _line?: number) {
    selectFile(file as WorkspacePath);
  }

  if (errors.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
        No problems detected
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <div className="py-1">
        {fileGroups.map(([filePath, fileErrors]) => (
          <div key={filePath}>
            {/* File header */}
            <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-foreground bg-muted/50 sticky top-0">
              <FileText className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="truncate">{filePath}</span>
              <span className="text-muted-foreground ml-auto flex-shrink-0">
                {fileErrors.length}
              </span>
            </div>
            {/* Error rows */}
            {fileErrors.map((err, idx) => (
              <ErrorRow
                key={`${err.file}:${err.line}:${err.column}:${idx}`}
                error={err}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        ))}
      </div>
    </ScrollArea>
  );
}
