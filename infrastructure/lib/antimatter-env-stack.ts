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
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as events from 'aws-cdk-lib/aws-events';
import { Construct } from 'constructs';
import * as path from 'path';

/**
 * Props for a reusable Antimatter environment stack.
 *
 * Each environment gets its own S3 buckets, Lambda functions, API Gateway,
 * CloudFront distribution, and EC2/ALB while sharing the VPC from the
 * production stack.
 */
export interface AntimatterEnvStackProps extends cdk.StackProps {
  /** Unique environment identifier — used in all resource names (e.g. 'e1', 'feat-auth', 'v2') */
  readonly envId: string;
}

export class AntimatterEnvStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AntimatterEnvStackProps) {
    super(scope, id, props);

    const { envId } = props;

    // Look up the shared VPC by ID (configured in cdk.json → context.sharedVpcId).
    // `fromLookup` resolves at synth time and caches into cdk.context.json — it
    // does NOT emit a CloudFormation cross-stack Import. That's deliberate: we
    // want env-stack deploys to be provably unable to touch AntimatterStack.
    const sharedVpcId = this.node.tryGetContext('sharedVpcId');
    if (!sharedVpcId) {
      throw new Error(
        'AntimatterEnvStack requires `sharedVpcId` context. Set it in cdk.json (or pass --context sharedVpcId=vpc-...).',
      );
    }
    const vpc = ec2.Vpc.fromLookup(this, 'SharedVpc', { vpcId: sharedVpcId });

    // ==========================================
    // Frontend - S3 + CloudFront
    // ==========================================

    const websiteBucket = new s3.Bucket(this, 'WebsiteBucket', {
      bucketName: `antimatter-ide-${envId}-${this.account}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const oai = new cloudfront.OriginAccessIdentity(this, 'OAI', {
      comment: `OAI for Antimatter IDE environment ${envId}`,
    });

    websiteBucket.grantRead(oai);

    const distribution = new cloudfront.Distribution(this, 'Distribution', {
      defaultBehavior: {
        origin: new origins.S3Origin(websiteBucket, {
          originAccessIdentity: oai,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      },
      defaultRootObject: 'index.html',
      errorResponses: [
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
          ttl: cdk.Duration.seconds(0),
        },
      ],
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
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
      bucketName: `antimatter-data-${envId}-${this.account}`,
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    // ==========================================
    // Authentication — per-env Cognito User Pool
    // ==========================================
    // A separate pool per env keeps test-env auth isolated from prod.
    // Sign-in is email + admin-created users, same as prod.

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `antimatter-users-${envId}`,
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      // DESTROY so `cdk destroy` can clean up test envs fully. Prod pool
      // stays RETAIN — but this stack only creates per-env pools.
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Domain prefix must be globally unique — include account suffix to
    // reduce collision risk across AWS accounts reusing the codebase.
    const userPoolDomain = userPool.addDomain('CognitoDomain', {
      cognitoDomain: { domainPrefix: `antimatter-${envId}-${this.account.slice(-6)}` },
    });

    // Callback URLs: a placeholder-only set at stack-creation time.
    // We can't reference `distribution.distributionDomainName` here — it
    // closes a circular dependency: distribution → BucketDeployment →
    // API Gateway → ApiFunction → UserPoolClient → distribution.
    // The authenticated flows we use in practice are userSrp-based (tokens
    // issued via InitiateAuth, not the Hosted UI), which doesn't consult
    // the callback list. After the stack deploys, a one-line AWS CLI
    // update-user-pool-client call can add the real CloudFront URL to
    // callbackUrls/logoutUrls if Hosted UI access is ever needed for this
    // env. The CFN output `CognitoClientUpdateHint` spells out the command.
    const userPoolClient = userPool.addClient('WebClient', {
      userPoolClientName: `antimatter-web-${envId}`,
      generateSecret: false,
      // userSrp: SPA login flow (frontend).
      // adminUserPassword: admin-side token fetching for tests / automation
      //   (e.g. CLI scripts that need a token without doing SRP math).
      authFlows: { userSrp: true, adminUserPassword: true },
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: ['http://localhost:5173/'],
        logoutUrls: ['http://localhost:5173/'],
      },
      accessTokenValidity: cdk.Duration.hours(24),
      idTokenValidity: cdk.Duration.hours(24),
      refreshTokenValidity: cdk.Duration.days(30),
      preventUserExistenceErrors: true,
    });

    // ==========================================
    // Events — per-env EventBridge bus
    // ==========================================
    // The Lambda defaults to bus name 'antimatter' which doesn't exist in
    // a fresh env — without this, PutEvents calls silently fail. Creating
    // a scoped bus keeps event-based features working and avoids cross-
    // env pollution if we ever route S3 file-change events here.

    const eventBus = new events.EventBus(this, 'EventBus', {
      eventBusName: `antimatter-${envId}`,
    });

    // ==========================================
    // Backend - API Lambda (no VPC)
    // ==========================================

    const apiFunction = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/ui/dist-lambda')),
      timeout: cdk.Duration.seconds(120),
      memorySize: 1024,
      environment: {
        NODE_ENV: 'production',
        PROJECTS_BUCKET: dataBucket.bucketName,
        COGNITO_USER_POOL_ID: userPool.userPoolId,
        COGNITO_CLIENT_ID: userPoolClient.userPoolClientId,
        COGNITO_DOMAIN: `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });

