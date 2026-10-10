import type { GeminiNotesData, GeminiResult, ProblemMetadata } from './types.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
export const FALLBACK_GEMINI_MODEL = 'gemini-flash-latest';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiModelInfo {
  name: string;
  displayName?: string;
  description?: string;
  supportedGenerationMethods?: string[];
}

/**
 * Extracts Google's error message from an API response if available.
 */
async function extractGoogleErrorMessage(res: Response): Promise<string> {
  try {
    let data: unknown = null;
    if (typeof res.clone === 'function') {
      data = await res.clone().json();
    } else if (typeof res.json === 'function') {
      data = await res.json();
    }
    if (
      data &&
      typeof data === 'object' &&
      'error' in data &&
      typeof (data as Record<string, any>).error?.message === 'string'
    ) {
      return (data as Record<string, any>).error.message.trim();
    }
  } catch {
  }
  return '';
}

/**
 * Builds a failure reason string that explicitly includes the HTTP status
 * and Google's error.message if present.
 */
async function formatHttpFailureReason(res: Response, category: string): Promise<string> {
  const googleMessage = await extractGoogleErrorMessage(res);
  if (googleMessage) {
    return `[HTTP ${res.status}] ${category}: ${googleMessage}`;
  }
  return `[HTTP ${res.status}] ${category}`;
}

/**
 * Saves a discovered working model name back to the chrome.storage extension configuration.
 */
export async function saveWorkingModelToConfig(workingModel: string): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      const stored = await chrome.storage.local.get('config');
      if (stored?.config) {
        const updatedConfig = { ...stored.config, geminiModel: workingModel };
        await chrome.storage.local.set({ config: updatedConfig });
        console.log(`[LWS] Saved working model back to config: ${workingModel}`);
      }
    }
  } catch (err) {
    console.warn('[LWS] Failed to save working model to chrome.storage:', err);
  }
}

/**
 * Calls GET /v1beta/models using the x-goog-api-key header to retrieve available Gemini models.
 */
export async function listGeminiModels(
  apiKey: string,
): Promise<{ ok: true; models: string[] } | { ok: false; reason: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, reason: 'invalid key' };
  }

  try {
    const res = await fetch(GEMINI_API_BASE, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey.trim(),
      },
    });

    if (!res.ok) {
      const reason = await formatHttpFailureReason(res, 'failed to list models');
      return { ok: false, reason };
    }

    const data = await res.json();
    const rawModels: GeminiModelInfo[] = data?.models ?? [];
    const filtered = rawModels
      .filter((m) => m.supportedGenerationMethods?.includes('generateContent'))
      .map((m) => m.name.replace(/^models\//, ''));

    return { ok: true, models: filtered };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: `network: ${msg}` };
  }
}

/**
 * Finds the first available model from ListModels whose supportedGenerationMethods includes
 * generateContent and whose name contains "flash".
 */
async function discoverFlashModel(apiKey: string): Promise<string | null> {
  try {
    const res = await fetch(GEMINI_API_BASE, {
      method: 'GET',
      headers: {
        'x-goog-api-key': apiKey.trim(),
      },
    });

    if (!res.ok) return null;

    const data = await res.json();
    const rawModels: GeminiModelInfo[] = data?.models ?? [];

    for (const m of rawModels) {
      const name = m.name?.replace(/^models\//, '') ?? '';
      const supportsGen = m.supportedGenerationMethods?.includes('generateContent');
      const isFlash = name.toLowerCase().includes('flash') || (m.displayName?.toLowerCase().includes('flash') ?? false);
      if (supportsGen && isFlash) {
        return name;
      }
    }
  } catch {
  }
  return null;
}

/**
 * Executes a single generateContent call with retry on 429 and 5xx.
 */
async function callGenerateContentEndpoint(
  model: string,
  apiKey: string,
  requestBody: unknown,
  backoffMs: number,
): Promise<{ res?: Response; error?: unknown }> {
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  const doFetch = async (): Promise<{ res?: Response; error?: unknown }> => {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim(),
        },
        body: JSON.stringify(requestBody),
      });
      return { res };
    } catch (error) {
      return { error };
    }
  };

  let attempt = await doFetch();

  if (attempt.res && (attempt.res.status === 429 || attempt.res.status >= 500)) {
    if (backoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    attempt = await doFetch();
  }

  return attempt;
}


