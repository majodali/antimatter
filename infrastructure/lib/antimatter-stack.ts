import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as events from 'aws-cdk-lib/aws-events';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53targets from 'aws-cdk-lib/aws-route53-targets';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import { Construct } from 'constructs';
import * as path from 'path';

export class AntimatterStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

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

    // ==========================================
    // DNS + TLS — Route53 + ACM
    // ==========================================

    // Hosted zone for antimatter.solutions (already exists from domain registration)
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: 'Z06940802YF3L0EO5UBCI',
      zoneName: 'antimatter.solutions',
    });

    // ACM certificate for ide.antimatter.solutions — must be in us-east-1 for CloudFront.
    // DnsValidatedCertificate handles the cross-region requirement explicitly.
    const certificate = new acm.DnsValidatedCertificate(this, 'Certificate', {
      domainName: 'ide.antimatter.solutions',
      hostedZone,
      region: 'us-east-1', // Required for CloudFront
    });

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
      domainNames: ['ide.antimatter.solutions'],
      certificate,
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
    // Events - EventBridge for system events
    // ==========================================

    const eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: 'antimatter',
    });

    // ==========================================
    // Authentication — Cognito User Pool
    // ==========================================

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'antimatter-users',
      selfSignUpEnabled: false, // Admin creates users
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      removalPolicy: cdk.RemovalPolicy.RETAIN, // Never auto-delete user pool
    });

    // Cognito prefix domain for Hosted UI (e.g. antimatter-ide.auth.us-west-2.amazoncognito.com)
    const userPoolDomain = userPool.addDomain('CognitoDomain', {
      cognitoDomain: { domainPrefix: 'antimatter-ide' },
    });

    // User Pool Client — SPA with authorization code + PKCE
    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: 'antimatter-web',
      generateSecret: false, // SPA — no client secret
      authFlows: {
        userSrp: true,
      },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          'https://ide.antimatter.solutions/',
          'https://d33wyunpiwy2df.cloudfront.net/',
        ],
        logoutUrls: [
          'https://ide.antimatter.solutions/',
          'https://d33wyunpiwy2df.cloudfront.net/',
        ],
      },
      accessTokenValidity: cdk.Duration.hours(24),
      idTokenValidity: cdk.Duration.hours(24),
      refreshTokenValidity: cdk.Duration.days(3650), // ~10 years
      preventUserExistenceErrors: true,
    });

    // ==========================================
    // Network - VPC for EC2 Workspace Instances
    // ==========================================

    // VPC with private subnets for EC2 workspace instances.
    // NAT Gateway required for internet access (S3, npm registry, etc.).
    // Cost: ~$32/month for NAT Gateway. Acceptable for dev.
    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 1,
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

    // Grant API Lambda permission to put events on EventBridge
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['events:PutEvents'],
      resources: [eventBus.eventBusArn],
    }));

    // Pass event bus name to API Lambda
    apiFunction.addEnvironment('EVENT_BUS_NAME', eventBus.eventBusName);

    // Grant API Lambda CloudFormation permissions for environment registry
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudformation:DeleteStack', 'cloudformation:DescribeStacks'],
      resources: [`arn:aws:cloudformation:${this.region}:${this.account}:stack/AntimatterEnv-*/*`],
    }));

    // Grant API Lambda SSM permissions for secrets management
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ssm:GetParameter', 'ssm:PutParameter', 'ssm:DeleteParameter'],
      resources: [`arn:aws:ssm:${this.region}:${this.account}:parameter/antimatter/secrets/*`],
    }));

    // ==========================================
    // Workspace Instances - EC2 + ALB
    // ==========================================
    // Per-project EC2 instances provide a full workspace with Docker,
    // git, cdk, interactive bash (WebSocket + PTY), and all project APIs.
    // CloudFront proxies /workspace/* and /ws/* to the ALB.

    // IAM Role + Instance Profile for workspace EC2 instances.
    // AdministratorAccess is needed for cdk deploy — scope down later.
    const workspaceRole = new iam.Role(this, 'WorkspaceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
      description: 'IAM role for EC2 workspace instances',
    });

    const instanceProfile = new iam.InstanceProfile(this, 'WorkspaceInstanceProfile', {
      role: workspaceRole,
    });

    // Security group for workspace EC2 instances
    const workspaceSg = new ec2.SecurityGroup(this, 'WorkspaceSg', {
      vpc: this.vpc,
      description: 'Security group for EC2 workspace instances',
      allowAllOutbound: true,
    });

    // ALB for workspace routing (HTTP APIs + WebSocket)
    const workspaceAlb = new elbv2.ApplicationLoadBalancer(this, 'WorkspaceAlb', {
      vpc: this.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // HTTP listener — default action is 404.
    // Per-project target groups and path-based routing rules are created
    // dynamically by workspace-ec2-service when instances start.
    const workspaceListener = workspaceAlb.addListener('WorkspaceListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: 'text/plain',
        messageBody: 'No workspace instance for this path',
      }),
    });

    // Allow ALB to reach workspace instances on port 8080
    workspaceAlb.connections.allowTo(workspaceSg, ec2.Port.tcp(8080), 'Allow ALB to reach workspace instances');

    // EC2 Launch Template — base config for workspace instances.
    // User-data is provided at RunInstances time by workspace-ec2-service
    // with project-specific configuration embedded.
    const launchTemplate = new ec2.LaunchTemplate(this, 'WorkspaceLaunchTemplate', {
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.LARGE),
      machineImage: ec2.MachineImage.latestAmazonLinux2023(),
      role: workspaceRole,
      securityGroup: workspaceSg,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(30, {
          volumeType: ec2.EbsDeviceVolumeType.GP3,
          encrypted: true,
        }),
      }],
      requireImdsv2: true,
    });

    // Set ALB idle timeout to 5 minutes (default 60s is too aggressive for WebSocket)
    workspaceAlb.setAttribute('idle_timeout.timeout_seconds', '300');

    // CloudFront behavior for /ws/* → ALB (WebSocket proxy)
    const wsOrigin = new origins.HttpOrigin(workspaceAlb.loadBalancerDnsName, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      httpPort: 80,
      readTimeout: cdk.Duration.seconds(60), // Increase from default 30s for WebSocket
    });

    distribution.addBehavior('/ws/*', wsOrigin, {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      // Forward ALL headers (including Upgrade, Connection, Sec-WebSocket-*)
      // for WebSocket upgrade requests to work through CloudFront.
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    });

    // CloudFront behavior for /workspace/* → ALB (project-scoped APIs on EC2)
    distribution.addBehavior('/workspace/*', wsOrigin, {
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
    });

    // Grant API Lambda permission to manage EC2 instances + EBS volumes
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'ec2:RunInstances',
        'ec2:StartInstances',
        'ec2:StopInstances',
        'ec2:TerminateInstances',
        'ec2:DescribeInstances',
        'ec2:DescribeInstanceStatus',
        'ec2:DescribeVolumes',
        'ec2:CreateVolume',
        'ec2:AttachVolume',
        'ec2:DetachVolume',
        'ec2:DeleteVolume',
        'ec2:CreateTags',
        'ec2:DescribeTags',
        'ec2:DescribeSubnets',
      ],
      resources: ['*'],
    }));

    // Allow API Lambda to pass the workspace role to EC2 instances
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['iam:PassRole'],
      resources: [workspaceRole.roleArn],
    }));

    // Allow API Lambda to manage dynamic ALB target groups and listener rules.
    // Resources are '*' because target groups and rules are created at runtime
    // with unpredictable ARNs.
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'elasticloadbalancing:CreateTargetGroup',
        'elasticloadbalancing:DeleteTargetGroup',
        'elasticloadbalancing:RegisterTargets',
        'elasticloadbalancing:DeregisterTargets',
        'elasticloadbalancing:DescribeTargetGroups',
        'elasticloadbalancing:DescribeTargetHealth',
        'elasticloadbalancing:ModifyTargetGroupAttributes',
        'elasticloadbalancing:CreateRule',
        'elasticloadbalancing:DeleteRule',
        'elasticloadbalancing:DescribeRules',
        'elasticloadbalancing:AddTags',
      ],
      resources: ['*'],
    }));

    // Pass Cognito configuration to API Lambda
    apiFunction.addEnvironment('COGNITO_USER_POOL_ID', userPool.userPoolId);
    apiFunction.addEnvironment('COGNITO_CLIENT_ID', userPoolClient.userPoolClientId);
    apiFunction.addEnvironment('COGNITO_DOMAIN', `antimatter-ide.auth.${this.region}.amazoncognito.com`);

    // Pass workspace configuration to API Lambda
    apiFunction.addEnvironment('WORKSPACE_LAUNCH_TEMPLATE_ID', launchTemplate.launchTemplateId!);
    apiFunction.addEnvironment('WORKSPACE_INSTANCE_PROFILE_ARN', instanceProfile.instanceProfileArn);
    apiFunction.addEnvironment('WORKSPACE_SUBNET_IDS', this.vpc.privateSubnets.map(s => s.subnetId).join(','));
    apiFunction.addEnvironment('WORKSPACE_SG_ID', workspaceSg.securityGroupId);
    apiFunction.addEnvironment('ALB_LISTENER_ARN', workspaceListener.listenerArn);
    apiFunction.addEnvironment('VPC_ID', this.vpc.vpcId);
    apiFunction.addEnvironment('WORKSPACE_ALB_DNS', workspaceAlb.loadBalancerDnsName);
    apiFunction.addEnvironment('WORKSPACE_SHARED_MODE', 'true');

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
        allowOrigins: ['https://ide.antimatter.solutions'],
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'Authorization'],
      },
      deployOptions: {
        stageName: 'prod',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    // API Lambda integration (handles all routes)
    const apiIntegration = new apigateway.LambdaIntegration(apiFunction, {
      proxy: true,
    });

    // ---- Route structure ----
    // CloudFront sends /api/* paths to API Gateway. All routes go to the API Lambda.
    //
    //   /api/{proxy+}    → API Lambda  (CloudFront path)
    //   /{proxy+}         → API Lambda  (direct API Gateway access)

    // -- CloudFront paths (under /api) --
    const apiResource = api.root.addResource('api');
    apiResource.addProxy({
      defaultIntegration: apiIntegration,
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
      value: this.vpc.vpcId,
      description: 'VPC ID for workspace instances',
    });

    new cdk.CfnOutput(this, 'WorkspaceLaunchTemplateId', {
      value: launchTemplate.launchTemplateId!,
      description: 'EC2 launch template ID for workspace instances',
    });

    new cdk.CfnOutput(this, 'WorkspaceAlbDns', {
      value: workspaceAlb.loadBalancerDnsName,
      description: 'ALB DNS name for workspace WebSocket connections',
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: eventBus.eventBusName,
      description: 'EventBridge event bus for system events',
    });

    // ==========================================
    // DNS Record — ide.antimatter.solutions → CloudFront
    // ==========================================

    new route53.ARecord(this, 'SiteAliasRecord', {
      zone: hostedZone,
      recordName: 'ide',
      target: route53.RecordTarget.fromAlias(
        new route53targets.CloudFrontTarget(distribution),
      ),
    });

    new cdk.CfnOutput(this, 'CustomDomainURL', {
      value: 'https://ide.antimatter.solutions',
      description: 'Custom domain URL for the frontend',
    });

    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `antimatter-ide.auth.${this.region}.amazoncognito.com`,
      description: 'Cognito Hosted UI domain',
    });
  }
}
