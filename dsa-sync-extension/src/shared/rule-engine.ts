import type { ExtensionConfig, ProblemMetadata } from './types.js';

/**
 * Same logic as dsa-sync CLI's core/rule-engine — kept behaviorally identical on
 * purpose, so a user who's used both the CLI and this extension gets the same
 * "Array" folder for the same problem either way. (Standalone copy for now since
 * the extension is a separate npm project; candidate for a shared workspace
 * package if this graduates beyond MVP.)
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
