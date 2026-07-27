import { emptyStats } from './types.js';
import type { ProblemMetadata, SyncStats } from './types.js';

/**
 * Estimated time a manual reorganize-and-push workflow takes per problem:
 * find/create the right topic folder, rename the file, move it, hand-edit the
 * README's stats section, git add/commit/push. This is a labeled *estimate*,
 * not a measured claim — shown as such everywhere it's surfaced in the UI.
 * Deliberately conservative (3 min) rather than inflated.
 */
export const ASSUMED_MANUAL_SECONDS_PER_PROBLEM = 180;

/** Identical logic to dsa-sync CLI's core/readme/stats.ts applySolvedProblem —
 *  kept behaviorally identical intentionally. Pure function, no I/O.
 *  `automatedSeconds` (extension-only) is the real, measured wall-clock time this
 *  sync actually took — used to accumulate a running, honest "time saved" total
 *  (estimated manual baseline minus real automated time), only for genuinely new
 *  problems, not resubmissions of one already counted. */
export function applySolvedProblem(
  stats: SyncStats,
  metadata: ProblemMetadata,
  automatedSeconds = 0,
): SyncStats {
  const now = new Date();
  const today = now.toISOString().slice(0, 10);
  const lastDate = stats.lastSyncedAt?.slice(0, 10) ?? null;

  const isConsecutiveDay = lastDate !== null && isNextCalendarDay(lastDate, today);
  const isSameDay = lastDate === today;

  const currentStreak = isSameDay
    ? stats.currentStreak
    : isConsecutiveDay
      ? stats.currentStreak + 1
      : 1;

  const alreadyCounted = stats.recent.some((r) => r.id === metadata.id);
  const timeSavedThisSync = alreadyCounted
    ? 0
    : Math.max(0, ASSUMED_MANUAL_SECONDS_PER_PROBLEM - automatedSeconds);

  return {
    total: alreadyCounted ? stats.total : stats.total + 1,
    easy: stats.easy + (!alreadyCounted && metadata.difficulty === 'Easy' ? 1 : 0),
    medium: stats.medium + (!alreadyCounted && metadata.difficulty === 'Medium' ? 1 : 0),
    hard: stats.hard + (!alreadyCounted && metadata.difficulty === 'Hard' ? 1 : 0),
    currentStreak,
    longestStreak: Math.max(stats.longestStreak, currentStreak),
    lastSyncedAt: now.toISOString(),
    timeSavedSeconds: stats.timeSavedSeconds + timeSavedThisSync,
    recent: [
      {
        id: metadata.id,
        title: metadata.title,
        difficulty: metadata.difficulty,
        language: metadata.language,
        date: today,
      },
      ...stats.recent.filter((r) => r.id !== metadata.id),
    ].slice(0, 10),
  };
}

function isNextCalendarDay(previous: string, current: string): boolean {
  const prevDate = new Date(previous + 'T00:00:00Z');
  const currDate = new Date(current + 'T00:00:00Z');
  const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 86_400_000);
  return diffDays === 1;
}

export { emptyStats };
