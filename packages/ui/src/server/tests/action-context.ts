/** High-level UI operations abstracted over transport.
 *  FetchActionContext calls REST endpoints.
 *  A future BrowserActionContext can drive a real browser with the same interface. */

export interface ActionContext {
  // File operations (project-scoped)
  writeFile(path: string, content: string): Promise<void>;
  readFile(path: string): Promise<string>;
  deleteFile(path: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  getFileTree(path?: string): Promise<any[]>;

  // Build operations (project-scoped)
  saveBuildConfig(config: { rules: any[]; targets: any[] }): Promise<void>;
  loadBuildConfig(): Promise<{ rules: any[]; targets: any[] }>;
  executeBuild(): Promise<any[]>;
  getBuildResults(): Promise<any[]>;
  clearBuildResults(): Promise<void>;
  clearBuildCache(targetId?: string): Promise<void>;
  getStaleTargets(): Promise<string[]>;

  // Agent operations (project-scoped)
  sendChat(message: string): Promise<{ response: string }>;
  getHistory(): Promise<any[]>;
  clearHistory(): Promise<void>;
  getCustomTools(): Promise<any[]>;
  saveCustomTools(tools: any[]): Promise<void>;
}

export class FetchActionContext implements ActionContext {
  private api: string;
  private frontend: string;
  private projectId: string;

  constructor(apiBase: string, frontendBase: string, projectId: string) {
    this.api = apiBase.replace(/\/+$/, '');
    this.frontend = frontendBase.replace(/\/+$/, '');
    this.projectId = projectId;
  }

  private url(path: string): string {
    return `${this.api}/api/projects/${this.projectId}${path}`;
  }

  private async json(res: Response): Promise<any> {
    const body = await res.json();
    if (!res.ok) throw new Error(`${res.status}: ${JSON.stringify(body)}`);
    return body;
  }

  // ---- Files ----

  async writeFile(path: string, content: string): Promise<void> {
    const res = await fetch(this.url('/files/write'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, content }),
    });
    await this.json(res);
  }

  async readFile(path: string): Promise<string> {
    const res = await fetch(this.url(`/files/read?path=${encodeURIComponent(path)}`));
    const body = await this.json(res);
    return body.content;
  }

  async deleteFile(path: string): Promise<void> {
    const res = await fetch(this.url(`/files/delete?path=${encodeURIComponent(path)}`), {
      method: 'DELETE',
    });
    await this.json(res);
  }

  async mkdir(path: string): Promise<void> {
    const res = await fetch(this.url('/files/mkdir'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    await this.json(res);
  }

  async getFileTree(path?: string): Promise<any[]> {
    const qs = path ? `?path=${encodeURIComponent(path)}` : '';
    const res = await fetch(this.url(`/files/tree${qs}`));
    const body = await this.json(res);
    return body.tree;
  }

  // ---- Build ----

  async saveBuildConfig(config: { rules: any[]; targets: any[] }): Promise<void> {
    const res = await fetch(this.url('/build/config'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    await this.json(res);
  }

  async loadBuildConfig(): Promise<{ rules: any[]; targets: any[] }> {
    const res = await fetch(this.url('/build/config'));
    const body = await this.json(res);
    return { rules: body.rules ?? [], targets: body.targets ?? [] };
  }

  async executeBuild(): Promise<any[]> {
    const res = await fetch(this.url('/build/execute'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    const body = await this.json(res);
    return body.results ?? [];
  }

  async getBuildResults(): Promise<any[]> {
    const res = await fetch(this.url('/build/results'));
    const body = await this.json(res);
    return body.results ?? [];
  }

  async clearBuildResults(): Promise<void> {
    const res = await fetch(this.url('/build/results'), { method: 'DELETE' });
    await this.json(res);
  }

  async clearBuildCache(targetId?: string): Promise<void> {
    const qs = targetId ? `?targetId=${encodeURIComponent(targetId)}` : '';
    const res = await fetch(this.url(`/build/cache${qs}`), { method: 'DELETE' });
    await this.json(res);
  }

  async getStaleTargets(): Promise<string[]> {
    const res = await fetch(this.url('/build/changes'));
    const body = await this.json(res);
    return body.staleTargetIds ?? [];
  }

  // ---- Agent ----

  async sendChat(message: string): Promise<{ response: string }> {
    const res = await fetch(this.url('/agent/chat'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
    const body = await this.json(res);
    return { response: body.response };
  }

  async getHistory(): Promise<any[]> {
    const res = await fetch(this.url('/agent/history'));
    const body = await this.json(res);
    return body.history ?? [];
  }

  async clearHistory(): Promise<void> {
    const res = await fetch(this.url('/agent/history'), { method: 'DELETE' });
    await this.json(res);
  }

  async getCustomTools(): Promise<any[]> {
    const res = await fetch(this.url('/agent/tools'));
    const body = await this.json(res);
    return body.tools ?? [];
  }

  async saveCustomTools(tools: any[]): Promise<void> {
    const res = await fetch(this.url('/agent/tools'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tools }),
    });
    await this.json(res);
  }
}
