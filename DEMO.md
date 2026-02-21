# Antimatter Feature Demos

Step-by-step walkthroughs for demoing new functionality against the live deployment at
`https://d33wyunpiwy2df.cloudfront.net`.

---

## Build System (Items 1.1–1.6)

### Prerequisites
- Open the app at `https://d33wyunpiwy2df.cloudfront.net`
- Create or select a project from the sidebar

### 1. Configure a Build

1. Click the **Hammer** icon in the left sidebar icon bar to open the Build panel.
2. Click the **Settings** (gear) icon in the Build panel header to enter config mode.
3. In the **BUILD RULES** section, click the **+** button:
   - **Name:** `compile-ts`
   - **Command:** `echo "Compiling TypeScript..."` (monospace input)
   - **Input globs:** `src/**/*.ts` (comma-separated)
   - **Output globs:** `dist/**/*.js`
4. In the **BUILD TARGETS** section, click the **+** button:
   - **Target ID:** `app`
   - **Rule:** select `compile-ts` from the dropdown
   - **Module ID:** `app`
5. Click the **Save Configuration** button at the bottom.
6. The config is persisted to `.antimatter/build.json`. Reload the page — the rule and target are still there.

### 2. Run a Build (Streaming Output)

1. Click the **Play** (triangle) icon in the Build panel header to run all targets.
2. Watch the results list — each target shows a status row with:
   - A spinning **Loader** icon (yellow) while running
   - A **CheckCircle** (green) or **XCircle** (red) when complete
   - Duration displayed as `123ms` or `1.23s`
   - A colored status badge (success/failure/cached/running/pending/skipped)
3. Build output also streams to the terminal panel at the bottom of the screen.
4. A summary bar appears below the header showing total/passed/failed counts.

### 3. Parallel Execution

1. Enter config mode (gear icon) and add a second target (`lib`, rule `compile-ts`).
   - If both targets are independent, they'll execute concurrently.
   - To add a dependency, use the **Depends on** buttons that appear when multiple targets exist.
2. Save and run the build — independent targets execute in parallel (interleaved output in terminal).

### 4. Incremental Builds

1. Run the build a second time without changing any files.
2. Cached targets show a blue **Database** icon and a "cached" status badge.
3. Edit one of the input files, then run the build again — only the affected target rebuilds; the rest stay cached.

### 5. Watch Mode

1. Click the **Eye** icon in the Build panel header to enable watch mode.
   - The icon switches to **EyeOff** (primary color) and a "Watch active" label appears in the summary bar.
   - The system polls for file changes every 5 seconds.
2. Edit and save a source file that is an input to a build target.
3. The build automatically re-runs for affected targets.
4. Click the **EyeOff** icon again to disable watch mode.

### 6. Diagnostics Overlay

1. After a build with errors, expand a failed target row by clicking the **chevron** on the left.
2. Diagnostics appear below the target, color-coded by severity:
   - **Red** (left border) — errors
   - **Yellow** — warnings
   - **Blue** — info
3. Each diagnostic shows severity label, message, and a clickable **file:line:column** link.
4. Click the file link — the file opens in the editor with red/yellow squiggles at the reported location.
5. Hover over a squiggle in the editor to see the error message.

### 7. Clearing Results

1. Click the **Trash** icon in the Build panel header to clear all build results.
2. The panel returns to the empty state with placeholder text.

---

## Agent Integration (Items 2.1–2.7)

### Prerequisites
- Open the app at `https://d33wyunpiwy2df.cloudfront.net`
- The chat panel is in the left sidebar — click the **MessageSquare** icon in the icon bar
- Without an Anthropic API key, the agent uses a mock provider that returns
  `"Mock response"`. To test real streaming, set the `ANTHROPIC_API_KEY`
  environment variable in the Lambda configuration.

### 1. Streaming Responses (2.1)

**What it does:** Assistant tokens stream into the chat progressively instead of appearing all at once.

1. Click the **MessageSquare** icon in the left sidebar icon bar to open the AI Chat panel.
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
