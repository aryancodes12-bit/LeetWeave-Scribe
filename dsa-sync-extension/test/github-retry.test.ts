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

    const client = new GitHubClient('token', 'owner', 'repo', 'main');
    await client.putFile('stats.json', '{}', 'Update stats', 'STALE_SHA');

    const puts = calls.filter((c) => c.method === 'PUT');
    expect(puts).toHaveLength(2);
    expect(JSON.parse(puts[0]!.body!).sha).toBe('STALE_SHA');
    expect(JSON.parse(puts[1]!.body!).sha).toBe('FRESH_SHA');
  });

  it('does not retry on non-conflict errors (e.g. 401 unauthorized)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { message: 'bad credentials' })));

    const client = new GitHubClient('bad-token', 'owner', 'repo', 'main');
    await expect(client.putFile('stats.json', '{}', 'Update stats')).rejects.toThrow(/401/);
  });

  it('propagates the error if the retry also fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === 'PUT') return jsonResponse(409, { message: 'still conflicting' });
      return jsonResponse(200, { content: Buffer.from('x').toString('base64'), sha: 'FRESH_SHA' });
    }));

    const client = new GitHubClient('token', 'owner', 'repo', 'main');
    await expect(client.putFile('stats.json', '{}', 'Update stats', 'STALE_SHA')).rejects.toThrow(/409/);
  });
});
