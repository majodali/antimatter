import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'ai-agent',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
});
