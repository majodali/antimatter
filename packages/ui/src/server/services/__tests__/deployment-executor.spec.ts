import { describe, it, beforeEach } from 'node:test';
import { expect, createMockFn } from '@antimatter/test-utils';
import type { DeploymentConfig } from '@antimatter/project-model';
import type { WorkspaceEnvironment, ExecutionResult } from '@antimatter/workspace';
import {
  DeploymentExecutor,
  resolveEnvVars,
} from '../deployment-executor.js';
import type {
  DeployLambdaClient,
  DeployCloudfrontClient,
  DeploymentExecutorOptions,
} from '../deployment-executor.js';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

function createMockEnv(): WorkspaceEnvironment {
  return {
    id: 'test-env',
    label: 'Test Env',
    readFile: createMockFn().mockResolvedValue(''),
    writeFile: createMockFn().mockResolvedValue(undefined),
    deleteFile: createMockFn().mockResolvedValue(undefined),
    exists: createMockFn().mockResolvedValue(false),
    readDirectory: createMockFn().mockResolvedValue([]),
    mkdir: createMockFn().mockResolvedValue(undefined),
    stat: createMockFn().mockResolvedValue({ size: 0, isFile: true, isDirectory: false, modifiedAt: '' }),
    execute: createMockFn().mockResolvedValue({
      exitCode: 0,
      stdout: 'build output',
      stderr: '',
      durationMs: 100,
    } as ExecutionResult),
    initialize: createMockFn().mockResolvedValue(undefined),
    dispose: createMockFn().mockResolvedValue(undefined),
    fileSystem: {} as any,
  };
}

function createMockS3Client(): any {
  return {
    send: createMockFn().mockImplementation((cmd: any) => {
      const cmdName = cmd.constructor?.name ?? '';
      if (cmdName === 'GetObjectCommand') {
        return Promise.resolve({
          Body: {
            transformToByteArray: () => Promise.resolve(new Uint8Array(Buffer.from('console.log("hello");'))),
          },
        });
      }
      if (cmdName === 'ListObjectsV2Command') {
        return Promise.resolve({
          Contents: [
            { Key: 'projects/test/files/dist/client/index.html' },
            { Key: 'projects/test/files/dist/client/app.js' },
          ],
          IsTruncated: false,
        });
      }
      if (cmdName === 'PutObjectCommand') {
        return Promise.resolve({});
      }
      return Promise.resolve({});
    }),
  };
}

function createMockLambdaClient(): DeployLambdaClient {
  return {
    updateFunctionCode: createMockFn().mockResolvedValue({
      FunctionName: 'test-function',
      LastUpdateStatus: 'Successful',
    }),
    getFunctionConfiguration: createMockFn().mockResolvedValue({
      LastUpdateStatus: 'Successful',
      State: 'Active',
    }),
  };
}

function createMockCloudfrontClient(): DeployCloudfrontClient {
  return {
    createInvalidation: createMockFn().mockResolvedValue({
      Invalidation: { Id: 'inv-123' },
    }),
  };
}

function sampleConfig(): DeploymentConfig {
  return {
    modules: [
      {
        id: 'api-lambda',
        name: 'API Lambda',
        type: 'lambda',
        buildCommand: 'node scripts/build-lambda.mjs',
        cwd: 'packages/ui',
      },
      {
        id: 'frontend',
        name: 'Frontend',
        type: 'frontend',
        buildCommand: 'npx vite build',
        cwd: 'packages/ui',
      },
    ],
    packaging: [
      {
        id: 'api-zip',
        moduleId: 'api-lambda',
        type: 'lambda-zip',
        config: { type: 'lambda-zip', bundlePath: 'packages/ui/dist-lambda/index.js' },
      },
      {
        id: 'frontend-s3',
        moduleId: 'frontend',
        type: 's3-static',
        config: { type: 's3-static', outputDir: 'packages/ui/dist/client' },
      },
    ],
    targets: [
      {
        id: 'api-dev',
        moduleId: 'api-lambda',
        packagingId: 'api-zip',
        type: 'lambda-update',
        config: { type: 'lambda-update', functionName: 'TestApiFunction', region: 'us-west-2' },
      },
      {
        id: 'frontend-dev',
        moduleId: 'frontend',
        packagingId: 'frontend-s3',
        type: 's3-upload',
        config: { type: 's3-upload', bucket: 'test-website-bucket', region: 'us-west-2', distributionId: 'DIST123' },
      },
    ],
  };
}

