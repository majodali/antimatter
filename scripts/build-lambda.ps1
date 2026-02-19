# Build Lambda function for deployment using esbuild
Write-Host "Building Lambda function with esbuild..." -ForegroundColor Cyan

# Install dependencies (ensures esbuild is available)
pnpm install --frozen-lockfile 2>$null

# Run the esbuild bundler script
node packages/ui/scripts/build-lambda.mjs

if ($LASTEXITCODE -ne 0) {
    Write-Host "Lambda build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "Lambda build complete! Output: packages/ui/dist-lambda/index.js" -ForegroundColor Green
