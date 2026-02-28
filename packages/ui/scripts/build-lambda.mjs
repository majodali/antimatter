import { build } from 'esbuild';
import { rmSync, mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const uiRoot = resolve(__dirname, '..');

// Clean and recreate output directory
const outDir = resolve(uiRoot, 'dist-lambda');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Shared esbuild configuration
const sharedConfig = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  conditions: ['@antimatter/source'],
  // @aws-sdk is included in the Lambda Node.js 20 runtime — keep it external
  external: ['@aws-sdk/*'],
  sourcemap: false,
  minify: false, // Keep readable for debugging
  logLevel: 'info',
};

// Build API Lambda
console.log('Bundling API Lambda...');
await build({
  ...sharedConfig,
  entryPoints: [resolve(uiRoot, 'src/server/lambda.ts')],
  outfile: resolve(outDir, 'index.js'),
});

// Build Command Lambda
console.log('Bundling Command Lambda...');
await build({
  ...sharedConfig,
  entryPoints: [resolve(uiRoot, 'src/server/command-lambda.ts')],
  outfile: resolve(outDir, 'command.js'),
});

console.log('Lambda bundles written to dist-lambda/index.js and dist-lambda/command.js');
