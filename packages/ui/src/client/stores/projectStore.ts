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

export const useProjectStore = create<ProjectStore>((set, get) => ({
  projects: [],
  currentProjectId: localStorage.getItem(STORAGE_KEY),
  isLoading: false,
  error: null,
  importProgress: null,

  loadProjects: async () => {
    set({ isLoading: true, error: null });
    try {
      const projects = await fetchProjects();
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
    set((state) => ({ projects: [...state.projects, project] }));
    return project;
  },

  remove: async (id: string) => {
    await deleteProject(id);
    set((state) => {
      const projects = state.projects.filter((p) => p.id !== id);
      const currentProjectId = state.currentProjectId === id ? null : state.currentProjectId;
      if (currentProjectId === null) {
        localStorage.removeItem(STORAGE_KEY);
      }
      return { projects, currentProjectId };
    });
  },

  selectProject: (id: string) => {
    localStorage.setItem(STORAGE_KEY, id);
    set({ currentProjectId: id });
  },

  clearProject: () => {
    localStorage.removeItem(STORAGE_KEY);
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
