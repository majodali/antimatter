import { describe, it, expect } from 'vitest';
import { AgentError, ProviderError, ContextError } from '../types.js';
import type { Identifier } from '@antimatter/project-model';

describe('AgentError', () => {
  it('should create error with message and details', () => {
    const error = new AgentError(
      'Test error',
      'agent-1' as Identifier,
      'configuration-invalid',
    );

    expect(error.message).toBe('Test error');
    expect(error.agentId).toBe('agent-1');
    expect(error.reason).toBe('configuration-invalid');
    expect(error.name).toBe('AgentError');
  });

  it('should support all error reasons', () => {
    const reasons = [
      'configuration-invalid',
      'execution-failed',
      'tool-failed',
    ] as const;

    for (const reason of reasons) {
      const error = new AgentError('Test', 'agent-1' as Identifier, reason);
      expect(error.reason).toBe(reason);
    }
  });
});

describe('ProviderError', () => {
  it('should create error with provider and reason', () => {
    const error = new ProviderError(
      'API failed',
      'claude',
      'api-error',
    );

    expect(error.message).toBe('API failed');
    expect(error.provider).toBe('claude');
    expect(error.reason).toBe('api-error');
    expect(error.name).toBe('ProviderError');
  });

  it('should support original error', () => {
    const original = new Error('Original error');
    const error = new ProviderError(
      'Wrapped error',
      'claude',
      'network-error',
      original,
    );

    expect(error.originalError).toBe(original);
  });

  it('should support all error reasons', () => {
    const reasons = [
      'auth-failed',
      'rate-limit',
      'invalid-request',
      'api-error',
      'network-error',
    ] as const;

    for (const reason of reasons) {
      const error = new ProviderError('Test', 'claude', reason);
      expect(error.reason).toBe(reason);
    }
  });
});

describe('ContextError', () => {
  it('should create error with reason', () => {
    const error = new ContextError(
      'Context too large',
      'context-too-large',
    );

    expect(error.message).toBe('Context too large');
    expect(error.reason).toBe('context-too-large');
    expect(error.name).toBe('ContextError');
  });

  it('should support all error reasons', () => {
    const reasons = [
      'context-too-large',
      'invalid-state',
      'storage-failed',
    ] as const;

    for (const reason of reasons) {
      const error = new ContextError('Test', reason);
      expect(error.reason).toBe(reason);
    }
  });
});
