# Claude Code Remote Project Template

Set up a local folder for Claude Code to drive an Antimatter IDE project remotely.

## Quick Setup

1. Create a project in the IDE (or use an existing one):
   ```
   antimatter_projects_create name="my-project"
   ```
   Note the returned project ID.

2. Create a local folder and copy the templates:
   ```bash
   mkdir ~/my-project && cd ~/my-project
   ```

3. Create `.mcp.json` from the template — replace:
   - `{{ANTIMATTER_ROOT}}` → path to your antimatter checkout (e.g. `C:/Users/you/antimatter`)
   - `{{PROJECT_ID}}` → the project ID from step 1

4. Create `CLAUDE.md` from the template — replace:
   - `{{PROJECT_NAME}}` → your project name
   - `{{PROJECT_DESCRIPTION}}` → brief description
   - `{{PROJECT_ID}}` → same project ID

5. Start Claude Code in the folder:
   ```bash
   cd ~/my-project && claude
   ```

## What's in the folder

- `.mcp.json` — connects Claude Code to the Antimatter MCP server
- `CLAUDE.md` — project context, tool reference, and remote-only workflow rules

The MCP server code lives in the antimatter repo and is referenced by path.
Auth tokens are shared via the token file path in `.mcp.json`.

## Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{ANTIMATTER_ROOT}}` | Path to antimatter repo | `C:/Users/majod/antimatter` |
| `{{PROJECT_ID}}` | Antimatter project UUID | `2147a516-6543-4417-b1c2-c1690e1deb34` |
| `{{PROJECT_NAME}}` | Human-readable name | `in-real-life` |
| `{{PROJECT_DESCRIPTION}}` | Brief description | `Mobile web app for local meetups` |
