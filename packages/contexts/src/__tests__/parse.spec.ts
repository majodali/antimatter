/**
 * Parse + validate tests for @antimatter/contexts.
 *
 * Covers:
 *   - Basic indent-based parsing of work / runtime contexts
 *   - description optional vs. quoted
 *   - `targets` and `depends` lines synthesized into edges
 *   - Cross-kind validation (work→runtime for targets, work→work for depends)
 *   - Self-reference and depends_on cycles
 *   - Unresolved name references
 *   - Multiple top-level contexts (multiple-roots) and no roots
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import {
  parseContexts,
  validateContexts,
  CONTEXT_NODE_TYPE,
  REFERENCE_NODE_TYPE,
  EDGE_CONTAINS,
  EDGE_DEPENDS_ON,
  EDGE_TARGETS,
  KIND_WORK,
  KIND_RUNTIME,
} from '../index.js';

// Helper: collect all Context nodes by name.
function contextsByName(model: import('simple-modeling').Model): Map<string, import('simple-modeling').Node> {
  const out = new Map<string, import('simple-modeling').Node>();
  for (const node of model.nodes.values()) {
    if (node.type === CONTEXT_NODE_TYPE && node.name) out.set(node.name, node);
  }
  return out;
}

// Helper: count edges of a given type.
function edgeCount(model: import('simple-modeling').Model, type: string): number {
  let n = 0;
  for (const e of model.edges.values()) if (e.type === type) n++;
  return n;
}

describe('parseContexts — basic shapes', () => {
  it('parses a single root work context with description', () => {
    const text = 'work antimatter "Antimatter IDE"\n';
    const { model, unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences).toEqual([]);

    const ctx = contextsByName(model);
    expect(ctx.size).toBe(1);
    const root = ctx.get('antimatter')!;
    expect(root.properties.kind).toBe(KIND_WORK);
    expect(root.properties.description).toBe('Antimatter IDE');
  });

  it('parses a context with no description', () => {
    const text = 'work foo\n';
    const { model } = parseContexts(text);
    const ctx = contextsByName(model);
    const node = ctx.get('foo')!;
    expect(node.properties.kind).toBe(KIND_WORK);
    expect(node.properties.description).toBe(undefined);
  });

  it('parses runtime contexts (with and without description)', () => {
    const text = `work root "Root"
  runtime production
  runtime staging "Staging env"
`;
    const { model } = parseContexts(text);
    const ctx = contextsByName(model);
    expect(ctx.get('production')!.properties.kind).toBe(KIND_RUNTIME);
    expect(ctx.get('production')!.properties.description).toBe(undefined);
    expect(ctx.get('staging')!.properties.kind).toBe(KIND_RUNTIME);
    expect(ctx.get('staging')!.properties.description).toBe('Staging env');
  });

  it('builds nested containment edges from indentation', () => {
    const text = `work root "Root"
  work child-a "A"
    work grandchild "GC"
  work child-b "B"
`;
    const { model } = parseContexts(text);
    expect(edgeCount(model, EDGE_CONTAINS)).toBe(3); // root→A, root→B, A→GC

    const root = contextsByName(model).get('root')!;
    const childrenOfRoot = model.edgesFrom(root.id, EDGE_CONTAINS).map(e => model.getNode(e.target).name);
    expect(childrenOfRoot.sort()).toEqual(['child-a', 'child-b']);
  });
});

describe('parseContexts — targets / depends lines', () => {
  it('synthesizes a targets edge from `targets X`', () => {
    const text = `work root "Root"
  work feature "F"
    targets staging
  runtime staging "Staging"
`;
    const { model, unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences).toEqual([]);

    // Intermediate _Reference nodes should be gone after post-process.
    let refCount = 0;
    for (const n of model.nodes.values()) if (n.type === REFERENCE_NODE_TYPE) refCount++;
    expect(refCount).toBe(0);

    expect(edgeCount(model, EDGE_TARGETS)).toBe(1);
    const ctx = contextsByName(model);
    const targets = model.edgesFrom(ctx.get('feature')!.id, EDGE_TARGETS);
    expect(targets.length).toBe(1);
    expect(model.getNode(targets[0].target).name).toBe('staging');
  });

  it('synthesizes a depends_on edge from `depends Y`', () => {
    const text = `work root "Root"
  work feature "F"
    depends shared
  work shared "S"
`;
    const { model, unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences).toEqual([]);

    expect(edgeCount(model, EDGE_DEPENDS_ON)).toBe(1);
    const ctx = contextsByName(model);
    const deps = model.edgesFrom(ctx.get('feature')!.id, EDGE_DEPENDS_ON);
    expect(deps.length).toBe(1);
    expect(model.getNode(deps[0].target).name).toBe('shared');
  });

  it('reports unresolved targets/depends references', () => {
    const text = `work root "Root"
  work feature "F"
    targets nonexistent-runtime
    depends nonexistent-work
`;
    const { model, unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences.length).toBe(2);
    expect(unresolvedReferences.map(r => r.toName).sort()).toEqual(['nonexistent-runtime', 'nonexistent-work']);
    // Edges should NOT have been added.
    expect(edgeCount(model, EDGE_TARGETS)).toBe(0);
    expect(edgeCount(model, EDGE_DEPENDS_ON)).toBe(0);
  });
});

describe('parseContexts — full antimatter-style example', () => {
  it('parses the canonical example end-to-end', () => {
    const text = `work antimatter "Antimatter IDE"
  work feature-dark-mode "Add dark mode support"
    targets staging
    depends theme-system
  work theme-system "Refactor theme system"
  runtime staging "Staging deployment env"
  runtime production
`;
    const { model, unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences).toEqual([]);

    const ctx = contextsByName(model);
    expect([...ctx.keys()].sort()).toEqual([
      'antimatter', 'feature-dark-mode', 'production', 'staging', 'theme-system',
    ]);

    // 4 contains edges: antimatter contains all 4 children
    expect(edgeCount(model, EDGE_CONTAINS)).toBe(4);
    // 1 targets edge (feature → staging)
    expect(edgeCount(model, EDGE_TARGETS)).toBe(1);
    // 1 depends_on edge (feature → theme-system)
    expect(edgeCount(model, EDGE_DEPENDS_ON)).toBe(1);

    // Validate clean.
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors).toEqual([]);
  });
});

describe('validateContexts — cross-kind constraints', () => {
  it('rejects targets pointing at a work context', () => {
    const text = `work root "R"
  work feature "F"
    targets shared
  work shared "S"
`;
    const { model, unresolvedReferences } = parseContexts(text);
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors.some(e => e.code === 'targets-target-kind')).toBe(true);
  });

  it('rejects depends pointing at a runtime context', () => {
    const text = `work root "R"
  work feature "F"
    depends prod
  runtime prod "Prod"
`;
    const { model, unresolvedReferences } = parseContexts(text);
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors.some(e => e.code === 'depends-target-kind')).toBe(true);
  });

  it('rejects self-reference on depends', () => {
    const text = `work root "R"
  work feature "F"
    depends feature
`;
    const { model, unresolvedReferences } = parseContexts(text);
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors.some(e => e.code === 'self-reference')).toBe(true);
  });

  it('detects cycles in depends_on', () => {
    const text = `work root "R"
  work a "A"
    depends b
  work b "B"
    depends c
  work c "C"
    depends a
`;
    const { model, unresolvedReferences } = parseContexts(text);
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors.some(e => e.code === 'depends-cycle')).toBe(true);
  });

  it('allows a clean depends DAG without false cycle reports', () => {
    const text = `work root "R"
  work a "A"
    depends b
    depends c
  work b "B"
    depends c
  work c "C"
`;
    const { model, unresolvedReferences } = parseContexts(text);
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors).toEqual([]);
  });
});

describe('validateContexts — root structure', () => {
  it('flags multiple top-level contexts', () => {
    const text = `work one "1"
work two "2"
`;
    const { model, unresolvedReferences } = parseContexts(text);
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors.some(e => e.code === 'multiple-roots')).toBe(true);
  });

  it('flags an empty document (no roots)', () => {
    const text = '';
    const { model, unresolvedReferences } = parseContexts(text);
    const errors = validateContexts(model, unresolvedReferences);
    expect(errors.some(e => e.code === 'no-root')).toBe(true);
  });
});
