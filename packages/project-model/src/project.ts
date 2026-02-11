import type { Identifier, Timestamp } from './common.js';
import type { Module } from './module.js';
import type { ToolConfig } from './tool.js';

/** Top-level configuration for a project workspace. */
export interface ProjectConfig {
  /** Default Node.js version to use. */
  readonly nodeVersion?: string;
  /** Default package manager. */
  readonly packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
  /** Root-level environment variable overrides. */
  readonly env?: Readonly<Record<string, string>>;
}

/** Descriptive metadata about the project. */
export interface ProjectMetadata {
  readonly createdAt: Timestamp;
  readonly updatedAt: Timestamp;
  readonly description?: string;
  readonly repository?: string;
  readonly license?: string;
}

/** The top-level container representing an entire workspace. */
export interface Project {
  readonly id: Identifier;
  readonly name: string;
  readonly modules: readonly Module[];
  readonly tools: readonly ToolConfig[];
  readonly config: ProjectConfig;
  readonly metadata: ProjectMetadata;
}
