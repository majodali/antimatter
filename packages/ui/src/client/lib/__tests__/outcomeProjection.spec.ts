import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { projectOutcomes } from '../outcomeProjection.js';
import { Kinds, type ActivityEvent } from '../../../shared/activity-types.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

let nextSeq = 1;
let nextMs = Date.parse('2026-04-23T12:00:00Z');

function ev(partial: Partial<ActivityEvent> & Pick<ActivityEvent, 'source' | 'kind' | 'level' | 'message'>): ActivityEvent {
  return {
    seq: nextSeq++,
    loggedAt: new Date(nextMs++).toISOString(),
    ...partial,
  } as ActivityEvent;
}

function resetSeq() { nextSeq = 1; nextMs = Date.parse('2026-04-23T12:00:00Z'); }

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('projectOutcomes', () => {
  it('returns nothing for an empty input', () => {
    resetSeq();
    expect(projectOutcomes([])).toEqual([]);
  });

  it('ignores non-workflow sources entirely', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'router', kind: 'router:start',   level: 'info', message: 'router up' }),
      ev({ source: 'child',  kind: 'child:spawn',    level: 'info', message: 'worker up', projectId: 'antimatter' }),
      ev({ source: 'worker', kind: 'worker:ready',   level: 'info', message: 'worker ready' }),
    ];
    expect(projectOutcomes(events)).toEqual([]);
  });

  it('ignores invocations with no rule:start (file:change storm case)', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowInvocationStart, level: 'info', message: 'Invocation start: file:change x2095', operationId: 'inv-1' }),
      ev({ source: 'workflow', kind: Kinds.WorkflowInvocationEnd,   level: 'info', message: 'Invocation end (1 cycles, 7ms)',      operationId: 'inv-1' }),
    ];
    expect(projectOutcomes(events)).toEqual([]);
  });

  it('emits a success outcome for a rule that matched and ended without error', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowInvocationStart, level: 'info', message: 'Invocation start', operationId: 'inv-1' }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart,       level: 'info', message: 'Rule start: compile',
           operationId: 'inv-1', correlationId: 'compile', parentId: 'inv-1', data: { ruleId: 'compile', matchedCount: 1 } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd,         level: 'info', message: 'Rule end: compile (42ms)',
           operationId: 'inv-1', correlationId: 'compile', parentId: 'inv-1', data: { ruleId: 'compile', durationMs: 42 } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowInvocationEnd,   level: 'info', message: 'Invocation end', operationId: 'inv-1' }),
    ];
    const out = projectOutcomes(events);
    expect(out.length).toBe(1);
    expect(out[0].status).toBe('success');
    expect(out[0].ruleId).toBe('compile');
    expect(out[0].ruleName).toBe('Compile');
    expect(out[0].durationMs).toBe(42);
    expect(out[0].kind).toBe('rule');
    expect(out[0].childEvents.length).toBe(0);
  });

  it('derives error status from rule:end.data.error and exposes the message', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info',  message: 'Rule start: deploy',
           operationId: 'op-1', correlationId: 'deploy', parentId: 'inv-1', data: { ruleId: 'deploy' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd,   level: 'error', message: 'Rule failed',
           operationId: 'op-1', correlationId: 'deploy', parentId: 'inv-1',
           data: { ruleId: 'deploy', durationMs: 10, error: 'connection refused' } }),
    ];
    const [o] = projectOutcomes(events);
    expect(o.status).toBe('error');
    expect(o.errorMessage).toBe('connection refused');
  });

  it('derives error status from a child workflow:log at level=error even if rule:end is clean', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info',  message: 'Rule start: health',
           operationId: 'op-1', correlationId: 'health', data: { ruleId: 'health' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowLog,       level: 'error', message: 'lambda unreachable',
           operationId: 'op-1', correlationId: 'health', parentId: 'inv-1' }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd,   level: 'info',  message: 'Rule end: health (5ms)',
           operationId: 'op-1', correlationId: 'health', data: { ruleId: 'health', durationMs: 5 } }),
    ];
    const [o] = projectOutcomes(events);
    expect(o.status).toBe('error');
    expect(o.errorMessage).toBe('lambda unreachable');
    expect(o.childEvents.length).toBe(1);
  });

  it('derives warn status from a workflow:log at level=warn (no errors present)', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info', message: 'Rule start: build',
           operationId: 'op-1', correlationId: 'build', data: { ruleId: 'build' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowLog,       level: 'warn', message: 'deprecated API used',
           operationId: 'op-1', correlationId: 'build', parentId: 'inv-1' }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd,   level: 'info', message: 'Rule end: build',
           operationId: 'op-1', correlationId: 'build', data: { ruleId: 'build', durationMs: 100 } }),
    ];
    const [o] = projectOutcomes(events);
    expect(o.status).toBe('warn');
  });

  it('leaves status=running when rule:start exists but rule:end hasnt arrived yet', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info', message: 'Rule start: slow',
           operationId: 'op-1', correlationId: 'slow', data: { ruleId: 'slow' } }),
    ];
    const [o] = projectOutcomes(events);
    expect(o.status).toBe('running');
    expect(o.endedAt).toBe(undefined);
    expect(o.durationMs).toBe(undefined);
  });

  it('tags schedule-fire outcomes with kind=schedule and a trigger summary', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowScheduleFire, level: 'info',
           message: 'Schedule fire: ops:health-check (every 10m)',
           operationId: 'schedop-1', correlationId: 'schedule:ops-health-check',
           data: { scheduleId: 'ops-health-check', scheduleName: 'ops:health-check', intervalSpec: '10m', intervalMs: 600_000, lastRunAt: null } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info', message: 'Rule start: schedule:ops-health-check',
           operationId: 'schedop-1', correlationId: 'schedule:ops-health-check',
           data: { ruleId: 'schedule:ops-health-check' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd,   level: 'info', message: 'Rule end',
           operationId: 'schedop-1', correlationId: 'schedule:ops-health-check',
           data: { ruleId: 'schedule:ops-health-check', durationMs: 108 } }),
    ];
    const [o] = projectOutcomes(events);
    expect(o.kind).toBe('schedule');
    expect(o.ruleName).toBe('ops:health-check');
    expect(o.triggerSummary).toBe('every 10m');
    expect(o.status).toBe('success');
  });

  it('attaches log + exec + util children to their parent rule outcome', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart,  level: 'info', message: 'Rule start: deploy',
           operationId: 'op-1', correlationId: 'deploy', data: { ruleId: 'deploy' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowLog,        level: 'info', message: 'Starting deploy',
           operationId: 'op-1', correlationId: 'deploy', parentId: 'inv-1' }),
      ev({ source: 'workflow', kind: Kinds.WorkflowExecStart,  level: 'info', message: 'npm run deploy',
           operationId: 'op-1', correlationId: 'exec-1', parentId: 'deploy' }),
      ev({ source: 'workflow', kind: Kinds.WorkflowExecEnd,    level: 'info', message: 'npm run deploy OK',
           operationId: 'op-1', correlationId: 'exec-1', parentId: 'deploy', data: { durationMs: 2000, exitCode: 0 } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowUtilStart,  level: 'info', message: 's3.uploadDir',
           operationId: 'op-1', correlationId: 'util-1', parentId: 'deploy' }),
      ev({ source: 'workflow', kind: Kinds.WorkflowUtilEnd,    level: 'info', message: 's3.uploadDir OK',
           operationId: 'op-1', correlationId: 'util-1', parentId: 'deploy', data: { durationMs: 500 } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd,    level: 'info', message: 'Rule end: deploy',
           operationId: 'op-1', correlationId: 'deploy', data: { ruleId: 'deploy', durationMs: 2550 } }),
    ];
    const [o] = projectOutcomes(events);
    expect(o.childEvents.length).toBe(5);
    expect(o.status).toBe('success');
  });

  it('promotes status to error when an exec ends with non-zero exit code', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info',  message: 'Rule start',
           operationId: 'op-1', correlationId: 'build', data: { ruleId: 'build' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowExecEnd,   level: 'info',  message: 'tsc failed',
           operationId: 'op-1', correlationId: 'exec-1', parentId: 'build', data: { exitCode: 1, durationMs: 2000 } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd,   level: 'info',  message: 'Rule end',
           operationId: 'op-1', correlationId: 'build', data: { ruleId: 'build', durationMs: 2100 } }),
    ];
    const [o] = projectOutcomes(events);
    expect(o.status).toBe('error');
    expect(o.errorMessage).toBe('exit 1');
  });

  it('orphan children (no matching rule:start) are dropped silently', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      // Log without any rule:start before it
      ev({ source: 'workflow', kind: Kinds.WorkflowLog, level: 'info', message: 'orphan',
           operationId: 'op-1', correlationId: 'missing', parentId: 'inv-1' }),
    ];
    expect(projectOutcomes(events)).toEqual([]);
  });

  it('is idempotent when called with a growing prefix (incremental stream)', () => {
    resetSeq();
    const a: ActivityEvent = ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info', message: 'start',
        operationId: 'op-1', correlationId: 'r', data: { ruleId: 'r' } });
    const b: ActivityEvent = ev({ source: 'workflow', kind: Kinds.WorkflowRuleEnd, level: 'info', message: 'end',
        operationId: 'op-1', correlationId: 'r', data: { ruleId: 'r', durationMs: 5 } });
    const firstPass = projectOutcomes([a]);
    const secondPass = projectOutcomes([a, b]);
    expect(firstPass.length).toBe(1);
    expect(firstPass[0].status).toBe('running');
    expect(secondPass.length).toBe(1);
    expect(secondPass[0].status).toBe('success');
    expect(secondPass[0].key).toBe(firstPass[0].key);
  });

  it('produces outcomes in ascending startedAt order', () => {
    resetSeq();
    const events: ActivityEvent[] = [
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info', message: 'a',
           operationId: 'op-1', correlationId: 'a', data: { ruleId: 'a' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info', message: 'b',
           operationId: 'op-2', correlationId: 'b', data: { ruleId: 'b' } }),
      ev({ source: 'workflow', kind: Kinds.WorkflowRuleStart, level: 'info', message: 'c',
           operationId: 'op-3', correlationId: 'c', data: { ruleId: 'c' } }),
    ];
    const out = projectOutcomes(events);
    expect(out.map((o) => o.ruleId)).toEqual(['a', 'b', 'c']);
  });
});
