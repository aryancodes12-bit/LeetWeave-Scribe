/**
 * Runs in the page's MAIN world (real window.fetch, same scope as LeetCode's own
 * React app) so it can see the actual network traffic LeetCode makes — far more
 * resilient to LeetCode UI changes than scraping DOM elements, since the
 * submit/check API shape changes far less often than class names and layout.
 *
 * Strategy:
 *  1. Capture the request body of the POST to `/problems/{slug}/submit/` — this
 *     contains the actual submitted source code + language before LeetCode even
 *     knows if it's correct.
 *  2. Watch responses from the polling endpoint `/submissions/detail/{id}/check/`.
 *     When one comes back with status_msg === "Accepted", pair it with the most
 *     recently captured submission body and dispatch a DOM CustomEvent so the
 *     isolated-world content script (which has extension API access) can pick
 *     it up. CustomEvents on `window` cross the MAIN/ISOLATED world boundary.
 */

const EVENT_NAME = 'lws:accepted';

interface PendingSubmission {
  lang: string;
  code: string;
  capturedAt: number;
}

let lastSubmission: PendingSubmission | null = null;

const originalFetch = window.fetch;

window.fetch = async function patchedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

  // Capture outgoing submission bodies before we know the verdict.
  if (init?.method === 'POST' && /\/problems\/[^/]+\/(?:v\d+\/)?submit\/?$/.test(url) && init.body) {
    try {
      const parsed = JSON.parse(String(init.body));
      if (parsed?.typed_code && parsed?.lang) {
        lastSubmission = {
          lang: parsed.lang,
          code: parsed.typed_code,
          capturedAt: Date.now(),
        };
      }
    } catch {
      // Not JSON, or shape changed — ignore; the accepted-event just won't fire
      // for this submission, which is a safe (silent) failure mode, not a crash.
    }
  }

  const response = await originalFetch.call(window, input, init);

  // Watch the polling response for the accepted verdict. Confirmed against real
  // traffic: LeetCode's actual URL is .../submissions/detail/{id}/v2/check/ —
  // the "/v2/" segment is real and easy to miss; matched loosely here so a future
  // /v3/ (etc.) doesn't silently break this again.
  if (/\/submissions\/detail\/\d+\/(?:v\d+\/)?check\/?$/.test(url)) {
    response
      .clone()
      .json()
      .then((data) => {
        if (data?.state === 'SUCCESS' && data?.status_msg === 'Accepted' && lastSubmission) {
          // Only trust a submission captured recently (guards against a stale
          // capture being reused if a check poll fires unexpectedly late).
          const isRecent = Date.now() - lastSubmission.capturedAt < 5 * 60 * 1000;
          if (isRecent) {
            window.dispatchEvent(
              new CustomEvent(EVENT_NAME, {
                detail: {
                  lang: lastSubmission.lang,
                  code: lastSubmission.code,
                  runtime: data.status_runtime ?? null,
                  memory: data.status_memory ?? null,
                },
              }),
            );
            lastSubmission = null; // consume — one event per accepted submission
          }
        }
      })
      .catch(() => {
        // Response wasn't JSON or didn't match the expected shape — ignore.
      });
  }

  return response;
};
