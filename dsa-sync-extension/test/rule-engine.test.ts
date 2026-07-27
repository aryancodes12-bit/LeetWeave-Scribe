import { describe, expect, it } from 'vitest';
import { resolveDestinationFolder, resolveFileName } from '../src/shared/rule-engine.js';
import { lookupProblemBySlug } from '../src/shared/dataset.js';
import { languageToExtension } from '../src/shared/language.js';
import type { ExtensionConfig, ProblemMetadata } from '../src/shared/types.js';

function makeConfig(overrides: Partial<ExtensionConfig> = {}): ExtensionConfig {
  return {
    repoOwner: 'aryancodes12-bit',
    repoName: 'DSA-Journey',
    branch: 'main',
    destinationRoot: 'organized',
    organization: 'topic',
    rules: [],
    fallbackFolder: 'Uncategorized',
    namingPattern: 'LC{id}',
    githubToken: 'ghp_fake',
    ...overrides,
  };
}

function makeMetadata(overrides: Partial<ProblemMetadata> = {}): ProblemMetadata {
  return {
    id: 283,
    slug: 'move-zeroes',
    title: 'Move Zeroes',
    difficulty: 'Easy',
    topics: ['Array', 'Two Pointers'],
    url: 'https://leetcode.com/problems/move-zeroes/',
    language: 'java',
    code: 'class Solution {}',
    ...overrides,
  };
}

describe('dataset (slug-indexed)', () => {
  it('finds the exact problem from the real-world screenshot by slug', () => {
    const result = lookupProblemBySlug('move-zeroes');
    expect(result?.id).toBe(283);
    expect(result?.title).toBe('Move Zeroes');
    expect(result?.difficulty).toBe('Easy');
    expect(result?.topics).toEqual(['Array', 'Two Pointers']);
  });

  it('returns null for an unknown slug rather than throwing', () => {
    expect(lookupProblemBySlug('this-slug-does-not-exist')).toBeNull();
  });
});

describe('resolveDestinationFolder (ported)', () => {
  it('matches CLI behavior for topic mode', () => {
    const config = makeConfig({ organization: 'topic' });
    expect(resolveDestinationFolder(makeMetadata(), config)).toBe('Array');
  });

  it('matches CLI behavior for difficulty mode', () => {
    const config = makeConfig({ organization: 'difficulty' });
    expect(resolveDestinationFolder(makeMetadata({ difficulty: 'Hard' }), config)).toBe('Hard');
  });

  it('matches CLI behavior for custom rules with fallback', () => {
    const config = makeConfig({
      organization: 'custom',
      rules: [{ topic: 'array', path: '01-Arrays' }],
    });
    expect(resolveDestinationFolder(makeMetadata(), config)).toBe('01-Arrays');
    expect(
      resolveDestinationFolder(makeMetadata({ topics: ['Graph'] }), config),
    ).toBe('Uncategorized');
  });
});

describe('resolveFileName (ported)', () => {
  it('renders naming patterns identically to the CLI', () => {
    expect(resolveFileName(makeMetadata(), makeConfig({ namingPattern: 'LC{id}' }))).toBe(
      'LC283.java',
    );
    expect(resolveFileName(makeMetadata(), makeConfig({ namingPattern: '{title}' }))).toBe(
      'MoveZeroes.java',
    );
  });
});

describe('languageToExtension', () => {
  it('maps known LeetCode language codes to file extensions', () => {
    expect(languageToExtension('python3')).toBe('py');
    expect(languageToExtension('golang')).toBe('go');
    expect(languageToExtension('cpp')).toBe('cpp');
  });

  it('falls back to the raw code for unknown languages rather than throwing', () => {
    expect(languageToExtension('some-future-language')).toBe('some-future-language');
  });
});
