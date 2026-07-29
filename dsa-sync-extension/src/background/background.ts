import { resolveDestinationFolder, resolveFileName } from '../shared/rule-engine.js';
import { applySolvedProblem, emptyStats } from '../shared/stats.js';
import { renderRootReadme } from '../shared/readme.js';
import { GitHubClient, GitHubApiError } from '../shared/github.js';
import { generateExplanation } from '../shared/groq.js';
import { GROQ_API_KEY } from '../shared/env.js';
import type { ExtensionConfig, ProblemMetadata, SyncStats } from '../shared/types.js';

interface AcceptedMessage {
  type: 'DSA_SYNC_ACCEPTED';
  metadata: ProblemMetadata;
}

/**
 * Chrome only auto-injects content scripts into tabs opened AFTER the extension
 * loads. A LeetCode tab that was already open before an extension reload/update
 * keeps running the OLD content script until the page is refreshed — this is
 * what causes "sync doesn't fire until I reload the page." Re-inject fresh
 * copies into every currently-open matching tab on install/update/startup so
 * that manual refresh usually isn't necessary.
 */
async function reinjectIntoOpenTabs(): Promise<void> {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://leetcode.com/problems/*' });
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/inject.js'],
          world: 'MAIN',
        });
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ['content/content.js'],
        });
      } catch (err) {
        // A single tab failing to accept injection (e.g. a chrome:// error page,
        // or the tab closing mid-loop) shouldn't stop the rest from succeeding.
        console.warn(`[LWS] Could not re-inject into tab ${tab.id}:`, err);
      }
    }
  } catch (err) {
    console.warn('[LWS] Failed to query open LeetCode tabs for re-injection:', err);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  reinjectIntoOpenTabs();
});
chrome.runtime.onStartup.addListener(() => {
  reinjectIntoOpenTabs();
});

chrome.runtime.onMessage.addListener((message: AcceptedMessage, _sender, sendResponse) => {
  if (message.type !== 'DSA_SYNC_ACCEPTED') return false;

  syncProblem(message.metadata)
    .then((path) => sendResponse({ ok: true, path }))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[LWS] sync failed:', err);
      sendResponse({ ok: false, error: msg });
    });

  return true; // keep the message channel open for the async response
});

async function loadConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get('config');
  const config = stored.config as ExtensionConfig | undefined;
  if (!config || !config.githubToken || !config.repoOwner || !config.repoName) {
    throw new Error('LeetWeave Scribe isn\'t configured yet — open the extension popup and connect a repo.');
  }
  return config;
}

async function loadStats(client: GitHubClient, statsPath: string): Promise<SyncStats> {
  const file = await client.getFile(statsPath);
  if (!file) return emptyStats();
  try {
    return { ...emptyStats(), ...JSON.parse(file.content) };
  } catch {
    return emptyStats(); // corrupted stats file should never block a sync
  }
}

export async function syncProblem(metadata: ProblemMetadata): Promise<string> {
  const startedAt = Date.now();
  const config = await loadConfig();
  const client = new GitHubClient(config.githubToken, config.repoOwner, config.repoName, config.branch);

  const folder = resolveDestinationFolder(metadata, config);
  const fileName = resolveFileName(metadata, config);
  // One subfolder per problem (matches LeetHub's own layout) rather than a flat
  // topic folder — at 100+ problems, a flat folder mixing .java and .md files
  // becomes unreadable. Notes file is named README.md specifically so GitHub
  // auto-renders it the moment the folder is opened, not just when clicked into.
  const problemFolder = fileName.replace(/\.[^./]+$/, '');
  const solutionPath = `${config.destinationRoot}/${folder}/${problemFolder}/${fileName}`;
  const explanationPath = `${config.destinationRoot}/${folder}/${problemFolder}/README.md`;
  const statsPath = `${config.destinationRoot}/stats.json`;
  const readmePath = `${config.destinationRoot}/README.md`;
  const rootReadmePath = 'README.md'; // the actual top-level repo README, distinct from the one inside destinationRoot

  // 1. Push the solution file (create or update — check for existing sha first).
  const existingSolution = await client.getFile(solutionPath).catch((err) => {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  });
  await client.putFile(
    solutionPath,
    metadata.code,
    `Add LC${metadata.id} - ${metadata.title}`,
    existingSolution?.sha,
  );

  // 2. Per-problem README — always generated (title, difficulty, topics, link).
  //    If a Groq key is configured, we also try to fetch an Approach/Complexity
  //    section written against the actual submitted code. That call is fully
  //    isolated: any failure (bad key, rate limit, network) just means the
  //    README ships without the AI section — it never blocks the README itself,
  //    and never blocks the rest of the sync (solution push already happened above).
  {
    let aiSection: string | null = null;
    const groqKey = config.groqApiKey || GROQ_API_KEY;
    if (groqKey) {
      try {
        aiSection = await generateExplanation(metadata, groqKey);
      } catch (err) {
        console.warn('[LWS] AI explanation step failed, README will ship without it:', err);
      }
    }

    const existingExplanation = await client.getFile(explanationPath).catch(() => null);
    const body = renderExplanationFile(metadata, aiSection);
    await client.putFile(
      explanationPath,
      body,
      `Add notes for LC${metadata.id} - ${metadata.title}`,
      existingExplanation?.sha,
    );
  }

  // 3. Update stats.json
  const stats = await loadStats(client, statsPath);
  const automatedSeconds = (Date.now() - startedAt) / 1000;
  const updatedStats = applySolvedProblem(stats, metadata, automatedSeconds);
  const existingStatsFile = await client.getFile(statsPath).catch(() => null);
  await client.putFile(
    statsPath,
    JSON.stringify(updatedStats, null, 2),
    `Update stats - LC${metadata.id}`,
    existingStatsFile?.sha,
  );

  // 4. Update README.md (marker-based, preserves hand-written content)
  const existingReadme = await client.getFile(readmePath).catch(() => null);
  const renderedReadme = renderRootReadme(existingReadme?.content ?? null, updatedStats);
  await client.putFile(
    readmePath,
    renderedReadme,
    `Update README - LC${metadata.id}`,
    existingReadme?.sha,
  );

  // Also mirror the same stats block into the repo's actual top-level README —
  // marker-based, so any hand-written project description outside the
  // <!-- dsa-sync:start/end --> block is preserved, same as organized/README.md.
  const existingRootReadme = await client.getFile(rootReadmePath).catch(() => null);
  const renderedRootReadme = renderRootReadme(existingRootReadme?.content ?? null, updatedStats);
  await client.putFile(
    rootReadmePath,
    renderedRootReadme,
    `Update README - LC${metadata.id}`,
    existingRootReadme?.sha,
  );

  await chrome.storage.local.set({ stats: updatedStats });

  return solutionPath;
}

function renderExplanationFile(metadata: ProblemMetadata, aiSection: string | null): string {
  const lines = [
    `# ${metadata.id}. ${metadata.title}`,
    '',
    `**Difficulty:** ${metadata.difficulty}  `,
    `**Topics:** ${metadata.topics.join(', ') || 'N/A'}  `,
    `**Link:** ${metadata.url}`,
    '',
    '---',
    '',
  ];

  if (aiSection) {
    lines.push(aiSection, '', '---', '_Approach notes generated automatically by LeetWeave Scribe._');
  } else {
    lines.push('_Add a Groq API key in the extension settings to auto-generate approach notes here._');
  }

  return lines.join('\n');
}
