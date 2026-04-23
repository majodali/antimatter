import { create } from 'zustand';
import type { InfraEnvironment } from '@antimatter/project-model';
import { fetchInfraEnvironments, terminateInfraEnvironment } from '@/lib/api';
interface InfraEnvironmentState {
  environments: InfraEnvironment[];
  isLoading: boolean;

  loadEnvironments: () => Promise<void>;
  terminateEnvironment: (envId: string) => Promise<void>;
}

export const useInfraEnvironmentStore = create<InfraEnvironmentState>((set, get) => ({
  environments: [],
  isLoading: false,

  loadEnvironments: async () => {
    set({ isLoading: true });
    try {
      const environments = await fetchInfraEnvironments();
      set({ environments, isLoading: false });
    } catch (err) {
      set({ isLoading: false });
    }
  },

  terminateEnvironment: async (envId: string) => {
    // Optimistic update: set status to 'destroying' immediately
    set((state) => ({
      environments: state.environments.map((e) =>
        e.envId === envId
          ? { ...e, status: 'destroying' as const, updatedAt: new Date().toISOString() }
          : e,
      ),
    }));

    try {
      await terminateInfraEnvironment(envId);
    } catch (err) {
      // Reload to get actual state
      get().loadEnvironments();
    }
  },
}));
