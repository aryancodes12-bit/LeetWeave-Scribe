/**
 * __GROQ_API_KEY__ is replaced at build time by esbuild's `define` (see build.mjs)
 * with the value of GROQ_API_KEY from .env (gitignored, never committed). It is
 * NOT read from chrome.storage or entered by the user — this is a developer-owned
 * key baked into the build, not a per-user credential.
 *
 * Security note (see build.mjs and .env.example for the full explanation): baking
 * a key into a browser extension only keeps it out of git — it does not hide it
 * from anyone who has the extension installed, since the built JS is fully
 * readable. Acceptable for personal use; do not publish this build publicly with
 * a real key inside it.
 */
declare const __GROQ_API_KEY__: string;

export const GROQ_API_KEY: string = typeof __GROQ_API_KEY__ !== 'undefined' ? __GROQ_API_KEY__ : '';
