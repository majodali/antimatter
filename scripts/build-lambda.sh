#!/bin/bash
set -e

echo "Building Lambda functions with esbuild..."

# Install dependencies (ensures esbuild is available)
pnpm install --frozen-lockfile 2>/dev/null || true

# Run the esbuild bundler script
node packages/ui/scripts/build-lambda.mjs

echo "Lambda build complete!"
echo "  API Lambda:     packages/ui/dist-lambda/index.js"
echo "  Command Lambda: packages/ui/dist-lambda/command.js"
