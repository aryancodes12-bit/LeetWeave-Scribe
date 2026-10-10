import type { GeminiNotesData, GeminiResult, ProblemMetadata } from './types.js';

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
export const FALLBACK_GEMINI_MODEL = 'gemini-flash-latest';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export const GEMINI_NOTES_SCHEMA = {
  type: 'OBJECT',
  properties: {
    patternTag: {
      type: 'STRING',
      description: 'Core algorithmic pattern (e.g. Two Pointers, DFS). Maximum 4 words.',
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
      description: 'Exactly 2 concise, high-value insights. Max 2 sentences each.',
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
          idea: { type: 'STRING', description: 'Core idea in maximum 2 sentences.' },
          time: { type: 'STRING', description: 'Big-O time complexity (e.g. O(n)).' },
          space: { type: 'STRING', description: 'Big-O space complexity (e.g. O(1)).' },
        },
        required: ['name', 'idea', 'time', 'space'],
      },
      description: '1 to 2 approaches (Optimal, and Brute/Better if provided).',
    },
    edgeCases: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: '2 to 3 critical edge cases. Max 1 sentence each.',
    },
    similarProblems: {
      type: 'ARRAY',
      items: { type: 'STRING' },
      description: 'Up to 2 similar LeetCode problem titles.',
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

export function buildGenerationConfig(model: string): Record<string, unknown> {
  const config: Record<string, unknown> = {
    responseMimeType: 'application/json',
    responseSchema: GEMINI_NOTES_SCHEMA,
    temperature: 0.3,
    maxOutputTokens: 900,
  };

  const isOlder1x = model.includes('1.5') || model.includes('1.0');
  if (!isOlder1x) {
    config.thinkingConfig = {
      thinkingBudget: 0,
    };
  }

  return config;
}

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
    // Response body not JSON or not readable
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
    // ListModels failed
  }
  return null;
}

/**
 * Executes a single generateContent call with retry on 429 and 5xx,
 * backed by a 20-second AbortController timeout.
 */
async function callGenerateContentEndpoint(
  model: string,
  apiKey: string,
  requestBody: unknown,
  backoffMs: number,
  timeoutMs = 20000,
): Promise<{ res?: Response; error?: unknown }> {
  const endpoint = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent`;

  const doFetch = async (): Promise<{ res?: Response; error?: unknown }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort(new Error('Gemini API request timed out after 20s'));
    }, timeoutMs);

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey.trim(),
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return { res };
    } catch (error) {
      clearTimeout(timer);
      if (
        (error instanceof Error && error.name === 'AbortError') ||
        controller.signal.aborted
      ) {
        return { error: new Error('Gemini API request timed out after 20s') };
      }
      return { error };
    }
  };

  let attempt = await doFetch();

  // Retry once on 429 or 5xx with backoff (only if not aborted)
  if (attempt.res && (attempt.res.status === 429 || attempt.res.status >= 500)) {
    if (backoffMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
    }
    attempt = await doFetch();
  }

  return attempt;
}

/**
 * Generates structured technical notes for a solved problem via Google Gemini's
 * generateContent API using structured JSON output (responseSchema).
 * 
 * If a 404 "model not found" occurs:
 * 1. Automatically retries with "gemini-flash-latest".
 * 2. If that also fails, queries GET /v1beta/models using x-goog-api-key,
 *    picks the first model supporting generateContent whose name contains "flash",
 *    and retries with it.
 * 3. Saves the working model name back to config.
 * 4. Includes HTTP status and Google's error.message in failure reasons.
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
  let currentModel = model?.trim() || DEFAULT_GEMINI_MODEL;
  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: buildGenerationConfig(currentModel),
  };

  let attempt = await callGenerateContentEndpoint(currentModel, apiKey, requestBody, backoffMs);

  // 404 Fallback sequence
  if (attempt.res?.status === 404) {
    console.warn(`[LWS] Model "${currentModel}" returned 404. Attempting fallback...`);

    // Fallback 1: Try gemini-flash-latest
    if (currentModel !== FALLBACK_GEMINI_MODEL) {
      const fallbackRequestBody = {
        ...requestBody,
        generationConfig: buildGenerationConfig(FALLBACK_GEMINI_MODEL),
      };
      const fallbackAttempt = await callGenerateContentEndpoint(
        FALLBACK_GEMINI_MODEL,
        apiKey,
        fallbackRequestBody,
        backoffMs,
      );

      if (fallbackAttempt.res?.ok) {
        attempt = fallbackAttempt;
        currentModel = FALLBACK_GEMINI_MODEL;
        await saveWorkingModelToConfig(FALLBACK_GEMINI_MODEL);
      } else if (fallbackAttempt.res?.status === 404) {
        attempt = fallbackAttempt; // update attempt with latest 404
      }
    }

    // Fallback 2: Query ListModels for the first flash model
    if (attempt.res?.status === 404) {
      console.warn(`[LWS] Querying ListModels for available flash models...`);
      const discoveredModel = await discoverFlashModel(apiKey);

      if (discoveredModel && discoveredModel !== currentModel && discoveredModel !== FALLBACK_GEMINI_MODEL) {
        const discoveredRequestBody = {
          ...requestBody,
          generationConfig: buildGenerationConfig(discoveredModel),
        };
        const discoveredAttempt = await callGenerateContentEndpoint(
          discoveredModel,
          apiKey,
          discoveredRequestBody,
          backoffMs,
        );

        if (discoveredAttempt.res?.ok) {
          attempt = discoveredAttempt;
          currentModel = discoveredModel;
          await saveWorkingModelToConfig(discoveredModel);
        } else {
          attempt = discoveredAttempt;
        }
      }
    }
  }

  if (attempt.error || !attempt.res) {
    const errorMsg =
      attempt.error instanceof Error ? attempt.error.message : String(attempt.error ?? '');
    if (errorMsg.includes('timed out')) {
      return { ok: false, reason: 'Gemini API request timed out after 20s' };
    }
    return { ok: false, reason: 'network' };
  }

  const res = attempt.res;

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const reason = await formatHttpFailureReason(res, 'invalid key');
      return { ok: false, reason, status: res.status };
    }
    if (res.status === 429) {
      const reason = await formatHttpFailureReason(res, 'rate limited');
      return { ok: false, reason, status: res.status };
    }
    if (res.status === 404) {
      const reason = await formatHttpFailureReason(res, 'model not found');
      return { ok: false, reason, status: res.status };
    }
    if (res.status >= 500) {
      const reason = await formatHttpFailureReason(res, 'server error');
      return { ok: false, reason, status: res.status };
    }
    const reason = await formatHttpFailureReason(res, 'API error');
    return { ok: false, reason, status: res.status };
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

    return { ok: true, data: parsed as GeminiNotesData, workingModel: currentModel };
  } catch {
    return { ok: false, reason: 'bad JSON' };
  }
}

function buildNotesPrompt(metadata: ProblemMetadata): string {
  const parts: string[] = [
    `DSA Educator: Produce concise notes for LeetCode ${metadata.id}: ${metadata.title} (${metadata.difficulty}).`,
    `Topics: ${metadata.topics.join(', ') || 'N/A'}. Language: ${metadata.language}.`,
    '',
    'Code:',
    '```' + metadata.language,
    metadata.code,
    '```',
  ];

  if (metadata.approaches?.better) {
    parts.push('Better code:', '```' + metadata.language, metadata.approaches.better, '```');
  }

  if (metadata.approaches?.brute) {
    parts.push('Brute code:', '```' + metadata.language, metadata.approaches.brute, '```');
  }

  parts.push(
    '',
    'Rules:',
    '1. problemSummary: Clear summary in your own words, maximum 2 sentences.',
    '2. patternTag: Primary algorithmic pattern.',
    '3. example: Realistic minimal example with input and output.',
    '4. keyInsights: Exactly 2 concise insights (max 2 sentences each).',
    '5. approaches: 1-2 approaches with idea in max 2 sentences.',
    '6. edgeCases: 2-3 boundary conditions (max 1 sentence each).',
    '7. similarProblems: Up to 2 problem titles.',
    'Output valid JSON strictly following schema. Maximum 2 sentences per text field.',
  );

  return parts.join('\n');
}

