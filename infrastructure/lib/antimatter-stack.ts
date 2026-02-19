import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
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
    // Backend - Lambda + API Gateway
    // ==========================================

    // Lambda function for backend API
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

    // Grant Lambda read/write access to the data bucket
    dataBucket.grantReadWrite(apiFunction);

    // API Gateway REST API
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

    // Lambda integration
    const lambdaIntegration = new apigateway.LambdaIntegration(apiFunction, {
      proxy: true,
    });

    // Proxy all requests to Lambda (let Express handle routing)
    api.root.addProxy({
      defaultIntegration: lambdaIntegration,
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
  }
}
