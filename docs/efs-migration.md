# EFS Migration & Module Architecture

## 1. Workspace Environment Abstraction

### The Problem
File storage and command execution are currently separate abstractions (`FileSystem` and `SubprocessRunner`), but they're tightly coupled in practice — commands run against files, build outputs land in the same file system, tools read and write project state. On EFS, they share the same mount. On a developer's machine, they share the same disk. They should be one abstraction.

### The Abstraction

```typescript
/**
 * A WorkspaceEnvironment is a place where files live and commands execute.
 * It couples file access and command execution into a single context,
 * because they are inherently coupled — commands operate on files.
 */
interface WorkspaceEnvironment {
  /** Unique identifier for this environment instance */
  readonly id: string;

  /** Human-readable label (e.g., "dev-efs", "local", "build-worker") */
  readonly label: string;

  // --- File operations ---
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  deleteFile(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readDirectory(path: string): Promise<FileEntry[]>;
  mkdir(path: string): Promise<void>;
  stat(path: string): Promise<FileStat>;

  // --- Command execution ---
  /**
   * Execute a command in this environment's file system context.
   * The command runs with the environment's files as its working tree.
   */
  execute(options: ExecuteOptions): Promise<ExecutionResult>;

  // --- Lifecycle ---
  /**
   * Ensure the environment is ready (EFS mounted, files synced, etc.).
   * Called before first use. Idempotent.
   */
  initialize(): Promise<void>;

  /**
   * Clean up resources (unmount, release locks, etc.).
   */
  dispose(): Promise<void>;
}

interface ExecuteOptions {
  /** The command to run */
  command: string;
  /** Arguments */
  args?: string[];
  /** Working directory relative to environment root */
  cwd?: string;
  /** Environment variables (merged with environment defaults) */
  env?: Record<string, string>;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Stream output as it's produced */
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
}

interface ExecutionResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}
```

### Implementations

**`LocalWorkspaceEnvironment`**
- Files: reads/writes to local disk (wraps current `LocalFileSystem`)
- Commands: runs via `child_process` (wraps current `SubprocessRunner`)
- Use: local development, testing

**`EfsWorkspaceEnvironment`**
- Files: reads/writes to EFS mount path
- Commands: runs via `child_process` against EFS mount (same as local, just different root)
- Use: Lambda-based command execution
- Note: EFS is a POSIX file system, so this is very similar to Local — the key difference is initialization (ensuring the mount is available and project files are present)

**`S3WorkspaceEnvironment`** (read-only commands, or limited)
- Files: reads/writes to S3 (wraps current `S3FileSystem`)
- Commands: not supported (or very limited — could copy to /tmp for small operations)
- Use: file browsing and editing in Lambda when EFS isn't needed

### Migration Path

1. Define the `WorkspaceEnvironment` interface
2. Implement `LocalWorkspaceEnvironment` (wrapping existing `LocalFileSystem` + `SubprocessRunner`)
3. Update `WorkspaceService` to accept a `WorkspaceEnvironment` instead of separate `FileSystem` + `ToolRunner`
4. Implement `EfsWorkspaceEnvironment`
5. In Lambda, create the appropriate environment based on context:
   - File browsing/editing: `S3WorkspaceEnvironment` (cheap, no VPC needed)
   - Command execution: `EfsWorkspaceEnvironment` (needs VPC + EFS mount)

### File Syncing: S3 ↔ EFS

Projects are stored durably in S3 (the source of truth). EFS is a working copy for command execution. We need a sync strategy:

```
S3 (durable storage)  ←→  EFS (working tree)
       ↑                        ↑
   file edits              command outputs
   (from UI)              (build artifacts, etc.)
```

**Option A: EFS as primary, S3 as backup**
- All file operations go through EFS
- Periodic sync to S3 for durability
- Simpler model, but EFS becomes a single point of failure

**Option B: S3 as primary, EFS as build cache** (recommended)
- File edits write to S3 (current behavior, durable)
- Before command execution, sync relevant project files from S3 → EFS
- After command execution, sync outputs from EFS → S3
- EFS is ephemeral — can be rebuilt from S3 at any time
- Sync can be incremental using content hashes (already in the filesystem package)

