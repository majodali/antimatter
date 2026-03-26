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
// No imports — automation files use the `wf` runtime parameter.

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

export default (wf: any) => {

  // ---- Widget declarations ----

  // Status indicators — show bundle and deploy progress
  wf.widget('api-bundle-status', {
    type: 'status',
    label: 'API Lambda',
    section: 'deploy',
  });

  wf.widget('frontend-bundle-status', {
    type: 'status',
    label: 'Frontend',
    section: 'deploy',
  });

  wf.widget('workspace-bundle-status', {
    type: 'status',
    label: 'Workspace Server',
    section: 'deploy',
  });

  wf.widget('deploy-status', {
    type: 'status',
    label: 'Deploy',
    section: 'deploy',
    icon: 'rocket',
  });

  // Action buttons
  wf.widget('bundle-all', {
    type: 'button',
    label: 'Build All',
    section: 'deploy',
    icon: 'hammer',
    variant: 'default',
    event: { type: 'build:full' },
  });

  wf.widget('deploy-prod', {
    type: 'button',
    label: 'Deploy',
    section: 'deploy',
    icon: 'rocket',
    variant: 'primary',
    event: { type: 'deploy:promote' },
  });

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
      promote: { event: { type: 'deploy:promote' }, icon: 'play' },
    },
  });

  // ---- Bundle rules (triggered by explicit events) ----

  /** Helper: update a widget's state. */
  function setWidgetState(state: DeployState, widgetId: string, ws: Record<string, unknown>) {
    const ui = ((state as any)._ui ?? {});
    ui[widgetId] = { ...(ui[widgetId] ?? {}), ...ws };
    (state as any)._ui = ui;
  }

  /** Helper: update deploy button enabled state based on bundle statuses. */
  function updateDeployButton(state: DeployState) {
    const { apiLambda, workspaceServer, frontend } = state.bundle;
    const allSuccess = apiLambda.status === 'success'
      && workspaceServer.status === 'success'
      && frontend.status === 'success';
    setWidgetState(state, 'deploy-prod', { enabled: allSuccess });
  }

  wf.rule('Bundle API Lambda',
    (e) => e.type === 'build:bundle-api-lambda',
    async (_events, state) => {
      state.bundle.apiLambda = { status: 'running' };
      setWidgetState(state, 'api-bundle-status', { value: 'bundling' });
      wf.log('Bundling API Lambda...');

      const result = await wf.exec('node packages/ui/scripts/build-lambda.mjs', {
        timeout: 120_000,
      });

      if (result.exitCode === 0) {
        state.bundle.apiLambda.status = 'success';
        state.bundle.apiLambda.lastRun = new Date().toISOString();
        setWidgetState(state, 'api-bundle-status', { value: 'success' });
        wf.log(`API Lambda bundled (${(result.durationMs / 1000).toFixed(1)}s)`);
      } else {
        state.bundle.apiLambda.status = 'failed';
        setWidgetState(state, 'api-bundle-status', { value: 'failed' });
        wf.log(`API Lambda bundle failed (exit ${result.exitCode})`, 'error');
      }
      updateDeployButton(state);
    },
  );

  wf.rule('Bundle workspace server',
    (e) => e.type === 'build:bundle-workspace',
    async (_events, state) => {
      state.bundle.workspaceServer = { status: 'running' };
      setWidgetState(state, 'workspace-bundle-status', { value: 'bundling' });
      wf.log('Bundling workspace server...');

      const result = await wf.exec('node packages/ui/scripts/build-workspace-server.mjs', {
        timeout: 120_000,
      });

      if (result.exitCode === 0) {
        state.bundle.workspaceServer.status = 'success';
        state.bundle.workspaceServer.lastRun = new Date().toISOString();
        setWidgetState(state, 'workspace-bundle-status', { value: 'success' });
        wf.log(`Workspace server bundled (${(result.durationMs / 1000).toFixed(1)}s)`);
      } else {
        state.bundle.workspaceServer.status = 'failed';
        setWidgetState(state, 'workspace-bundle-status', { value: 'failed' });
        wf.log(`Workspace server bundle failed (exit ${result.exitCode})`, 'error');
      }
      updateDeployButton(state);
    },
  );

  wf.rule('Bundle frontend',
    (e) => e.type === 'build:bundle-frontend',
    async (_events, state) => {
      state.bundle.frontend = { status: 'running' };
      setWidgetState(state, 'frontend-bundle-status', { value: 'bundling' });
      wf.log('Bundling frontend...');

      const result = await wf.exec('cd packages/ui && npx vite build', {
        timeout: 120_000,
      });

      if (result.exitCode === 0) {
        state.bundle.frontend.status = 'success';
        state.bundle.frontend.lastRun = new Date().toISOString();
        setWidgetState(state, 'frontend-bundle-status', { value: 'success' });
        wf.log(`Frontend bundled (${(result.durationMs / 1000).toFixed(1)}s)`);
      } else {
        state.bundle.frontend.status = 'failed';
        setWidgetState(state, 'frontend-bundle-status', { value: 'failed' });
        wf.log(`Frontend bundle failed (exit ${result.exitCode})`, 'error');
      }
      updateDeployButton(state);
    },
  );

  // ---- Upload workspace server to S3 ----

  wf.rule('Upload workspace server bundle to S3',
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

  wf.rule('Build all modules',
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
    { manual: false },
  );

  // ---- CDK deploy ----

  wf.rule('Full CDK deploy',
    (e) => e.type === 'deploy:cdk',
    async (_events, state) => {
      state.deploy = { status: 'deploying' };
      setWidgetState(state, 'deploy-status', { value: 'deploying' });
      setWidgetState(state, 'deploy-prod', { enabled: false });
      setWidgetState(state, 'bundle-all', { enabled: false });
      wf.log('Starting CDK deploy...');

      const result = await wf.exec(
        'cd infrastructure && MSYS_NO_PATHCONV=1 npx cdk deploy --require-approval never',
        { timeout: 600_000 }, // 10 minutes
      );

      if (result.exitCode === 0) {
        state.deploy.status = 'success';
        state.deploy.lastRun = new Date().toISOString();
        setWidgetState(state, 'deploy-status', { value: 'success' });
        wf.log('CDK deploy complete');
      } else {
        state.deploy.status = 'failed';
        setWidgetState(state, 'deploy-status', { value: 'failed' });
        wf.log(`CDK deploy failed (exit ${result.exitCode})`, 'error');
      }
      setWidgetState(state, 'bundle-all', { enabled: true });
      updateDeployButton(state);
    },
    { manual: false },
  );

  // ---- Promote to production (validate builds, then deploy) ----

  wf.rule('Promote to production',
    (e) => e.type === 'deploy:promote',
    async (_events, state) => {
      // Validate that all bundles have succeeded
      const { apiLambda, workspaceServer, frontend } = state.bundle;
      const allSuccess = apiLambda.status === 'success'
        && workspaceServer.status === 'success'
        && frontend.status === 'success';

      if (!allSuccess) {
        const statuses = `api=${apiLambda.status}, ws=${workspaceServer.status}, fe=${frontend.status}`;
        wf.log(`Cannot promote: not all bundles succeeded (${statuses})`, 'error');
        return;
      }

      wf.log('All bundles valid. Promoting to production via CDK deploy...');
      wf.emit({ type: 'deploy:cdk' });
    },
    { manual: false },
  );

  // ---- Initialize deploy state ----

  wf.rule('Initialize deploy state',
    (e) => e.type === 'project:initialize',
    (_events, state) => {
      state.bundle = {
        apiLambda: { status: 'pending' },
        workspaceServer: { status: 'pending' },
        frontend: { status: 'pending' },
      };
      state.deploy = { status: 'idle' };
      (state as any)._ui = {
        'api-bundle-status': { value: 'pending' },
        'frontend-bundle-status': { value: 'pending' },
        'workspace-bundle-status': { value: 'pending' },
        'deploy-status': { value: 'idle' },
        'deploy-prod': { enabled: false },
      };
    },
    { manual: false },
  );
};
