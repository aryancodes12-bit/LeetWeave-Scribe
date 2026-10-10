import { describe, expect, it, vi, afterEach } from 'vitest';
import { GitHubClient } from '../src/shared/github.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe('GitHubClient.putFile conflict retry', () => {
  it('retries once with a fresh sha after a 409 conflict, and succeeds', async () => {
    const calls: Array<{ url: string; method?: string; body?: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body as string });

      if (init?.method === 'PUT') {
        const isFirstPut = calls.filter((c) => c.method === 'PUT').length === 1;
        if (isFirstPut) return jsonResponse(409, { message: 'sha does not match' });
        return jsonResponse(200, {});
      }
      // GET (re-fetch for fresh sha)
      return jsonResponse(200, { content: Buffer.from('fresh content').toString('base64'), sha: 'FRESH_SHA' });
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 5, 0, 0);
    await client.putFile('stats.json', '{}', 'Update stats', 'STALE_SHA');

    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[0]!.body!).sha).toBe('STALE_SHA');
    expect(JSON.parse(puts[1]!.body!).sha).toBe('FRESH_SHA');
  });

  it('does not retry on non-conflict errors (e.g. 401 unauthorized)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { message: 'bad credentials' })));

    const client = new GitHubClient('bad-token', 'owner', 'repo', 'main', 5, 0, 0);
    await expect(client.putFile('stats.json', '{}', 'Update stats')).rejects.toThrow(/401/);
  });

  it('propagates the error if the retry also fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return jsonResponse(409, { message: 'still conflicting' });
      return jsonResponse(200, { content: Buffer.from('x').toString('base64'), sha: 'FRESH_SHA' });
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    await expect(client.putFile('stats.json', '{}', 'Update stats', 'STALE_SHA')).rejects.toThrow(/409/);
  });
});

describe('GitHubClient transient 5xx, 429, and network retry', () => {
  it('retries on 503 Service Unavailable and succeeds when next attempt passes', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse(503, { message: 'No server is currently available to service your request.' });
      }
      return jsonResponse(200, {});
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    await client.putFile('organized/Array/LC128/LC128.java', 'class Solution {}', 'Add solution');

    expect(attempts).toBe(2);
  });

  it('retries on 429 Too Many Requests and succeeds', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        return jsonResponse(429, { message: 'Rate limit exceeded' });
      }
      return jsonResponse(200, {});
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    await client.putFile('organized/Array/LC128/LC128.java', 'class Solution {}', 'Add solution');

    expect(attempts).toBe(2);
  });

  it('retries on network failure and succeeds when next attempt passes', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts++;
      if (attempts === 1) {
        throw new TypeError('Failed to fetch');
      }
      return jsonResponse(200, {});
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    await client.putFile('organized/Array/LC128/LC128.java', 'class Solution {}', 'Add solution');

    expect(attempts).toBe(2);
  });

  it('throws 503 error after exhausting max retries', async () => {
    let attempts = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      attempts++;
      return jsonResponse(503, { message: 'Service Unavailable' });
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    await expect(client.putFile('test.java', 'code', 'msg')).rejects.toThrow(/503/);
    expect(attempts).toBe(4); // 1 initial attempt + 3 retries
  });
});

