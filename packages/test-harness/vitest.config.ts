import { defineConfig } from 'vitest/config';
import * as path from 'node:path';

export default defineConfig({
  test: {
    name: 'test-harness',
    globals: true,
    environment: 'node',
    include: ['src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@antimatter/filesystem': path.resolve(__dirname, '../filesystem/src/index.ts'),
      '@antimatter/tool-integration': path.resolve(__dirname, '../tool-integration/src/index.ts'),
      '@antimatter/build-system': path.resolve(__dirname, '../build-system/src/index.ts'),
      '@antimatter/agent-framework': path.resolve(__dirname, '../agent-framework/src/index.ts'),
      '@antimatter/project-model': path.resolve(__dirname, '../project-model/src/index.ts'),
    },
  },
});
