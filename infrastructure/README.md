# Antimatter IDE - AWS Infrastructure

This directory contains AWS CDK infrastructure code for deploying Antimatter IDE to AWS.

## Architecture

- **Frontend**: React app hosted on S3 with CloudFront CDN
- **Backend**: Express API running on AWS Lambda with API Gateway
- **Region**: us-east-1 (configurable)

## Prerequisites

1. **AWS Account** with appropriate permissions
2. **AWS CLI** configured with credentials (`aws configure`)
3. **Node.js** 20+ and npm/pnpm
4. **AWS CDK** CLI (installed as dev dependency)

## First-Time Setup

### Bootstrap CDK (one-time per account/region)

```bash
cd infrastructure
npx cdk bootstrap aws://ACCOUNT-ID/us-east-1
```

Replace `ACCOUNT-ID` with your AWS account ID, or use:

```bash
npx cdk bootstrap
```

This creates the necessary S3 bucket and IAM roles for CDK deployments.

## Deployment

### 1. Build the Frontend

```bash
cd packages/ui
npm run build
```

This creates `packages/ui/dist` with the production build.

### 2. Build the Lambda Function

From the root directory:

**Windows (PowerShell):**
```powershell
.\scripts\build-lambda.ps1
```

**Linux/Mac:**
```bash
chmod +x scripts/build-lambda.sh
./scripts/build-lambda.sh
```

This creates `packages/ui/dist-lambda` with the bundled Lambda function.

### 3. Deploy to AWS

```bash
cd infrastructure
npm run deploy
```

This will:
- Upload frontend to S3
- Deploy Lambda function
- Create API Gateway
- Set up CloudFront distribution
- Output the URLs

### View the Stack

```bash
npm run synth    # View CloudFormation template
npm run diff     # See what will change
```

## Outputs

After deployment, CDK will output:

- **WebsiteURL**: `https://d123456789.cloudfront.net` - Your app URL
- **ApiURL**: `https://abc123.execute-api.us-east-1.amazonaws.com/prod` - API endpoint
- **S3BucketName**: `antimatter-ide-123456789` - Frontend bucket
- **DistributionId**: `E123456789` - CloudFront distribution ID

## Environment Variables

To set the Anthropic API key:

1. Go to AWS Lambda console
2. Find the `AntimatterStack-ApiFunction` function
3. Add environment variable: `ANTHROPIC_API_KEY=your-key-here`

Or use AWS Secrets Manager (recommended for production).

## Updating the App

After making changes:

```bash
# Rebuild frontend
cd packages/ui
npm run build

# Rebuild Lambda (if backend changed)
cd ../..
.\scripts\build-lambda.ps1  # Windows
./scripts\build-lambda.sh   # Linux/Mac

# Deploy
cd infrastructure
npm run deploy
```

## Costs

Estimated monthly costs (light usage):

- **S3**: ~$0.50/month (storage + requests)
- **CloudFront**: ~$1-5/month (data transfer)
- **Lambda**: ~$0-5/month (free tier: 1M requests, 400K GB-seconds)
- **API Gateway**: ~$0-3/month (free tier: 1M requests)

**Total**: ~$2-15/month depending on traffic

## Cleanup

To remove all resources:

```bash
cd infrastructure
npm run destroy
```

⚠️ **Warning**: This will delete the S3 bucket and all data.

## Troubleshooting

### CDK Bootstrap Failed

Make sure your AWS credentials have sufficient permissions:
- `iam:CreateRole`, `iam:AttachRolePolicy`
- `s3:CreateBucket`, `s3:PutObject`
- `cloudformation:CreateStack`

### Lambda Function Not Working

Check CloudWatch Logs:
```bash
aws logs tail /aws/lambda/AntimatterStack-ApiFunction --follow
```

### Frontend Not Loading

1. Check S3 bucket has files: `aws s3 ls s3://antimatter-ide-ACCOUNT-ID/`
2. Check CloudFront distribution is deployed
3. Wait 5-10 minutes for CloudFront to propagate

## CI/CD

For automated deployments, see `.github/workflows/deploy.yml` (coming soon).
