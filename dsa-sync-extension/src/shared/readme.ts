import type { SyncStats } from './types.js';

// ─── Marker constants ────────────────────────────────────────────────────────
// New canonical marker pair used in both README targets.
const MARKER_START = '<!-- STATS:START -->';
const MARKER_END = '<!-- STATS:END -->';

// Legacy marker pair written by earlier versions of the engine.
// Recognized on read so existing organized/README.md files are migrated
// transparently on the next sync — no manual editing required.
const LEGACY_MARKER_START = '<!-- dsa-sync:start -->';
const LEGACY_MARKER_END = '<!-- dsa-sync:end -->';

// ─── Public variant types ────────────────────────────────────────────────────

export type ReadmeVariant = 'full' | 'compact';

// ─── Core public API ─────────────────────────────────────────────────────────

/**
 * Idempotent, marker-based README renderer. Replaces the content between
 * `<!-- STATS:START -->` and `<!-- STATS:END -->` with the rendered stats
 * block, leaving everything outside the markers exactly as-is.
 *
 * - `variant = 'full'`    → Progress heading + Recent Solutions table
 *                           (used for organized/README.md)
 * - `variant = 'compact'` → Single summary line + streak + link to full log
 *                           (used for root README.md)
 *
 * @param existingContent  Current file content, or null if the file doesn't
 *                         exist yet (the rendered block is returned as-is).
 * @param stats            Live stats computed by applySolvedProblem.
 * @param variant          Which template to use.
 * @param organizedPath    Path to the organized README, shown in the compact
 *                         "Full progress log →" link. Defaults to
 *                         "organized/README.md".
 */
export function renderReadme(
  existingContent: string | null,
  stats: SyncStats,
  variant: ReadmeVariant,
  organizedPath = 'organized/README.md',
): string {
  const block =
    variant === 'compact'
      ? renderCompactBlock(stats, organizedPath)
      : renderFullBlock(stats);

  if (!existingContent) return block;

  // Migrate legacy markers to new markers so we can use a single code path.
  const content = migrateLegacyMarkers(existingContent);

  const hasMarkers = content.includes(MARKER_START) && content.includes(MARKER_END);
  if (!hasMarkers) {
    // No markers at all — append block at the end (first-run behaviour).
    return `${content.trimEnd()}\n\n${block}`;
  }

  const before = content.slice(0, content.indexOf(MARKER_START));
  const after = content.slice(content.indexOf(MARKER_END) + MARKER_END.length);
  return `${before}${block}${after}`;
}

/**
 * Returns a simple before/after diff string showing what `renderReadme`
 * *would* write, without touching any file. Designed for `--dry-run` output.
 * Returns an empty string when the file would not change.
 */
export function diffReadme(
  existingContent: string | null,
  stats: SyncStats,
  variant: ReadmeVariant,
  organizedPath = 'organized/README.md',
): string {
  const next = renderReadme(existingContent, stats, variant, organizedPath);
  const prev = existingContent ?? '';

  if (prev === next) return '';

  // Produce a simple line-by-line diff (--- / +++ style) without requiring
  // a diff library — just enough to see what changed in a dry-run log.
  const prevLines = prev.split('\n');
  const nextLines = next.split('\n');

  const removed = prevLines
    .filter((l) => !nextLines.includes(l))
    .map((l) => `- ${l}`)
    .join('\n');
  const added = nextLines
    .filter((l) => !prevLines.includes(l))
    .map((l) => `+ ${l}`)
    .join('\n');

  return [removed, added].filter(Boolean).join('\n');
}

// ─── Block renderers ─────────────────────────────────────────────────────────

/**
 * Full block: Progress heading + difficulty breakdown + Recent Solutions table.
 * Written to `organized/README.md`.
 */
export function renderFullBlock(stats: SyncStats): string {
  const recentTable = stats.recent
    .map((r) => `| ${r.id} | ${escapeMd(r.title)} | ${r.difficulty} | ${r.language} | ${r.date} |`)
    .join('\n');

  return [
    MARKER_START,
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
    MARKER_END,
  ].join('\n');
}

/**
 * Compact block: one-liner summary + difficulty counts + link to full log.
 * Written to the root `README.md` so it stays readable without cluttering the
 * hand-maintained topic index.
 *
 * Example output (between markers):
 *   📊 14 problems solved · 🔥 5 day streak (longest: 6)
 *   Easy: 9 · Medium: 5 · Hard: 0
 *   📁 [Full progress log →](organized/README.md)
 */
export function renderCompactBlock(
  stats: SyncStats,
  organizedPath = 'organized/README.md',
): string {
  return [
    MARKER_START,
    `📊 **${stats.total}** problems solved · 🔥 **${stats.currentStreak}** day streak (longest: ${stats.longestStreak})`,
    `Easy: ${stats.easy} · Medium: ${stats.medium} · Hard: ${stats.hard}`,
    `📁 [Full progress log →](${organizedPath})`,
    MARKER_END,
  ].join('\n');
}

// ─── Backward-compat alias ───────────────────────────────────────────────────

/**
 * @deprecated Use `renderReadme(content, stats, 'full')` instead.
 *             Kept for any callers not yet migrated to the new API.
 */
export function renderRootReadme(existingContent: string | null, stats: SyncStats): string {
  return renderReadme(existingContent, stats, 'full');
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/** Replace legacy `dsa-sync:start/end` markers with the canonical STATS markers. */
function migrateLegacyMarkers(content: string): string {
  return content
    .replace(LEGACY_MARKER_START, MARKER_START)
    .replace(LEGACY_MARKER_END, MARKER_END);
}

function escapeMd(text: string): string {
  return text.replace(/([|*_`])/g, '\\$1');
}