/**
 * Calls Gemini to generate a specific approach (Brute or Better) code
 * based on the optimal solution. Supports 404 fallback chain as well.
 */
export async function generateApproachCode(params: {
  metadata: ProblemMetadata;
  approachType: 'Brute' | 'Better';
  optimalCode: string;
  language: string;
  apiKey: string;
  model?: string;
  backoffMs?: number;
}): Promise<{ ok: true; code: string; workingModel?: string } | { ok: false; reason: string }> {
  const { metadata, approachType, optimalCode, language, apiKey, backoffMs = 1000 } = params;

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

  const requestBody = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.3,
      maxOutputTokens: 1200,
    },
  };

  let currentModel = params.model?.trim() || DEFAULT_GEMINI_MODEL;
  let attempt = await callGenerateContentEndpoint(currentModel, apiKey, requestBody, backoffMs);

  // 404 Fallback sequence
  if (attempt.res?.status === 404) {
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

    if (attempt.res?.status === 404) {
      const discoveredModel = await discoverFlashModel(apiKey);
      if (discoveredModel && discoveredModel !== currentModel && discoveredModel !== FALLBACK_GEMINI_MODEL) {
        const discoveredAttempt = await callGenerateContentEndpoint(
          discoveredModel,
          apiKey,
          requestBody,
          backoffMs,
        );
        if (discoveredAttempt.res?.ok) {
          attempt = discoveredAttempt;
          currentModel = discoveredModel;
          await saveWorkingModelToConfig(discoveredModel);
        } else {
          attempt = discoveredAttempt;
        }
      }
    }
  }

  if (attempt.error || !attempt.res) {
    const errorMsg =
      attempt.error instanceof Error ? attempt.error.message : String(attempt.error ?? '');
    if (errorMsg.includes('timed out')) {
      return { ok: false, reason: 'Gemini API request timed out after 20s' };
    }
    return { ok: false, reason: 'network' };
  }

  const res = attempt.res;

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      const reason = await formatHttpFailureReason(res, 'invalid key');
      return { ok: false, reason };
    }
    if (res.status === 429) {
      const reason = await formatHttpFailureReason(res, 'rate limited');
      return { ok: false, reason };
    }
    if (res.status === 404) {
      const reason = await formatHttpFailureReason(res, 'model not found');
      return { ok: false, reason };
    }
    const reason = await formatHttpFailureReason(res, `API error (${res.status})`);
    return { ok: false, reason };
  }

  try {
    const data = await res.json();
    let text: string =
      data?.candidates?.[0]?.content?.parts?.[0]?.text ??
      data?.candidates?.[0]?.output ??
      '';

    text = text.replace(/^```[a-zA-Z0-9_-]*\n/, '').replace(/\n```\s*$/, '').trim();

    if (!text) {
      return { ok: false, reason: 'empty response' };
    }

    return { ok: true, code: text, workingModel: currentModel };
  } catch {
    return { ok: false, reason: 'bad JSON' };
  }
}