    dataBucket.grantReadWrite(apiFunction);
    eventBus.grantPutEventsTo(apiFunction);

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
      description: `IAM role for EC2 workspace instances (${envId})`,
    });

    const instanceProfile = new iam.InstanceProfile(this, 'WorkspaceInstanceProfile', {
      role: workspaceRole,
    });

    // Security group for workspace EC2 instances
    const workspaceSg = new ec2.SecurityGroup(this, 'WorkspaceSg', {
      vpc,
      description: `Security group for EC2 workspace instances (${envId})`,
      allowAllOutbound: true,
    });

    // ALB for workspace routing (HTTP APIs + WebSocket)
    const workspaceAlb = new elbv2.ApplicationLoadBalancer(this, 'WorkspaceAlb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

    // Shared target group — all workspace EC2 instances register here.
    // The Router on each instance dispatches /workspace/{projectId}/...
    // to the correct project worker child process. Mirrors the prod
    // `ws-default` target group.
    const workspaceTargetGroup = new elbv2.ApplicationTargetGroup(this, 'WorkspaceTargetGroup', {
      targetGroupName: `ws-${envId}`,
      vpc,
      port: 8080,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      healthCheck: {
        path: '/health',
        protocol: elbv2.Protocol.HTTP,
        port: '8080',
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
      deregistrationDelay: cdk.Duration.seconds(30),
    });

    const workspaceListener = workspaceAlb.addListener('WorkspaceListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [workspaceTargetGroup],
    });

    // Allow ALB to reach workspace instances on port 8080
    workspaceAlb.connections.allowTo(workspaceSg, ec2.Port.tcp(8080), 'Allow ALB to reach workspace instances');

    // EC2 Launch Template — base config for workspace instances.
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

    // Pass workspace configuration to API Lambda
    apiFunction.addEnvironment('WORKSPACE_LAUNCH_TEMPLATE_ID', launchTemplate.launchTemplateId!);
    apiFunction.addEnvironment('WORKSPACE_INSTANCE_PROFILE_ARN', instanceProfile.instanceProfileArn);
    apiFunction.addEnvironment('WORKSPACE_SUBNET_IDS', vpc.privateSubnets.map(s => s.subnetId).join(','));
    apiFunction.addEnvironment('WORKSPACE_SG_ID', workspaceSg.securityGroupId);
    apiFunction.addEnvironment('ALB_LISTENER_ARN', workspaceListener.listenerArn);
    apiFunction.addEnvironment('VPC_ID', vpc.vpcId);
    apiFunction.addEnvironment('WORKSPACE_ALB_DNS', workspaceAlb.loadBalancerDnsName);
    apiFunction.addEnvironment('WORKSPACE_TARGET_GROUP_ARN', workspaceTargetGroup.targetGroupArn);
    apiFunction.addEnvironment('WORKSPACE_SHARED_MODE', 'true');
    apiFunction.addEnvironment('WORKSPACE_ENV_ID', envId);

    // ==========================================
    // Self-Deployment Permissions
    // ==========================================

    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: [
        'lambda:UpdateFunctionCode',
        'lambda:GetFunctionConfiguration',
      ],
      resources: [
        `arn:aws:lambda:${this.region}:${this.account}:function:*`,
      ],
    }));

    websiteBucket.grantReadWrite(apiFunction);
    apiFunction.addEnvironment('WEBSITE_BUCKET', websiteBucket.bucketName);

    // ==========================================
    // API Gateway
    // ==========================================

    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: `Antimatter API (${envId})`,
      description: `API for Antimatter IDE environment ${envId}`,
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

    const apiIntegration = new apigateway.LambdaIntegration(apiFunction, { proxy: true });

    // Route structure — all routes go to the API Lambda
    const apiResource = api.root.addResource('api');
    apiResource.addProxy({
      defaultIntegration: apiIntegration,
      anyMethod: true,
    });

    api.root.addProxy({
      defaultIntegration: apiIntegration,
      anyMethod: true,
    });

    // ==========================================
    // CloudFront → API Gateway proxy for /api/*
    // ==========================================

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

    // CloudFront invalidation permissions
    apiFunction.addToRolePolicy(new iam.PolicyStatement({
      actions: ['cloudfront:CreateInvalidation'],
      resources: [`arn:aws:cloudfront::${this.account}:distribution/*`],
    }));

    // ==========================================
    // Outputs
    // ==========================================

    new cdk.CfnOutput(this, 'WebsiteURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: `CloudFront URL for environment ${envId}`,
    });

    new cdk.CfnOutput(this, 'WebsiteBucketName', {
      value: websiteBucket.bucketName,
      description: `Website S3 bucket for environment ${envId}`,
    });

    new cdk.CfnOutput(this, 'ApiURL', {
      value: api.url,
      description: `API Gateway URL for environment ${envId}`,
    });

    new cdk.CfnOutput(this, 'DistributionId', {
      value: distribution.distributionId,
      description: `CloudFront distribution ID for environment ${envId}`,
    });

    new cdk.CfnOutput(this, 'DataBucketName', {
      value: dataBucket.bucketName,
      description: `Data bucket for environment ${envId}`,
    });

    new cdk.CfnOutput(this, 'WorkspaceLaunchTemplateId', {
      value: launchTemplate.launchTemplateId!,
      description: `EC2 launch template ID for environment ${envId}`,
    });

    new cdk.CfnOutput(this, 'WorkspaceAlbDns', {
      value: workspaceAlb.loadBalancerDnsName,
      description: `ALB DNS for workspace WebSocket connections (${envId})`,
    });

    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: userPool.userPoolId,
      description: `Cognito User Pool ID (${envId})`,
    });

    new cdk.CfnOutput(this, 'CognitoClientId', {
      value: userPoolClient.userPoolClientId,
      description: `Cognito User Pool Client ID (${envId})`,
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: `${userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
      description: `Cognito Hosted UI domain (${envId})`,
    });

    new cdk.CfnOutput(this, 'EventBusName', {
      value: eventBus.eventBusName,
      description: `EventBridge bus name (${envId})`,
    });

    // Post-deploy hint: if you want Hosted UI (Cognito OAuth code grant)
    // to work on the CloudFront domain, add it to the callback + logout
    // lists with this command. Not needed for SRP-based auth.
    new cdk.CfnOutput(this, 'CognitoClientUpdateHint', {
      value: [
        'aws cognito-idp update-user-pool-client',
        `--user-pool-id ${userPool.userPoolId}`,
        `--client-id ${userPoolClient.userPoolClientId}`,
        `--callback-urls http://localhost:5173/ https://${distribution.distributionDomainName}/`,
        `--logout-urls   http://localhost:5173/ https://${distribution.distributionDomainName}/`,
        `--region ${this.region}`,
      ].join(' '),
      description: `(Optional) add the CloudFront domain to Cognito callbacks for Hosted UI access`,
    });
  }
}
