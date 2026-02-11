import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'project-model',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
