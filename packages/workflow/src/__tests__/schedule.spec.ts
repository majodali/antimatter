import { describe, it } from 'node:test';
import { expect, createMockFn } from '@antimatter/test-utils';
import { WorkflowRuntime } from '../runtime.js';
import {
  parseInterval,
  MIN_SCHEDULE_INTERVAL_MS,
  SCHEDULE_FIRE_EVENT_TYPE,
} from '../schedule.js';
import type { ExecResult, WorkflowDefinition, WorkflowEvent } from '../types.js';

const ok: ExecResult = { exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
const noop = () => Promise.resolve(ok);

function fire(scheduleId: string): WorkflowEvent {
  return {
    type: SCHEDULE_FIRE_EVENT_TYPE,
    timestamp: new Date().toISOString(),
    scheduleId,
    scheduledAt: new Date().toISOString(),
  } as WorkflowEvent;
}

// ---------------------------------------------------------------------------
// parseInterval
// ---------------------------------------------------------------------------

describe('parseInterval', () => {
  it('parses seconds', () => {
    expect(parseInterval('30s')).toBe(30_000);
    expect(parseInterval('120s')).toBe(120_000);
  });

  it('parses minutes', () => {
    expect(parseInterval('5m')).toBe(5 * 60_000);
    expect(parseInterval('1m')).toBe(60_000);
  });

  it('parses hours', () => {
    expect(parseInterval('1h')).toBe(3_600_000);
    expect(parseInterval('6h')).toBe(6 * 3_600_000);
  });

  it('parses days', () => {
    expect(parseInterval('1d')).toBe(86_400_000);
  });

  it('parses raw milliseconds', () => {
    expect(parseInterval('15000ms')).toBe(15_000);
    expect(parseInterval(30_000)).toBe(30_000);
  });

  it('parses ISO 8601 PT fragments', () => {
    expect(parseInterval('PT30S')).toBe(30_000);
    expect(parseInterval('PT5M')).toBe(300_000);
    expect(parseInterval('PT1H')).toBe(3_600_000);
  });

  it('tolerates internal whitespace', () => {
    expect(parseInterval('5 m')).toBe(300_000);
  });

  it('rejects intervals below the minimum', () => {
    expect(() => parseInterval('1s')).toThrow();
    expect(() => parseInterval(500)).toThrow();
    expect(() => parseInterval('100ms')).toThrow();
  });

  it('rejects invalid strings', () => {
    expect(() => parseInterval('5 minutes')).toThrow();
    expect(() => parseInterval('')).toThrow();
    expect(() => parseInterval('abc')).toThrow();
    expect(() => parseInterval('-5m')).toThrow();
  });

  it('rejects invalid numbers', () => {
    expect(() => parseInterval(0)).toThrow();
    expect(() => parseInterval(-1)).toThrow();
    expect(() => parseInterval(Number.NaN)).toThrow();
    expect(() => parseInterval(Number.POSITIVE_INFINITY)).toThrow();
  });

  it('confirms the minimum constant', () => {
    expect(MIN_SCHEDULE_INTERVAL_MS).toBe(10_000);
  });
});

// ---------------------------------------------------------------------------
// wf.every — declaration phase
// ---------------------------------------------------------------------------

describe('wf.every declarations', () => {
  it('registers schedules and exposes them via declarations.schedules', () => {
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('Ops health check', '10m', () => {});
      wf.every('Nightly vacuum', '1d', () => {});
    };
    const rt = new WorkflowRuntime(def, { executor: noop });

    const scheds = rt.declarations.schedules;
    expect(scheds.length).toBe(2);
    expect(scheds[0].id).toBe('ops-health-check');
    expect(scheds[0].intervalSpec).toBe('10m');
    expect(scheds[0].intervalMs).toBe(600_000);
    expect(scheds[1].id).toBe('nightly-vacuum');
    expect(scheds[1].intervalMs).toBe(86_400_000);
  });

  it('also registers a synthetic rule "schedule:{id}" so tracing reuses the rule path', () => {
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('foo', '30s', () => {});
    };
    const rt = new WorkflowRuntime(def, { executor: noop });

    const rules = rt.declarations.rules;
    const synthetic = rules.find(r => r.id === 'schedule:foo');
    expect(synthetic != null).toBe(true);
    expect(synthetic!.name).toBe('Schedule: foo');
    expect(synthetic!.manual).toBe(false);
  });

  it('allows an explicit id via options', () => {
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('Health', '30s', () => {}, { id: 'custom-id' });
    };
    const rt = new WorkflowRuntime(def, { executor: noop });
    expect(rt.declarations.schedules[0].id).toBe('custom-id');
    expect(rt.declarations.rules.some(r => r.id === 'schedule:custom-id')).toBe(true);
  });

  it('rejects duplicate schedule ids', () => {
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('same name', '30s', () => {});
      wf.every('same-name', '1m', () => {});
    };
    expect(() => new WorkflowRuntime(def, { executor: noop })).toThrow();
  });

  it('rejects invalid intervals at declaration time', () => {
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('too fast', '1s', () => {});
    };
    expect(() => new WorkflowRuntime(def, { executor: noop })).toThrow();
  });
});

