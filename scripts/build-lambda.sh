#!/bin/bash
set -e

echo "Building Lambda functions with esbuild..."

# Install dependencies (ensures esbuild is available)
npm ci 2>/dev/null || true

# Run the esbuild bundler script
node packages/ui/scripts/build-lambda.mjs

echo "Lambda build complete!"
echo "  API Lambda:     packages/ui/dist-lambda/index.js"
echo "  Command Lambda: packages/ui/dist-lambda/command.js"

# Build workspace server bundle
echo ""
echo "Building workspace server..."
node packages/ui/scripts/build-workspace-server.mjs
echo "  Workspace:      packages/ui/dist-workspace/workspace-server.js"

# Generate a minimal package.json for workspace server external dependencies
# (native modules that can't be bundled — installed on EC2 via npm install)
cat > packages/ui/dist-workspace/package.json << 'PKGJSON'
{
  "name": "antimatter-workspace-server",
  "private": true,
  "dependencies": {
    "esbuild": "^0.21.0",
    "node-pty": "^1.0.0"
  }
}
PKGJSON
echo "  package.json:   packages/ui/dist-workspace/package.json"

# Upload workspace server to S3 (so EC2 instances pick up the latest on boot)
BUCKET=$(aws cloudformation describe-stacks --stack-name AntimatterStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DataBucketName`].OutputValue' --output text 2>/dev/null || echo "")
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  echo ""
  echo "Uploading workspace server to s3://$BUCKET/workspace-server/workspace-server.js"
  aws s3 cp packages/ui/dist-workspace/workspace-server.js "s3://$BUCKET/workspace-server/workspace-server.js"
  echo "Uploading workspace server package.json to s3://$BUCKET/workspace-server/package.json"
  aws s3 cp packages/ui/dist-workspace/package.json "s3://$BUCKET/workspace-server/package.json"
  echo "Workspace server uploaded to S3"
else
  echo ""
  echo "WARNING: Could not determine data bucket — skipping workspace server upload"
  echo "  Upload manually: aws s3 cp packages/ui/dist-workspace/workspace-server.js s3://BUCKET/workspace-server/workspace-server.js"
fi
