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

# Build workspace server bundle
echo ""
echo "Building workspace server..."
node packages/ui/scripts/build-workspace-server.mjs
echo "  Workspace:      packages/ui/dist-workspace/workspace-server.js"

# Upload workspace server to S3 (so EC2 instances pick up the latest on boot)
BUCKET=$(aws cloudformation describe-stacks --stack-name AntimatterStack \
  --query 'Stacks[0].Outputs[?OutputKey==`DataBucketName`].OutputValue' --output text 2>/dev/null || echo "")
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  echo ""
  echo "Uploading workspace server to s3://$BUCKET/workspace-server/workspace-server.js"
  aws s3 cp packages/ui/dist-workspace/workspace-server.js "s3://$BUCKET/workspace-server/workspace-server.js"
  echo "Workspace server uploaded to S3"
else
  echo ""
  echo "WARNING: Could not determine data bucket — skipping workspace server upload"
  echo "  Upload manually: aws s3 cp packages/ui/dist-workspace/workspace-server.js s3://BUCKET/workspace-server/workspace-server.js"
fi
