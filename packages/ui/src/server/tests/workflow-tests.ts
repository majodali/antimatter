/**
 * Workflow Functional Tests
 *
 * Exercises the workflow engine integration on a running EC2 workspace:
 *   write definition → reload → emit events → verify state → file triggers → persistence → auto-reload
 *
 * These tests run as part of the 'workspace' suite — they require a running
 * workspace container with the workflow router mounted. They use the shared
 * `ctx.__wsProjectId` from the workspace lifecycle tests.
 */

import type { TestDef } from './test-types.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Get workflow functional tests.
 * @param albDns  The ALB DNS hostname (e.g. Antima-Works-xxx.us-west-2.elb.amazonaws.com)
 */
export function getWorkflowTests(albDns: string): TestDef[] {
  /** Build the workspace container base URL from the shared context. */
  const wsUrl = (ctx: Record<string, string>) =>
    `http://${albDns}/${ctx.__wsProjectId}`;

  return [
    // ---- 1. Write a workflow definition ----
    {
      name: 'WF: Write Workflow Definition',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);
        const workflowSource = `
import { defineWorkflow } from '@antimatter/workflow';

interface TestState {
  initialized: boolean;
  fileChangeCount: number;
  lastChangedFile: string;
  echoOutput: string;
}

export default defineWorkflow((wf) => {
  wf.rule('project:init', 'Initialize test state',
    (e) => e.type === 'project:initialize',
    (_events, state) => {
      state.initialized = true;
      state.fileChangeCount = 0;
      state.lastChangedFile = '';
      state.echoOutput = '';
    },
  );

  wf.rule('track-changes', 'Track file changes',
    (e) => e.type === 'file:change',
    (events, state) => {
      state.fileChangeCount += events.length;
      state.lastChangedFile = String(events[events.length - 1].path);
    },
  );

  wf.rule('echo-test', 'Echo test via exec',
    (e) => e.type === 'workflow:echo-test',
    async (_events, state) => {
      const result = await wf.exec('echo hello-workflow');
      state.echoOutput = result.stdout.trim();
      wf.log('Echo test completed');
    },
  );

  wf.rule('chain-start', 'Start a chain',
    (e) => e.type === 'workflow:chain',
    (_events, _state) => {
      wf.emit({ type: 'workflow:chain-step-2' });
    },
  );

  wf.rule('chain-end', 'End a chain',
    (e) => e.type === 'workflow:chain-step-2',
    (_events, state) => {
      state.echoOutput = 'chain-complete';
    },
  );
});
`;
        const res = await fetch(`${base}/api/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '.antimatter/workflow.ts', content: workflowSource }),
        });
        return { pass: res.ok, detail: res.ok ? 'Workflow definition written' : `${res.status}` };
      },
    },

    // ---- 2. Reload workflow (triggers project:initialize) ----
    {
      name: 'WF: Reload and Initialize',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);
        const res = await fetch(`${base}/api/workflow/reload`, { method: 'POST' });
        if (!res.ok) return { pass: false, detail: `Reload failed: ${res.status}` };

        await sleep(500);

        const stateRes = await fetch(`${base}/api/workflow/state`);
        const body = await stateRes.json();
        const ok = body?.state?.initialized === true && body.version === 1;
        return {
          pass: ok,
          detail: ok
            ? `initialized=${body.state.initialized}, version=${body.version}`
            : `Unexpected state: ${JSON.stringify(body).substring(0, 200)}`,
        };
      },
    },

    // ---- 3. Emit a custom event that runs exec ----
    {
      name: 'WF: Emit Event with Exec',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);
        const res = await fetch(`${base}/api/workflow/emit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: { type: 'workflow:echo-test' } }),
        });
        const body = await res.json();

        const ruleExecuted = body.result?.rulesExecuted?.some(
          (r: any) => r.ruleId === 'echo-test' && !r.error,
        );

        const stateRes = await fetch(`${base}/api/workflow/state`);
        const state = await stateRes.json();
        const ok = ruleExecuted && state?.state?.echoOutput === 'hello-workflow';

        return {
          pass: ok,
          detail: ok
            ? `echoOutput="${state.state.echoOutput}", logs=${body.result?.logs?.length}`
            : `ruleExecuted=${ruleExecuted}, echoOutput="${state?.state?.echoOutput}"`,
        };
      },
    },

    // ---- 4. Multi-cycle event chain ----
    {
      name: 'WF: Multi-Cycle Chain',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);
        const res = await fetch(`${base}/api/workflow/emit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: { type: 'workflow:chain' } }),
        });
        const body = await res.json();

        const stateRes = await fetch(`${base}/api/workflow/state`);
        const state = await stateRes.json();

        const ok = body.result?.cycles >= 2 && state?.state?.echoOutput === 'chain-complete';
        return {
          pass: ok,
          detail: ok
            ? `cycles=${body.result.cycles}, echoOutput="${state.state.echoOutput}"`
            : `cycles=${body.result?.cycles}, echoOutput="${state?.state?.echoOutput}"`,
        };
      },
    },

    // ---- 5. File change triggers workflow ----
    {
      name: 'WF: File Change Triggers Rule',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);

        // Reload to get clean state with fileChangeCount=0
        await fetch(`${base}/api/workflow/reload`, { method: 'POST' });
        await sleep(500);

        // Write a file to trigger file:change event
        const writeRes = await fetch(`${base}/api/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: 'test-trigger.txt', content: 'trigger-' + Date.now() }),
        });
        if (!writeRes.ok) return { pass: false, detail: 'File write failed' };

        // Wait for debounce (300ms) + processing
        await sleep(2000);

        const stateRes = await fetch(`${base}/api/workflow/state`);
        const state = await stateRes.json();

        const ok = state?.state?.fileChangeCount > 0;
        return {
          pass: ok,
          detail: ok
            ? `fileChangeCount=${state.state.fileChangeCount}, lastChangedFile="${state.state.lastChangedFile}"`
            : `fileChangeCount=${state?.state?.fileChangeCount}`,
        };
      },
    },

    // ---- 6. State persists to file ----
    {
      name: 'WF: State Persistence',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);
        const fileRes = await fetch(
          `${base}/api/files/read?path=${encodeURIComponent('.antimatter/workflow-state.json')}`,
        );
        if (!fileRes.ok) return { pass: false, detail: `Read failed: ${fileRes.status}` };

        const fileBody = await fileRes.json();
        let persisted: any;
        try {
          persisted = JSON.parse(fileBody.content);
        } catch {
          return { pass: false, detail: `Invalid JSON in state file` };
        }

        const ok =
          persisted.version === 1 &&
          persisted.state?.initialized === true &&
          typeof persisted.updatedAt === 'string';

        return {
          pass: ok,
          detail: ok
            ? `version=${persisted.version}, updatedAt=${persisted.updatedAt}`
            : `Persisted: ${JSON.stringify(persisted).substring(0, 200)}`,
        };
      },
    },

    // ---- 7. No-match event completes without error ----
    {
      name: 'WF: No-Match Event',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);
        const res = await fetch(`${base}/api/workflow/emit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: { type: 'nonexistent:event' } }),
        });
        const body = await res.json();

        const ok = res.ok && (body.result?.rulesExecuted?.length === 0 || body.result === null);
        return {
          pass: ok,
          detail: ok
            ? `No rules executed for unknown event type`
            : `${res.status}: ${JSON.stringify(body).substring(0, 200)}`,
        };
      },
    },

    // ---- 8. Auto-reload on definition file change ----
    {
      name: 'WF: Auto-Reload on Definition Change',
      suite: 'workspace',
      run: async (ctx) => {
        const base = wsUrl(ctx);

        // Write a new workflow definition with an additional rule
        const updatedSource = `
import { defineWorkflow } from '@antimatter/workflow';

interface TestState {
  initialized: boolean;
  fileChangeCount: number;
  lastChangedFile: string;
  echoOutput: string;
  autoReloadWorked: boolean;
}

export default defineWorkflow((wf) => {
  wf.rule('project:init', 'Initialize test state',
    (e) => e.type === 'project:initialize',
    (_events, state) => {
      state.initialized = true;
      state.fileChangeCount = 0;
      state.lastChangedFile = '';
      state.echoOutput = '';
      state.autoReloadWorked = false;
    },
  );

  wf.rule('track-changes', 'Track file changes',
    (e) => e.type === 'file:change',
    (events, state) => {
      state.fileChangeCount += events.length;
      state.lastChangedFile = String(events[events.length - 1].path);
    },
  );

  wf.rule('auto-reload-verify', 'Verify auto-reload',
    (e) => e.type === 'workflow:auto-reload-check',
    (_events, state) => {
      state.autoReloadWorked = true;
    },
  );
});
`;

        // Write the updated definition — should trigger auto-reload
        const writeRes = await fetch(`${base}/api/files/write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: '.antimatter/workflow.ts', content: updatedSource }),
        });
        if (!writeRes.ok) return { pass: false, detail: 'Failed to write updated definition' };

        // Wait for debounce (500ms) + reload processing
        await sleep(3000);

        // Emit the new event type — if auto-reload worked, the new rule will fire
        const emitRes = await fetch(`${base}/api/workflow/emit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ event: { type: 'workflow:auto-reload-check' } }),
        });
        const emitBody = await emitRes.json();

        const ruleExecuted = emitBody.result?.rulesExecuted?.some(
          (r: any) => r.ruleId === 'auto-reload-verify' && !r.error,
        );

        const stateRes = await fetch(`${base}/api/workflow/state`);
        const state = await stateRes.json();
        const ok = ruleExecuted && state?.state?.autoReloadWorked === true;

        return {
          pass: ok,
          detail: ok
            ? `Auto-reload verified: autoReloadWorked=${state.state.autoReloadWorked}`
            : `ruleExecuted=${ruleExecuted}, autoReloadWorked=${state?.state?.autoReloadWorked}`,
        };
      },
    },
  ];
}