// ---------------------------------------------------------------------------
// wf.every — execution path (schedule:fire event → action runs with tracing)
// ---------------------------------------------------------------------------

describe('wf.every execution', () => {
  it('runs the action when a matching schedule:fire event arrives', async () => {
    const calls: string[] = [];
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('tick', '30s', () => { calls.push('tick ran'); });
    };
    const rt = new WorkflowRuntime(def, { executor: noop });

    const { result } = await rt.processEvents([fire('tick')], {});
    expect(calls).toEqual(['tick ran']);
    expect(result.rulesExecuted.length).toBe(1);
    expect(result.rulesExecuted[0].ruleId).toBe('schedule:tick');
  });

  it('does NOT run schedules whose scheduleId does not match', async () => {
    const calls: string[] = [];
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('a', '30s', () => { calls.push('a'); });
      wf.every('b', '30s', () => { calls.push('b'); });
    };
    const rt = new WorkflowRuntime(def, { executor: noop });

    await rt.processEvents([fire('a')], {});
    expect(calls).toEqual(['a']);
  });

  it('propagates operationId + invocationId into onRuleStart/onRuleEnd hooks', async () => {
    const onRuleStart = createMockFn();
    const onRuleEnd = createMockFn();
    const def: WorkflowDefinition<{}> = (wf) => {
      wf.every('traced', '30s', () => {});
    };
    const rt = new WorkflowRuntime(def, {
      executor: noop,
      config: { onRuleStart, onRuleEnd },
    });

    await rt.processEvents([fire('traced')], {});
    expect(onRuleStart).toHaveBeenCalled();
    expect(onRuleEnd).toHaveBeenCalled();
    const ctx = (onRuleStart.mock.calls[0] as unknown[])[0] as any;
    expect(ctx.ruleId).toBe('schedule:traced');
    expect(typeof ctx.invocationId).toBe('string');
    expect(typeof ctx.operationId).toBe('string');
  });

  it('removes schedules when their source file is unloaded', async () => {
    const def: WorkflowDefinition<{}> = (wf) => {};
    const rt = new WorkflowRuntime(def, { executor: noop });
    rt.setSourceFile('.antimatter/ops.ts');
    const calls: string[] = [];
    rt.getHandle().every('health', '30s', () => { calls.push('fired'); });
    rt.setSourceFile(null);
    expect(rt.declarations.schedules.length).toBe(1);

    rt.removeDeclarationsFromFile('.antimatter/ops.ts');
    expect(rt.declarations.schedules.length).toBe(0);

    // Synthetic rule should also be gone — firing the event should match nothing.
    const { result } = await rt.processEvents([fire('health')], {});
    expect(result.rulesExecuted.length).toBe(0);
    expect(calls).toEqual([]);
  });
});