**Option C: Dual write**
- Every file write goes to both S3 and EFS
- Commands execute against EFS
- Consistent but more complex, more latency on writes

**Recommendation: Option B.** S3 remains the source of truth. EFS is a working tree that's synced on demand. The change tracking infrastructure (`createSnapshot`, `diffSnapshots`) already exists in the filesystem package and can drive incremental sync.

---

## 2. Module Packaging & Deployment Architecture

### The Problem
Currently, "deploying antimatter" means running CDK, which deploys the entire stack. But as the system grows, we need to:
- Deploy individual modules independently
- Package the same module differently for different targets (Lambda zip, S3 bundle, container)
- Deploy to different environments (dev, test, prod)
- Swap out deployment tooling without changing modules

### Three-Layer Separation

```
┌─────────────────────────────────────────┐
│          Module Implementation           │
│                                          │
│  TypeScript source, interfaces, tests    │
│  Knows nothing about how it's packaged   │
│  or where it runs.                       │
└──────────────────┬──────────────────────┘
                   │ produces source artifacts
                   ▼
┌─────────────────────────────────────────┐
│          Packaging Strategy              │
│                                          │
│  How to bundle this module for a target: │
│  - Lambda zip (tree-shake, bundle deps)  │
│  - S3 static (Vite build, asset hash)    │
│  - Container image (Dockerfile)          │
│  - npm package (for library modules)     │
│                                          │
│  Defined per module. Swappable.          │
└──────────────────┬──────────────────────┘
                   │ produces deployable artifacts
                   ▼
┌─────────────────────────────────────────┐
│          Deployment Target               │
│                                          │
│  Where and how to deploy the artifact:   │
│  - Lambda function update                │
│  - S3 bucket + CloudFront invalidation   │
│  - Container registry + ECS/Fargate      │
│  - CDK stack (for infra changes)         │
│                                          │
│  Defined per environment. Swappable.     │
└─────────────────────────────────────────┘
```

### Data Model

```typescript
/**
 * A logical module — what it is, not how it's deployed.
 * Extends the existing @antimatter/project-model Module type.
 */
interface ModuleDefinition {
  id: string;
  name: string;
  type: 'frontend' | 'backend-service' | 'library' | 'infrastructure';
  sourcePath: string;          // e.g., "packages/ui/src/client"
  buildCommand: string;        // e.g., "nx build ui"
  testCommand: string;         // e.g., "nx test ui"
  dependencies: string[];      // other module IDs
}

/**
 * How to package a module for deployment.
 * A module can have different packaging strategies for different contexts.
 */
interface PackagingStrategy {
  id: string;
  moduleId: string;
  type: 'lambda-zip' | 's3-static' | 'container' | 'npm-package';
  config: PackagingConfig;     // type-specific configuration
}

type PackagingConfig =
  | LambdaZipConfig
  | S3StaticConfig
  | ContainerConfig
  | NpmPackageConfig;

interface LambdaZipConfig {
  type: 'lambda-zip';
  entryPoint: string;          // e.g., "packages/ui/src/server/lambda.ts"
  bundler: 'esbuild' | 'ncc';
  outputPath: string;          // e.g., "packages/ui/dist-lambda"
  externals?: string[];        // modules to exclude from bundle
}

interface S3StaticConfig {
  type: 's3-static';
  buildOutputPath: string;     // e.g., "packages/ui/dist/client"
  indexDocument: string;
}

interface ContainerConfig {
  type: 'container';
  dockerfile: string;
  context: string;
  registry?: string;
}

interface NpmPackageConfig {
  type: 'npm-package';
  outputPath: string;
  scope?: string;
}

/**
 * Where to deploy a packaged artifact.
 * Separates the target resource from the packaging.
 */
interface DeploymentTarget {
  id: string;
  moduleId: string;
  packagingId: string;          // which packaging strategy to use
  environment: string;          // e.g., "dev", "test", "prod"
  config: DeploymentConfig;     // target-specific configuration
}

type DeploymentConfig =
  | LambdaDeployConfig
  | S3DeployConfig
  | CdkDeployConfig;

interface LambdaDeployConfig {
  type: 'lambda-update';
  functionName: string;
  region: string;
}

interface S3DeployConfig {
  type: 's3-upload';
  bucket: string;
  distributionId?: string;      // CloudFront invalidation
  region: string;
}

interface CdkDeployConfig {
  type: 'cdk-deploy';
  stackName: string;
  region: string;
}

/**
 * The deployment pipeline for a module in an environment.
 * Composes: build → package → deploy.
 */
interface DeploymentPipeline {
  moduleId: string;
  environment: string;
  steps: Array<
    | { type: 'build'; command: string }
    | { type: 'test'; command: string }
    | { type: 'package'; packagingId: string }
    | { type: 'deploy'; targetId: string }
  >;
}
```

