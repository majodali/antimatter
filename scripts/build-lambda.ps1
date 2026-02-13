# Build Lambda function for deployment
Write-Host "📦 Building Lambda function..." -ForegroundColor Cyan

# Clean previous build
if (Test-Path "packages/ui/dist-lambda") {
    Remove-Item -Recurse -Force "packages/ui/dist-lambda"
}
New-Item -ItemType Directory -Force -Path "packages/ui/dist-lambda" | Out-Null

# Build all workspace dependencies first
Write-Host "Building workspace packages..." -ForegroundColor Yellow
nx run-many -t build -p @antimatter/project-model @antimatter/filesystem @antimatter/tool-integration @antimatter/agent-framework

# Copy server code (convert to CommonJS)
Write-Host "Copying server code..." -ForegroundColor Yellow
Copy-Item -Path "packages/ui/src/server/*" -Destination "packages/ui/dist-lambda" -Recurse

# Create package.json for Lambda
Write-Host "Creating package.json..." -ForegroundColor Yellow
Set-Location "packages/ui/dist-lambda"

@"
{
  "name": "antimatter-lambda",
  "version": "1.0.0",
  "type": "commonjs",
  "dependencies": {
    "express": "^4.18.3",
    "@codegenie/serverless-express": "^4.14.0",
    "ws": "^8.16.0"
  }
}
"@ | Out-File -FilePath "package.json" -Encoding utf8

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install --production

# Copy workspace packages
Write-Host "Copying workspace dependencies..." -ForegroundColor Yellow
New-Item -ItemType Directory -Force -Path "node_modules/@antimatter" | Out-Null

$packages = @("project-model", "filesystem", "tool-integration", "agent-framework")
foreach ($pkg in $packages) {
    Write-Host "  Copying @antimatter/$pkg..." -ForegroundColor Gray
    New-Item -ItemType Directory -Force -Path "node_modules/@antimatter/$pkg" | Out-Null
    Copy-Item -Path "../../$pkg/dist/*" -Destination "node_modules/@antimatter/$pkg" -Recurse
    Copy-Item -Path "../../$pkg/package.json" -Destination "node_modules/@antimatter/$pkg/"
}

# Create Lambda entry point
Write-Host "Creating Lambda handler..." -ForegroundColor Yellow
@"
const { handler } = require('./lambda.js');
exports.handler = handler;
"@ | Out-File -FilePath "index.js" -Encoding utf8

Set-Location "../../.."

Write-Host "✅ Lambda build complete!" -ForegroundColor Green
