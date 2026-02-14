import type { FileSystem, WorkspacePath } from '@antimatter/filesystem';
import type { AgentTool } from '../types.js';

/**
 * Create a tool that reads a text file from the workspace.
 */
export function createReadFileTool(fs: FileSystem): AgentTool {
  return {
    name: 'readFile',
    description: 'Read the contents of a text file at the given path.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Workspace-relative file path',
        required: true,
      },
    ],
    async execute(params) {
      const path = params.path as string;
      if (!path) return JSON.stringify({ error: 'path is required' });
      try {
        const content = await fs.readTextFile(path as WorkspacePath);
        return content;
      } catch (error) {
        return JSON.stringify({
          error: `Failed to read file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

/**
 * Create a tool that writes content to a file in the workspace.
 */
export function createWriteFileTool(fs: FileSystem): AgentTool {
  return {
    name: 'writeFile',
    description: 'Write content to a file at the given path. Creates parent directories as needed.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Workspace-relative file path',
        required: true,
      },
      {
        name: 'content',
        type: 'string',
        description: 'File content to write',
        required: true,
      },
    ],
    async execute(params) {
      const path = params.path as string;
      const content = params.content as string;
      if (!path) return JSON.stringify({ error: 'path is required' });
      if (content === undefined || content === null) {
        return JSON.stringify({ error: 'content is required' });
      }
      try {
        await fs.writeFile(path as WorkspacePath, content);
        return JSON.stringify({ success: true, path });
      } catch (error) {
        return JSON.stringify({
          error: `Failed to write file: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

/**
 * Create a tool that lists directory entries.
 */
export function createListFilesTool(fs: FileSystem): AgentTool {
  return {
    name: 'listFiles',
    description: 'List files and directories at the given path.',
    parameters: [
      {
        name: 'path',
        type: 'string',
        description: 'Workspace-relative directory path',
        required: true,
      },
    ],
    async execute(params) {
      const path = params.path as string;
      if (!path && path !== '') return JSON.stringify({ error: 'path is required' });
      try {
        const entries = await fs.readDirectory(path as WorkspacePath);
        return JSON.stringify(entries);
      } catch (error) {
        return JSON.stringify({
          error: `Failed to list directory: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    },
  };
}

/**
 * Convenience: return all file tools as an array.
 */
export function createFileTools(fs: FileSystem): AgentTool[] {
  return [
    createReadFileTool(fs),
    createWriteFileTool(fs),
    createListFilesTool(fs),
  ];
}
