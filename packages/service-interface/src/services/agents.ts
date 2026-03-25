/**
 * Agents Service
 *
 * Manages AI agent chat sessions and interactions.
 *
 * Chat sessions are resources that are typically but not always scoped to
 * a project. User messages are sent as commands; all chat content (agent
 * responses, tool calls, results) is delivered as events targeting the
 * specific session. This decouples the request from the response stream.
 *
 * Chat history is managed per-session by the Agents service. The internal
 * orchestration of agent interactions and tool use is not exposed through
 * the service interface.
 */

import type { ServiceEventBase, OperationMeta } from '../protocol.js';

// ---------------------------------------------------------------------------
// Resource types
// ---------------------------------------------------------------------------

export interface ChatSession {
  readonly sessionId: string;
  readonly projectId?: string;
  readonly name?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export interface ChatMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly role: ChatMessageRole;
  readonly content: string;
  readonly timestamp: string;
}

export interface ChatToolCall {
  readonly id: string;
  readonly sessionId: string;
  readonly name: string;
  readonly parameters: Record<string, unknown>;
  readonly timestamp: string;
}

export interface ChatToolResult {
  readonly toolCallId: string;
  readonly sessionId: string;
  readonly content: string;
  readonly isError?: boolean;
  readonly timestamp: string;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

export interface AgentsChatsCreateCommand {
  readonly type: 'agents.chats.create';
  readonly projectId?: string;
  readonly name?: string;
}

export interface AgentsChatsSendCommand {
  readonly type: 'agents.chats.send';
  readonly sessionId: string;
  readonly message: string;
}

export interface AgentsChatsDeleteCommand {
  readonly type: 'agents.chats.delete';
  readonly sessionId: string;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface AgentsChatsListQuery {
  readonly type: 'agents.chats.list';
  readonly projectId?: string;
}

export interface AgentsChatsGetQuery {
  readonly type: 'agents.chats.get';
  readonly sessionId: string;
}

export interface AgentsChatsHistoryQuery {
  readonly type: 'agents.chats.history';
  readonly sessionId: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface AgentsChatMessageEvent extends ServiceEventBase {
  readonly type: 'agents.chat.message';
  readonly sessionId: string;
  readonly message: ChatMessage;
}

export interface AgentsChatToolCallEvent extends ServiceEventBase {
  readonly type: 'agents.chat.toolCall';
  readonly sessionId: string;
  readonly toolCall: ChatToolCall;
}

export interface AgentsChatToolResultEvent extends ServiceEventBase {
  readonly type: 'agents.chat.toolResult';
  readonly sessionId: string;
  readonly toolResult: ChatToolResult;
}

export interface AgentsChatDoneEvent extends ServiceEventBase {
  readonly type: 'agents.chat.done';
  readonly sessionId: string;
  readonly usage?: { inputTokens: number; outputTokens: number };
}

// ---------------------------------------------------------------------------
// Union types
// ---------------------------------------------------------------------------

export type AgentsCommand =
  | AgentsChatsCreateCommand
  | AgentsChatsSendCommand
  | AgentsChatsDeleteCommand;

export type AgentsQuery =
  | AgentsChatsListQuery
  | AgentsChatsGetQuery
  | AgentsChatsHistoryQuery;

export type AgentsEvent =
  | AgentsChatMessageEvent
  | AgentsChatToolCallEvent
  | AgentsChatToolResultEvent
  | AgentsChatDoneEvent;

// ---------------------------------------------------------------------------
// Response maps
// ---------------------------------------------------------------------------

export interface AgentsCommandResponseMap {
  'agents.chats.create': ChatSession;
  'agents.chats.send': void;
  'agents.chats.delete': void;
}

export interface AgentsQueryResponseMap {
  'agents.chats.list': { sessions: readonly ChatSession[] };
  'agents.chats.get': ChatSession;
  'agents.chats.history': { messages: readonly ChatMessage[] };
}

// ---------------------------------------------------------------------------
// Operation metadata
// ---------------------------------------------------------------------------

import { z } from 'zod';

export const AGENTS_OPERATIONS: Record<string, OperationMeta> = {
  'agents.chats.create': {
    kind: 'command', context: 'platform', description: 'Create a chat session',
    params: { name: z.string().optional().describe('Session name') },
  },
  'agents.chats.send': {
    kind: 'command', context: 'workspace', description: 'Send a message to a chat session',
    params: { sessionId: z.string().describe('Chat session ID'), message: z.string().describe('Message content to send') },
  },
  'agents.chats.delete': {
    kind: 'command', context: 'platform', description: 'Delete a chat session',
    params: { sessionId: z.string().describe('Chat session ID to delete') },
  },
  'agents.chats.list': {
    kind: 'query', context: 'platform', description: 'List chat sessions',
  },
  'agents.chats.get': {
    kind: 'query', context: 'platform', description: 'Get chat session details',
    params: { sessionId: z.string().describe('Chat session ID') },
  },
  'agents.chats.history': {
    kind: 'query', context: 'platform', description: 'Get chat history',
    params: { sessionId: z.string().describe('Chat session ID'), limit: z.number().optional().describe('Max messages to return') },
  },
};
