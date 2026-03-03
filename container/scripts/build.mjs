/**
 * Build the workspace container application with esbuild.
 *
 * Bundles all TypeScript source into a single ESM file (dist/server.js).
 * node-pty is marked external because it's a native module that must
 * be installed via npm in the Docker image (not bundled).
 */

import { build } from 'esbuild';

await build({
  entryPoints: ['src/server.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/server.js',
  external: ['node-pty'],
  banner: {
    // ESM compatibility shim for __dirname and require()
    // Use unique names to avoid colliding with bundled imports of 'path', 'url', etc.
    js: `
import { createRequire as __banner_createRequire } from 'module';
import { fileURLToPath as __banner_fileURLToPath } from 'url';
import { dirname as __banner_dirname } from 'path';
const require = __banner_createRequire(import.meta.url);
const __filename = __banner_fileURLToPath(import.meta.url);
const __dirname = __banner_dirname(__filename);
    `.trim(),
  },
  sourcemap: false,
  minify: false, // Keep readable for debugging
});

console.log('Container build complete: dist/server.js');
