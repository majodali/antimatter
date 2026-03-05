import { describe, it, expect, vi } from 'vitest';
import { WorkflowRuntime } from '../runtime.js';
import type {
  ExecResult,
  WorkflowDefinition,
  WorkflowEvent,
} from '../types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(type: string, extra: Record<string, unknown> = {}): WorkflowEvent {
  return { type, timestamp: new Date().toISOString(), ...extra };
}

const successResult: ExecResult = { exitCode: 0, stdout: '', stderr: '', durationMs: 0 };
const failResult: ExecResult = { exitCode: 1, stdout: '', stderr: 'error', durationMs: 0 };

function noopExecutor(): Promise<ExecResult> {
  return Promise.resolve(successResult);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorkflowRuntime', () => {

  // ---- Construction -------------------------------------------------------

  describe('construction', () => {
    it('registers rules from the definition function', () => {
      const definition: WorkflowDefinition<{ count: number }> = (wf) => {
        wf.rule('a', 'Rule A', () => true, () => {});
        wf.rule('b', 'Rule B', () => false, () => {});
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      expect(runtime.ruleCount).toBe(2);
    });

    it('works with zero rules', () => {
      const runtime = new WorkflowRuntime(() => {}, { executor: noopExecutor });
      expect(runtime.ruleCount).toBe(0);
    });
  });

  // ---- Event matching -----------------------------------------------------

  describe('event matching', () => {
    it('fires rules whose predicate matches', async () => {
      const fired: string[] = [];

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('match', 'Matches file:change', (e) => e.type === 'file:change', () => {
          fired.push('match');
        });
        wf.rule('nomatch', 'Matches file:delete', (e) => e.type === 'file:delete', () => {
          fired.push('nomatch');
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      await runtime.processEvents([makeEvent('file:change', { path: 'foo.ts' })], {});

      expect(fired).toEqual(['match']);
    });

    it('passes only matched events to the action', async () => {
      let received: WorkflowEvent[] = [];

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('r', 'test', (e) => e.type === 'file:change', (events) => {
          received = events;
        });
      };

      const events = [
        makeEvent('file:change', { path: 'a.ts' }),
        makeEvent('file:delete', { path: 'b.ts' }),
        makeEvent('file:change', { path: 'c.ts' }),
      ];

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      await runtime.processEvents(events, {});

      expect(received).toHaveLength(2);
      expect(received[0].path).toBe('a.ts');
      expect(received[1].path).toBe('c.ts');
    });

    it('does not fire rules when no events match', async () => {
      const fired = vi.fn();
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('r', 'test', (e) => e.type === 'never', fired);
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('file:change')], {});

      expect(fired).not.toHaveBeenCalled();
      expect(result.rulesExecuted).toHaveLength(0);
    });
  });

  // ---- Execution order ----------------------------------------------------

  describe('execution order', () => {
    it('executes rules in declaration order', async () => {
      const order: string[] = [];

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('first', 'First', () => true, () => { order.push('first'); });
        wf.rule('second', 'Second', () => true, () => { order.push('second'); });
        wf.rule('third', 'Third', () => true, () => { order.push('third'); });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      await runtime.processEvents([makeEvent('any')], {});

      expect(order).toEqual(['first', 'second', 'third']);
    });

    it('awaits async actions before running the next rule', async () => {
      const order: string[] = [];

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('slow', 'Slow', () => true, async () => {
          await new Promise(r => setTimeout(r, 10));
          order.push('slow');
        });
        wf.rule('fast', 'Fast', () => true, () => {
          order.push('fast');
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      await runtime.processEvents([makeEvent('any')], {});

      expect(order).toEqual(['slow', 'fast']);
    });
  });

  // ---- State mutation -----------------------------------------------------

  describe('state mutation', () => {
    it('actions can mutate state', async () => {
      interface S { count: number }

      const definition: WorkflowDefinition<S> = (wf) => {
        wf.rule('inc', 'Increment', () => true, (_events, state) => {
          state.count += 1;
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { state } = await runtime.processEvents([makeEvent('tick')], { count: 0 });

      expect(state.count).toBe(1);
    });

    it('does not modify the original state object', async () => {
      interface S { value: string }

      const definition: WorkflowDefinition<S> = (wf) => {
        wf.rule('r', 'test', () => true, (_events, state) => {
          state.value = 'modified';
        });
      };

      const original: S = { value: 'original' };
      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { state } = await runtime.processEvents([makeEvent('x')], original);

      expect(original.value).toBe('original');
      expect(state.value).toBe('modified');
    });

    it('state mutations are visible to subsequent rules in the same cycle', async () => {
      interface S { value: number }

      const definition: WorkflowDefinition<S> = (wf) => {
        wf.rule('set', 'Set', () => true, (_e, s) => { s.value = 42; });
        wf.rule('read', 'Read', () => true, (_e, s) => { s.value = s.value * 2; });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { state } = await runtime.processEvents([makeEvent('x')], { value: 0 });

      expect(state.value).toBe(84);
    });
  });

  // ---- Event emission (multi-cycle) ---------------------------------------

  describe('event emission', () => {
    it('emitted events trigger a second cycle', async () => {
      const fired: string[] = [];

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('emit', 'Emits custom', (e) => e.type === 'start', () => {
          fired.push('emit');
          wf.emit({ type: 'custom:done' });
        });
        wf.rule('react', 'Reacts to custom', (e) => e.type === 'custom:done', () => {
          fired.push('react');
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('start')], {});

      expect(fired).toEqual(['emit', 'react']);
      expect(result.cycles).toBe(2);
      expect(result.emittedEvents).toHaveLength(1);
      expect(result.emittedEvents[0].type).toBe('custom:done');
    });

    it('emitted events have a timestamp', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('r', 'test', () => true, () => {
          wf.emit({ type: 'custom' });
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('x')], {});

      expect(result.emittedEvents[0].timestamp).toBeDefined();
    });

    it('supports multi-hop chains', async () => {
      const fired: string[] = [];

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('a', 'A', (e) => e.type === 'start', () => {
          fired.push('a');
          wf.emit({ type: 'step:1' });
        });
        wf.rule('b', 'B', (e) => e.type === 'step:1', () => {
          fired.push('b');
          wf.emit({ type: 'step:2' });
        });
        wf.rule('c', 'C', (e) => e.type === 'step:2', () => {
          fired.push('c');
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('start')], {});

      expect(fired).toEqual(['a', 'b', 'c']);
      expect(result.cycles).toBe(3);
    });

    it('stops at maxCycles to prevent infinite loops', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('loop', 'Infinite loop', () => true, () => {
          wf.emit({ type: 'loop' });
        });
      };

      const runtime = new WorkflowRuntime(definition, {
        executor: noopExecutor,
        config: { maxCycles: 3 },
      });
      const { result } = await runtime.processEvents([makeEvent('start')], {});

      expect(result.cycles).toBe(3);
    });

    it('stops processing when no events remain', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('r', 'test', (e) => e.type === 'start', () => {
          // No emit — cycle should stop.
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('start')], {});

      expect(result.cycles).toBe(1);
    });
  });

  // ---- Command execution --------------------------------------------------

  describe('command execution', () => {
    it('delegates exec to the provided executor', async () => {
      const executor = vi.fn().mockResolvedValue(successResult);

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('build', 'Build', () => true, async () => {
          await wf.exec('tsc --build', { cwd: 'packages/lib' });
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor });
      await runtime.processEvents([makeEvent('x')], {});

      expect(executor).toHaveBeenCalledWith('tsc --build', { cwd: 'packages/lib' });
    });

    it('exec result is available in the action', async () => {
      const executor = vi.fn().mockResolvedValue({ ...failResult, stderr: 'type error' });

      const definition: WorkflowDefinition<{ error?: string }> = (wf) => {
        wf.rule('build', 'Build', () => true, async (_e, state) => {
          const r = await wf.exec('tsc');
          if (r.exitCode !== 0) state.error = r.stderr;
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor });
      const { state } = await runtime.processEvents([makeEvent('x')], {});

      expect(state.error).toBe('type error');
    });
  });

  // ---- Logging ------------------------------------------------------------

  describe('logging', () => {
    it('captures log messages in the result', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('r', 'test', () => true, () => {
          wf.log('hello');
          wf.log('warning', 'warn');
          wf.log('failure', 'error');
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('x')], {});

      expect(result.logs).toHaveLength(3);
      expect(result.logs[0]).toMatchObject({ message: 'hello', level: 'info' });
      expect(result.logs[1]).toMatchObject({ message: 'warning', level: 'warn' });
      expect(result.logs[2]).toMatchObject({ message: 'failure', level: 'error' });
    });

    it('logs have timestamps', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('r', 'test', () => true, () => { wf.log('msg'); });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('x')], {});

      expect(result.logs[0].timestamp).toBeDefined();
    });
  });

  // ---- Error handling -----------------------------------------------------

  describe('error handling', () => {
    it('captures action errors without stopping other rules', async () => {
      const fired: string[] = [];

      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('fail', 'Fails', () => true, () => {
          fired.push('fail');
          throw new Error('boom');
        });
        wf.rule('ok', 'Succeeds', () => true, () => {
          fired.push('ok');
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('x')], {});

      expect(fired).toEqual(['fail', 'ok']);
      expect(result.rulesExecuted[0].error).toBe('boom');
      expect(result.rulesExecuted[1].error).toBeUndefined();
    });

    it('captures async action errors', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('fail', 'Async fail', () => true, async () => {
          throw new Error('async boom');
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('x')], {});

      expect(result.rulesExecuted[0].error).toBe('async boom');
    });
  });

  // ---- Invocation result --------------------------------------------------

  describe('invocation result', () => {
    it('includes trigger events', async () => {
      const runtime = new WorkflowRuntime(() => {}, { executor: noopExecutor });
      const events = [makeEvent('a'), makeEvent('b')];
      const { result } = await runtime.processEvents(events, {});

      expect(result.triggerEvents).toEqual(events);
    });

    it('reports zero cycles when no events match any rule', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('r', 'test', (e) => e.type === 'never', () => {});
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('x')], {});

      // One cycle was attempted, even though no rules fired.
      expect(result.cycles).toBe(1);
    });

    it('tracks durationMs', async () => {
      const definition: WorkflowDefinition<{}> = (wf) => {
        wf.rule('slow', 'Slow', () => true, async () => {
          await new Promise(r => setTimeout(r, 10));
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { result } = await runtime.processEvents([makeEvent('x')], {});

      expect(result.durationMs).toBeGreaterThanOrEqual(10);
    });
  });

  // ---- Integration: project:initialize -----------------------------------

  describe('project:initialize flow', () => {
    it('initializes state on first invocation', async () => {
      interface S { status: string; items: string[] }

      const definition: WorkflowDefinition<S> = (wf) => {
        wf.rule('project:init', 'Initialize', (e) => e.type === 'project:initialize', (_e, state) => {
          state.status = 'ready';
          state.items = [];
        });
      };

      const runtime = new WorkflowRuntime(definition, { executor: noopExecutor });
      const { state } = await runtime.processEvents(
        [makeEvent('project:initialize')],
        { status: '', items: [] } as S,
      );

      expect(state.status).toBe('ready');
      expect(state.items).toEqual([]);
    });
  });
});
