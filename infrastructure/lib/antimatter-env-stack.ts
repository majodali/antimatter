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

/**
 * Props for a reusable Antimatter environment stack.
 *
 * Each environment gets its own S3 buckets, Lambda functions, API Gateway,
 * and CloudFront distribution while sharing the VPC and EFS from the
 * production stack.
 */
export interface AntimatterEnvStackProps extends cdk.StackProps {
  /** Unique environment identifier — used in all resource names (e.g. 'e1', 'feat-auth', 'v2') */
  readonly envId: string;
  /** Shared VPC from the production stack */
  readonly vpc: ec2.IVpc;
  /** Shared EFS from the production stack */
  readonly projectEfs: efs.IFileSystem;
  /** Shared EFS access point from the production stack */
  readonly efsAccessPoint: efs.IAccessPoint;
  /** Security group ID of the shared EFS (for adding NFS ingress) */
  readonly efsSecurityGroupId: string;
}

export class AntimatterEnvStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: AntimatterEnvStackProps) {
    super(scope, id, props);

    const { envId, vpc, efsAccessPoint, efsSecurityGroupId } = props;

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
      },
    });

    dataBucket.grantReadWrite(apiFunction);

    // ==========================================
    // Command Execution - Lambda with shared VPC + EFS
    // ==========================================

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

    dataBucket.grantReadWrite(commandFunction);
    commandFunction.grantInvoke(apiFunction);
    apiFunction.addEnvironment('COMMAND_FUNCTION_NAME', commandFunction.functionName);

    // Allow the environment's Command Lambda NFS access to the shared EFS.
    // Created here (not in the prod stack) so the prod stack template is untouched.
    new ec2.CfnSecurityGroupIngress(this, 'EfsAccess', {
      groupId: efsSecurityGroupId,
      ipProtocol: 'tcp',
      fromPort: 2049,
      toPort: 2049,
      sourceSecurityGroupId: commandFunction.connections.securityGroups[0].securityGroupId,
    });

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
    const commandIntegration = new apigateway.LambdaIntegration(commandFunction, { proxy: true });

    // Route structure (same as production)
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

    const commandsResource = api.root.addResource('commands');
    commandsResource.addMethod('ANY', commandIntegration);
    commandsResource.addProxy({
      defaultIntegration: commandIntegration,
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

    new cdk.CfnOutput(this, 'CommandFunctionArn', {
      value: commandFunction.functionArn,
      description: `Command Lambda function ARN for environment ${envId}`,
    });
  }
}
