import { describe, expect, it, vi, afterEach } from 'vitest';
import { generateNotes, generateApproachCode, DEFAULT_GEMINI_MODEL } from '../src/shared/gemini.js';
import type { GeminiNotesData, ProblemMetadata } from '../src/shared/types.js';

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

function makeValidNotesData(): GeminiNotesData {
  return {
    patternTag: 'Two Pointers',
    problemSummary: 'Move all zeroes to the end of the array in-place while keeping relative order.',
    example: {
      input: 'nums = [0,1,0,3,12]',
      output: '[1,3,12,0,0]',
    },
    keyInsights: [
      'Use a write pointer to track position for non-zero elements.',
      'Swap or overwrite non-zero elements and fill zeroes at the end.',
    ],
    approaches: [
      {
        name: 'Brute',
        idea: 'Allocate a new array, copy non-zero elements, and append zeroes.',
        time: 'O(n)',
        space: 'O(n)',
      },
      {
        name: 'Optimal',
        idea: 'In-place two-pointer traversal swapping zeroes.',
        time: 'O(n)',
        space: 'O(1)',
      },
    ],
    edgeCases: ['All zeroes', 'No zeroes', 'Single element array'],
    similarProblems: ['Remove Element', 'Move Zeros II'],
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('generateNotes (Google Gemini API integration)', () => {
  it('returns invalid key immediately when API key is empty', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), '');
    expect(result).toEqual({ ok: false, reason: 'invalid key' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns structured data on successful response', async () => {
    const validData = makeValidNotesData();
    const mockApiResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: JSON.stringify(validData) }],
          },
        },
      ],
    };

    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), 'valid-gemini-key', 'gemini-2.5-flash', 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.patternTag).toBe('Two Pointers');
      expect(result.data.approaches).toHaveLength(2);
      expect(result.data.keyInsights).toHaveLength(2);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('gemini-2.5-flash:generateContent');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('valid-gemini-key');
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeDefined();
  });

  it('returns invalid key on HTTP 401 or 403', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
      } as Response),
    );

    const result = await generateNotes(makeMetadata(), 'bad-key', DEFAULT_GEMINI_MODEL, 0);
    expect(result).toEqual({ ok: false, reason: 'invalid key' });
  });

  it('retries once on HTTP 429 and succeeds if second call succeeds', async () => {
    const validData = makeValidNotesData();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify(validData) }] } }],
        }),
      } as Response);

    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), 'valid-key', DEFAULT_GEMINI_MODEL, 1);
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns rate limited if HTTP 429 persists after retry', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
    } as Response);

    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), 'valid-key', DEFAULT_GEMINI_MODEL, 1);
    expect(result).toEqual({ ok: false, reason: 'rate limited' });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('returns model not found on HTTP 404', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      } as Response),
    );

    const result = await generateNotes(makeMetadata(), 'valid-key', 'non-existent-model', 0);
    expect(result).toEqual({ ok: false, reason: 'model not found' });
  });

  it('returns network on fetch rejection', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Connection aborted')));

    const result = await generateNotes(makeMetadata(), 'valid-key', DEFAULT_GEMINI_MODEL, 0);
    expect(result).toEqual({ ok: false, reason: 'network' });
  });

  it('returns bad JSON if response contains malformed JSON text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: '{ not-valid-json' }] } }],
        }),
      } as Response),
    );

    const result = await generateNotes(makeMetadata(), 'valid-key', DEFAULT_GEMINI_MODEL, 0);
    expect(result).toEqual({ ok: false, reason: 'bad JSON' });
  });

  it('returns bad JSON if JSON missing required schema fields', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: JSON.stringify({ incomplete: true }) }] } }],
        }),
      } as Response),
    );

    const result = await generateNotes(makeMetadata(), 'valid-key', DEFAULT_GEMINI_MODEL, 0);
    expect(result).toEqual({ ok: false, reason: 'bad JSON' });
  });
});

describe('generateApproachCode', () => {
  it('successfully extracts generated code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [{ text: '```java\nclass Solution { void brute() {} }\n```' }],
              },
            },
          ],
        }),
      } as Response),
    );

    const res = await generateApproachCode({
      metadata: makeMetadata(),
      approachType: 'Brute',
      optimalCode: 'class Solution {}',
      language: 'java',
      apiKey: 'valid-key',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.code).toContain('class Solution { void brute() {} }');
    }
  });
});
