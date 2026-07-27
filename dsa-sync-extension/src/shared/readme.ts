import type { SyncStats } from './types.js';

const MARKER_START = '<!-- dsa-sync:start -->';
const MARKER_END = '<!-- dsa-sync:end -->';

/** Identical logic to dsa-sync CLI's core/readme/generator.ts — idempotent,
 *  preserves hand-written content outside the marker block. Pure function. */
export function renderRootReadme(existingContent: string | null, stats: SyncStats): string {
  const block = renderStatsBlock(stats);

  if (!existingContent) return block;

  const hasMarkers = existingContent.includes(MARKER_START) && existingContent.includes(MARKER_END);
  if (!hasMarkers) {
    return `${existingContent.trimEnd()}\n\n${block}`;
  }

  const before = existingContent.slice(0, existingContent.indexOf(MARKER_START));
  const after = existingContent.slice(existingContent.indexOf(MARKER_END) + MARKER_END.length);
  return `${before}${block}${after}`;
}

function renderStatsBlock(stats: SyncStats): string {
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

function escapeMd(text: string): string {
  return text.replace(/([|*_`])/g, '\\$1');
}
