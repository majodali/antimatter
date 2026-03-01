import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as efs from 'aws-cdk-lib/aws-efs';
import { Construct } from 'constructs';
import * as path from 'path';

export class AntimatterStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // Frontend - S3 + CloudFront
    // ==========================================

    // S3 bucket for frontend static files
    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `antimatter-ide-${this.account}`,
      // No websiteIndexDocument — CloudFront handles SPA routing via error pages.
      // Setting websiteIndexDocument causes S3Origin to use the website endpoint
      // (CustomOriginConfig) instead of OAI, breaking private bucket access.
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // WARNING: For dev only
      autoDeleteObjects: true, // WARNING: For dev only
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // CloudFront Origin Access Identity
    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: 'OAI for Antimatter IDE',
    });

    websiteBucket.grantRead(oai);

    // CloudFront distribution
    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.minutes(5),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100, // Use only North America and Europe
    });

    // Deploy frontend to S3
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../../packages/ui/dist/client'))],
      destinationBucket: websiteBucket,
      distribution,
      distributionPaths: ['/*'],
    });

    // ==========================================
    // Data - S3 bucket for project storage
    // ==========================================

    const dataBucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `antimatter-data-${this.account}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // WARNING: For dev only
      autoDeleteObjects: true, // WARNING: For dev only
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // ==========================================
    // Network - VPC for Command Lambda + EFS
    // ==========================================

    // VPC with private subnets for Lambda + EFS.
    // NAT Gateway required for Lambda internet access (S3, Claude API, npm registry).
    // Cost: ~$32/month for NAT Gateway. Acceptable for dev.
    const vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
    });

    // ==========================================
    // Storage - EFS for project working trees
    // ==========================================

    // EFS provides the POSIX file system that build tools need.
    // S3 remains the durable source of truth; EFS is a working copy
    // for command execution (synced on demand in Step 3).
    const projectEfs = new efs.FileSystem(this, 'ProjectEfs', {
      vpc,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.ELASTIC,
      removalPolicy: cdk.RemovalPolicy.DESTROY, // WARNING: For dev only
      encrypted: true,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    });

    // Access point creates /projects with non-root uid/gid
    const efsAccessPoint = projectEfs.addAccessPoint('LambdaAccess', {
      path: '/projects',
      createAcl: {
        ownerGid: '1001',
        ownerUid: '1001',
        permissions: '755',
      },
      posixUser: {
        gid: '1001',
        uid: '1001',
      },
    });

    // ==========================================
    // Backend - API Lambda (no VPC)
    // ==========================================

    // API Lambda handles file CRUD (via S3), agent chat, build config.
    // Stays outside VPC for low latency and fast cold starts.
    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/ui/dist-lambda')),
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: {
        NODE_ENV: 'production',
        PROJECTS_BUCKET: dataBucket.bucketName,
        // ANTHROPIC_API_KEY will be added via Secrets Manager or environment variable
      },
    });

    // Grant API Lambda read/write access to the data bucket
    dataBucket.grantReadWrite(apiFunction);

    // ==========================================
    // Command Execution - Lambda with EFS
    // ==========================================

    // Command Lambda runs build tools, tests, and other commands against
    // a POSIX file system (EFS). Lives in VPC for EFS access.
    // Higher memory and timeout than API Lambda for build workloads.
    const commandFunction = new lambda.Function(this, 'CommandFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'command.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/ui/dist-lambda')),
      timeout: cdk.Duration.minutes(15),
      memorySize: 2048,
      vpc,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      filesystem: lambda.FileSystem.fromEfsAccessPoint(efsAccessPoint, '/mnt/projects'),
      environment: {
        NODE_ENV: 'production',
        EFS_MOUNT_PATH: '/mnt/projects',
        PROJECTS_BUCKET: dataBucket.bucketName,
      },
    });

    // Grant Command Lambda access to data bucket (needed for S3↔EFS sync)
    dataBucket.grantReadWrite(commandFunction);

    // Grant API Lambda permission to invoke Command Lambda (Step 4).
    // Build/test/lint execution on the API Lambda is routed to the Command
    // Lambda via direct Lambda invoke (CommandLambdaEnvironment).
    commandFunction.grantInvoke(apiFunction);

    // Pass Command Lambda function name to the API Lambda so it can
    // create a CommandLambdaEnvironment pointing at the right function.
    apiFunction.addEnvironment('COMMAND_FUNCTION_NAME', commandFunction.functionName);

    // ==========================================
    // Self-Deployment Permissions (Step 5)
    // ==========================================

    // Allow API Lambda to update its own code and the Command Lambda's code
    // (for deploying from within the IDE).
    // IMPORTANT: Can't reference apiFunction.functionArn here — it creates a
    // circular dependency (role policy → Lambda → role policy). Use a wildcard
    // for Lambda functions in this account instead.
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunctionConfiguration',
      ],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:*`,
      ],
    }));

    // Allow API Lambda to write to the website bucket (frontend deployment)
    websiteBucket.grantReadWrite(apiFunction);

    // Pass website bucket name and distribution ID to API Lambda
    apiFunction.addEnvironment('WEBSITE_BUCKET', websiteBucket.bucketName);

    // ==========================================
    // API Gateway
    // ==========================================

    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'Antimatter API',
      description: 'API for Antimatter IDE',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // API Lambda integration (handles all routes except commands)
    const apiIntegration = new apigateway.LambdaIntegration(apiFunction, {
      proxy: true,
    });

    // Command Lambda integration (handles command execution routes)
    const commandIntegration = new apigateway.LambdaIntegration(commandFunction, {
      proxy: true,
    });

    // ---- Route structure ----
    // CloudFront sends /api/* paths to API Gateway, so the path the gateway
    // sees is /api/commands/health, /api/files/tree, etc.  We need explicit
    // /api/commands/* routes so they reach the Command Lambda instead of
    // falling through to the API Lambda catch-all.
    //
    // API Gateway REST API precedence: explicit resources > {proxy+}.
    //
    //   /api/commands/*  → Command Lambda  (CloudFront path)
    //   /api/{proxy+}    → API Lambda      (CloudFront path, everything else)
    //   /commands/*       → Command Lambda  (direct API Gateway access)
    //   /{proxy+}         → API Lambda      (direct API Gateway access)

    // -- CloudFront paths (under /api) --
    const apiResource = api.root.addResource('api');

    const apiCommandsResource = apiResource.addResource('commands');
    apiCommandsResource.addMethod('ANY', commandIntegration);
    apiCommandsResource.addProxy({
      defaultIntegration: commandIntegration,
      anyMethod: true,
    });

    apiResource.addProxy({
      defaultIntegration: apiIntegration,
      anyMethod: true,
    });

    // -- Direct API Gateway paths (under /commands) --
    const commandsResource = api.root.addResource('commands');
    commandsResource.addMethod('ANY', commandIntegration);
    commandsResource.addProxy({
      defaultIntegration: commandIntegration,
      anyMethod: true,
    });

    // -- Root catch-all for everything else --
    api.root.addProxy({
      defaultIntegration: apiIntegration,
      anyMethod: true,
    });

    // ==========================================
    // CloudFront → API Gateway proxy for /api/*
    // ==========================================

    // Route /api/* requests through CloudFront to API Gateway so the
    // frontend can use relative URLs (e.g. /api/projects) instead of
    // hard-coding the API Gateway domain.
    const apiOrigin = new origins.HttpOrigin(
      `${api.restApiId}.execute-api.${this.region}.amazonaws.com`,
      {
        originPath: `/${api.deploymentStage.stageName}`,
        protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      },
    );

    distribution.addBehavior('/api/*', apiOrigin, {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    });

    // ==========================================
    // Self-Deployment: CloudFront Permissions
    // ==========================================
    // (Must be after distribution is created)

    // Allow API Lambda to invalidate the CloudFront cache (for frontend deploy).
    // Uses wildcard resource to avoid CDK/CloudFormation circular dependency:
    // Lambda → Distribution → API Gateway → Lambda.
    // The distribution ID is passed to deploy configs directly (not as env var).
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
    }));

    // ==========================================
    // Outputs
    // ==========================================

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL for the frontend',
    });

    new cdk.CfnOutput(this, 'ApiURL', {
      value: api.url,
      description: 'API Gateway URL for the backend',
    });

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: websiteBucket.bucketName,
      description: 'S3 bucket name for frontend deployment',
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      description: 'S3 bucket name for project data storage',
    });

    new cdk.CfnOutput(this, 'VpcId', {
      value: vpc.vpcId,
      description: 'VPC ID for Command Lambda',
    });

    new cdk.CfnOutput(this, 'EfsId', {
      value: projectEfs.fileSystemId,
      description: 'EFS file system ID for project working trees',
    });

    new cdk.CfnOutput(this, 'CommandFunctionArn', {
      value: commandFunction.functionArn,
      description: 'Command Lambda function ARN',
    });
  }
}
