#!/usr/bin/env bash
# deploy.sh — Full local deploy: build all bundles, upload, CDK deploy, restart workspace
#
# Usage:
#   ./scripts/deploy.sh          # full deploy (frontend + lambda + workspace + CDK)
#   ./scripts/deploy.sh --skip-cdk   # skip CDK, just upload workspace bundle and restart
#   ./scripts/deploy.sh --ws-only    # workspace server bundle only (upload + restart)
#
# Requires: node, npm, aws CLI, CDK CLI, SSM access to workspace EC2

set -euo pipefail
cd "$(dirname "$0")/.."

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[deploy]${NC} $*"; }
warn() { echo -e "${YELLOW}[deploy]${NC} $*"; }
fail() { echo -e "${RED}[deploy]${NC} $*"; exit 1; }

SKIP_CDK=false
WS_ONLY=false

for arg in "$@"; do
  case $arg in
    --skip-cdk) SKIP_CDK=true ;;
    --ws-only)  WS_ONLY=true; SKIP_CDK=true ;;
  esac
done

# ---- Resolve AWS resources ----

STACK_NAME="AntimatterEnv-e1"

resolve_bucket() {
  aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='DataBucketName'].OutputValue" \
    --output text 2>/dev/null
}

resolve_instance() {
  aws ec2 describe-instances \
    --filters "Name=tag:Name,Values=*antimatter-workspace*" "Name=instance-state-name,Values=running" \
    --query 'Reservations[0].Instances[0].InstanceId' \
    --output text 2>/dev/null
}

# ---- Step 1: Build frontend ----

if [ "$WS_ONLY" = false ]; then
  log "Building frontend (Vite)..."
  cd packages/ui && npx vite build && cd ../..
  log "Frontend built."
fi

# ---- Step 2: Build Lambda bundle ----

if [ "$WS_ONLY" = false ]; then
  log "Building Lambda bundle..."
  node packages/ui/scripts/build-lambda.mjs
  log "Lambda bundled."
fi

# ---- Step 3: Build workspace server bundle ----

log "Building workspace server bundle..."
node packages/ui/scripts/build-workspace-server.mjs
log "Workspace server bundled."

# ---- Step 4: CDK deploy (frontend + Lambda + infra) ----

if [ "$SKIP_CDK" = false ]; then
  log "Running CDK deploy..."
  cd infrastructure
  MSYS_NO_PATHCONV=1 npx cdk deploy --all --require-approval never
  cd ..
  log "CDK deploy complete."
fi

# ---- Step 5: Upload workspace server bundle to S3 ----

BUCKET=$(resolve_bucket)
if [ -z "$BUCKET" ] || [ "$BUCKET" = "None" ]; then
  fail "Could not resolve data bucket from CloudFormation stack $STACK_NAME"
fi

log "Uploading workspace server to s3://$BUCKET/workspace-server/..."
aws s3 cp packages/ui/dist-workspace/workspace-server.js "s3://$BUCKET/workspace-server/workspace-server.js" --quiet
log "Workspace server uploaded."

# ---- Step 6: Restart workspace server on EC2 via SSM ----

INSTANCE_ID=$(resolve_instance)
if [ -z "$INSTANCE_ID" ] || [ "$INSTANCE_ID" = "None" ]; then
  warn "No running workspace instance found — skipping restart."
  warn "The new bundle will be loaded on next workspace start."
else
  log "Restarting workspace server on $INSTANCE_ID..."

  CMD_ID=$(MSYS_NO_PATHCONV=1 aws ssm send-command \
    --instance-ids "$INSTANCE_ID" \
    --document-name "AWS-RunShellScript" \
    --parameters '{"commands":["aws s3 cp s3://'"$BUCKET"'/workspace-server/workspace-server.js /opt/antimatter/workspace-server.js","pkill -f node.*workspace-server || true","sleep 2","cd /opt/antimatter && nohup /usr/bin/node workspace-server.js > /var/log/workspace-server.log 2>&1 &","sleep 3","curl -sf http://localhost:8080/health && echo Health_check_OK || echo WARNING_health_check_failed"]}' \
    --query 'Command.CommandId' \
    --output text 2>/dev/null)

  if [ -n "$CMD_ID" ]; then
    log "SSM command sent ($CMD_ID). Waiting for completion..."
    # Poll for completion (max 30s)
    for i in $(seq 1 10); do
      sleep 3
      STATUS=$(aws ssm get-command-invocation \
        --command-id "$CMD_ID" \
        --instance-id "$INSTANCE_ID" \
        --query 'Status' \
        --output text 2>/dev/null || echo "Pending")
      if [ "$STATUS" = "Success" ]; then
        log "Workspace server restarted successfully."
        break
      elif [ "$STATUS" = "Failed" ] || [ "$STATUS" = "TimedOut" ]; then
        warn "SSM command $STATUS. Check /var/log/workspace-server.log on the instance."
        break
      fi
    done
  else
    warn "Failed to send SSM command — restart workspace manually."
  fi
fi

log "Deploy complete!"
echo ""
echo "Next steps:"
echo "  1. Hard-refresh the IDE browser tab (Ctrl+Shift+R)"
echo "  2. Wait for workspace WebSocket to reconnect (~10s)"
echo "  3. Run functional tests to verify"
