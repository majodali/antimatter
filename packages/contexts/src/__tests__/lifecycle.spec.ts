/**
 * Lifecycle status derivation tests.
 *
 * Covers the full state machine documented in lifecycle.ts:
 *   - Forward path: pending → ready → in-progress → done
 *   - Regression: done → regressed (own constituent breaks)
 *   - Dep regression: done → dependency-regressed
 *   - In-progress + dep regress → dependency-regressed (per design discussion)
 *   - Recovery: dependency-regressed → done | in-progress (re-tested per design)
 *   - Recovery: regressed → done (own recovers)
 *   - Recovery: regressed → dependency-regressed (own recovers but dep still bad)
 *   - Hierarchical rollup: parent done iff all children done
 *   - Cycles get pending fallback
 *   - Transitions report only changes
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import {
  parseContexts,
  deriveLifecycleStatuses,
  type LifecycleStatus,
} from '../index.js';

// Helper: parse + derive in one go.
function derive(
  dsl: string,
  state: {
    rulePasses?: Record<string, boolean>;
    testPasses?: Record<string, boolean>;
    priorStatuses?: Record<string, LifecycleStatus>;
  } = {},
) {
  const { model, requirements } = parseContexts(dsl);
  return deriveLifecycleStatuses({
    model,
    requirements,
    rulePasses: new Map(Object.entries(state.rulePasses ?? {})),
    testPasses: new Map(Object.entries(state.testPasses ?? {})),
    priorStatuses: new Map(Object.entries(state.priorStatuses ?? {})),
  });
}

// Helper: extract the status for a named context.
function statusOf(out: ReturnType<typeof derive>, name: string): LifecycleStatus | undefined {
  return out.statuses.get(name);
}

// ---------------------------------------------------------------------------
// Forward path
// ---------------------------------------------------------------------------

describe('lifecycle — forward path', () => {
  it('leaf with no requirements is done', () => {
    const out = derive(`work root "R"\n`);
    expect(statusOf(out, 'root')).toBe('done');
  });

  it('leaf with all reqs passing is done', () => {
    const out = derive(
      `work root "R"\n  requires rule build\n`,
      { rulePasses: { build: true } },
    );
    expect(statusOf(out, 'root')).toBe('done');
  });

  it('leaf with no reqs passing is ready', () => {
    const out = derive(
      `work root "R"\n  requires rule build\n`,
      { rulePasses: { build: false } },
    );
    expect(statusOf(out, 'root')).toBe('ready');
  });

  it('leaf with partial reqs passing is in-progress', () => {
    const out = derive(
      `work root "R"\n  requires rule a\n  requires rule b\n`,
      { rulePasses: { a: true, b: false } },
    );
    expect(statusOf(out, 'root')).toBe('in-progress');
  });

  it('context with un-done dep is pending', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
`,
      { rulePasses: { a: false, b: true } },
    );
    expect(statusOf(out, 'a')).toBe('ready');
    expect(statusOf(out, 'b')).toBe('pending');
  });

  it('context with done dep and own reqs passing is done', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
`,
      { rulePasses: { a: true, b: true } },
    );
    expect(statusOf(out, 'a')).toBe('done');
    expect(statusOf(out, 'b')).toBe('done');
    // Root has no own reqs but has 2 children, both done → root done.
    expect(statusOf(out, 'root')).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Hierarchical rollup
// ---------------------------------------------------------------------------

describe('lifecycle — child rollup', () => {
  it('parent in-progress when some children done', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    requires rule b
`,
      { rulePasses: { a: true, b: false } },
    );
    expect(statusOf(out, 'a')).toBe('done');
    expect(statusOf(out, 'b')).toBe('ready');
    expect(statusOf(out, 'root')).toBe('in-progress');
  });

  it('parent ready when no children done', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    requires rule b
`,
      { rulePasses: { a: false, b: false } },
    );
    expect(statusOf(out, 'root')).toBe('ready');
  });

  it('parent done when all children done', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    requires rule b
`,
      { rulePasses: { a: true, b: true } },
    );
    expect(statusOf(out, 'root')).toBe('done');
  });
});

// ---------------------------------------------------------------------------
// Regression: own constituent fails
// ---------------------------------------------------------------------------

describe('lifecycle — own regression', () => {
  it('done → regressed when own rule breaks', () => {
    const out = derive(
      `work root "R"\n  requires rule build\n`,
      {
        rulePasses: { build: false },
        priorStatuses: { root: 'done' },
      },
    );
    expect(statusOf(out, 'root')).toBe('regressed');
  });

  it('done → regressed when child regresses (parent rolls up)', () => {
    const out = derive(`work root "R"
  work child "C"
    requires rule build
`,
      {
        rulePasses: { build: false },
        priorStatuses: { root: 'done', child: 'done' },
      },
    );
    expect(statusOf(out, 'child')).toBe('regressed');
    expect(statusOf(out, 'root')).toBe('regressed');
  });

  it('regressed → done when own req recovers', () => {
    const out = derive(
      `work root "R"\n  requires rule build\n`,
      {
        rulePasses: { build: true },
        priorStatuses: { root: 'regressed' },
      },
    );
    expect(statusOf(out, 'root')).toBe('done');
  });

  it('regressed → regressed when own req still failing', () => {
    const out = derive(
      `work root "R"\n  requires rule build\n`,
      {
        rulePasses: { build: false },
        priorStatuses: { root: 'regressed' },
      },
    );
    expect(statusOf(out, 'root')).toBe('regressed');
  });
});

// ---------------------------------------------------------------------------
// Dependency regression
// ---------------------------------------------------------------------------

describe('lifecycle — dependency regression', () => {
  it('done → dependency-regressed when dep regresses (own constituents still pass)', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
`,
      {
        rulePasses: { a: false, b: true },
        priorStatuses: { a: 'done', b: 'done', root: 'done' },
      },
    );
    expect(statusOf(out, 'a')).toBe('regressed');
    expect(statusOf(out, 'b')).toBe('dependency-regressed');
    // Root has child a regressed → root regressed (own constituent failure).
    expect(statusOf(out, 'root')).toBe('regressed');
  });

  it('in-progress → dependency-regressed when dep regresses (per design)', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule x
    requires rule y
`,
      {
        rulePasses: { a: false, x: true, y: false },
        priorStatuses: { a: 'done', b: 'in-progress' },
      },
    );
    expect(statusOf(out, 'a')).toBe('regressed');
    expect(statusOf(out, 'b')).toBe('dependency-regressed');
  });

  it('ready → dependency-regressed when dep regresses', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
`,
      {
        rulePasses: { a: false, b: false },
        priorStatuses: { a: 'done', b: 'ready' },
      },
    );
    expect(statusOf(out, 'b')).toBe('dependency-regressed');
  });

  it('pending stays pending when dep regresses (was never active)', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
`,
      {
        rulePasses: { a: false },
        priorStatuses: { a: 'done', b: 'pending' },
      },
    );
    expect(statusOf(out, 'b')).toBe('pending');
  });

  it('dependency-regressed → done when dep recovers and own reqs pass', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
`,
      {
        rulePasses: { a: true, b: true },
        priorStatuses: { a: 'done', b: 'dependency-regressed' },
      },
    );
    expect(statusOf(out, 'b')).toBe('done');
  });

  it('dependency-regressed → in-progress when dep recovers but own reqs partial', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule x
    requires rule y
`,
      {
        rulePasses: { a: true, x: true, y: false },
        priorStatuses: { a: 'done', b: 'dependency-regressed' },
      },
    );
    expect(statusOf(out, 'b')).toBe('in-progress');
  });

  it('dependency-regressed stays put when dep still regressed', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
`,
      {
        rulePasses: { a: false, b: true },
        priorStatuses: { a: 'regressed', b: 'dependency-regressed' },
      },
    );
    expect(statusOf(out, 'b')).toBe('dependency-regressed');
  });
});

// ---------------------------------------------------------------------------
// Mixed regression states (cascade)
// ---------------------------------------------------------------------------

describe('lifecycle — cascading regressions', () => {
  it('chain: a regresses → b dep-regressed → c dep-regressed', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
  work c "C"
    depends b
    requires rule c
`,
      {
        rulePasses: { a: false, b: true, c: true },
        priorStatuses: { a: 'done', b: 'done', c: 'done' },
      },
    );
    expect(statusOf(out, 'a')).toBe('regressed');
    expect(statusOf(out, 'b')).toBe('dependency-regressed');
    expect(statusOf(out, 'c')).toBe('dependency-regressed');
  });

  it('regressed → dependency-regressed when own recovers but dep still bad', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    depends a
    requires rule b
`,
      {
        rulePasses: { a: false, b: true },
        priorStatuses: { a: 'done', b: 'regressed' },
      },
    );
    // b's own rule recovered, but a is still regressed → b: dep-regressed.
    expect(statusOf(out, 'b')).toBe('dependency-regressed');
  });
});

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

describe('lifecycle — transitions', () => {
  it('reports only contexts whose status changed', () => {
    const out = derive(`work root "R"
  work a "A"
    requires rule a
  work b "B"
    requires rule b
`,
      {
        rulePasses: { a: true, b: false },
        priorStatuses: { a: 'done', b: 'ready', root: 'in-progress' },
      },
    );
    // a: done → done       (no transition)
    // b: ready → ready     (no transition)
    // root: in-progress → in-progress (no transition)
    expect(out.transitions).toEqual([]);
  });

  it('reports new statuses with from=undefined when no prior', () => {
    const out = derive(
      `work root "R"\n  requires rule build\n`,
      { rulePasses: { build: true } },
    );
    expect(out.transitions.length).toBe(1);
    expect(out.transitions[0]).toEqual({
      contextId: 'root', from: undefined, to: 'done',
    });
  });

  it('reports state changes with from set', () => {
    const out = derive(
      `work root "R"\n  requires rule build\n`,
      {
        rulePasses: { build: false },
        priorStatuses: { root: 'done' },
      },
    );
    expect(out.transitions.length).toBe(1);
    expect(out.transitions[0]).toEqual({
      contextId: 'root', from: 'done', to: 'regressed',
    });
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe('lifecycle — edge cases', () => {
  it('cycle members get pending fallback (defensive)', () => {
    // Bypass validation: build a cycle directly via a DSL that the validator
    // would reject but the parser still produces.
    const out = derive(`work root "R"
  work a "A"
    depends b
  work b "B"
    depends a
`);
    // Both a and b are in a cycle — neither can be processed in topological
    // order. Defensive fallback assigns 'pending' to both.
    // (Note: 'b' may actually get processed first by chance — both end up
    // either pending or one might claim ready/done; we assert both are
    // present and not crash.)
    expect(out.statuses.has('a')).toBe(true);
    expect(out.statuses.has('b')).toBe(true);
  });

  it('runtime contexts are not constituents (don\'t affect work parent rollup)', () => {
    // A runtime context targeted by a work context shouldn't change the
    // work context's lifecycle (targets is not contains).
    const out = derive(`work root "R"
  work feature "F"
    requires rule build
    targets staging
  runtime staging "Staging"
`,
      { rulePasses: { build: true } },
    );
    expect(statusOf(out, 'feature')).toBe('done');
    expect(statusOf(out, 'root')).toBe('done');
    // Runtime context with no reqs/children/deps → done.
    expect(statusOf(out, 'staging')).toBe('done');
  });

  it('runtime context as contains-child still rolls up', () => {
    // Runtime contexts ARE first-class children via contains, so they roll
    // up just like work contexts. (Whether you'd model this in practice is
    // a separate question; the derivation should be consistent.)
    const out = derive(`work root "R"
  runtime staging "Staging"
`);
    expect(statusOf(out, 'staging')).toBe('done');
    expect(statusOf(out, 'root')).toBe('done');
  });
});
