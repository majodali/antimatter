import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ui',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
});
