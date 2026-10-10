export interface CommitFileInput {
  path: string;
  content?: string;
  sha?: string;
}

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
 * Client for GitHub repository operations.
 * Supports file retrieval, legacy single-file PUTs with conflict retries,
 * and atomic multi-file commits via the Git Data API.
 */
export class GitHubClient {
  private lastWriteTime = 0;

  constructor(
    private token: string,
    private owner: string,
    private repo: string,
    private branch: string,
    private maxRetries = 5,
    private initialDelayMs = 1000,
    private writeIntervalMs = 1000,
  ) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private async fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
    let lastError: Error | null = null;
    let delay = this.initialDelayMs;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(url, init);
        const isTransientStatus = res.status === 429 || (res.status >= 500 && res.status <= 599);

        if (isTransientStatus) {
          const bodyText = await safeText(res);
          lastError = new GitHubApiError(
            `${init?.method || 'GET'} ${url} failed: ${res.status} ${bodyText}`,
            res.status,
          );
          if (attempt < this.maxRetries) {
            const retryAfterHeader = res.headers?.get?.('retry-after');
            const retryAfterMs = retryAfterHeader ? parseInt(retryAfterHeader, 10) * 1000 : 0;
            const waitTime = Math.max(delay, isNaN(retryAfterMs) ? 0 : retryAfterMs);
            if (waitTime > 0) {
              await new Promise((resolve) => setTimeout(resolve, waitTime));
            }
            delay *= 2;
            continue;
          }
          throw lastError;
        }
        return res;
      } catch (err) {
        if (err instanceof GitHubApiError) {
          throw err;
        }
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < this.maxRetries) {
          if (delay > 0) await new Promise((resolve) => setTimeout(resolve, delay));
          delay *= 2;
          continue;
        }
        throw lastError;
      }
    }
    throw lastError ?? new Error('Request failed after retries');
  }

  /**
   * Creates an atomic commit for multiple files using the GitHub Git Data API:
   * 1. GET ref/heads/{branch} to get latest base commit SHA
   * 2. GET commits/{base_commit_sha} to get base tree SHA
   * 3. POST git/blobs for each file in parallel with Promise.all
   * 4. POST git/trees with base_tree and all new file blobs
   * 5. POST git/commits with new tree and base commit as parent
   * 6. PATCH git/refs/heads/{branch} to update the branch pointer
   *
   * Automatically retries once on 422 or 409 non-fast-forward by refetching the ref.
   */
  async commitFiles(files: CommitFileInput[], message: string): Promise<string> {
    if (files.length === 0) {
      throw new Error('commitFiles requires at least one file');
    }

    // Step 3: Create blobs in parallel
    const blobEntries = await Promise.all(
      files.map(async (file) => {
        const blobSha = file.sha ?? (await this.createBlob(file.content ?? ''));
        return {
          path: file.path,
          mode: '100644' as const,
          type: 'blob' as const,
          sha: blobSha,
        };
      }),
    );

    const attemptCommit = async (): Promise<string> => {
      // Step 1: GET ref
      const refUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/ref/heads/${encodeURIComponent(this.branch)}`;
      const refRes = await this.fetchWithRetry(refUrl, { headers: this.headers() });
      if (!refRes.ok) {
        throw new GitHubApiError(
          `GET ref heads/${this.branch} failed: ${refRes.status} ${await safeText(refRes)}`,
          refRes.status,
        );
      }
      const refData = await refRes.json();
      const baseCommitSha: string = refData.object.sha;

      // Step 2: GET base commit to find its tree SHA
      const commitUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/commits/${baseCommitSha}`;
      const commitRes = await this.fetchWithRetry(commitUrl, { headers: this.headers() });
      if (!commitRes.ok) {
        throw new GitHubApiError(
          `GET commit ${baseCommitSha} failed: ${commitRes.status} ${await safeText(commitRes)}`,
          commitRes.status,
        );
      }
      const commitData = await commitRes.json();
      const baseTreeSha: string = commitData.tree.sha;

      // Step 4: POST git/trees with base_tree
      const treeUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/trees`;
      const treeRes = await this.fetchWithRetry(treeUrl, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_tree: baseTreeSha,
          tree: blobEntries,
        }),
      });
      if (!treeRes.ok) {
        throw new GitHubApiError(
          `POST tree failed: ${treeRes.status} ${await safeText(treeRes)}`,
          treeRes.status,
        );
      }
      const treeData = await treeRes.json();
      const newTreeSha: string = treeData.sha;

      // Step 5: POST git/commits
      const newCommitUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/commits`;
      const newCommitRes = await this.fetchWithRetry(newCommitUrl, {
        method: 'POST',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message,
          tree: newTreeSha,
          parents: [baseCommitSha],
        }),
      });
      if (!newCommitRes.ok) {
        throw new GitHubApiError(
          `POST commit failed: ${newCommitRes.status} ${await safeText(newCommitRes)}`,
          newCommitRes.status,
        );
      }
      const newCommitData = await newCommitRes.json();
      const newCommitSha: string = newCommitData.sha;

      // Step 6: PATCH git/refs/heads/{branch}
      const patchRefUrl = `https://api.github.com/repos/${this.owner}/${this.repo}/git/refs/heads/${encodeURIComponent(this.branch)}`;
      const patchRes = await this.fetchWithRetry(patchRefUrl, {
        method: 'PATCH',
        headers: { ...this.headers(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sha: newCommitSha,
          force: false,
        }),
      });
      if (!patchRes.ok) {
        throw new GitHubApiError(
          `PATCH ref heads/${this.branch} failed: ${patchRes.status} ${await safeText(patchRes)}`,
          patchRes.status,
        );
      }

      return newCommitSha;
    };

    try {
      return await attemptCommit();
    } catch (err) {
      if (err instanceof GitHubApiError && (err.status === 422 || err.status === 409)) {
        // Refetch ref and retry once on non-fast-forward/conflict
        return await attemptCommit();
      }
      throw err;
    }
  }

  /** Creates a blob using the GitHub Git Data API */
  async createBlob(content: string): Promise<string> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/git/blobs`;
    const res = await this.fetchWithRetry(url, {
      method: 'POST',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content,
        encoding: 'utf-8',
      }),
    });
    if (!res.ok) {
      throw new GitHubApiError(
        `POST blob failed: ${res.status} ${await safeText(res)}`,
        res.status,
      );
    }
    const data = await res.json();
    return data.sha;
  }

  /** Returns null if the file doesn't exist yet (404) — that's an expected case
   *  (first sync of a new file), not an error. */
  async getFile(path: string): Promise<GitHubFile | null> {
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}?ref=${this.branch}`;
    const res = await this.fetchWithRetry(url, { headers: this.headers() });

    if (res.status === 404) return null;
    if (!res.ok) {
      throw new GitHubApiError(`GET ${path} failed: ${res.status} ${await safeText(res)}`, res.status);
    }

    const data = await res.json();
    return { content: decodeBase64(data.content), sha: data.sha };
  }

  /** Creates or updates a file. Pass the previous sha (from getFile) when updating
   *  an existing file — GitHub requires it to prevent accidental overwrites. */
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

  private async paceWriteRequest(): Promise<void> {
    if (this.writeIntervalMs <= 0) return;
    const now = Date.now();
    const timeSinceLastWrite = now - this.lastWriteTime;
    if (timeSinceLastWrite < this.writeIntervalMs) {
      const waitTime = this.writeIntervalMs - timeSinceLastWrite;
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
    this.lastWriteTime = Date.now();
  }

  private async attemptPut(path: string, content: string, message: string, sha?: string): Promise<void> {
    await this.paceWriteRequest();
    const url = `https://api.github.com/repos/${this.owner}/${this.repo}/contents/${encodePath(path)}`;
    const res = await this.fetchWithRetry(url, {
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