export const GEMINI_NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    patternTag: {
      type: 'STRING',
      description: 'The algorithmic pattern or technique (e.g. Two Pointers, Sliding Window, DFS).',
    },
    problemSummary: {
      type: 'STRING',
      description: 'Clear problem summary in your own words, maximum 2 sentences.',
    },
    example: {
      type: 'OBJECT',
      properties: {
        input: { type: 'STRING', description: 'Sample input representation' },
        output: { type: 'STRING', description: 'Sample expected output' },
      },
      required: ['input', 'output'],
    },
    keyInsights: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '2 to 3 concise, high-value insights or takeaways.',
    },
    approaches: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: {
            type: 'STRING',
            enum: ['Brute', 'Better', 'Optimal'],
            description: 'The tier of this approach.',
          },
          idea: { type: 'STRING', description: 'Core idea in 1-2 concise sentences.' },
          time: { type: 'STRING', description: 'Big-O time complexity (e.g. O(n)).' },
          space: { type: 'STRING', description: 'Big-O space complexity (e.g. O(1)).' },
        },
        required: ['name', 'idea', 'time', 'space'],
      },
      description: 'Approaches for this problem, reflecting submitted code and standard DSA solutions.',
    },
    edgeCases: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '3 to 4 critical edge cases to keep in mind.',
    },
    similarProblems: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Up to 3 similar LeetCode problem titles.',
    },
  },
  required: [
    'patternTag',
    'problemSummary',
    'example',
    'keyInsights',
    'approaches',
    'edgeCases',
    'similarProblems',
  ],
};

/**
 * Generates structured technical notes for a solved problem via Google Gemini's
 * generateContent API using structured JSON output (responseSchema).
 * Returns a discriminated result { ok: true, data } | { ok: false, reason }.
 * Automatically retries once on 429 or 5xx with backoff.
 */
export async function generateNotes(
  metadata: ProblemMetadata,
  apiKey: string,
  model: string = DEFAULT_GEMINI_MODEL,
  backoffMs = 1000,
): Promise<GeminiResult> {
  if (!apiKey || !apiKey.trim()) {
    return { ok: false, reason: 'invalid key' };
  }

  const prompt = buildNotesPrompt(metadata);
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: GEMINI_NOTES_SCHEMA,
    },
  };

  let currentModel = model?.trim() || DEFAULT_GEMINI_MODEL;
  let attempt = await callGenerateContentEndpoint(currentModel, apiKey, requestBody, backoffMs);

  // 404 Fallback sequence
  if (attempt.res?.status === 404) {
    console.warn(`[LWS] Model "${currentModel}" returned 404. Attempting fallback...`);

    if (currentModel !== FALLBACK_GEMINI_MODEL) {
      const fallbackAttempt = await callGenerateContentEndpoint(
        FALLBACK_GEMINI_MODEL,
        apiKey,
        requestBody,
        backoffMs,
      );

      if (fallbackAttempt.res?.ok) {
        attempt = fallbackAttempt;
        currentModel = FALLBACK_GEMINI_MODEL;
        await saveWorkingModelToConfig(FALLBACK_GEMINI_MODEL);
      } else if (fallbackAttempt.res?.status === 404) {
        attempt = fallbackAttempt;
      }
    }
  }

    if (attempt.res?.status === 404) {
      console.warn(`[LWS] Querying ListModels for available flash models...`);
      const discoveredModel = await discoverFlashModel(apiKey);
    }

  if (attempt.error || !attempt.res) {
    return { ok: false, reason: 'network' };
  }

  const res = attempt.res;

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      return { ok: false, reason: 'invalid key' };
    }
    if (res.status === 429) {
      return { ok: false, reason: 'rate limited' };
    }
    if (res.status === 404) {
      return { ok: false, reason: 'model not found' };
    }
    if (res.status >= 500) {
      return { ok: false, reason: 'server error' };
    }
    return { ok: false, reason: `API error (${res.status})` };
  }

  try {
    const rawData = await res.json();
    const text =
      rawData?.candidates?.[0]?.content?.parts?.[0]?.text ??
      rawData?.candidates?.[0]?.output ??
      '';

    if (!text || typeof text !== 'string') {
      return { ok: false, reason: 'bad JSON' };
    }

    const parsed = JSON.parse(text);

    if (
      !parsed ||
      typeof parsed !== 'object' ||
      typeof parsed.patternTag !== 'string' ||
      typeof parsed.problemSummary !== 'string' ||
      !parsed.example ||
      !Array.isArray(parsed.keyInsights) ||
      !Array.isArray(parsed.approaches) ||
      !Array.isArray(parsed.edgeCases) ||
      !Array.isArray(parsed.similarProblems)
    ) {
      return { ok: false, reason: 'bad JSON' };
    }

    return { ok: true, data: parsed as GeminiNotesData };
  } catch {
    return { ok: false, reason: 'bad JSON' };
  }
}

