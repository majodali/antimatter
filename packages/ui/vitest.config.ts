import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    name: 'ui',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
  resolve: {
    alias: {
      '@antimatter/workspace': path.resolve(__dirname, '../workspace/src/index.ts'),
      '@antimatter/filesystem': path.resolve(__dirname, '../filesystem/src/index.ts'),
      '@antimatter/tool-integration': path.resolve(__dirname, '../tool-integration/src/index.ts'),
      '@antimatter/build-system': path.resolve(__dirname, '../build-system/src/index.ts'),
      '@antimatter/agent-framework': path.resolve(__dirname, '../agent-framework/src/index.ts'),
      '@antimatter/project-model': path.resolve(__dirname, '../project-model/src/index.ts'),
    },
  },
});
