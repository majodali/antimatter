#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AntimatterStack } from '../lib/antimatter-stack';

const app = new cdk.App();

new AntimatterStack(app, 'AntimatterStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
  description: 'Antimatter IDE - AI-powered development environment',
});

app.synth();
