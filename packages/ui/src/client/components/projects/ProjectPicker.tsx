import { useEffect, useRef, useState } from 'react';
import { FolderOpen, GitBranch, Loader2, Plus, Trash2, Upload } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { useProjectStore } from '@/stores/projectStore';

export function ProjectPicker() {
  const {
    projects,
    isLoading,
    error,
    importProgress,
    loadProjects,
    create,
    remove,
    selectProject,
    importFromGit,
    importFromFiles,
  } = useProjectStore();

  const [newName, setNewName] = useState('');
  const [gitUrl, setGitUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [cloning, setCloning] = useState(false);
  const [gitError, setGitError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const isBusy = creating || cloning || importProgress !== null;

  useEffect(() => {
    loadProjects();
  }, []);

  const handleCreate = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const project = await create(name);
      selectProject(project.id);
      setNewName('');
    } catch (err) {
      console.error('Failed to create project:', err);
    } finally {
      setCreating(false);
    }
  };

  const handleClone = async () => {
    const url = gitUrl.trim();
    if (!url) return;
    setCloning(true);
    setGitError(null);
    try {
      const project = await importFromGit(url);
      selectProject(project.id);
      setGitUrl('');
    } catch (err) {
      setGitError(err instanceof Error ? err.message : 'Clone failed');
    } finally {
      setCloning(false);
    }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploadError(null);

    // Derive project name from root folder
    const firstPath = files[0].webkitRelativePath || files[0].name;
    const rootFolder = firstPath.split('/')[0] || 'uploaded-project';

    try {
      const project = await importFromFiles(files, rootFolder);
      selectProject(project.id);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    }

    // Reset input so the same folder can be re-selected
    e.target.value = '';
  };

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await remove(id);
    } catch (err) {
      console.error('Failed to delete project:', err);
    }
  };

  const progressPercent =
    importProgress && importProgress.total > 0
      ? Math.round((importProgress.current / importProgress.total) * 100)
      : 0;

  return (
    <div className="h-screen flex items-center justify-center bg-background">
      <div className="w-full max-w-md mx-auto p-6">
        <div className="text-center mb-8">
          <h1 className="text-2xl font-bold text-foreground mb-2">Antimatter IDE</h1>
          <p className="text-sm text-muted-foreground">Select a project or create a new one</p>
        </div>

        {/* Progress bar */}
        {importProgress && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-1">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">{importProgress.status}</span>
            </div>
            {importProgress.total > 0 && (
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            )}
          </div>
        )}

        {/* New project form */}
        <div className="flex gap-2 mb-3">
          <input
            type="text"
            placeholder="New project name..."
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            className="flex-1 bg-secondary text-foreground rounded-md px-3 py-2 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isBusy}
          />
          <Button onClick={handleCreate} disabled={isBusy || !newName.trim()}>
            <Plus className="h-4 w-4 mr-1" />
            Create
          </Button>
        </div>

        {/* Import row */}
        <div className="flex gap-2 mb-6">
          <input
            type="text"
            placeholder="Git repository URL..."
            value={gitUrl}
            onChange={(e) => setGitUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleClone()}
            className="flex-1 bg-secondary text-foreground rounded-md px-3 py-2 text-sm border border-border focus:outline-none focus:ring-2 focus:ring-ring"
            disabled={isBusy}
          />
          <Button onClick={handleClone} disabled={isBusy || !gitUrl.trim()} variant="outline">
            {cloning ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <GitBranch className="h-4 w-4 mr-1" />
            )}
            Clone
          </Button>
          <Button onClick={handleUpload} disabled={isBusy} variant="outline">
            <Upload className="h-4 w-4 mr-1" />
            Upload
          </Button>
          {/* @ts-expect-error webkitdirectory is non-standard */}
          <input
            ref={fileInputRef}
            type="file"
            webkitdirectory=""
            multiple
            className="hidden"
            onChange={handleFilesSelected}
          />
        </div>

        {/* Error messages */}
        {gitError && (
          <p className="text-sm text-red-500 mb-4">{gitError}</p>
        )}
        {uploadError && (
          <p className="text-sm text-red-500 mb-4">{uploadError}</p>
        )}

        {/* Project list */}
        {isLoading ? (
          <p className="text-center text-sm text-muted-foreground py-8">Loading projects...</p>
        ) : error ? (
          <p className="text-center text-sm text-red-500 py-8">{error}</p>
        ) : projects.length === 0 ? (
          <p className="text-center text-sm text-muted-foreground py-8">
            No projects yet. Create one to get started.
          </p>
        ) : (
          <ScrollArea className="max-h-80">
            <div className="space-y-2">
              {projects.map((project) => (
                <div
                  key={project.id}
                  className="flex items-center gap-3 px-4 py-3 rounded-md border border-border hover:bg-secondary/50 cursor-pointer transition-colors"
                  onClick={() => selectProject(project.id)}
                >
                  <FolderOpen className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground truncate">
                      {project.name}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {new Date(project.createdAt).toLocaleDateString()}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 shrink-0"
                    onClick={(e) => handleDelete(project.id, e)}
                    title="Delete project"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  );
}
