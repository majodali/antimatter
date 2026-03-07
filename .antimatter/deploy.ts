/**
 * Deploy Automation — declares deployment targets and rules for the Antimatter project.
 *
 * Targets declare how modules are deployed: Lambda updates, S3 uploads.
 * Rules are triggered by explicit events (not file changes) — no accidental deployments.
 *
 * Event chain:
 *   build:full → install deps → emit bundle events → bundle all modules
 *   build:bundle-* → bundle individual modules
 *   deploy:upload-workspace → upload workspace server bundle to S3
 *   deploy:cdk → full CDK deploy (frontend + API Lambda + infrastructure)
 */
import { defineWorkflow } from '@antimatter/workflow';

interface DeployState {
  bundle: {
    apiLambda: { status: string; lastRun?: string };
    workspaceServer: { status: string; lastRun?: string };
    frontend: { status: string; lastRun?: string };
  };
  deploy: {
    status: 'idle' | 'deploying' | 'success' | 'failed';
    lastRun?: string;
  };
}

export default defineWorkflow<DeployState>((wf) => {

  // ---- Target declarations ----

  wf.target('api-lambda-deploy', {
    module: 'api-lambda',
    type: 'lambda-update',
    config: { functionName: 'AntimatterStack-ApiFunction' },
  });

  wf.target('frontend-deploy', {
    module: 'frontend',
    type: 's3-upload',
    config: { bucket: 'antimatter-frontend', distributionId: '' },
  });

  wf.target('workspace-server-deploy', {
    module: 'workspace-server',
    type: 's3-upload',
    config: { bucket: '', prefix: 'workspace-server/' },
  });

  // ---- Environment declaration ----

  wf.environment('production', {
    stackName: 'AntimatterStack',
    url: 'ide.antimatter.solutions',
    actions: {
      build: { event: { type: 'build:full' }, icon: 'build' },
      deploy: { event: { type: 'deploy:cdk' }, icon: 'play' },
    },
  });

  // ---- Bundle rules (triggered by explicit events) ----

  wf.rule('bundle-api-lambda', 'Bundle API Lambda',
    (e) => e.type === 'build:bundle-api-lambda',
    async (_events, state) => {
      state.bundle.apiLambda = { status: 'running' };
      wf.log('Bundling API Lambda...');

      const result = await wf.exec('node packages/ui/scripts/build-lambda.mjs', {
        timeout: 120_000,
      });

      if (result.exitCode === 0) {
        state.bundle.apiLambda.status = 'success';
        state.bundle.apiLambda.lastRun = new Date().toISOString();
        wf.log(`API Lambda bundled (${(result.durationMs / 1000).toFixed(1)}s)`);
      } else {
        state.bundle.apiLambda.status = 'failed';
        wf.log(`API Lambda bundle failed (exit ${result.exitCode})`, 'error');
      }
    },
  );

  wf.rule('bundle-workspace', 'Bundle workspace server',
    (e) => e.type === 'build:bundle-workspace',
    async (_events, state) => {
      state.bundle.workspaceServer = { status: 'running' };
      wf.log('Bundling workspace server...');

      const result = await wf.exec('node packages/ui/scripts/build-workspace-server.mjs', {
        timeout: 120_000,
      });

      if (result.exitCode === 0) {
        state.bundle.workspaceServer.status = 'success';
        state.bundle.workspaceServer.lastRun = new Date().toISOString();
        wf.log(`Workspace server bundled (${(result.durationMs / 1000).toFixed(1)}s)`);
      } else {
        state.bundle.workspaceServer.status = 'failed';
        wf.log(`Workspace server bundle failed (exit ${result.exitCode})`, 'error');
      }
    },
  );

  wf.rule('bundle-frontend', 'Bundle frontend',
    (e) => e.type === 'build:bundle-frontend',
    async (_events, state) => {
      state.bundle.frontend = { status: 'running' };
      wf.log('Bundling frontend...');

      const result = await wf.exec('cd packages/ui && npx vite build', {
        timeout: 120_000,
      });

      if (result.exitCode === 0) {
        state.bundle.frontend.status = 'success';
        state.bundle.frontend.lastRun = new Date().toISOString();
        wf.log(`Frontend bundled (${(result.durationMs / 1000).toFixed(1)}s)`);
      } else {
        state.bundle.frontend.status = 'failed';
        wf.log(`Frontend bundle failed (exit ${result.exitCode})`, 'error');
      }
    },
  );

  // ---- Upload workspace server to S3 ----

  wf.rule('upload-workspace-server', 'Upload workspace server bundle to S3',
    (e) => e.type === 'deploy:upload-workspace',
    async (_events, state) => {
      wf.log('Uploading workspace server to S3...');

      // Query CloudFormation for the projects bucket name
      const cfResult = await wf.exec(
        'aws cloudformation describe-stacks --stack-name AntimatterStack --query "Stacks[0].Outputs[?OutputKey==\'ProjectsBucket\'].OutputValue" --output text',
        { timeout: 30_000 },
      );

      if (cfResult.exitCode !== 0 || !cfResult.stdout.trim()) {
        wf.log('Failed to resolve S3 bucket from CloudFormation', 'error');
        return;
      }

      const bucket = cfResult.stdout.trim();
      wf.log(`Uploading to s3://${bucket}/workspace-server/...`);

      const uploadResult = await wf.exec(
        `aws s3 cp packages/ui/dist-workspace/workspace-server.js s3://${bucket}/workspace-server/workspace-server.js && ` +
        `aws s3 cp packages/ui/dist-workspace/package.json s3://${bucket}/workspace-server/package.json`,
        { timeout: 60_000 },
      );

      if (uploadResult.exitCode === 0) {
        wf.log('Workspace server uploaded to S3');
      } else {
        wf.log('Upload failed', 'error');
      }
    },
  );

  // ---- Full build (install + bundle all modules) ----

  wf.rule('full-build', 'Build all modules',
    (e) => e.type === 'build:full',
    async (_events, state) => {
      // Step 1: Install dependencies
      wf.log('Starting full build: installing dependencies...');
      const installResult = await wf.exec('npm ci', {
        timeout: 300_000,
      });
      if (installResult.exitCode !== 0) {
        wf.log('Dependency install failed — aborting build', 'error');
        return;
      }

      // Step 2: Emit bundle events — each fires the individual bundle rules
      wf.log('Dependencies ready. Triggering module bundles...');
      wf.emit({ type: 'build:bundle-frontend' });
      wf.emit({ type: 'build:bundle-api-lambda' });
      wf.emit({ type: 'build:bundle-workspace' });
    },
  );

  // ---- CDK deploy ----

  wf.rule('cdk-deploy', 'Full CDK deploy',
    (e) => e.type === 'deploy:cdk',
    async (_events, state) => {
      state.deploy = { status: 'deploying' };
      wf.log('Starting CDK deploy...');

      const result = await wf.exec(
        'cd infrastructure && MSYS_NO_PATHCONV=1 npx cdk deploy --require-approval never',
        { timeout: 600_000 }, // 10 minutes
      );

      if (result.exitCode === 0) {
        state.deploy.status = 'success';
        state.deploy.lastRun = new Date().toISOString();
        wf.log('CDK deploy complete');
      } else {
        state.deploy.status = 'failed';
        wf.log(`CDK deploy failed (exit ${result.exitCode})`, 'error');
      }
    },
  );

  // ---- Initialize deploy state ----

  wf.rule('deploy:init', 'Initialize deploy state',
    (e) => e.type === 'project:initialize',
    (_events, state) => {
      state.bundle = {
        apiLambda: { status: 'pending' },
        workspaceServer: { status: 'pending' },
        frontend: { status: 'pending' },
      };
      state.deploy = { status: 'idle' };
    },
  );
});
