import { describe, expect, it } from 'vitest';
import {
  renderRootReadme,
  renderCompactReadme,
  renderFullBlock,
  renderCompactBlock,
  renderGeminiNotesReadme,
  renderFailedNotesReadme,
  hasExistingAiNotes,
} from '../src/shared/readme.js';
import { emptyStats } from '../src/shared/stats.js';
import type { GeminiNotesData, ProblemMetadata, SyncStats } from '../src/shared/types.js';

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

function makeMetadata(): ProblemMetadata {
  return {
    id: 283,
    slug: 'move-zeroes',
    title: 'Move Zeroes',
    difficulty: 'Easy',
    topics: ['Array', 'Two Pointers'],
    url: 'https://leetcode.com/problems/move-zeroes/',
    language: 'java',
    code: 'class Solution {}',
  };
}

function makeNotes(): GeminiNotesData {
  return {
    patternTag: 'Two Pointers',
    problemSummary: 'Move all zeroes to the end of array in-place.',
    example: { input: '[0,1,0,3,12]', output: '[1,3,12,0,0]' },
    keyInsights: ['Use two pointers to partition non-zero elements.'],
    approaches: [
      { name: 'Brute', idea: 'Extra array', time: 'O(n)', space: 'O(n)' },
      { name: 'Optimal', idea: 'Two-pointer swap', time: 'O(n)', space: 'O(1)' },
    ],
    edgeCases: ['Array with all zeroes'],
    similarProblems: ['Remove Element'],
  };
}

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

describe('Gemini technical notes README renderer', () => {
  it('renders complete structured Markdown template', () => {
    const meta = makeMetadata();
    const notes = makeNotes();
    const rendered = renderGeminiNotesReadme(meta, notes);

    expect(rendered).toContain('# 283. Move Zeroes');
    expect(rendered).toContain('**Difficulty:** Easy');
    expect(rendered).toContain('**Pattern:** Two Pointers');
    expect(rendered).toContain('## Problem');
    expect(rendered).toContain(notes.problemSummary);
    expect(rendered).toContain('## Example');
    expect(rendered).toContain('- **Input:** `[0,1,0,3,12]`');
    expect(rendered).toContain('## Key Insights');
    expect(rendered).toContain('## Approaches');
    expect(rendered).toContain('| Brute | Extra array | `O(n)` | `O(n)` |');
    expect(rendered).toContain('| Optimal | Two-pointer swap | `O(n)` | `O(1)` |');
    expect(rendered).toContain('## Edge Cases');
    expect(rendered).toContain('## Similar Problems');
  });

  it('renders fallback when notes generation fails', () => {
    const meta = makeMetadata();
    const failed = renderFailedNotesReadme(meta, 'rate limited');

    expect(failed).toContain('# 283. Move Zeroes');
    expect(failed).toContain('_AI notes generation unavailable: rate limited_');
    expect(failed).not.toContain('## Key Insights');
  });

  it('detects existing AI notes correctly', () => {
    const existingWithAi = '# 283. Move Zeroes\n\n## Key Insights\n- insight';
    expect(hasExistingAiNotes(existingWithAi)).toBe(true);

    const fallbackWithoutAi = '# 283. Move Zeroes\n\n_AI notes generation unavailable: invalid key_';
    expect(hasExistingAiNotes(fallbackWithoutAi)).toBe(false);
    expect(hasExistingAiNotes(null)).toBe(false);
  });
});
