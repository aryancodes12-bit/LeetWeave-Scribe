/**
 * Runs in the page's MAIN world (real window.fetch, same scope as LeetCode's own
 * React app) so it can see the actual network traffic LeetCode makes.
 *
 * Captures:
 * 1. Submit requests to `/problems/{slug}/submit/`
 * 2. Run Code requests to `/problems/{slug}/interpret_solution/`
 * 3. Polling checks to `/submissions/detail/{id}/check/`
 */

const EVENT_NAME = 'lws:accepted';
const REQUEST_SNAPSHOTS_EVENT = 'lws:request_snapshots';
const SNAPSHOTS_RESPONSE_EVENT = 'lws:snapshots_response';

interface PendingSubmission {
  slug: string;
  lang: string;
  code: string;
  capturedAt: number;
}

let lastSubmission: PendingSubmission | null = null;
const snapshotsBySlug = new Map<string, string[]>();

function isStarterTemplate(code: string): boolean {
  const trimmed = code.trim();
  if (!trimmed || trimmed.length < 25) return true;

  // Strip single-line and multi-line comments
  const stripped = trimmed
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
    .replace(/#.*$/gm, '')
    .trim();

  const lines = stripped.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= 2) return true;

  // Check if it's only empty class/method boilerplate with pass or default return
  const normalized = stripped.replace(/\s+/g, ' ');
  if (
    /class\s+Solution\s*\{?\s*(?:public|def)?[^{}]*\{\s*(?:return\s*(?:null|0|false|\{\}|\[\])?;?)?\s*\}\s*\}?/.test(
      normalized,
    ) ||
    /class\s+Solution:\s*def\s+[a-zA-Z0-9_]+\([^)]*\):\s*(?:pass|return None)/.test(normalized)
  ) {
    return true;
  }

  return false;
}

function recordSnapshot(slug: string, code: string): void {
  if (!slug || !code || isStarterTemplate(code)) return;

  const current = snapshotsBySlug.get(slug) ?? [];
  const normalized = code.trim();

  // Deduplicate against existing snapshots
  if (current.some((s) => s.trim() === normalized)) return;

  const updated = [normalized, ...current].slice(0, 10);
  snapshotsBySlug.set(slug, updated);
}

const originalFetch = window.fetch;

window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // 1. Capture outgoing Run Code ("Run") requests
  const interpretMatch = url.match(/\/problems\/([^/]+)\/(?:v\d+\/)?interpret_solution\/?$/);
  if (init?.method === 'POST' && interpretMatch && init.body) {
    try {
      const slug = interpretMatch[1]!;
      const parsed = JSON.parse(String(init.body));
      if (parsed?.typed_code) {
        recordSnapshot(slug, String(parsed.typed_code));
      }
    } catch {
      // Ignore parse failure
    }
  }

  // 2. Capture outgoing submission ("Submit") bodies before verdict
  const submitMatch = url.match(/\/problems\/([^/]+)\/(?:v\d+\/)?submit\/?$/);
  if (init?.method === 'POST' && submitMatch && init.body) {
    try {
      const slug = submitMatch[1]!;
      const parsed = JSON.parse(String(init.body));
      if (parsed?.typed_code && parsed?.lang) {
        lastSubmission = {
          slug,
          lang: parsed.lang,
          code: parsed.typed_code,
          capturedAt: Date.now(),
        };
      }
    } catch {
      // Ignore parse failure
    }
  }

  const response = await originalFetch.call(window, input, init);

  // 3. Watch polling responses for the Accepted verdict
  if (/\/submissions\/detail\/\d+\/(?:v\d+\/)?check\/?$/.test(url)) {
    response
      .clone()
      .json()
      .then((data) => {
        if (data?.state === 'SUCCESS' && data?.status_msg === 'Accepted' && lastSubmission) {
          const isRecent = Date.now() - lastSubmission.capturedAt < 5 * 60 * 1000;
          if (isRecent) {
            const slug = lastSubmission.slug;
            const snapshots = snapshotsBySlug.get(slug) ?? [];

            window.dispatchEvent(
              new CustomEvent(EVENT_NAME, {
                detail: {
                  slug,
                  lang: lastSubmission.lang,
                  code: lastSubmission.code,
                  runtime: data.status_runtime ?? null,
                  memory: data.status_memory ?? null,
                  snapshots,
                },
              }),
            );
            lastSubmission = null; // Consume submission
          }
        }
      })
      .catch(() => {
        // Ignore response parse errors
      });
  }

  return response;
};

// Allow content script to query snapshots on demand
window.addEventListener(REQUEST_SNAPSHOTS_EVENT, (event: Event) => {
  const customEv = event as CustomEvent<{ slug: string }>;
  const slug = customEv?.detail?.slug;
  if (slug) {
    const snapshots = snapshotsBySlug.get(slug) ?? [];
    window.dispatchEvent(
      new CustomEvent(SNAPSHOTS_RESPONSE_EVENT, {
        detail: { slug, snapshots },
      }),
    );
  }
});
