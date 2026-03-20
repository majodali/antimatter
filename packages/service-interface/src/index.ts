/**
 * @antimatter/service-interface
 *
 * Canonical type definitions for all Antimatter platform operations.
 *
 * The service interface defines operations organized by service:
 *
 * **App Services** (manage resources during project work):
 *  - Projects -- project lifecycle and version control
 *  - Files -- file system and annotations
 *  - Builds -- build rules, results, configurations, triggers
 *  - Tests -- test definitions, execution, results
 *  - Workspaces -- workspace lifecycle and terminal sessions
 *  - DeployedResources -- project-defined resource tracking
 *  - Agents -- AI agent chat sessions
 *
 * **Platform Services** (supporting functions):
 *  - Auth -- authentication and authorization
 *  - ClientAutomation -- browser client testing and automation
 *  - Observability -- event logging and monitoring
 *
 * Three transport adapters consume these types:
 *  - REST (Lambda API + Workspace Server)
 *  - WebSocket (full duplex with event subscriptions and terminal I/O)
 *  - Tool-use (AI agent framework)
 *
 * WebSocket connections are scoped to a default project (set at handshake).
 * Individual frames can override the project scope. The workspace server
 * responds with `not-hosted` error for projects it doesn't host, signaling
 * the client to fall back to REST.
 */

// ---------------------------------------------------------------------------
// Protocol -- envelopes, errors, frames, base types
// ---------------------------------------------------------------------------

export type {
  ServiceResponse,
  ServiceError,
  ServiceErrorCode,
  ExecutionContext,
  Operation,
  ServiceEventBase,
  ProjectScoped,
  ClientFrame,
  ServerFrame,
  OperationMeta,
} from './protocol.js';

// ---------------------------------------------------------------------------
// Projects Service
// ---------------------------------------------------------------------------

export type {
  ProjectInfo,
  VcsStatus,
  VcsFileChange,
  VcsLogEntry,
  ProjectsCommand,
  ProjectsQuery,
  ProjectsEvent,
  ProjectsCreateCommand,
  ProjectsDeleteCommand,
  ProjectsImportCommand,
  ProjectsSetRemoteCommand,
  ProjectsStageCommand,
  ProjectsUnstageCommand,
  ProjectsCommitCommand,
  ProjectsPushCommand,
  ProjectsPullCommand,
  ProjectsListQuery,
  ProjectsGetQuery,
  ProjectsStatusQuery,
  ProjectsLogQuery,
  ProjectsRemoteQuery,
  ProjectsCreatedEvent,
  ProjectsDeletedEvent,
  ProjectsCommandResponseMap,
  ProjectsQueryResponseMap,
} from './services/projects.js';
export { PROJECTS_OPERATIONS } from './services/projects.js';

// ---------------------------------------------------------------------------
// Files Service
// ---------------------------------------------------------------------------

export type {
  FileNode,
  FileChange,
  Annotation,
  AnnotationAction,
  AnnotationSeverity,
  FilesCommand,
  FilesQuery,
  FilesEvent,
  FilesWriteCommand,
  FilesDeleteCommand,
  FilesMkdirCommand,
  FilesMoveCommand,
  FilesCopyCommand,
  FilesAnnotateCommand,
  FilesClearAnnotationsCommand,
  FilesReadQuery,
  FilesTreeQuery,
  FilesExistsQuery,
  FilesAnnotationsQuery,
  FilesChangedEvent,
  FilesAnnotationsChangedEvent,
  FilesCommandResponseMap,
  FilesQueryResponseMap,
} from './services/files.js';
export { FILES_OPERATIONS } from './services/files.js';

// ---------------------------------------------------------------------------
// Builds Service
// ---------------------------------------------------------------------------

export type {
  BuildRule,
  BuildResult,
  BuildResultSeverity,
  BuildConfiguration,
  BuildTrigger,
  BuildTriggerParam,
  BuildsCommand,
  BuildsQuery,
  BuildsEvent,
  BuildsTriggerInvokeCommand,
  BuildsConfigurationSetCommand,
  BuildsRulesListQuery,
  BuildsResultsListQuery,
  BuildsConfigurationsListQuery,
  BuildsTriggersListQuery,
  BuildsStartedEvent,
  BuildsOutputEvent,
  BuildsCompletedEvent,
  BuildsResultEvent,
  BuildsCommandResponseMap,
  BuildsQueryResponseMap,
} from './services/builds.js';
export { BUILDS_OPERATIONS } from './services/builds.js';

// ---------------------------------------------------------------------------
// Tests Service
// ---------------------------------------------------------------------------

