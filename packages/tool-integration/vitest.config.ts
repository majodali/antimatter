import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'tool-integration',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