describe('GitHubClient.commitFiles atomic commit via Git Data API', () => {
  it('creates blobs in parallel, builds tree with base_tree, commits, and updates branch ref', async () => {
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      const parsedBody = init?.body ? JSON.parse(init.body as string) : undefined;
      calls.push({ url, method: init?.method, body: parsedBody });

      if (url.includes('/git/blobs')) {
        return jsonResponse(201, { sha: `BLOB_SHA_${calls.length}` });
      }
      if (url.includes('/git/ref/heads/')) {
        return jsonResponse(200, { object: { sha: 'BASE_COMMIT_SHA' } });
      }
      if (url.includes('/git/commits/BASE_COMMIT_SHA')) {
        return jsonResponse(200, { tree: { sha: 'BASE_TREE_SHA' } });
      }
      if (url.includes('/git/trees')) {
        return jsonResponse(201, { sha: 'NEW_TREE_SHA' });
      }
      if (url.endsWith('/git/commits') && init?.method === 'POST') {
        return jsonResponse(201, { sha: 'NEW_COMMIT_SHA' });
      }
      if (url.includes('/git/refs/heads/') && init?.method === 'PATCH') {
        return jsonResponse(200, { object: { sha: 'NEW_COMMIT_SHA' } });
      }

      return jsonResponse(404, {});
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    const commitSha = await client.commitFiles(
      [
        { path: 'LC1.java', content: 'class Solution {}' },
        { path: 'LC1/README.md', content: '# Two Sum' },
        { path: 'stats.json', content: '{"total":1}' },
      ],
      'Add LC1 - Two Sum',
    );

    expect(commitSha).toBe('NEW_COMMIT_SHA');

    // Verify blob uploads
    const blobCalls = calls.filter((c) => c.url.includes('/git/blobs'));
    expect(blobCalls).toHaveLength(3);

    // Verify tree call has base_tree set
    const treeCall = calls.find((c) => c.url.includes('/git/trees'));
    expect(treeCall).toBeDefined();
    expect((treeCall?.body as any)?.base_tree).toBe('BASE_TREE_SHA');
    expect((treeCall?.body as any)?.tree).toHaveLength(3);

    // Verify commit call
    const commitCall = calls.find((c) => c.url.endsWith('/git/commits') && c.method === 'POST');
    expect(commitCall).toBeDefined();
    expect((commitCall?.body as any)?.message).toBe('Add LC1 - Two Sum');
    expect((commitCall?.body as any)?.parents).toEqual(['BASE_COMMIT_SHA']);

    // Verify patch ref
    const patchCall = calls.find((c) => c.url.includes('/git/refs/heads/') && c.method === 'PATCH');
    expect(patchCall).toBeDefined();
    expect((patchCall?.body as any)?.sha).toBe('NEW_COMMIT_SHA');
  });

  it('uses precomputed sha if provided in CommitFileInput', async () => {
    const calls: Array<{ url: string; method?: string }> = [];

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      if (url.includes('/git/blobs')) return jsonResponse(201, { sha: 'BLOB_FOR_README' });
      if (url.includes('/git/ref/heads/')) return jsonResponse(200, { object: { sha: 'BASE_SHA' } });
      if (url.includes('/git/commits/BASE_SHA')) return jsonResponse(200, { tree: { sha: 'TREE_SHA' } });
      if (url.includes('/git/trees')) return jsonResponse(201, { sha: 'NEW_TREE' });
      if (url.endsWith('/git/commits') && init?.method === 'POST') return jsonResponse(201, { sha: 'NEW_COMMIT' });
      if (url.includes('/git/refs/heads/') && init?.method === 'PATCH') return jsonResponse(200, {});
      return jsonResponse(404, {});
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    await client.commitFiles(
      [
        { path: 'LC1.java', sha: 'PRECOMPUTED_BLOB_SHA' },
        { path: 'README.md', content: 'Notes' },
      ],
      'Add LC1',
    );

    const blobCalls = calls.filter((c) => c.url.includes('/git/blobs'));
    // Only README needed blob creation because LC1 had precomputed sha
    expect(blobCalls).toHaveLength(1);
  });

  it('retries once on 422 or 409 non-fast-forward conflict and succeeds', async () => {
    let patchAttempts = 0;
    let refFetches = 0;

    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/git/blobs')) return jsonResponse(201, { sha: 'BLOB_SHA' });
      if (url.includes('/git/ref/heads/')) {
        refFetches++;
        const sha = refFetches === 1 ? 'STALE_BASE_SHA' : 'FRESH_BASE_SHA';
        return jsonResponse(200, { object: { sha } });
      }
      if (url.includes('/git/commits/STALE_BASE_SHA')) return jsonResponse(200, { tree: { sha: 'STALE_TREE' } });
      if (url.includes('/git/commits/FRESH_BASE_SHA')) return jsonResponse(200, { tree: { sha: 'FRESH_TREE' } });
      if (url.includes('/git/trees')) return jsonResponse(201, { sha: 'NEW_TREE' });
      if (url.endsWith('/git/commits') && init?.method === 'POST') return jsonResponse(201, { sha: 'COMMIT_SHA' });
      if (url.includes('/git/refs/heads/') && init?.method === 'PATCH') {
        patchAttempts++;
        if (patchAttempts === 1) {
          return jsonResponse(422, { message: 'Reference cannot be updated' });
        }
        return jsonResponse(200, { object: { sha: 'COMMIT_SHA' } });
      }
      return jsonResponse(404, {});
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    const result = await client.commitFiles([{ path: 'test.txt', content: 'hello' }], 'Test retry');

    expect(result).toBe('COMMIT_SHA');
    expect(patchAttempts).toBe(2);
    expect(refFetches).toBe(2);
  });

  it('rejects if files array is empty', async () => {
    const client = new GitHubClient('token', 'owner', 'repo', 'main', 3, 0, 0);
    await expect(client.commitFiles([], 'Empty commit')).rejects.toThrow(/at least one file/);
  });
});
