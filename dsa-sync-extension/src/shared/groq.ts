import type { ProblemMetadata } from './types.js';

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';

/**
 * Generates a short, per-problem README (approach explanation + complexity
 * analysis) via Groq's OpenAI-compatible chat completions API. This is a
 * best-effort enhancement, not a core requirement — any failure (missing key,
 * network error, rate limit, malformed response) returns null rather than
 * throwing, so a Groq outage or bad key can never block the actual GitHub sync,
 * which is the part that matters.
 */
export async function generateExplanation(
  metadata: ProblemMetadata,
  groqApiKey: string,
): Promise<string | null> {
  if (!groqApiKey) return null;

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.3,
        max_tokens: 500,
        messages: [
          {
            role: 'system',
            content:
              'You write extremely concise technical README notes for solved LeetCode problems. ' +
              'Output valid Markdown only, no preamble, no code fences around the whole response. ' +
              'Keep the approach explanation to 2-4 sentences. Never invent a complexity you cannot ' +
              'justify from the code — reason about the actual code given.',
          },
          {
            role: 'user',
            content: buildPrompt(metadata),
          },
        ],
      }),
    });

    if (!res.ok) {
      console.warn(`[LWS] Groq API returned ${res.status} — skipping AI explanation for this sync.`);
      return null;
    }

    const data = await res.json();
    const content: string | undefined = data?.choices?.[0]?.message?.content;
    if (!content || !content.trim()) return null;

    return content.trim();
  } catch (err) {
    console.warn('[LWS] Groq API call failed — skipping AI explanation for this sync.', err);
    return null;
  }
}

function buildPrompt(metadata: ProblemMetadata): string {
  return [
    `Problem: ${metadata.id}. ${metadata.title}`,
    `Difficulty: ${metadata.difficulty}`,
    `Topics: ${metadata.topics.join(', ') || 'unknown'}`,
    `Language: ${metadata.language}`,
    '',
    'Submitted solution:',
    '```' + metadata.language,
    metadata.code,
    '```',
    '',
    'Write a short README.md body with these sections, in this order:',
    '## Approach',
    '(2-4 sentences explaining the actual technique used in this code)',
    '## Complexity',
    '- Time: O(...) with a one-line justification',
    '- Space: O(...) with a one-line justification',
  ].join('\n');
}
