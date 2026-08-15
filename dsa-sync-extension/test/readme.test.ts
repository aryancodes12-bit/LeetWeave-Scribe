import { describe, expect, it } from 'vitest';
import {
  renderReadme,
  renderFullBlock,
  renderCompactBlock,
  diffReadme,
  renderRootReadme,
} from '../src/shared/readme.js';
import { emptyStats } from '../src/shared/stats.js';
import type { SyncStats } from '../src/shared/types.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MARKER_START = '<!-- STATS:START -->';
const MARKER_END = '<!-- STATS:END -->';

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

// ─────────────────────────────────────────────────────────────────────────────
// (a) Marker-based replacement — surrounding content left untouched
// ─────────────────────────────────────────────────────────────────────────────

describe('(a) marker-based replacement — surrounding content untouched', () => {
  it('preserves content BEFORE the marker block exactly', () => {
    const before = '# My Repo\n\nSome hand-written intro.\n\n';
    const existing = `${before}${MARKER_START}\nold block\n${MARKER_END}\n`;
    const result = renderReadme(existing, STATS, 'full');
    expect(result.startsWith(before)).toBe(true);
  });

  it('preserves content AFTER the marker block exactly', () => {
    const after = '\n\n## 📁 Array\n\n| Problem | Difficulty |\n|---|---|\n';
    const existing = `${MARKER_START}\nold block\n${MARKER_END}${after}`;
    const result = renderReadme(existing, STATS, 'full');
    expect(result.endsWith(after)).toBe(true);
  });

  it('handles markers with content both before and after', () => {
    const before = 'HEADER\n\n';
    const after = '\n\nFOOTER';
    const existing = `${before}${MARKER_START}\nstale\n${MARKER_END}${after}`;
    const result = renderReadme(existing, STATS, 'compact');
    expect(result.startsWith(before)).toBe(true);
    expect(result.endsWith(after)).toBe(true);
  });

  it('when no markers present, appends block to existing content without altering it', () => {
    const noMarkers = '# Project\n\nSome content here.';
    const result = renderReadme(noMarkers, STATS, 'full');
    // Original content must still be present
    expect(result).toContain('# Project');
    expect(result).toContain('Some content here.');
    // Block must be appended
    expect(result).toContain(MARKER_START);
    expect(result).toContain(MARKER_END);
  });

  it('when existingContent is null, returns just the block (new file)', () => {
    const result = renderReadme(null, STATS, 'full');
    expect(result.startsWith(MARKER_START)).toBe(true);
    expect(result).toContain(MARKER_END);
  });

  it('never touches hand-written topic tables that live outside markers', () => {
    const topicTable = '## Array\n| Problem | Diff |\n|---|---|\n| Two Sum | Easy |\n';
    const existing = `${MARKER_START}\nold\n${MARKER_END}\n\n${topicTable}`;
    const result = renderReadme(existing, STATS, 'compact');
    expect(result).toContain(topicTable);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (b) Compact vs full template selection per target
// ─────────────────────────────────────────────────────────────────────────────

describe('(b) compact vs full template selection', () => {
  it('full variant includes the Progress heading', () => {
    const block = renderFullBlock(STATS);
    expect(block).toContain('## 📊 Progress');
  });

  it('full variant includes the Recent Solutions table header', () => {
    const block = renderFullBlock(STATS);
    expect(block).toContain('| # | Problem | Difficulty | Language | Date |');
  });

  it('full variant includes problem rows from stats.recent', () => {
    const block = renderFullBlock(STATS);
    expect(block).toContain('Two Sum');
  });

  it('full variant includes the Last synced timestamp', () => {
    const block = renderFullBlock(STATS);
    expect(block).toContain('_Last synced:');
  });

  it('compact variant includes the summary emoji line with live numbers', () => {
    const block = renderCompactBlock(STATS);
    expect(block).toContain('📊 **14** problems solved · 🔥 **5** day streak (longest: 6)');
  });

  it('compact variant includes the difficulty breakdown line', () => {
    const block = renderCompactBlock(STATS);
    expect(block).toContain('Easy: 9 · Medium: 5 · Hard: 0');
  });

  it('compact variant includes the "Full progress log →" link', () => {
    const block = renderCompactBlock(STATS);
    expect(block).toContain('[Full progress log →](organized/README.md)');
  });

  it('compact variant uses a custom organizedPath when provided', () => {
    const block = renderCompactBlock(STATS, 'docs/progress.md');
    expect(block).toContain('[Full progress log →](docs/progress.md)');
  });

  it('compact variant does NOT include the Recent Solutions table', () => {
    const block = renderCompactBlock(STATS);
    expect(block).not.toContain('| # | Problem');
    expect(block).not.toContain('Two Sum');
  });

  it('full variant does NOT include the compact "Full progress log →" link', () => {
    const block = renderFullBlock(STATS);
    expect(block).not.toContain('Full progress log →');
  });

  it('renderReadme with variant="full" produces same output as renderFullBlock wrapped in markers', () => {
    const direct = renderFullBlock(STATS);
    const viaRender = renderReadme(null, STATS, 'full');
    expect(viaRender).toBe(direct);
  });

  it('renderReadme with variant="compact" produces same output as renderCompactBlock wrapped in markers', () => {
    const direct = renderCompactBlock(STATS);
    const viaRender = renderReadme(null, STATS, 'compact');
    expect(viaRender).toBe(direct);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// (c) Idempotency — running twice produces identical output
// ─────────────────────────────────────────────────────────────────────────────

describe('(c) idempotency on repeated runs', () => {
  it('full variant: second render produces byte-identical output', () => {
    const first = renderReadme(null, STATS, 'full');
    const second = renderReadme(first, STATS, 'full');
    expect(second).toBe(first);
  });

  it('compact variant: second render produces byte-identical output', () => {
    const first = renderReadme(null, STATS, 'compact');
    const second = renderReadme(first, STATS, 'compact');
    expect(second).toBe(first);
  });

  it('markers are not duplicated on the second run', () => {
    const first = renderReadme(null, STATS, 'full');
    const second = renderReadme(first, STATS, 'full');
    const startCount = (second.match(/<!-- STATS:START -->/g) ?? []).length;
    const endCount = (second.match(/<!-- STATS:END -->/g) ?? []).length;
    expect(startCount).toBe(1);
    expect(endCount).toBe(1);
  });

  it('surrounding content is unchanged after two runs (full)', () => {
    const surrounding = 'BEFORE\n\n';
    const after = '\n\nAFTER';
    const initial = `${surrounding}${MARKER_START}\nold\n${MARKER_END}${after}`;
    const once = renderReadme(initial, STATS, 'full');
    const twice = renderReadme(once, STATS, 'full');
    expect(twice.startsWith(surrounding)).toBe(true);
    expect(twice.endsWith(after)).toBe(true);
  });

  it('surrounding content is unchanged after two runs (compact)', () => {
    const surrounding = 'TOP\n\n';
    const after = '\n\nBOTTOM';
    const initial = `${surrounding}${MARKER_START}\nstale\n${MARKER_END}${after}`;
    const once = renderReadme(initial, STATS, 'compact');
    const twice = renderReadme(once, STATS, 'compact');
    expect(twice.startsWith(surrounding)).toBe(true);
    expect(twice.endsWith(after)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy marker migration
// ─────────────────────────────────────────────────────────────────────────────

describe('legacy dsa-sync marker migration', () => {
  it('recognizes old <!-- dsa-sync:start/end --> markers and replaces the block', () => {
    const legacy =
      'BEFORE\n\n<!-- dsa-sync:start -->\nstale old block\n<!-- dsa-sync:end -->\n\nAFTER';
    const result = renderReadme(legacy, STATS, 'full');
    // Old markers should be gone
    expect(result).not.toContain('<!-- dsa-sync:start -->');
    expect(result).not.toContain('<!-- dsa-sync:end -->');
    // New markers should be present
    expect(result).toContain(MARKER_START);
    expect(result).toContain(MARKER_END);
    // Surrounding content untouched
    expect(result).toContain('BEFORE');
    expect(result).toContain('AFTER');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// diffReadme
// ─────────────────────────────────────────────────────────────────────────────

describe('diffReadme', () => {
  it('returns a non-empty string when the file would change', () => {
    const existing = `${MARKER_START}\nold content here\n${MARKER_END}`;
    const diff = diffReadme(existing, STATS, 'full');
    expect(diff.length).toBeGreaterThan(0);
  });

  it('returns an empty string when the file is already up to date (no change)', () => {
    // Render once, then diff against the same stats — no change expected.
    const upToDate = renderReadme(null, STATS, 'compact');
    const diff = diffReadme(upToDate, STATS, 'compact');
    expect(diff).toBe('');
  });

  it('shows removed lines prefixed with "- " and added lines prefixed with "+ "', () => {
    const existing = `${MARKER_START}\nold line\n${MARKER_END}`;
    const diff = diffReadme(existing, STATS, 'full');
    expect(diff).toContain('- old line');
    // New content from the full block should appear with "+"
    expect(diff).toMatch(/^\+ /m);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat alias
// ─────────────────────────────────────────────────────────────────────────────

describe('renderRootReadme backward-compat alias', () => {
  it('produces the same output as renderReadme(..., "full")', () => {
    const existing = 'HEADER\n\n<!-- STATS:START -->\nold\n<!-- STATS:END -->\n\nFOOTER';
    expect(renderRootReadme(existing, STATS)).toBe(renderReadme(existing, STATS, 'full'));
  });
});
