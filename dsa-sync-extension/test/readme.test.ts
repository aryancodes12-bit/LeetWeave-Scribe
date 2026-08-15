import { describe, expect, it } from 'vitest';
import {
  renderRootReadme,
  renderCompactReadme,
  renderFullBlock,
  renderCompactBlock,
} from '../src/shared/readme.js';
import { emptyStats } from '../src/shared/stats.js';
import type { SyncStats } from '../src/shared/types.js';

const MARKER_START = '<!-- dsa-sync:start -->';
const MARKER_END = '<!-- dsa-sync:end -->';

function makeStats(overrides: Partial<SyncStats> = {}): SyncStats {
  return {
    ...emptyStats(),
    total: 14,
    easy: 9,
    medium: 5,
    hard: 0,
    currentStreak: 5,
    longestStreak: 6,
    lastSyncedAt: '2026-08-15T17:00:00.000Z',
    recent: [
      { id: 1, title: 'Two Sum', difficulty: 'Easy', language: 'java', date: '2026-08-15' },
    ],
    ...overrides,
  };
}

const STATS = makeStats();

describe('renderFullBlock vs renderCompactBlock structure', () => {
  it('renderFullBlock output contains the Recent Solutions table header; renderCompactBlock output does not', () => {
    const fullBlock = renderFullBlock(STATS);
    const compactBlock = renderCompactBlock(STATS, 'organized/README.md');

    expect(fullBlock).toContain('| # | Problem | Difficulty | Language | Date |');
    expect(compactBlock).not.toContain('| # | Problem | Difficulty | Language | Date |');
  });

  it('renderCompactBlock output contains a link containing the passed organizedPath; renderFullBlock does not', () => {
    const customPath = 'custom/organized/README.md';
    const compactBlock = renderCompactBlock(STATS, customPath);
    const fullBlock = renderFullBlock(STATS);

    expect(compactBlock).toContain(`[Full progress log →](${customPath})`);
    expect(fullBlock).not.toContain('[Full progress log →]');
  });
});

describe('marker replacement preserves surrounding content', () => {
  it('preserves arbitrary hand-written content both before and after the markers, for both variants', () => {
    const before = '# Header Title\n\nSome hand-written intro.\n\n';
    const after = '\n\n## 📁 Hand-maintained Topic Table\n\n| Topic | Solved |\n|---|---|\n';
    const existing = `${before}${MARKER_START}\nold content\n${MARKER_END}${after}`;

    const fullResult = renderRootReadme(existing, STATS);
    expect(fullResult.startsWith(before)).toBe(true);
    expect(fullResult.endsWith(after)).toBe(true);
    expect(fullResult).toContain('## 📊 Progress');

    const compactResult = renderCompactReadme(existing, STATS, 'organized/README.md');
    expect(compactResult.startsWith(before)).toBe(true);
    expect(compactResult.endsWith(after)).toBe(true);
    expect(compactResult).toContain('[Full progress log →](organized/README.md)');
  });
});

describe('first-run / no-marker behavior', () => {
  it('when no markers exist yet, the block gets appended below existing content, not replacing it — for both variants', () => {
    const existingNoMarkers = '# Existing LeetHub Content\n\nHand-maintained content here.';

    const fullResult = renderRootReadme(existingNoMarkers, STATS);
    expect(fullResult.startsWith(existingNoMarkers.trimEnd())).toBe(true);
    expect(fullResult).toContain(MARKER_START);
    expect(fullResult).toContain('## 📊 Progress');
    expect(fullResult).toContain(MARKER_END);

    const compactResult = renderCompactReadme(existingNoMarkers, STATS, 'organized/README.md');
    expect(compactResult.startsWith(existingNoMarkers.trimEnd())).toBe(true);
    expect(compactResult).toContain(MARKER_START);
    expect(compactResult).toContain('[Full progress log →](organized/README.md)');
    expect(compactResult).toContain(MARKER_END);
  });
});

describe('idempotency', () => {
  it('calling renderCompactReadme twice in a row with identical stats produces byte-identical output, markers not duplicated', () => {
    const initial = '# Header\n\n<!-- dsa-sync:start -->\nold\n<!-- dsa-sync:end -->\n\n# Footer';
    
    const firstRun = renderCompactReadme(initial, STATS, 'organized/README.md');
    const secondRun = renderCompactReadme(firstRun, STATS, 'organized/README.md');

    expect(secondRun).toBe(firstRun);

    const startCount = (secondRun.match(/<!-- dsa-sync:start -->/g) || []).length;
    const endCount = (secondRun.match(/<!-- dsa-sync:end -->/g) || []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it('calling renderRootReadme twice in a row with identical stats produces byte-identical output, markers not duplicated', () => {
    const initial = '# Header\n\n<!-- dsa-sync:start -->\nold\n<!-- dsa-sync:end -->\n\n# Footer';

    const firstRun = renderRootReadme(initial, STATS);
    const secondRun = renderRootReadme(firstRun, STATS);

    expect(secondRun).toBe(firstRun);

    const startCount = (secondRun.match(/<!-- dsa-sync:start -->/g) || []).length;
    const endCount = (secondRun.match(/<!-- dsa-sync:end -->/g) || []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });
});