export type {
  TestDefinition,
  TestRunnerRef,
  TestResult,
  TestResultStatus,
  TestRunSummary,
  TestsCommand,
  TestsQuery,
  TestsEvent,
  TestsRunCommand,
  TestsRegisterCommand,
  TestsListQuery,
  TestsResultsQuery,
  TestsRunnersQuery,
  TestsStartedEvent,
  TestsResultEvent,
  TestsCompletedEvent,
  TestsCommandResponseMap,
  TestsQueryResponseMap,
} from './services/tests.js';
export { TESTS_OPERATIONS } from './services/tests.js';

// ---------------------------------------------------------------------------
// Workspaces Service
// ---------------------------------------------------------------------------

export type {
  WorkspaceInfo,
  TerminalSession,
  WorkspacesCommand,
  WorkspacesQuery,
  WorkspacesEvent,
  WorkspacesStartCommand,
  WorkspacesStopCommand,
  WorkspacesTerminalsCreateCommand,
  WorkspacesTerminalsCloseCommand,
  WorkspacesStatusQuery,
  WorkspacesTerminalsListQuery,
  WorkspacesStatusChangedEvent,
  WorkspacesCommandResponseMap,
  WorkspacesQueryResponseMap,
} from './services/workspaces.js';
export { WORKSPACES_OPERATIONS } from './services/workspaces.js';

// ---------------------------------------------------------------------------
// DeployedResources Service
// ---------------------------------------------------------------------------

export type {
  DeployedResource,
  DeployedResourceAction,
  DeployedResourcesCommand,
  DeployedResourcesQuery,
  DeployedResourcesEvent,
  DeployedResourcesRegisterCommand,
  DeployedResourcesDeregisterCommand,
  DeployedResourcesUpdateCommand,
  DeployedResourcesListQuery,
  DeployedResourcesGetQuery,
  DeployedResourcesCreatedEvent,
  DeployedResourcesUpdatedEvent,
  DeployedResourcesDeletedEvent,
  DeployedResourcesCommandResponseMap,
  DeployedResourcesQueryResponseMap,
} from './services/deployed-resources.js';
export { DEPLOYED_RESOURCES_OPERATIONS } from './services/deployed-resources.js';

// ---------------------------------------------------------------------------
// Agents Service
// ---------------------------------------------------------------------------

export type {
  ChatSession,
  ChatMessage,
  ChatMessageRole,
  ChatToolCall,
  ChatToolResult,
  AgentsCommand,
  AgentsQuery,
  AgentsEvent,
  AgentsChatsCreateCommand,
  AgentsChatsSendCommand,
  AgentsChatsDeleteCommand,
  AgentsChatsListQuery,
  AgentsChatsGetQuery,
  AgentsChatsHistoryQuery,
  AgentsChatMessageEvent,
  AgentsChatToolCallEvent,
  AgentsChatToolResultEvent,
  AgentsChatDoneEvent,
  AgentsCommandResponseMap,
  AgentsQueryResponseMap,
} from './services/agents.js';
export { AGENTS_OPERATIONS } from './services/agents.js';

// ---------------------------------------------------------------------------
// Auth Service
// ---------------------------------------------------------------------------

export type {
  UserInfo,
  AuthCommand,
  AuthQuery,
  AuthEvent,
  AuthCurrentUserQuery,
  AuthCommandResponseMap,
  AuthQueryResponseMap,
} from './services/auth.js';
export { AUTH_OPERATIONS } from './services/auth.js';

// ---------------------------------------------------------------------------
// ClientAutomation Service
// ---------------------------------------------------------------------------

export type {
  ClientInfo,
  ClientAutomationCommand,
  ClientAutomationQuery,
  ClientAutomationEvent,
  ClientsAutomationExecuteCommand,
  ClientsListQuery,
  ClientsConnectedEvent,
  ClientsDisconnectedEvent,
  ClientAutomationCommandResponseMap,
  ClientAutomationQueryResponseMap,
} from './services/client-automation.js';
export { CLIENT_AUTOMATION_OPERATIONS } from './services/client-automation.js';

// ---------------------------------------------------------------------------
// Observability Service
// ---------------------------------------------------------------------------

export type {
  ObservabilityEvent,
  ObservabilityCommand,
  ObservabilityQuery,
  ObservabilityEvent_ as ObservabilityServiceEvent,
  ObservabilityEventsListQuery,
  ObservabilityCommandResponseMap,
  ObservabilityQueryResponseMap,
} from './services/observability.js';
export { OBSERVABILITY_OPERATIONS } from './services/observability.js';

// ---------------------------------------------------------------------------
// Aggregate types
// ---------------------------------------------------------------------------

