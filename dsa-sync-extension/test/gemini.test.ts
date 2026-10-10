import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  generateNotes,
  generateApproachCode,
  listGeminiModels,
  DEFAULT_GEMINI_MODEL,
  FALLBACK_GEMINI_MODEL,
  saveWorkingModelToConfig,
} from '../src/shared/gemini.js';
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

describe('Gemini Model Constants', () => {
  it('has default model set to gemini-3.5-flash', () => {
    expect(DEFAULT_GEMINI_MODEL).toBe('gemini-3.5-flash');
    expect(FALLBACK_GEMINI_MODEL).toBe('gemini-flash-latest');
  });
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

    const result = await generateNotes(makeMetadata(), 'valid-gemini-key', DEFAULT_GEMINI_MODEL, 0);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.patternTag).toBe('Two Pointers');
      expect(result.data.approaches).toHaveLength(2);
      expect(result.data.keyInsights).toHaveLength(2);
      expect(result.workingModel).toBe(DEFAULT_GEMINI_MODEL);
    }

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(`${DEFAULT_GEMINI_MODEL}:generateContent`);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('valid-gemini-key');
    const body = JSON.parse(init.body as string);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.responseSchema).toBeDefined();
  });

  it('returns invalid key on HTTP 401 or 403 with status code and error message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({
          error: {
            code: 401,
            message: 'API key not valid. Please pass a valid API key.',
            status: 'UNAUTHENTICATED',
          },
        }),
      } as Response),
    );

    const result = await generateNotes(makeMetadata(), 'bad-key', DEFAULT_GEMINI_MODEL, 0);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(401);
      expect(result.reason).toContain('[HTTP 401]');
      expect(result.reason).toContain('API key not valid. Please pass a valid API key.');
    }
  });

  it('retries once on HTTP 429 and succeeds if second call succeeds', async () => {
    const validData = makeValidNotesData();
    const fetchSpy = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'Quota exceeded' } }),
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
      json: async () => ({ error: { message: 'Rate limit exceeded' } }),
    } as Response);

    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), 'valid-key', DEFAULT_GEMINI_MODEL, 1);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(429);
      expect(result.reason).toContain('[HTTP 429]');
      expect(result.reason).toContain('Rate limit exceeded');
    }
    expect(fetchSpy).toHaveBeenCalledTimes(2);
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

describe('404 Fallback Path', () => {
  it('automatically retries with gemini-flash-latest on 404 and saves to config on success', async () => {
    const validData = makeValidNotesData();
    const chromeSetSpy = vi.fn().mockResolvedValue(undefined);
    const chromeGetSpy = vi.fn().mockResolvedValue({
      config: { geminiModel: 'gemini-3.5-flash', repoOwner: 'test' },
    });
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: chromeGetSpy,
          set: chromeSetSpy,
        },
      },
    });

    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('gemini-3.5-flash:generateContent')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 404,
              message: 'models/gemini-3.5-flash is not found for API version v1beta',
              status: 'NOT_FOUND',
            },
          }),
        } as Response;
      }
      if (url.includes('gemini-flash-latest:generateContent')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify(validData) }] } }],
          }),
        } as Response;
      }
      return { ok: false, status: 500 } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), 'test-api-key', 'gemini-3.5-flash', 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workingModel).toBe('gemini-flash-latest');
      expect(result.data.patternTag).toBe('Two Pointers');
    }

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(chromeSetSpy).toHaveBeenCalledWith({
      config: expect.objectContaining({ geminiModel: 'gemini-flash-latest' }),
    });
  });

  it('retries with ListModels discovered flash model when gemini-flash-latest also 404s', async () => {
    const validData = makeValidNotesData();
    const chromeSetSpy = vi.fn().mockResolvedValue(undefined);
    const chromeGetSpy = vi.fn().mockResolvedValue({
      config: { geminiModel: 'gemini-3.5-flash' },
    });
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: chromeGetSpy,
          set: chromeSetSpy,
        },
      },
    });

    const fetchSpy = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      // 1. Initial requested model 404
      if (url.includes('gemini-3.5-flash:generateContent')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'models/gemini-3.5-flash not found' } }),
        } as Response;
      }
      // 2. Fallback gemini-flash-latest 404
      if (url.includes('gemini-flash-latest:generateContent')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'models/gemini-flash-latest not found' } }),
        } as Response;
      }
      // 3. GET /v1beta/models ListModels call
      if (url === 'https://generativelanguage.googleapis.com/v1beta/models' && init?.method === 'GET') {
        expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
        return {
          ok: true,
          status: 200,
          json: async () => ({
            models: [
              { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
              { name: 'models/gemini-pro', supportedGenerationMethods: ['generateContent'] },
              { name: 'models/gemini-1.5-flash-8b', supportedGenerationMethods: ['generateContent'] },
            ],
          }),
        } as Response;
      }
      // 4. Retry with discovered flash model (gemini-1.5-flash-8b)
      if (url.includes('gemini-1.5-flash-8b:generateContent')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            candidates: [{ content: { parts: [{ text: JSON.stringify(validData) }] } }],
          }),
        } as Response;
      }
      return { ok: false, status: 500 } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), 'test-key', 'gemini-3.5-flash', 0);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.workingModel).toBe('gemini-1.5-flash-8b');
    }
    expect(chromeSetSpy).toHaveBeenCalledWith({
      config: expect.objectContaining({ geminiModel: 'gemini-1.5-flash-8b' }),
    });
  });

  it('includes HTTP status and Google error message when all 404 fallbacks fail', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('generateContent')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({
            error: {
              code: 404,
              message: 'Model requested is not found for API version v1beta',
              status: 'NOT_FOUND',
            },
          }),
        } as Response;
      }
      // ListModels returns no flash model
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: [
            { name: 'models/text-bison-001', supportedGenerationMethods: ['generateText'] },
          ],
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const result = await generateNotes(makeMetadata(), 'test-key', 'gemini-3.5-flash', 0);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(404);
      expect(result.reason).toContain('[HTTP 404]');
      expect(result.reason).toContain('Model requested is not found for API version v1beta');
    }
  });
});

