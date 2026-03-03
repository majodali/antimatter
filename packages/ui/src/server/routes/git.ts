import { Router } from 'express';
import type { WorkspaceService } from '../services/workspace-service.js';

/**
 * Git routes — provides structured JSON API for git operations.
 * Commands run via workspace.env.execute() on the EC2 workspace.
 * On Lambda (S3 environment), execute() throws and these routes return errors gracefully.
 */
export function createGitRouter(workspace: WorkspaceService): Router {
  const router = Router();

  /** Helper: run a git command and return stdout/stderr */
  async function runGit(args: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    if (!workspace.env) {
      throw new Error('Git requires a running workspace');
    }
    const result = await workspace.env.execute({
      command: `git ${args}`,
      cwd: '.',
      timeout: 30000,
    });
    return {
      stdout: result.stdout?.trim() ?? '',
      stderr: result.stderr?.trim() ?? '',
      exitCode: result.exitCode,
    };
  }

  /** Parse git status --porcelain=v1 output into structured data */
  function parseStatus(output: string): {
    staged: { path: string; status: string }[];
    unstaged: { path: string; status: string }[];
    untracked: string[];
  } {
    const staged: { path: string; status: string }[] = [];
    const unstaged: { path: string; status: string }[] = [];
    const untracked: string[] = [];

    for (const line of output.split('\n')) {
      if (!line) continue;
      const x = line[0]; // index status
      const y = line[1]; // worktree status
      const file = line.slice(3);

      if (x === '?' && y === '?') {
        untracked.push(file);
      } else {
        if (x !== ' ' && x !== '?') {
          staged.push({ path: file, status: statusChar(x) });
        }
        if (y !== ' ' && y !== '?') {
          unstaged.push({ path: file, status: statusChar(y) });
        }
      }
    }

    return { staged, unstaged, untracked };
  }

  function statusChar(c: string): string {
    switch (c) {
      case 'M': return 'modified';
      case 'A': return 'added';
      case 'D': return 'deleted';
      case 'R': return 'renamed';
      case 'C': return 'copied';
      default: return 'modified';
    }
  }

  // GET /status — git status
  router.get('/status', async (_req, res) => {
    try {
      // Check if git is initialized
      const revParse = await runGit('rev-parse --is-inside-work-tree').catch(() => null);
      if (!revParse || revParse.exitCode !== 0) {
        return res.json({ initialized: false, staged: [], unstaged: [], untracked: [] });
      }

      // Get branch name
      const branchResult = await runGit('rev-parse --abbrev-ref HEAD');
      const branch = branchResult.exitCode === 0 ? branchResult.stdout : undefined;

      // Get status
      const statusResult = await runGit('status --porcelain=v1');
      const { staged, unstaged, untracked } = parseStatus(statusResult.stdout);

      res.json({ initialized: true, branch, staged, unstaged, untracked });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes('requires a running workspace')) {
        return res.status(503).json({ error: message });
      }
      res.status(500).json({ error: message });
    }
  });

  // POST /init — git init
  router.post('/init', async (_req, res) => {
    try {
      const result = await runGit('init');
      if (result.exitCode !== 0) {
        return res.status(500).json({ error: result.stderr || 'git init failed' });
      }
      res.json({ success: true, message: result.stdout });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /stage — git add files
  router.post('/stage', async (req, res) => {
    try {
      const { files } = req.body as { files: string[] };
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'files array is required' });
      }
      // Quote each file path to handle spaces
      const fileArgs = files.map((f) => `"${f}"`).join(' ');
      const result = await runGit(`add ${fileArgs}`);
      if (result.exitCode !== 0) {
        return res.status(500).json({ error: result.stderr || 'git add failed' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /unstage — git reset HEAD files
  router.post('/unstage', async (req, res) => {
    try {
      const { files } = req.body as { files: string[] };
      if (!files || files.length === 0) {
        return res.status(400).json({ error: 'files array is required' });
      }
      const fileArgs = files.map((f) => `"${f}"`).join(' ');
      const result = await runGit(`reset HEAD ${fileArgs}`);
      if (result.exitCode !== 0) {
        return res.status(500).json({ error: result.stderr || 'git reset failed' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /commit — git commit
  router.post('/commit', async (req, res) => {
    try {
      const { message } = req.body as { message: string };
      if (!message) {
        return res.status(400).json({ error: 'commit message is required' });
      }
      // Use -m flag with escaped message
      const escaped = message.replace(/"/g, '\\"');
      const result = await runGit(`commit -m "${escaped}"`);
      if (result.exitCode !== 0) {
        return res.status(500).json({ error: result.stderr || 'git commit failed' });
      }
      res.json({ success: true, message: result.stdout });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /push — git push
  router.post('/push', async (req, res) => {
    try {
      const { remote, branch } = req.body as { remote?: string; branch?: string };
      const args = ['push'];
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const result = await runGit(args.join(' '));
      if (result.exitCode !== 0) {
        return res.status(500).json({ error: result.stderr || 'git push failed' });
      }
      res.json({ success: true, message: result.stdout || result.stderr });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /pull — git pull
  router.post('/pull', async (req, res) => {
    try {
      const { remote, branch } = req.body as { remote?: string; branch?: string };
      const args = ['pull'];
      if (remote) args.push(remote);
      if (branch) args.push(branch);
      const result = await runGit(args.join(' '));
      if (result.exitCode !== 0) {
        return res.status(500).json({ error: result.stderr || 'git pull failed' });
      }
      res.json({ success: true, message: result.stdout });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // POST /remote/add — git remote add
  router.post('/remote/add', async (req, res) => {
    try {
      const { name, url } = req.body as { name: string; url: string };
      if (!name || !url) {
        return res.status(400).json({ error: 'name and url are required' });
      }
      const result = await runGit(`remote add "${name}" "${url}"`);
      if (result.exitCode !== 0) {
        return res.status(500).json({ error: result.stderr || 'git remote add failed' });
      }
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /remotes — git remote -v
  router.get('/remotes', async (_req, res) => {
    try {
      const result = await runGit('remote -v');
      if (result.exitCode !== 0) {
        return res.json({ remotes: [] });
      }
      const remotes: { name: string; url: string; type: string }[] = [];
      for (const line of result.stdout.split('\n')) {
        const match = line.match(/^(\S+)\s+(\S+)\s+\((\w+)\)$/);
        if (match) {
          remotes.push({ name: match[1], url: match[2], type: match[3] });
        }
      }
      res.json({ remotes });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  // GET /log — git log
  router.get('/log', async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit) || '20', 10);
      const result = await runGit(`log --oneline -${limit}`);
      if (result.exitCode !== 0) {
        return res.json({ commits: [] });
      }
      const commits = result.stdout.split('\n').filter(Boolean).map((line) => {
        const spaceIdx = line.indexOf(' ');
        return {
          hash: line.slice(0, spaceIdx),
          message: line.slice(spaceIdx + 1),
        };
      });
      res.json({ commits });
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  return router;
}
