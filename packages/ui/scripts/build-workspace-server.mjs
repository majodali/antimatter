import { build } from 'esbuild';
import { rmSync, mkdirSync, writeFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(__dirname, '..');

// Clean and recreate output directory
const outDir = resolve(uiRoot, 'dist-workspace');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Shared esbuild config for both bundles
const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  conditions: ['@antimatter/source'],
  // Native modules — must be installed on EC2, not bundled.
  // node-pty: native terminal binding
  // esbuild: native binary for TypeScript transpilation (used by WorkflowManager)
  // @aws-sdk is bundled (NOT external) because it's not pre-installed on
  // Amazon Linux 2023 like it is in the Lambda runtime.
  external: ['node-pty', 'esbuild', 'puppeteer-core'],
  sourcemap: false,
  minify: false, // Keep readable for debugging
  logLevel: 'info',
};

// Bundle 1: Router (parent process)
console.log('Bundling workspace server (router)...');
await build({
  ...sharedConfig,
  entryPoints: [resolve(uiRoot, 'src/server/workspace-server.ts')],
  outfile: resolve(outDir, 'workspace-server.js'),
});

// Bundle 2: Project Worker (child process)
console.log('Bundling project worker...');
await build({
  ...sharedConfig,
  entryPoints: [resolve(uiRoot, 'src/server/project-worker.ts')],
  outfile: resolve(outDir, 'project-worker.js'),
});

// Generate package.json for external dependencies (installed on EC2 alongside the bundles)
writeFileSync(resolve(outDir, 'package.json'), JSON.stringify({
  name: 'antimatter-workspace-server',
  private: true,
  dependencies: {
    'esbuild': '^0.21.5',
    'puppeteer-core': '^24.0.0',
  },
}, null, 2));

console.log('Workspace server bundles written to dist-workspace/');
console.log('  - workspace-server.js (router)');
console.log('  - project-worker.js (child process)');