describe('listGeminiModels', () => {
  it('returns invalid key if apiKey is empty', async () => {
    const res = await listGeminiModels('');
    expect(res).toEqual({ ok: false, reason: 'invalid key' });
  });

  it('fetches models via GET using x-goog-api-key header and filters for generateContent', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        models: [
          { name: 'models/gemini-2.0-flash', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/gemini-1.5-pro', supportedGenerationMethods: ['generateContent'] },
          { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ],
      }),
    } as Response);
    vi.stubGlobal('fetch', fetchSpy);

    const res = await listGeminiModels('my-secret-key');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.models).toEqual(['gemini-2.0-flash', 'gemini-1.5-pro']);
    }

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://generativelanguage.googleapis.com/v1beta/models',
      expect.objectContaining({
        method: 'GET',
        headers: { 'x-goog-api-key': 'my-secret-key' },
      }),
    );
  });

  it('returns formatted error reason with HTTP status and message on error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({
        error: { message: 'Method doesn\'t allow unregistered callers' },
      }),
    } as Response));

    const res = await listGeminiModels('bad-key');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toContain('[HTTP 403]');
      expect(res.reason).toContain('Method doesn\'t allow unregistered callers');
    }
  });
});

describe('saveWorkingModelToConfig', () => {
  it('updates chrome.storage.local config safely', async () => {
    const setSpy = vi.fn().mockResolvedValue(undefined);
    const getSpy = vi.fn().mockResolvedValue({
      config: { repoOwner: 'aryancodes', geminiModel: 'old-model' },
    });
    vi.stubGlobal('chrome', {
      storage: {
        local: {
          get: getSpy,
          set: setSpy,
        },
      },
    });

    await saveWorkingModelToConfig('gemini-flash-latest');
    expect(getSpy).toHaveBeenCalledWith('config');
    expect(setSpy).toHaveBeenCalledWith({
      config: {
        repoOwner: 'aryancodes',
        geminiModel: 'gemini-flash-latest',
      },
    });
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

  it('falls back to gemini-flash-latest on 404', async () => {
    const fetchSpy = vi.fn().mockImplementation(async (url: string) => {
      if (url.includes('gemini-3.5-flash:generateContent')) {
        return {
          ok: false,
          status: 404,
          json: async () => ({ error: { message: 'Not found' } }),
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'class Solution { void brute() {} }' }] } }],
        }),
      } as Response;
    });
    vi.stubGlobal('fetch', fetchSpy);

    const res = await generateApproachCode({
      metadata: makeMetadata(),
      approachType: 'Brute',
      optimalCode: 'class Solution {}',
      language: 'java',
      apiKey: 'valid-key',
      model: 'gemini-3.5-flash',
    });

    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.workingModel).toBe('gemini-flash-latest');
    }
  });
});
