// Types
export type {
  WorkspaceEnvironment,
  ExecuteOptions,
  ExecutionResult,
} from './types.js';

// Implementations
export { LocalWorkspaceEnvironment } from './local-workspace-environment.js';
export type { LocalWorkspaceEnvironmentOptions } from './local-workspace-environment.js';

export { S3WorkspaceEnvironment } from './s3-workspace-environment.js';
export type { S3WorkspaceEnvironmentOptions } from './s3-workspace-environment.js';

export { MemoryWorkspaceEnvironment } from './memory-workspace-environment.js';
export type { MemoryWorkspaceEnvironmentOptions } from './memory-workspace-environment.js';

// Adapter
export { WorkspaceEnvironmentRunnerAdapter } from './runner-adapter.js';

// S3 sync engine removed — S3 Files mount replaces EBS + sync
