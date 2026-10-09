import type { ExtensionConfig, ProblemMetadata } from './types.js';

/**
 * Same logic as dsa-sync CLI's core/rule-engine — kept behaviorally identical on
 * purpose, so a user who's used both the CLI and this extension gets the same
 * "Array" folder for the same problem either way.
 */
export function resolveDestinationFolder(
  metadata: ProblemMetadata,
  config: ExtensionConfig,
): string {
  switch (config.organization) {
    case 'difficulty':
      return metadata.difficulty;
    case 'topic':
      return metadata.topics[0] ?? config.fallbackFolder;
    case 'custom':
      return resolveCustomRule(metadata, config);
    default:
      return config.fallbackFolder;
  }
}

function resolveCustomRule(metadata: ProblemMetadata, config: ExtensionConfig): string {
  for (const rule of config.rules ?? []) {
    const match = metadata.topics.some(
      (topic) => topic.toLowerCase() === rule.topic.toLowerCase(),
    );
    if (match) return rule.path;
  }
  return config.fallbackFolder;
}

export function resolveFileName(metadata: ProblemMetadata, config: ExtensionConfig): string {
  const pascalTitle = metadata.title
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join('');

  const base = config.namingPattern
    .replace('{id}', String(metadata.id))
    .replace('{slug}', metadata.slug)
    .replace('{title}', pascalTitle);

  return `${base}.${metadata.language}`;
}

/**
 * Resolves the file name for a specific approach (optimal, better, brute).
 * Optimal preserves the exact original filename for backwards compatibility.
 * Better and Brute append _Better and _Brute suffixes before the extension.
 */
export function resolveApproachFileName(
  metadata: ProblemMetadata,
  config: ExtensionConfig,
  approach: 'optimal' | 'better' | 'brute',
): string {
  const defaultFile = resolveFileName(metadata, config);
  if (approach === 'optimal') return defaultFile;

  const dotIdx = defaultFile.lastIndexOf('.');
  if (dotIdx === -1) {
    return `${defaultFile}_${approach === 'better' ? 'Better' : 'Brute'}`;
  }

  const base = defaultFile.slice(0, dotIdx);
  const ext = defaultFile.slice(dotIdx);
  const suffix = approach === 'better' ? '_Better' : '_Brute';
  return `${base}${suffix}${ext}`;
}

/**
 * Returns the line comment prefix for a given programming language.
 */
export function getCommentPrefix(language: string): string {
  const lang = language.toLowerCase();
  if (['py', 'python', 'python3', 'rb', 'ruby', 'sh', 'bash', 'r', 'pl', 'perl'].includes(lang)) {
    return '#';
  }
  if (['sql', 'mysql', 'pgsql', 'postgresql', 'sqlite', 'oracle'].includes(lang)) {
    return '--';
  }
  return '//';
}