### How It Works for Antimatter Today

```yaml
# Antimatter's own module definitions

modules:
  - id: ui-frontend
    name: "IDE Frontend"
    type: frontend
    sourcePath: packages/ui/src/client
    buildCommand: "cd packages/ui && npx vite build"
    testCommand: "nx test ui"

  - id: api-backend
    name: "API Backend"
    type: backend-service
    sourcePath: packages/ui/src/server
    buildCommand: "node packages/ui/scripts/build-lambda.mjs"
    testCommand: "nx test ui"

  - id: infrastructure
    name: "CDK Infrastructure"
    type: infrastructure
    sourcePath: infrastructure
    buildCommand: "cd infrastructure && npx cdk synth"

packaging:
  - id: frontend-s3
    moduleId: ui-frontend
    type: s3-static
    config:
      buildOutputPath: packages/ui/dist/client
      indexDocument: index.html

  - id: backend-lambda
    moduleId: api-backend
    type: lambda-zip
    config:
      entryPoint: packages/ui/src/server/lambda.ts
      bundler: esbuild
      outputPath: packages/ui/dist-lambda

deployment:
  - id: frontend-dev
    moduleId: ui-frontend
    packagingId: frontend-s3
    environment: dev
    config:
      type: s3-upload
      bucket: antimatter-ide-{account}
      distributionId: {distribution-id}
      region: us-west-2

  - id: backend-dev
    moduleId: api-backend
    packagingId: backend-lambda
    environment: dev
    config:
      type: lambda-update
      functionName: AntimatterStack-ApiFunction
      region: us-west-2

  - id: infra-dev
    moduleId: infrastructure
    packagingId: null  # CDK handles its own packaging
    environment: dev
    config:
      type: cdk-deploy
      stackName: AntimatterStack
      region: us-west-2

pipelines:
  - moduleId: ui-frontend
    environment: dev
    steps:
      - { type: build, command: "cd packages/ui && npx vite build" }
      - { type: package, packagingId: frontend-s3 }
      - { type: deploy, targetId: frontend-dev }

  - moduleId: api-backend
    environment: dev
    steps:
      - { type: build, command: "node packages/ui/scripts/build-lambda.mjs" }
      - { type: test, command: "nx test ui" }
      - { type: package, packagingId: backend-lambda }
      - { type: deploy, targetId: backend-dev }
```

### Why This Matters

**Today:** CDK deploys everything as one stack. To update the frontend, you redeploy the whole stack. To change how the backend is packaged, you edit the CDK stack.

**With this model:**
- Update the frontend? Run just the `ui-frontend` pipeline — build, upload to S3, invalidate CloudFront. Takes 30 seconds.
- Change the backend packaging from Lambda to container? Swap the PackagingStrategy. Module implementation doesn't change.
- Add a new environment? Create new DeploymentTargets pointing at different resources. Same modules, same packaging, different targets.
- Switch from CDK to Terraform? Only the DeploymentTarget configs change. Modules and packaging are untouched.

This is also the foundation for the Deployment & Operations Console in the Project Operating System — it models what's deployed where, and each layer is independently manageable.

