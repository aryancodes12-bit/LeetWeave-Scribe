import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateExplanation } from '../src/shared/groq.js';
import type { ProblemMetadata } from '../src/shared/types.js';

function makeMetadata(): ProblemMetadata {
  return {
    id: 283,
    slug: 'move-zeroes',
    title: 'Move Zeroes',
    difficulty: 'Easy',
    topics: ['Array', 'Two Pointers'],
    url: 'https://leetcode.com/problems/move-zeroes/',
    language: 'java',
    code: 'class Solution { void moveZeroes(int[] nums) {} }',
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateExplanation (resilience — the property that actually matters)', () => {
  it('returns null immediately when no API key is given, without calling fetch', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateExplanation(makeMetadata(), '');

    expect(result).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns null (not throw) when the API responds with an error status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401 } as Response),
    );

    const result = await generateExplanation(makeMetadata(), 'bad-key');
    expect(result).toBeNull();
  });

  it('returns null (not throw) when fetch itself rejects (network error)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')));

    const result = await generateExplanation(makeMetadata(), 'gsk_fake');
    expect(result).toBeNull();
  });

  it('returns null (not throw) when the response body is malformed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ unexpected: 'shape' }),
      } as Response),
    );

    const result = await generateExplanation(makeMetadata(), 'gsk_fake');
    expect(result).toBeNull();
  });

  it('returns the trimmed content on a well-formed successful response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: '  ## Approach\nUses two pointers.  ' } }],
        }),
      } as Response),
    );

    const result = await generateExplanation(makeMetadata(), 'gsk_fake');
    expect(result).toBe('## Approach\nUses two pointers.');
  });

  it('sends the correct model, auth header, and endpoint', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] }),
    } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    await generateExplanation(makeMetadata(), 'gsk_fake');

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_fake');
    const body = JSON.parse(init.body as string);
    expect(body.model).toBe('llama-3.3-70b-versatile');
    expect(body.messages[1].content).toContain('Move Zeroes');
  });
});
