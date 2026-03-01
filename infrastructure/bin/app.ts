#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AntimatterStack } from '../lib/antimatter-stack';
import { AntimatterEnvStack } from '../lib/antimatter-env-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
};

const prodStack = new AntimatterStack(app, 'AntimatterStack', {
  env,
  description: 'Antimatter IDE - AI-powered development environment',
});

// First dev environment for self-hosting verification.
// Shares VPC and EFS with prod; gets its own S3, Lambda, API Gateway, CloudFront.
new AntimatterEnvStack(app, 'AntimatterEnv-e1', {
  env,
  envId: 'e1',
  description: 'Antimatter IDE - Environment e1',
  vpc: prodStack.vpc,
  projectEfs: prodStack.projectEfs,
  efsAccessPoint: prodStack.efsAccessPoint,
  efsSecurityGroupId: prodStack.projectEfs.connections.securityGroups[0].securityGroupId,
});

app.synth();
