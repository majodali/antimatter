# Antimatter Feature Demos

Step-by-step walkthroughs for demoing new functionality against the live deployment at
`https://d33wyunpiwy2df.cloudfront.net`.

---

## Build System (Items 1.1–1.6)

### Prerequisites
- Open the app in your browser
- Create or select a project from the sidebar

### 1. Configure a Build

1. Click the **Build** tab in the right sidebar (hammer icon).
2. Under **Rules**, click **Add Rule**:
   - **ID:** `compile-ts`
   - **Command:** `echo "Compiling TypeScript..."`
   - Click **Save**.
3. Under **Targets**, click **Add Target**:
   - **ID:** `app`
   - **Rule:** select `compile-ts`
   - **Inputs:** `src/index.ts` (type it in)
   - **Outputs:** `dist/index.js`
   - Click **Save**.
4. The config is persisted to `.antimatter/build.json`. Reload the page — the rule and target are still there.

### 2. Run a Build (Streaming Output)

1. Click the **Run Build** button.
2. Watch the terminal panel at the bottom — build progress events stream in real-time via SSE:
   - `target-started` for `app`
   - `target-output` lines
   - `target-completed` with status and duration
   - `build-complete` summary
3. The **Build Results** section updates showing pass/fail per target.

### 3. Parallel Execution

1. Add a second target (`lib`, rule `compile-ts`, input `src/lib.ts`, output `dist/lib.js`).
2. Run the build again — both `app` and `lib` execute concurrently (you'll see interleaved output).

### 4. Incremental Builds

1. Run the build a second time without changing any files.
2. Targets with unchanged inputs are skipped (cached). You'll see `status: "cached"` in the results.
3. Edit one of the input files (e.g. `src/index.ts`), run build again — only the affected target rebuilds.

### 5. Watch Mode

1. Click the **Watch** toggle in the build panel.
2. Edit and save a source file listed as a target input.
3. The build automatically re-runs for affected targets.

### 6. Diagnostics Overlay

1. Create a build rule with a command that produces diagnostic-style output.
2. After a build with errors, open the file referenced in a diagnostic.
3. Red/yellow squiggles appear inline in the Monaco editor at the reported line/column.
4. Hover over a squiggle to see the error message.

---

## Agent Integration (Items 2.1–2.7)

### Prerequisites
- Open the app at `https://d33wyunpiwy2df.cloudfront.net`
- The chat panel is in the right sidebar (speech bubble icon)
- Without an Anthropic API key, the agent uses a mock provider that returns
  `"Mock response"`. To test real streaming, set the `ANTHROPIC_API_KEY`
  environment variable in the Lambda configuration.

### 1. Streaming Responses (2.1)

**What it does:** Assistant tokens stream into the chat progressively instead of appearing all at once.

1. Open the **AI Chat** panel in the right sidebar.
2. Type a message (e.g. `"Hello"`) and press Enter.
3. Observe:
   - A bouncing-dots typing indicator appears briefly.
   - The assistant message appears and text fills in progressively (word by word with the mock provider; token by token with Claude).
   - The message is complete once the typing indicator disappears.

**With the mock provider** the streaming is simulated word-by-word. With a real API key, you'd see actual Anthropic streaming.

### 2. Cancel / Interrupt (2.7)

**What it does:** Stop a running agent turn mid-stream.

1. Send a message to the agent.
2. While the response is streaming, notice the Send button has been replaced by a red **Stop** button (square icon).
3. Click the Stop button.
4. The streaming message ends with *[Cancelled]* and the agent stops processing.
5. The input is re-enabled — you can send a new message immediately.

### 3. Inline Code Actions (2.2)

**What it does:** Right-click on selected code in the editor to send it to the AI chat.

1. Open any file in the editor (e.g. create a file `demo.ts` with some code).
2. Select a block of code by clicking and dragging.
3. Right-click on the selection to open the context menu.
4. You'll see three new entries at the bottom:
   - **AI: Fix this code**
   - **AI: Explain this code**
   - **AI: Refactor this code**
5. Click one (e.g. "AI: Explain this code").
6. The chat panel receives a message like:
   ```
   Explain the following code:

   File: demo.ts (lines 1-5)
   ```ts
   const x = 42;
   ```
   ```
7. The agent processes it and responds.

### 4. Agent-Driven Builds (2.3)

**What it does:** The agent can trigger builds and read diagnostics using tools.

1. First, configure a build (see Build System demo above).
2. In the chat, type: `"Run the build and tell me the results"`
3. The agent uses the `runBuild` tool — you'll see:
   > Using tool: **runBuild**
4. The agent reports back the build results (targets, statuses, durations, any diagnostics).
5. Try: `"What were the diagnostics from the last build?"`
6. The agent uses `getBuildDiagnostics` to retrieve and display them.

### 5. Custom Tool Definitions (2.4)

**What it does:** Define project-specific tools the agent can invoke.

1. Create a file `.antimatter/tools.json` in your project with this content:
   ```json
   {
     "tools": [
       {
         "name": "formatCode",
         "description": "Run the code formatter",
         "command": "echo 'Formatting complete!'",
         "parameters": []
       },
       {
         "name": "runScript",
         "description": "Run a named script",
         "command": "echo Running {{scriptName}}...",
         "parameters": [
           {
             "name": "scriptName",
             "type": "string",
             "description": "Script name to run",
             "required": true
           }
         ]
       }
     ]
   }
   ```
2. The tools are loaded on the next chat message.
3. You can also manage tools via the API:
   - `GET /api/agent/tools` — list current tool definitions
   - `PUT /api/agent/tools` — update tool definitions

### 6. Persistent Memory (2.5)

**What it does:** The agent remembers facts across conversations and page reloads.

1. In the chat, the agent can use the `remember` tool to store key-value pairs.
2. These are saved to `.antimatter/agent-memory.json` after each chat turn.
3. On the next chat (even after a page reload or Lambda cold start), the memory is loaded back.
4. Check the memory file:
   - Read `.antimatter/agent-memory.json` in the file explorer.
   - You'll see `workingMemory` with the stored key-value pairs and a `lastUpdated` timestamp.

### 7. Multi-Agent Orchestration (2.6)

**What it does:** Specialized agents (implementer, reviewer, tester) hand off to each other.

> **Note:** This feature requires a real Anthropic API key. With the mock provider,
> only the single implementer agent is used.

1. With an API key configured, send a complex request like:
   `"Review the code in src/index.ts and suggest improvements"`
2. The implementer may respond and signal `[HANDOFF:reviewer]`.
3. You'll see a system message: `Agent handoff: implementer → reviewer`
4. The reviewer agent takes over — its messages show an **amber "reviewer" badge**.
5. If the reviewer finds issues needing fixes, it may hand off to `[HANDOFF:implementer]`.
6. Agent role badges:
   - **Blue** — implementer
   - **Amber** — reviewer
   - **Green** — tester
7. Maximum 2 handoffs per turn (Lambda timeout constraint).

---

## Smoke Tests

Verify everything works end-to-end:

```bash
curl -s -X POST https://d33wyunpiwy2df.cloudfront.net/api/tests/run | jq .summary
```

Expected output:
```json
{
  "total": 20,
  "passed": 20,
  "failed": 0
}
```
