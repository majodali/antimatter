import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    name: 'build-system',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@antimatter/filesystem': path.resolve(__dirname, '../filesystem/src/index.ts'),
      '@antimatter/tool-integration': path.resolve(__dirname, '../tool-integration/src/index.ts'),
      '@antimatter/project-model': path.resolve(__dirname, '../project-model/src/index.ts'),
    },
  },
});
