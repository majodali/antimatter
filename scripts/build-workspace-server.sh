#!/bin/bash
set -e

echo "Building workspace server with esbuild..."

# Install dependencies (ensures esbuild is available)
npm ci 2>/dev/null || true

# Run the esbuild bundler script
node packages/ui/scripts/build-workspace-server.mjs

echo "Workspace server build complete!"
echo "  Output: packages/ui/dist-workspace/workspace-server.js"
echo ""
echo "To upload to S3:"
echo "  aws s3 cp packages/ui/dist-workspace/workspace-server.js s3://\${BUCKET}/workspace-server/workspace-server.js"