function createExecutor(
  overrides: Partial<DeploymentExecutorOptions> = {},
): {
  executor: DeploymentExecutor;
  env: WorkspaceEnvironment;
  s3Client: any;
  lambdaClient: DeployLambdaClient;
  cloudfrontClient: DeployCloudfrontClient;
  progressEvents: any[];
} {
  const env = createMockEnv();
  const s3Client = createMockS3Client();
  const lambdaClient = createMockLambdaClient();
  const cloudfrontClient = createMockCloudfrontClient();
  const progressEvents: any[] = [];

  const executor = new DeploymentExecutor({
    env,
    s3Client,
    projectsBucket: 'test-data-bucket',
    projectPrefix: 'projects/test/files/',
    lambdaClient,
    cloudfrontClient,
    onProgress: (event) => progressEvents.push(event),
    ...overrides,
  });

  return { executor, env, s3Client, lambdaClient, cloudfrontClient, progressEvents };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('resolveEnvVars', () => {
  it('resolves known environment variables', () => {
    process.env.TEST_VAR = 'hello';
    expect(resolveEnvVars('prefix-${TEST_VAR}-suffix')).toBe('prefix-hello-suffix');
    delete process.env.TEST_VAR;
  });

  it('resolves multiple variables', () => {
    process.env.A = 'one';
    process.env.B = 'two';
    expect(resolveEnvVars('${A}-${B}')).toBe('one-two');
    delete process.env.A;
    delete process.env.B;
  });

  it('throws on missing variable', () => {
    expect(() => resolveEnvVars('${NONEXISTENT_TEST_VAR}')).toThrow(
      'Environment variable NONEXISTENT_TEST_VAR is not set',
    );
  });

  it('returns string unchanged when no variables present', () => {
    expect(resolveEnvVars('no-variables')).toBe('no-variables');
  });
});

describe('DeploymentExecutor', () => {
  describe('deployAll', () => {
    it('deploys all targets when no targetIds specified', async () => {
      const { executor, env } = createExecutor();
      const config = sampleConfig();

      const results = await executor.deployAll(config);

      expect(results).toHaveLength(2);
      expect(results[0].targetId).toBe('api-dev');
      expect(results[1].targetId).toBe('frontend-dev');
      // Build should have been called for each module
      expect(env.execute).toHaveBeenCalledTimes(2);
    });

    it('deploys only specified targets', async () => {
      const { executor } = createExecutor();
      const config = sampleConfig();

      const results = await executor.deployAll(config, ['frontend-dev']);

      expect(results).toHaveLength(1);
      expect(results[0].targetId).toBe('frontend-dev');
    });

    it('returns error for missing module', async () => {
      const { executor } = createExecutor();
      const config: DeploymentConfig = {
        modules: [],
        packaging: [{ id: 'pkg', moduleId: 'missing', type: 'lambda-zip', config: { type: 'lambda-zip', bundlePath: 'x' } }],
        targets: [{ id: 'tgt', moduleId: 'missing', packagingId: 'pkg', type: 'lambda-update', config: { type: 'lambda-update', functionName: 'f', region: 'r' } }],
      };

      const results = await executor.deployAll(config);

      expect(results[0].status).toBe('failed');
      expect(results[0].error).toContain('Module "missing" not found');
    });

    it('returns error for missing packaging', async () => {
      const { executor } = createExecutor();
      const config: DeploymentConfig = {
        modules: [{ id: 'm1', name: 'M', type: 'lambda', buildCommand: 'echo ok' }],
        packaging: [],
        targets: [{ id: 'tgt', moduleId: 'm1', packagingId: 'missing', type: 'lambda-update', config: { type: 'lambda-update', functionName: 'f', region: 'r' } }],
      };

      const results = await executor.deployAll(config);

      expect(results[0].status).toBe('failed');
      expect(results[0].error).toContain('Packaging "missing" not found');
    });
  });

  describe('build step', () => {
    it('executes the build command with correct args and cwd', async () => {
      const { executor, env } = createExecutor();
      const config = sampleConfig();

      await executor.deployAll(config, ['api-dev']);

      expect(env.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          command: 'node',
          args: ['scripts/build-lambda.mjs'],
          cwd: 'packages/ui',
        }),
      );
    });

    it('stops pipeline on build failure', async () => {
      const env = createMockEnv();
      (env.execute as any).mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'build error',
        durationMs: 50,
      });

      const { executor, lambdaClient } = createExecutor({ env });
      const config = sampleConfig();

      const results = await executor.deployAll(config, ['api-dev']);

      expect(results[0].status).toBe('failed');
      expect(results[0].steps).toHaveLength(1);
      expect(results[0].steps[0].step).toBe('build');
      expect(results[0].steps[0].status).toBe('failed');
      // Lambda should NOT have been called
      expect(lambdaClient.updateFunctionCode).not.toHaveBeenCalled();
    });
  });

  describe('dry run', () => {
    it('runs build and package but skips deploy step', async () => {
      const { executor, lambdaClient } = createExecutor();
      const config = sampleConfig();

      const results = await executor.deployAll(config, ['api-dev'], true);

      expect(results[0].status).toBe('success');
      const deployStep = results[0].steps.find((s) => s.step === 'deploy');
      expect(deployStep?.status).toBe('skipped');
      expect(deployStep?.output).toContain('Dry run');
      expect(lambdaClient.updateFunctionCode).not.toHaveBeenCalled();
    });
  });

  describe('Lambda deployment', () => {
    it('calls updateFunctionCode with zip payload', async () => {
      const { executor, lambdaClient } = createExecutor();
      const config = sampleConfig();

      await executor.deployAll(config, ['api-dev']);

      expect(lambdaClient.updateFunctionCode).toHaveBeenCalledWith(
        expect.objectContaining({
          FunctionName: 'TestApiFunction',
          ZipFile: expect.any(Buffer),
        }),
      );
    });

    it('waits for Lambda to become active after update', async () => {
      const lambdaClient = createMockLambdaClient();
      (lambdaClient.updateFunctionCode as any).mockResolvedValue({
        LastUpdateStatus: 'InProgress',
      });
      let callCount = 0;
      (lambdaClient.getFunctionConfiguration as any).mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          LastUpdateStatus: callCount >= 2 ? 'Successful' : 'InProgress',
        });
      });

      const { executor } = createExecutor({ lambdaClient });
      const config = sampleConfig();

      const results = await executor.deployAll(config, ['api-dev']);

      expect(results[0].status).toBe('success');
      expect(lambdaClient.getFunctionConfiguration).toHaveBeenCalled();
    });

    it('throws when Lambda client not configured', async () => {
      const { executor } = createExecutor({ lambdaClient: undefined });
      const config = sampleConfig();

      const results = await executor.deployAll(config, ['api-dev']);

      expect(results[0].status).toBe('failed');
      expect(results[0].error).toContain('Lambda client not configured');
    });
  });

  describe('S3 deployment', () => {
    it('uploads files to website bucket', async () => {
      const { executor, s3Client } = createExecutor();
      const config = sampleConfig();

      await executor.deployAll(config, ['frontend-dev']);

      // Should have called PutObject for each file
      const putCalls = s3Client.send.mock.calls.filter(
        (call: any) => call[0]?.constructor?.name === 'PutObjectCommand',
      );
      expect(putCalls.length).toBeGreaterThan(0);
    });

    it('creates CloudFront invalidation when distributionId is set', async () => {
      const { executor, cloudfrontClient } = createExecutor();
      const config = sampleConfig();

      await executor.deployAll(config, ['frontend-dev']);

      expect(cloudfrontClient.createInvalidation).toHaveBeenCalledWith(
        expect.objectContaining({
          DistributionId: 'DIST123',
        }),
      );
    });
  });

  describe('progress events', () => {
    it('emits step-started, step-completed, and deploy-complete events', async () => {
      const { executor, progressEvents } = createExecutor();
      const config = sampleConfig();

      await executor.deployAll(config, ['api-dev']);

      const types = progressEvents.map((e) => e.type);
      expect(types).toContain('step-started');
      expect(types).toContain('step-completed');
      expect(types).toContain('deploy-complete');
    });

    it('emits deploy-complete with all results', async () => {
      const { executor, progressEvents } = createExecutor();
      const config = sampleConfig();

      await executor.deployAll(config);

      const completeEvent = progressEvents.find((e) => e.type === 'deploy-complete');
      expect(completeEvent?.results).toHaveLength(2);
    });
  });
});
