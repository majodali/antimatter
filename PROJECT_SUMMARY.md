# Antimatter Project Summary

## Overview
**Antimatter** is a self-hosting online development environment with full build-test-deploy-operate capabilities. Built as a TypeScript-based Nx monorepo, it provides a complete suite of software development tools designed to run in multiple environments and be deployed as part of an online IDE platform. The project will eventually use Anthropic APIs to develop its own components, creating a self-improving development system.

## Vision
A fully integrated development platform that can:
- Host itself online with complete development capabilities
- Build, test, deploy, and operate software projects
- Enable AI-assisted development through pluggable agent integration
- Support both local development machines and cloud deployment (AWS Lambda)
- Provide a unified interface for human developers and AI agents

## Architecture
The project is organized as six interconnected packages following a monorepo structure:

### Core Packages

**`@antimatter/project-model`** ✅ *Implemented*
- **Foundation module** - All other packages reference this
- Language and platform-agnostic design
- Captures complete project metadata in TypeScript interfaces:
  - **Projects**: Top-level workspaces containing modules, tools, and configuration
  - **Modules**: Cohesive units of code (packages, libraries, or apps) with dependencies, source files, build rules, and test suites
  - **Source Files**: Tracked files with metadata including language detection (TypeScript, JavaScript, Rust, Python, etc.), type classification (source, test, config, asset, documentation), and content hashing
  - **Build System**: Build rules, targets, and result tracking with status
  - **Testing**: Test suites, cases, and execution results
  - **Tools**: Configurable external tool integrations with parameters and structured output
  - **Configuration**: All project structure, documentation, and build rules

**`@antimatter/filesystem`** ✅ *Implemented*
- Supports both local and virtual filesystems
- **Caching memfs approach**: Abstract over fs using lazy-load memory filesystem that syncs to real fs when tools require it
- Provides version control natively with Git integration
- Unified file system abstraction layer with multiple implementations:
  - `MemoryFileSystem` for in-memory operations
  - `LocalFileSystem` for disk-based operations
- Path manipulation utilities (normalize, join, dirname, basename, extname)
- File watching with debouncing support
- Content hashing for change detection
- Workspace snapshots and incremental change tracking
- Source file scanning with automatic language and type detection

### Planned Packages (Scaffolded)

**`@antimatter/tool-integration`**
- Runs configurable CLI or library tools (both 3rd party and custom)
- Standardized mappings for:
  - Tool configuration
  - Parameter passing
  - Output parsing
- External tool execution and management
- Integration with configured tool definitions from project-model

**`@antimatter/build-system`**
- **Rule-based CI/CD system**
- Triggers build actions on source changes or events
- Listens to filesystem events
- Executes build tasks via tool-integration
- Build orchestration and execution
- Integration with the project model's build rules and targets

**`@antimatter/ui`**
- User interface for the online IDE platform
- Features include:
  - Chat with AI agents and users
  - View and edit documentation, code, and configuration
  - Review changes and errors
  - Execution and deployment testing
  - Custom elements (notebooks, reports, datasets)
  - Release and deployment management
- Provides same information access for both human users and AI agents

**`@antimatter/ai-agent`**
- **Pluggable AI assistant/agent integration**
- Uses Anthropic APIs for AI capabilities
- Support for:
  - Defining roles and workflows
  - Information integration
  - Agent specialization and hierarchies
- AI agents access the same information as users in the UI
- Enables the system to eventually develop its own components

## Technology Stack
- **Language**: TypeScript 5.9+ with ES modules
- **Runtime**: Node.js (with roadmap for other platforms)
- **Build System**: Nx 22.5 monorepo
- **Deployment Targets**: Local dev machines and AWS Lambda
- **Testing**: Vitest with coverage support
  - Philosophy: Functional integration tests broken into functional unit tests
- **Linting**: ESLint 9.0
- **Package Management**: Workspace protocol for internal dependencies
- **File System**: Caching memfs with lazy-load and sync to real fs

## Current Status
- **Phase**: Early development
- **Implemented**:
  - ✅ `project-model` - Foundation complete
  - ✅ `filesystem` - Core functionality implemented
- **In Progress**: Build system, tool integration, AI agent, and UI packages are scaffolded but not yet implemented

## Suggested Build Order
1. ✅ **project-model** - Foundation module (everything references this)
2. ✅ **filesystem** - File operations and version control
3. **tool-integration** - External tool execution
4. **build-system** - CI/CD automation
5. **ui** - User interface and IDE features
6. **ai-agent** - AI-powered assistance

## Implementation Approach
1. **Minimal adapters** - Use standard tools and libraries where possible
2. **Start simple** - Begin with TypeScript/Node.js
3. **Plan for growth** - Roadmap for other platforms later
4. **Standard interfaces** - Language/platform agnostic design in project-model
5. **Self-hosting** - These six modules enable deployment and self-hosting online

## Key Design Principles
1. **Immutability**: All domain types use readonly properties
2. **Type Safety**: Comprehensive TypeScript types throughout
3. **Modularity**: Clear separation of concerns across packages
4. **Abstraction**: Pluggable implementations (e.g., file system providers)
5. **Change Tracking**: Built-in support for detecting and tracking modifications
6. **Tool Agnostic**: Designed to integrate with various external development tools
7. **Multi-Environment**: Architecture supports execution in browser, Node.js, and cloud environments
8. **Self-Hosting**: Capable of building, testing, deploying, and operating itself
9. **AI-First**: Equal access to information for human users and AI agents

## Use Cases
Antimatter is designed to support:
- **Self-hosting online IDE** with complete development lifecycle
- **Build-test-deploy-operate** automation
- **AI-assisted development** with pluggable agent integration
- **Self-improvement** - using Anthropic APIs to develop its own components
- Automated code analysis and refactoring
- Build orchestration and dependency management
- Project structure visualization and navigation
- Incremental build and test optimization
- Tool integration and workflow automation
- Cross-environment development (local, cloud, browser-based)
- Version control and change management

## Deployment Target
Antimatter is the core tooling infrastructure for a self-hosting online IDE platform, providing:
- Project workspace management
- File system operations across different runtime environments
- Build and test execution capabilities (local and AWS Lambda)
- AI-powered code assistance using Anthropic APIs
- Interactive development tools and visualizations
- Complete development lifecycle management
- Self-hosting and self-improvement capabilities