function buildNotesPrompt(metadata: ProblemMetadata): string {
  const parts: string[] = [
    `You are an expert Data Structures & Algorithms educator.`,
    `Analyze this solved problem and produce concise, high-signal technical notes.`,
    `Problem: ${metadata.id}. ${metadata.title}`,
    `Difficulty: ${metadata.difficulty}`,
    `Topics: ${metadata.topics.join(', ') || 'N/A'}`,
    `Language: ${metadata.language}`,
    `URL: ${metadata.url}`,
    '',
    'Optimal submitted code:',
    '```' + metadata.language,
    metadata.code,
    '```',
  ];

  if (metadata.approaches?.better) {
    parts.push(
      '',
      'Better approach code:',
      '```' + metadata.language,
      metadata.approaches.better,
      '```',
    );
  }

  if (metadata.approaches?.brute) {
    parts.push(
      '',
      'Brute approach code:',
      '```' + metadata.language,
      metadata.approaches.brute,
      '```',
    );
  }

  parts.push(
    '',
    'Instructions:',
    '1. problemSummary: Maximum 2 sentences in your own words. No filler words.',
    '2. patternTag: State the primary algorithmic pattern.',
    '3. example: Realistic minimal example with input and output.',
    '4. keyInsights: 2 to 3 bullet points explaining the core aha moments.',
    '5. approaches: Analyze the actual code provided. If better or brute was provided, evaluate them; otherwise include standard Brute/Better/Optimal progression for this problem. Keep ideas concise (1-2 sentences).',
    '6. edgeCases: 3 to 4 critical boundary conditions.',
    '7. similarProblems: Up to 3 problem titles.',
    'Keep every sentence punchy. No paragraph longer than 2 sentences.',
  );

  return parts.join('\n');
}

/**
 * Calls Gemini to generate a specific approach (Brute or Better) code
 * based on the optimal solution.
 */
export async function generateApproachCode(params: {
  metadata: ProblemMetadata;
  approachType: 'Brute' | 'Better';
  optimalCode: string;
  language: string;
  apiKey: string;
  model?: string;
  backoffMs?: number;
}): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  const { metadata, approachType, optimalCode, language, apiKey, model = DEFAULT_GEMINI_MODEL } = params;

  if (!apiKey || !apiKey.trim()) {
    return { ok: false, reason: 'invalid key' };
  }

  const prompt = [
    `You are an expert algorithm programmer.`,
    `Write the ${approachType} approach solution for LeetCode ${metadata.id}: ${metadata.title}.`,
    `Language: ${language}`,
    '',
    `Here is the Optimal solution for reference:`,
    '```' + language,
    optimalCode,
    '```',
    '',
    `Requirements:`,
    `- Output ONLY the raw executable ${language} code for the ${approachType} solution.`,
    `- Do NOT include markdown code fences (\`\`\`).`,
    `- Do NOT include explanatory text or greetings.`,
    `- Follow standard LeetCode class/method signature.`,
  ].join('\n');

  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
      }),
    });

    if (!res.ok) {
      if (res.status === 401 || res.status === 403) return { ok: false, reason: 'invalid key' };
      if (res.status === 429) return { ok: false, reason: 'rate limited' };
      if (res.status === 404) return { ok: false, reason: 'model not found' };
      return { ok: false, reason: `API error (${res.status})` };
    }

    const data = await res.json();
    let text: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.candidates?.[0]?.output ??
      '';

    // Strip any accidental markdown fences if returned
    text = text.replace(/^```[a-zA-Z0-9_-]*\n/, '').replace(/\n```\s*$/, '').trim();

    if (!text) {
      return { ok: false, reason: 'empty response' };
    }

    return { ok: true, code: text };
  } catch (err) {
    return { ok: false, reason: 'network' };
  }
}
