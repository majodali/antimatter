#!/bin/bash
set -e

echo "📦 Building Lambda function..."

# Clean previous build
rm -rf packages/ui/dist-lambda
mkdir -p packages/ui/dist-lambda

# Build all workspace dependencies first
echo "Building workspace packages..."
nx run-many -t build -p @antimatter/project-model @antimatter/filesystem @antimatter/tool-integration @antimatter/agent-framework

# Copy server code
echo "Copying server code..."
cp -r packages/ui/src/server/* packages/ui/dist-lambda/

# Install production dependencies
echo "Installing production dependencies..."
cd packages/ui/dist-lambda
npm init -y
npm install express @codegenie/serverless-express ws

# Copy built packages from workspace
echo "Copying workspace dependencies..."
mkdir -p node_modules/@antimatter

for pkg in project-model filesystem tool-integration agent-framework; do
  echo "  Copying @antimatter/$pkg..."
  cp -r "../../$pkg/dist" "node_modules/@antimatter/$pkg"
  cp "../../$pkg/package.json" "node_modules/@antimatter/$pkg/"
done

# Create Lambda handler entry point
cat > index.js << 'EOF'
const { handler } = require('./lambda.js');
exports.handler = handler;
EOF

echo "✅ Lambda build complete!"
cd ../../..