---

## 3. CDK Changes for EFS

### New Resources

```typescript
// Additions to antimatter-stack.ts

// VPC for Lambda + EFS connectivity
const vpc = new ec2.Vpc(this, 'Vpc', {
  maxAzs: 2,
  natGateways: 1,  // needed for Lambda to reach S3, Claude API, etc.
});

// EFS file system for project working trees
const fileSystem = new efs.FileSystem(this, 'ProjectEfs', {
  vpc,
  performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
  throughputMode: efs.ThroughputMode.ELASTIC,  // scales automatically
  removalPolicy: cdk.RemovalPolicy.DESTROY,     // dev only
  encrypted: true,
});

// EFS access point for Lambda
const accessPoint = fileSystem.addAccessPoint('LambdaAccess', {
  path: '/projects',
  createAcl: { ownerGid: '1001', ownerUid: '1001', permissions: '755' },
  posixUser: { gid: '1001', uid: '1001' },
});

// Lambda function for command execution (needs VPC + EFS)
const commandFunction = new lambda.Function(this, 'CommandFunction', {
  runtime: lambda.Runtime.NODEJS_20_X,
  handler: 'index.handler',
  code: lambda.Code.fromAsset(path.join(__dirname, '../../packages/command-service/dist')),
  timeout: cdk.Duration.minutes(15),  // max for long builds
  memorySize: 2048,                    // builds need memory
  vpc,
  filesystem: lambda.FileSystem.fromEfsAccessPoint(accessPoint, '/mnt/projects'),
  environment: {
    EFS_MOUNT_PATH: '/mnt/projects',
    PROJECTS_BUCKET: dataBucket.bucketName,
  },
});

dataBucket.grantReadWrite(commandFunction);
```

### Lambda Configuration

The existing API Lambda can remain outside the VPC for low-latency file CRUD (via S3). The command execution Lambda lives in the VPC with EFS access. This gives us the best of both worlds:

- **API Lambda (no VPC):** File read/write/list, agent chat, build config — all fast, no cold start penalty
- **Command Lambda (VPC + EFS):** Command execution, builds, tests — has the file system it needs

API Gateway routes command-related requests to the command Lambda:

```
/api/files/*     → API Lambda (S3)
/api/agent/*     → API Lambda (S3)
/api/build/*     → API Lambda (S3, for config) + Command Lambda (EFS, for execution)
/api/commands/*  → Command Lambda (EFS)
/api/deploy/*    → Command Lambda (EFS) or separate Deploy Lambda
```

---

## 4. Implementation Plan

### Step 1: WorkspaceEnvironment Interface
- Define the interface in `@antimatter/filesystem` (or a new `@antimatter/workspace` package)
- Implement `LocalWorkspaceEnvironment` wrapping existing code
- Update `WorkspaceService` to use it
- All existing tests should still pass — this is a refactor, not a behavior change

### Step 2: EFS Infrastructure
- Add VPC, EFS, access point to CDK stack
- Add Command Execution Lambda with EFS mount
- Add API Gateway routes for `/api/commands/*`
- Deploy and verify EFS is accessible from Lambda

### Step 3: EfsWorkspaceEnvironment
- Implement `EfsWorkspaceEnvironment`
- Implement S3 ↔ EFS sync (using existing change tracking)
- Command Execution Lambda uses `EfsWorkspaceEnvironment`
- Verify: can run `ls`, `node --version`, basic commands from IDE

### Step 4: Build Integration
- Wire build execution to Command Lambda
- Verify: can run `npm install`, `nx build`, `nx test` from IDE
- Stream build output back to UI via SSE

### Step 5: Deployment Model
- Define module/packaging/deployment data model
- Create deployment config for antimatter's own modules
- Implement deployment execution (Lambda update, S3 upload, CDK deploy)
- Deployment Panel UI

### Step 6: Self-Hosting Verification
- Load antimatter project in its own IDE
- Edit code → build → deploy — all from within
- Celebrate 🎉