import type { ProjectsCommand, ProjectsQuery, ProjectsEvent } from './services/projects.js';
import type { FilesCommand, FilesQuery, FilesEvent } from './services/files.js';
import type { BuildsCommand, BuildsQuery, BuildsEvent } from './services/builds.js';
import type { TestsCommand, TestsQuery, TestsEvent } from './services/tests.js';
import type { WorkspacesCommand, WorkspacesQuery, WorkspacesEvent } from './services/workspaces.js';
import type { DeployedResourcesCommand, DeployedResourcesQuery, DeployedResourcesEvent } from './services/deployed-resources.js';
import type { AgentsCommand, AgentsQuery, AgentsEvent } from './services/agents.js';
import type { AuthCommand, AuthQuery } from './services/auth.js';
import type { ClientAutomationCommand, ClientAutomationQuery, ClientAutomationEvent } from './services/client-automation.js';
import type { ObservabilityQuery } from './services/observability.js';

/** Union of all command types across all services. */
export type Command =
  | ProjectsCommand
  | FilesCommand
  | BuildsCommand
  | TestsCommand
  | WorkspacesCommand
  | DeployedResourcesCommand
  | AgentsCommand
  | AuthCommand
  | ClientAutomationCommand;

/** Union of all query types across all services. */
export type Query =
  | ProjectsQuery
  | FilesQuery
  | BuildsQuery
  | TestsQuery
  | WorkspacesQuery
  | DeployedResourcesQuery
  | AgentsQuery
  | AuthQuery
  | ClientAutomationQuery
  | ObservabilityQuery;

/** Union of all event types across all services. */
export type ServiceEvent =
  | ProjectsEvent
  | FilesEvent
  | BuildsEvent
  | TestsEvent
  | WorkspacesEvent
  | DeployedResourcesEvent
  | AgentsEvent
  | ClientAutomationEvent;

/** All event type strings (for subscribe/unsubscribe). */
export type ServiceEventType = ServiceEvent['type'];

// ---------------------------------------------------------------------------
// Aggregate response maps
// ---------------------------------------------------------------------------

import type { ProjectsCommandResponseMap, ProjectsQueryResponseMap } from './services/projects.js';
import type { FilesCommandResponseMap, FilesQueryResponseMap } from './services/files.js';
import type { BuildsCommandResponseMap, BuildsQueryResponseMap } from './services/builds.js';
import type { TestsCommandResponseMap, TestsQueryResponseMap } from './services/tests.js';
import type { WorkspacesCommandResponseMap, WorkspacesQueryResponseMap } from './services/workspaces.js';
import type { DeployedResourcesCommandResponseMap, DeployedResourcesQueryResponseMap } from './services/deployed-resources.js';
import type { AgentsCommandResponseMap, AgentsQueryResponseMap } from './services/agents.js';
import type { AuthCommandResponseMap, AuthQueryResponseMap } from './services/auth.js';
import type { ClientAutomationCommandResponseMap, ClientAutomationQueryResponseMap } from './services/client-automation.js';
import type { ObservabilityCommandResponseMap, ObservabilityQueryResponseMap } from './services/observability.js';

/** Maps every command type string to its response data shape. */
export interface CommandResponseMap extends
  ProjectsCommandResponseMap,
  FilesCommandResponseMap,
  BuildsCommandResponseMap,
  TestsCommandResponseMap,
  WorkspacesCommandResponseMap,
  DeployedResourcesCommandResponseMap,
  AgentsCommandResponseMap,
  AuthCommandResponseMap,
  ClientAutomationCommandResponseMap,
  ObservabilityCommandResponseMap {}

/** Maps every query type string to its response data shape. */
export interface QueryResponseMap extends
  ProjectsQueryResponseMap,
  FilesQueryResponseMap,
  BuildsQueryResponseMap,
  TestsQueryResponseMap,
  WorkspacesQueryResponseMap,
  DeployedResourcesQueryResponseMap,
  AgentsQueryResponseMap,
  AuthQueryResponseMap,
  ClientAutomationQueryResponseMap,
  ObservabilityQueryResponseMap {}

// ---------------------------------------------------------------------------
// Routing utilities
// ---------------------------------------------------------------------------

export {
  ALL_OPERATIONS,
  getOperationMeta,
  getExecutionContext,
  isWorkspaceOperation,
  isPlatformOperation,
  isBrowserOperation,
  isCommand,
  isQuery,
  getServiceNamespace,
} from './routing.js';

// ---------------------------------------------------------------------------
// Client -- transport-agnostic dispatch
// ---------------------------------------------------------------------------

export {
  ServiceClient,
} from './client.js';

export type {
  TransportAdapter,
  EventTransport,
  EventHandler,
  Unsubscribe,
  TransportRegistry,
} from './client.js';
