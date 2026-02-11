import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'filesystem',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
