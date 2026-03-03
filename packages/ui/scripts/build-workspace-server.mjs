import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(__dirname, '..');

// Clean and recreate output directory
const outDir = resolve(uiRoot, 'dist-workspace');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log('Bundling workspace server...');
await build({
  entryPoints: [resolve(uiRoot, 'src/server/workspace-server.ts')],
  outfile: resolve(outDir, 'workspace-server.js'),
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  conditions: ['@antimatter/source'],
  // node-pty is a native module — must be installed on EC2, not bundled.
  // @aws-sdk is bundled (NOT external) because it's not pre-installed on
  // Amazon Linux 2023 like it is in the Lambda runtime.
  external: ['node-pty'],
  sourcemap: false,
  minify: false, // Keep readable for debugging
  logLevel: 'info',
});

console.log('Workspace server bundle written to dist-workspace/workspace-server.js');
