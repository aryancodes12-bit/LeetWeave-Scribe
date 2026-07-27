export interface GitHubFile {
  content: string; // decoded, plain text
  sha: string;
}

export class GitHubApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/**
 * Minimal wrapper around the GitHub Contents API — just get + put, which is all
 * a browser-side sync needs. Uses a PAT via Authorization header (MVP auth
 * strategy; proper OAuth App flow is a planned follow-up, not this iteration).
 */
export class GitHubClient {
  constructor(
    private token: string,
    private owner: string,
    private repo: string,
    private branch: string,
  ) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  /** Returns null if the file doesn't exist yet (404) — that's an expected case
   *  (first sync of a new file), not an error. */
  async getFile(path: string): Promise<GitHubFile | null> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${this.branch}`;
    const res = await fetch(url, { headers: this.headers() });

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new GitHubApiError(`GET ${path} failed: ${res.status} ${await safeText(res)}`, res.status);
    }

    const data = await res.json();
    return { content: decodeBase64(data.content), sha: data.sha };
  }

  /** Creates or updates a file. Pass the previous sha (from getFile) when updating
   *  an existing file — GitHub requires it to prevent accidental overwrites.
   *
   *  Auto-retries once on a 409 conflict: this happens when a shared file
   *  (stats.json, README.md — every sync touches these) gets updated by another
   *  sync in between our GET and this PUT, making our sha stale. Without this,
   *  the per-problem solution file (a unique path, no contention) still succeeds
   *  while the shared stats/README update silently fails — exactly the symptom
   *  of "new files show up but the dashboard stops updating." */
  async putFile(path: string, content: string, message: string, sha?: string): Promise<void> {
    try {
      await this.attemptPut(path, content, message, sha);
    } catch (err) {
      if (err instanceof GitHubApiError && err.status === 409) {
        const fresh = await this.getFile(path);
        await this.attemptPut(path, content, message, fresh?.sha);
        return;
      }
      throw err;
    }
  }

  private async attemptPut(path: string, content: string, message: string, sha?: string): Promise<void> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message,
        content: encodeBase64(content),
        branch: this.branch,
        ...(sha ? { sha } : {}),
      }),
    });

    if (!res.ok) {
      throw new GitHubApiError(`PUT ${path} failed: ${res.status} ${await safeText(res)}`, res.status);
    }
  }
}

function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

function encodeBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

function decodeBase64(b64: string): string {
  return decodeURIComponent(escape(atob(b64.replace(/\n/g, ''))));
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '(no body)';
  }
}
