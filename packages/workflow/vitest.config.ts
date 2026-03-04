import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    name: 'workflow',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@antimatter/project-model': path.resolve(__dirname, '../project-model/src/index.ts'),
    },
  },
});
