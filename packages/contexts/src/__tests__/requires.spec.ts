/**
 * Tests for `requires rule X` / `requires test X` parsing.
 *
 * Verifies:
 *  - lines parse into the per-context requirements map
 *  - intermediate `_Reference` nodes get cleaned up (zero leftovers)
 *  - synthesized edges (targets/depends) and requirements coexist
 *  - missing rule/test ids do NOT show up as unresolvedReferences
 *    (those are validated downstream where the rule/test catalog exists)
 */
import { describe, it } from 'node:test';
import { expect } from '@antimatter/test-utils';
import { parseContexts, REFERENCE_NODE_TYPE } from '../index.js';

describe('parseContexts — requires lines', () => {
  it('collects rule and test requirements per context', () => {
    const text = `work root "R"
  work feature "F"
    requires rule build:full
    requires test FT-M3-001
    requires test FT-M3-002
  work other "O"
    requires rule deploy:promote
`;
    const { model, requirements, unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences).toEqual([]);

    // No leftover _Reference nodes after post-process.
    let refCount = 0;
    for (const n of model.nodes.values()) if (n.type === REFERENCE_NODE_TYPE) refCount++;
    expect(refCount).toBe(0);

    const featureReqs = requirements.get('feature') ?? [];
    expect(featureReqs.length).toBe(3);
    expect(featureReqs.map(r => `${r.kind}:${r.id}`).sort()).toEqual([
      'rule:build:full', 'test:FT-M3-001', 'test:FT-M3-002',
    ]);

    const otherReqs = requirements.get('other') ?? [];
    expect(otherReqs.length).toBe(1);
    expect(otherReqs[0]).toEqual({ kind: 'rule', id: 'deploy:promote' });

    // Root has no requires lines.
    expect(requirements.get('root')).toBe(undefined);
  });

  it('coexists with targets and depends', () => {
    const text = `work root "R"
  work feature "F"
    targets staging
    depends shared
    requires rule build:full
  work shared "S"
  runtime staging "Staging"
`;
    const { model, requirements, unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences).toEqual([]);

    const featureReqs = requirements.get('feature') ?? [];
    expect(featureReqs.map(r => r.id)).toEqual(['build:full']);

    // `targets` and `depends` edges should still have been synthesized.
    let targetsCount = 0;
    let dependsCount = 0;
    for (const e of model.edges.values()) {
      if (e.type === 'targets') targetsCount++;
      if (e.type === 'depends_on') dependsCount++;
    }
    expect(targetsCount).toBe(1);
    expect(dependsCount).toBe(1);
  });

  it('does not surface missing rule/test ids as unresolved', () => {
    // Validating that "no such rule" is detected happens at the integration
    // layer (where the rule catalog exists). Here we only verify the parser
    // doesn't itself emit unresolvedReferences for requires lines.
    const text = `work root "R"
  work feature "F"
    requires rule does-not-exist
    requires test also-missing
`;
    const { unresolvedReferences } = parseContexts(text);
    expect(unresolvedReferences).toEqual([]);
  });
});
