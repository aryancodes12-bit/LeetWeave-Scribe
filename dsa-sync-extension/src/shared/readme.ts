import type { SyncStats } from './types.js';

// ─── Marker constants ────────────────────────────────────────────────────────
// These are the canonical markers used in every README target. All content
// between them is owned by the sync engine; everything outside is hand-written
// and never touched.
const MARKER_START = '<!-- dsa-sync:start -->';
const MARKER_END = '<!-- dsa-sync:end -->';

// ─── Public entry points ─────────────────────────────────────────────────────

/**
 * Idempotent marker-based writer for `organized/README.md`.
 * Replaces the content between `<!-- dsa-sync:start -->` and
 * `<!-- dsa-sync:end -->` with the full Progress + Recent Solutions block,
 * leaving everything outside the markers exactly as-is.
 *
 * @param existingContent  Current file content, or null for a brand-new file.
 * @param stats            Live stats object from applySolvedProblem.
 */
export function renderRootReadme(existingContent: string | null, stats: SyncStats): string {
  return applyMarkers(existingContent, renderFullBlock(stats));
}

/**
 * Idempotent marker-based writer for the repo-root `README.md`.
 * Writes a compact one-liner summary + link instead of the full table, so the
 * hand-maintained topic index below is never disturbed.
 *
 * @param existingContent  Current file content, or null for a brand-new file.
 * @param stats            Live stats object from applySolvedProblem.
 * @param organizedPath    Repo-relative path to the full progress README
 *                         (e.g. `"organized/README.md"`). Shown in the link.
 */
export function renderCompactReadme(
  existingContent: string | null,
  stats: SyncStats,
  organizedPath: string,
): string {
  return applyMarkers(existingContent, renderCompactBlock(stats, organizedPath));
}

// ─── Block builders (pure, no I/O, no markers) ───────────────────────────────

/**
 * Builds the full stats block content (without wrapper markers).
 * Written inside the marker pair by renderRootReadme.
 *
 * Includes:
 *   - ## 📊 Progress heading
 *   - Easy / Medium / Hard counts
 *   - ## Recent Solutions table
 *   - Last-synced timestamp
 */
export function renderFullBlock(stats: SyncStats): string {
  const recentTable = stats.recent
    .map((r) => `| ${r.id} | ${escapeMd(r.title)} | ${r.difficulty} | ${r.language} | ${r.date} |`)
    .join('\n');

  return [
    '## 📊 Progress',
    '',
    `✔ **${stats.total}** problems solved · 🔥 **${stats.currentStreak}** day streak (longest: ${stats.longestStreak})`,
    '',
    `- Easy: ${stats.easy}`,
    `- Medium: ${stats.medium}`,
    `- Hard: ${stats.hard}`,
    '',
    '## Recent Solutions',
    '',
    '| # | Problem | Difficulty | Language | Date |',
    '|---|---------|------------|----------|------|',
    recentTable || '| — | _none yet_ | — | — | — |',
    '',
    `_Last synced: ${stats.lastSyncedAt ?? 'never'}_`,
  ].join('\n');
}

/**
 * Builds the compact stats block content (without wrapper markers).
 * Written inside the marker pair by renderCompactReadme.
 *
 * Example output:
 *   📊 **14** problems solved · 🔥 **5** day streak (longest: 6)
 *   Easy: 9 · Medium: 5 · Hard: 0
 *   📁 [Full progress log →](organized/README.md)
 *
 * @param organizedPath  Repo-relative path shown in the "Full progress log" link.
 */
export function renderCompactBlock(stats: SyncStats, organizedPath: string): string {
  return [
    `📊 **${stats.total}** problems solved · 🔥 **${stats.currentStreak}** day streak (longest: ${stats.longestStreak})`,
    `Easy: ${stats.easy} · Medium: ${stats.medium} · Hard: ${stats.hard}`,
    `📁 [Full progress log →](${organizedPath})`,
  ].join('\n');
}

// ─── Internal helper ─────────────────────────────────────────────────────────

/**
 * Shared marker-replacement logic used by both renderRootReadme and
 * renderCompactReadme. Wraps `block` in the canonical marker pair, then:
 *
 * - If existingContent is null  → returns the wrapped block as-is (new file).
 * - If markers are present      → slices before/after and splices the block in.
 * - If no markers found yet     → appends the wrapped block below existing content.
 *
 * The before/after slice approach makes every write idempotent: running twice
 * on the same data produces byte-identical output with no marker duplication.
 */
function applyMarkers(existingContent: string | null, block: string): string {
  const wrapped = `${MARKER_START}\n${block}\n${MARKER_END}`;

  if (!existingContent) return wrapped;

  const hasMarkers =
    existingContent.includes(MARKER_START) && existingContent.includes(MARKER_END);

  if (!hasMarkers) {
    // First run on a file that already has hand-written content but no markers
    // (e.g. an existing LeetHub-generated README). Append below existing content.
    return `${existingContent.trimEnd()}\n\n${wrapped}`;
  }

  const before = existingContent.slice(0, existingContent.indexOf(MARKER_START));
  const after = existingContent.slice(existingContent.indexOf(MARKER_END) + MARKER_END.length);
  return `${before}${wrapped}${after}`;
}

// ─── Internal utilities ───────────────────────────────────────────────────────

function escapeMd(text: string): string {
  return text.replace(/([|*_`])/g, '\\$1');
}
