import type { FileSystem, WorkspacePath } from '@antimatter/filesystem';

export interface PersistentMemory {
  workingMemory: Record<string, unknown>;
  conversationSummary?: string;
  lastUpdated: string;
}

export class MemoryStore {
  private readonly filePath: string;

  constructor(
    private readonly fs: FileSystem,
    filePath = '.antimatter/agent-memory.json',
  ) {
    this.filePath = filePath;
  }

  async load(): Promise<PersistentMemory | null> {
    try {
      const content = await this.fs.readTextFile(this.filePath as WorkspacePath);
      return JSON.parse(content) as PersistentMemory;
    } catch {
      return null;
    }
  }

  async save(memory: PersistentMemory): Promise<void> {
    // Ensure .antimatter directory exists
    const dir = this.filePath.substring(0, this.filePath.lastIndexOf('/'));
    if (dir) {
      try {
        await this.fs.mkdir(dir as WorkspacePath);
      } catch { /* already exists */ }
    }

    await this.fs.writeFile(
      this.filePath as WorkspacePath,
      JSON.stringify(memory, null, 2),
    );
  }
}
