import { create } from 'zustand';
import type { SecretStatus } from '@/lib/api';
import { fetchSecrets, setSecret as apiSetSecret, deleteSecret as apiDeleteSecret } from '@/lib/api';
import { toast } from '@/lib/toast';

interface SecretsState {
  secrets: SecretStatus[];
  isLoading: boolean;

  loadSecrets: () => Promise<void>;
  setSecret: (name: string, value: string) => Promise<void>;
  deleteSecret: (name: string) => Promise<void>;
}

export const useSecretsStore = create<SecretsState>((set, get) => ({
  secrets: [],
  isLoading: false,

  loadSecrets: async () => {
    set({ isLoading: true });
    try {
      const secrets = await fetchSecrets();
      set({ secrets, isLoading: false });
    } catch (err) {
      toast.error('Failed to load secrets', String(err));
      set({ isLoading: false });
    }
  },

  setSecret: async (name: string, value: string) => {
    try {
      await apiSetSecret(name, value);
      // Optimistic update
      set((state) => ({
        secrets: state.secrets.map((s) =>
          s.name === name ? { ...s, hasValue: true } : s,
        ),
      }));
      toast.info(`Secret "${name}" updated`, undefined);
    } catch (err) {
      toast.error(`Failed to set secret "${name}"`, String(err));
      // Reload to get actual state
      get().loadSecrets();
    }
  },

  deleteSecret: async (name: string) => {
    try {
      await apiDeleteSecret(name);
      // Optimistic update
      set((state) => ({
        secrets: state.secrets.map((s) =>
          s.name === name ? { ...s, hasValue: false } : s,
        ),
      }));
      toast.info(`Secret "${name}" cleared`, undefined);
    } catch (err) {
      toast.error(`Failed to delete secret "${name}"`, String(err));
      get().loadSecrets();
    }
  },
}));
