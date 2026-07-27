import dataset from './data/leetcode-topics.json';

export interface ProblemInfo {
  id: number;
  title: string;
  slug: string;
  difficulty: 'Easy' | 'Medium' | 'Hard';
  topics: string[];
}

interface RawEntry {
  t: string;
  s: string;
  d: string;
  tags: string[];
}

let slugIndex: Map<string, ProblemInfo> | null = null;

/**
 * Reuses the exact same bundled dataset as the CLI (src/data/leetcode-topics.json),
 * re-indexed by slug since that's what's reliably available from the page URL —
 * no network call needed, works instantly, same data source as the CLI so a user's
 * "Array" folder means the same thing whether a problem was synced via CLI or extension.
 */
export function lookupProblemBySlug(slug: string): ProblemInfo | null {
  if (!slugIndex) {
    slugIndex = new Map();
    const raw = dataset as unknown as Record<string, RawEntry>;
    for (const [id, entry] of Object.entries(raw)) {
      slugIndex.set(entry.s, {
        id: Number(id),
        title: entry.t,
        slug: entry.s,
        difficulty: normalizeDifficulty(entry.d),
        topics: entry.tags ?? [],
      });
    }
  }
  return slugIndex.get(slug) ?? null;
}

let difficultyTotalsCache: { easy: number; medium: number; hard: number } | null = null;

/** Total counts of Easy/Medium/Hard problems across the entire bundled dataset —
 *  used to show "X / Y solved" progress bars in the popup, not just raw counts. */
export function getDifficultyTotals(): { easy: number; medium: number; hard: number } {
  if (difficultyTotalsCache) return difficultyTotalsCache;
  const raw = dataset as unknown as Record<string, RawEntry>;
  const totals = { easy: 0, medium: 0, hard: 0 };
  for (const entry of Object.values(raw)) {
    if (entry.d === 'Easy') totals.easy++;
    else if (entry.d === 'Medium') totals.medium++;
    else if (entry.d === 'Hard') totals.hard++;
  }
  difficultyTotalsCache = totals;
  return totals;
}

function normalizeDifficulty(value: string): 'Easy' | 'Medium' | 'Hard' {
  if (value === 'Easy' || value === 'Medium' || value === 'Hard') return value;
  return 'Medium';
}
