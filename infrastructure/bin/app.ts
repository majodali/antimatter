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

// Production stack is always synthesized so per-env stacks can cross-stack
// reference its VPC. Synth != deploy: `cdk deploy AntimatterStack` targets
// prod explicitly, `cdk deploy AntimatterEnv-test` touches only the env.
const prodStack = new AntimatterStack(app, 'AntimatterStack', {
  env,
  description: 'Antimatter IDE - AI-powered development environment',
});

// Per-env stacks are opt-in via CDK context: `--context envId=test` spins
// up `AntimatterEnv-test`. You can pass a comma-separated list to synth
// multiple at once: `--context envIds=test,staging`. Without either
// context key, only the prod stack is synthesized.
const envIds = (() => {
  const single = app.node.tryGetContext('envId');
  const list = app.node.tryGetContext('envIds');
  const ids: string[] = [];
  if (typeof single === 'string' && single) ids.push(single);
  if (typeof list === 'string' && list) ids.push(...list.split(',').map((s) => s.trim()).filter(Boolean));
  return Array.from(new Set(ids));
})();

for (const envId of envIds) {
  new AntimatterEnvStack(app, `AntimatterEnv-${envId}`, {
    env,
    envId,
    description: `Antimatter IDE - Environment ${envId}`,
    vpc: prodStack.vpc,
  });
}

app.synth();
