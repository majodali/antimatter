import { create } from 'zustand';
import type { ProjectMeta } from '@/lib/api';
import {
  fetchProjects,
  createProject,
  deleteProject,
  importGitProject,
  readBrowserFile,
  saveFile,
} from '@/lib/api';
import { acquireLock, releaseLock } from '@/lib/tab-lock';

export interface ImportProgress {
  current: number;
  total: number;
  status: string;
}

interface ProjectStore {
  projects: ProjectMeta[];
  currentProjectId: string | null;
  isLoading: boolean;
  error: string | null;
  importProgress: ImportProgress | null;

  loadProjects: () => Promise<void>;
  create: (name: string) => Promise<ProjectMeta>;
  remove: (id: string) => Promise<void>;
  selectProject: (id: string) => void;
  clearProject: () => void;
  importFromGit: (url: string, name?: string) => Promise<ProjectMeta>;
  importFromFiles: (files: FileList, projectName: string) => Promise<ProjectMeta>;
}

const STORAGE_KEY = 'antimatter-current-project';
const PROJECTS_CACHE_KEY = 'antimatter-projects-cache';

const SKIP_PATTERNS = [
  'node_modules/',
  '.git/',
  '.next/',
  'dist/',
  'build/',
  '__pycache__/',
  '.venv/',
  'target/',
  'vendor/',
  '.terraform/',
];

// Check URL params once at module load — avoids race with sessionStorage in iframes
const _urlParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;
const _urlProjectId = _urlParams?.get('project') ?? null;

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: (() => {
    try {
      const cached = localStorage.getItem(PROJECTS_CACHE_KEY);
      return cached ? JSON.parse(cached) : [];
    } catch {
      return [];
    }
  })(),
  // URL ?project= parameter takes priority over sessionStorage.
  // This prevents iframes (which share sessionStorage with parent) from
  // loading the parent tab's project.
  currentProjectId: _urlProjectId ?? sessionStorage.getItem(STORAGE_KEY),
  isLoading: false,
  error: null,
  importProgress: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await fetchProjects();
      localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
      set({ projects, isLoading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load projects',
        isLoading: false,
      });
    }
  },

  create: async (name: string) => {
    const project = await createProject(name);
    set((state) => {
      const projects = [...state.projects, project];
      localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
      return { projects };
    });
    return project;
  },

  remove: async (id: string) => {
    await deleteProject(id);
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id);
      localStorage.setItem(PROJECTS_CACHE_KEY, JSON.stringify(projects));
      const currentProjectId = state.currentProjectId === id ? null : state.currentProjectId;
      if (currentProjectId === null) {
        sessionStorage.removeItem(STORAGE_KEY);
      }
      return { projects, currentProjectId };
    });
  },

  selectProject: (id: string) => {
    if (!acquireLock(id)) {
      set({ error: 'This project is already open in another tab' });
      return;
    }
    sessionStorage.setItem(STORAGE_KEY, id);
    set({ currentProjectId: id, error: null });
  },

  clearProject: () => {
    const { currentProjectId } = get();
    if (currentProjectId) releaseLock(currentProjectId);
    sessionStorage.removeItem(STORAGE_KEY);
    set({ currentProjectId: null });
  },

  importFromGit: async (url: string, name?: string) => {
    set({ importProgress: { current: 0, total: 0, status: 'Cloning repository...' } });
    try {
      const result = await importGitProject(url, name);
      set((state) => ({
        projects: [...state.projects, result],
        importProgress: null,
      }));
      return result;
    } catch (err) {
      set({ importProgress: null });
      throw err;
    }
  },

  importFromFiles: async (files: FileList, projectName: string) => {
    const project = await createProject(projectName);
    set((state) => ({ projects: [...state.projects, project] }));

    // Filter and prepare files
    const validFiles: { path: string; file: File }[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const relativePath = file.webkitRelativePath || file.name;

      // Skip hidden/filtered directories
      if (SKIP_PATTERNS.some((p) => relativePath.includes(p))) continue;

      // Strip the root folder from webkitRelativePath (browser gives "folder/sub/file.txt")
      const parts = relativePath.split('/');
      const strippedPath = parts.length > 1 ? parts.slice(1).join('/') : parts[0];

      validFiles.push({ path: strippedPath, file });
    }

    const total = validFiles.length;
    set({ importProgress: { current: 0, total, status: 'Uploading files...' } });

    // Upload in batches of 5
    const BATCH_SIZE = 5;
    let uploaded = 0;

    for (let i = 0; i < validFiles.length; i += BATCH_SIZE) {
      const batch = validFiles.slice(i, i + BATCH_SIZE);
      await Promise.all(
        batch.map(async ({ path: filePath, file }) => {
          const content = await readBrowserFile(file);
          if (content !== null) {
            await saveFile(filePath, content, project.id);
          }
        }),
      );
      uploaded += batch.length;
      set({
        importProgress: {
          current: uploaded,
          total,
          status: `Uploading files... (${uploaded}/${total})`,
        },
      });
    }

    set({ importProgress: null });
    return project;
  },
}));
