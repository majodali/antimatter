import type { Identifier } from './common.js';
import type { SourceFile } from './source.js';
import type { BuildRule } from './build.js';
import type { TestSuite } from './test.js';

/** A dependency link between modules. */
export interface ModuleDependency {
  /** The id of the module being depended upon. */
  readonly moduleId: Identifier;
  /** Whether this is a dev-only dependency. */
  readonly dev: boolean;
  /** Semantic version range constraint, if any. */
  readonly versionRange?: string;
}

/** Per-module configuration overrides. */
export interface ModuleConfig {
  /** Additional TypeScript compiler options. */
  readonly tsconfig?: Readonly<Record<string, unknown>>;
  /** Additional environment variables. */
  readonly env?: Readonly<Record<string, string>>;
}

/** A cohesive unit of code within a project (package / library / app). */
export interface Module {
  readonly id: Identifier;
  readonly name: string;
  /** Workspace-relative root directory (e.g. "packages/filesystem"). */
  readonly root: string;
  readonly dependencies: readonly ModuleDependency[];
  readonly sources: readonly SourceFile[];
  readonly buildRules: readonly BuildRule[];
  readonly testSuites: readonly TestSuite[];
  readonly config: ModuleConfig;
}
