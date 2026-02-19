#!/bin/bash
set -e

echo "Building Lambda function with esbuild..."

# Install dependencies (ensures esbuild is available)
pnpm install --frozen-lockfile 2>/dev/null || true

# Run the esbuild bundler script
node packages/ui/scripts/build-lambda.mjs

echo "Lambda build complete! Output: packages/ui/dist-lambda/index.js"
