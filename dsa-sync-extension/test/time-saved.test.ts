import { describe, expect, it } from 'vitest';
import { applySolvedProblem, emptyStats, ASSUMED_MANUAL_SECONDS_PER_PROBLEM } from '../src/shared/stats.js';
import type { ProblemMetadata } from '../src/shared/types.js';

function makeMetadata(overrides: Partial<ProblemMetadata> = {}): ProblemMetadata {
  return {
    id: 1,
    slug: 'two-sum',
    title: 'Two Sum',
    difficulty: 'Easy',
    topics: ['Array'],
    url: 'https://leetcode.com/problems/two-sum/',
    language: 'java',
    code: 'class Solution {}',
    ...overrides,
  };
}

describe('time-saved accumulation', () => {
  it('adds the full estimated baseline minus real automated time for a new problem', () => {
    const result = applySolvedProblem(emptyStats(), makeMetadata(), 2.5);
    expect(result.timeSavedSeconds).toBe(ASSUMED_MANUAL_SECONDS_PER_PROBLEM - 2.5);
  });

  it('never goes negative even if automated time somehow exceeds the manual baseline', () => {
    const result = applySolvedProblem(emptyStats(), makeMetadata(), 99999);
    expect(result.timeSavedSeconds).toBe(0);
  });

  it('accumulates across multiple distinct problems', () => {
    let stats = emptyStats();
    stats = applySolvedProblem(stats, makeMetadata({ id: 1 }), 2);
    stats = applySolvedProblem(stats, makeMetadata({ id: 2, title: 'Add Two Numbers' }), 3);
    expect(stats.timeSavedSeconds).toBe(
      (ASSUMED_MANUAL_SECONDS_PER_PROBLEM - 2) + (ASSUMED_MANUAL_SECONDS_PER_PROBLEM - 3),
    );
  });

  it('does NOT add more time-saved when the same problem is resubmitted (already counted)', () => {
    let stats = emptyStats();
    stats = applySolvedProblem(stats, makeMetadata({ id: 1 }), 2);
    const afterFirst = stats.timeSavedSeconds;
    stats = applySolvedProblem(stats, makeMetadata({ id: 1 }), 2);
    expect(stats.timeSavedSeconds).toBe(afterFirst); // no double-counting on resubmission
  });

  it('defaults automatedSeconds to 0 when not provided (backward compatible with CLI-ported callers)', () => {
    const result = applySolvedProblem(emptyStats(), makeMetadata());
    expect(result.timeSavedSeconds).toBe(ASSUMED_MANUAL_SECONDS_PER_PROBLEM);
  });
});
