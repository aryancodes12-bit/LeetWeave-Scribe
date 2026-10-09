import {
  resolveDestinationFolder,
  resolveApproachFileName,
  getCommentPrefix,
} from '../shared/rule-engine.js';
import { applySolvedProblem, emptyStats } from '../shared/stats.js';
import {
  renderRootReadme,
  renderCompactReadme,
  renderGeminiNotesReadme,
  renderFailedNotesReadme,
  hasExistingAiNotes,
} from '../shared/readme.js';
import { GitHubClient, GitHubApiError } from '../shared/github.js';
import { generateNotes, generateApproachCode, DEFAULT_GEMINI_MODEL } from '../shared/gemini.js';
import type { ExtensionConfig, ProblemMetadata, SyncStats } from '../shared/types.js';

interface AcceptedMessage {
  type: 'DSA_SYNC_ACCEPTED';
  metadata: ProblemMetadata;
}

interface GenerateApproachMessage {
  type: 'DSA_GENERATE_APPROACH';
  metadata: ProblemMetadata;
  approachType: 'Brute' | 'Better';
}

interface RegenerateNotesMessage {
  type: 'DSA_REGENERATE_NOTES';
}

type ExtensionMessage = AcceptedMessage | GenerateApproachMessage | RegenerateNotesMessage;

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

chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'DSA_SYNC_ACCEPTED') {
    const tabId = sender.tab?.id;
    syncProblem(message.metadata, tabId)
      .then((res) => sendResponse({ ok: true, ...res }))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[LWS] sync failed:', err);
        sendResponse({ ok: false, error: msg });
      });
    return true;
  }

  if (message.type === 'DSA_GENERATE_APPROACH') {
    handleGenerateApproach(message.metadata, message.approachType)
      .then((res) => sendResponse(res))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, reason: msg });
      });
    return true;
  }

  if (message.type === 'DSA_REGENERATE_NOTES') {
    handleRegenerateNotes()
      .then((res) => sendResponse(res))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        sendResponse({ ok: false, reason: msg });
      });
    return true;
  }

  return false;
});

async function loadConfig(): Promise<ExtensionConfig> {
  const stored = await chrome.storage.local.get('config');
  const config = stored.config as ExtensionConfig | undefined;
  if (!config || !config.githubToken || !config.repoOwner || !config.repoName) {
    throw new Error(
      "LeetWeave Scribe isn't configured yet — open the extension popup and connect a repo.",
    );
  }
  return config;
}

async function loadStats(client: GitHubClient, statsPath: string): Promise<SyncStats> {
  const file = await client.getFile(statsPath);
  if (!file) return emptyStats();
  try {
    return { ...emptyStats(), ...JSON.parse(file.content) };
  } catch {
    return emptyStats();
  }
}

function sendStep(
  tabId: number | undefined,
  step: 'submitting' | 'pushing' | 'notes' | 'stats',
  status: 'active' | 'done',
  detail?: string,
): void {
  if (tabId === undefined) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: 'DSA_STEP_UPDATE',
      step,
      status,
      detail,
    })
    .catch(() => {
      // Tab may have navigated or closed
    });
}

export async function syncProblem(
  metadata: ProblemMetadata,
  tabId?: number,
): Promise<{ path: string; folderPath: string; aiFailureReason: string | null }> {
  const startedAt = Date.now();

  // Step 1: Submitting
  sendStep(tabId, 'submitting', 'active');
  const config = await loadConfig();
  const client = new GitHubClient(
    config.githubToken,
    config.repoOwner,
    config.repoName,
    config.branch,
  );
  sendStep(tabId, 'submitting', 'done');

  const folder = resolveDestinationFolder(metadata, config);
  const optimalFileName = resolveApproachFileName(metadata, config, 'optimal');
  const problemFolder = optimalFileName.replace(/\.[^./]+$/, '');
  const baseDir = `${config.destinationRoot}/${folder}/${problemFolder}`;

  const optimalSolutionPath = `${baseDir}/${optimalFileName}`;
  const explanationPath = `${baseDir}/README.md`;
  const statsPath = `${config.destinationRoot}/stats.json`;
  const readmePath = `${config.destinationRoot}/README.md`;
  const rootReadmePath = 'README.md';

  // Step 2: Pushing code
  sendStep(tabId, 'pushing', 'active');

  const commentPrefix = getCommentPrefix(metadata.language);

  // 2a. Optimal code
  const existingOptimal = await client.getFile(optimalSolutionPath).catch((err) => {
    if (err instanceof GitHubApiError && err.status === 404) return null;
    throw err;
  });
  await client.putFile(
    optimalSolutionPath,
    metadata.code,
    `Add LC${metadata.id} - ${metadata.title} (Optimal)`,
    existingOptimal?.sha,
  );

  // 2b. Better code (if provided)
  const betterCode = metadata.approaches?.better?.trim();
  if (betterCode) {
    const betterFileName = resolveApproachFileName(metadata, config, 'better');
    const betterPath = `${baseDir}/${betterFileName}`;
    const isAi = metadata.approaches?.aiGenerated?.better;
    const content = isAi
      ? `${commentPrefix} AI-generated, not verified on LeetCode\n\n${betterCode}`
      : betterCode;

    const existingBetter = await client.getFile(betterPath).catch(() => null);
    await client.putFile(
      betterPath,
      content,
      `Add LC${metadata.id} - ${metadata.title} (Better)`,
      existingBetter?.sha,
    );
  }

  // 2c. Brute code (if provided)
  const bruteCode = metadata.approaches?.brute?.trim();
  if (bruteCode) {
    const bruteFileName = resolveApproachFileName(metadata, config, 'brute');
    const brutePath = `${baseDir}/${bruteFileName}`;
    const isAi = metadata.approaches?.aiGenerated?.brute;
    const content = isAi
      ? `${commentPrefix} AI-generated, not verified on LeetCode\n\n${bruteCode}`
      : bruteCode;

    const existingBrute = await client.getFile(brutePath).catch(() => null);
    await client.putFile(
      brutePath,
      content,
      `Add LC${metadata.id} - ${metadata.title} (Brute)`,
      existingBrute?.sha,
    );
  }

  sendStep(tabId, 'pushing', 'done');

  // Step 3: Writing notes
  sendStep(tabId, 'notes', 'active');

  let aiFailureReason: string | null = null;
  const existingExplanation = await client.getFile(explanationPath).catch(() => null);
  const alreadyHasNotes = hasExistingAiNotes(existingExplanation?.content);

  const apiKey = config.geminiApiKey?.trim();
  const model = config.geminiModel?.trim() || DEFAULT_GEMINI_MODEL;

  let explanationBody: string | null = null;

  if (apiKey) {
    const geminiRes = await generateNotes(metadata, apiKey, model);
    if (geminiRes.ok) {
      explanationBody = renderGeminiNotesReadme(metadata, geminiRes.data);
    } else {
      aiFailureReason = geminiRes.reason;
      if (!alreadyHasNotes) {
        explanationBody = renderFailedNotesReadme(metadata, geminiRes.reason);
      }
    }
  } else {
    aiFailureReason = 'Missing Gemini API key';
    if (!alreadyHasNotes) {
      explanationBody = renderFailedNotesReadme(
        metadata,
        'Add a Gemini API key in extension settings to auto-generate technical notes.',
      );
    }
  }

  if (explanationBody !== null) {
    await client.putFile(
      explanationPath,
      explanationBody,
      `Add notes for LC${metadata.id} - ${metadata.title}`,
      existingExplanation?.sha,
    );
  }

  sendStep(tabId, 'notes', 'done', aiFailureReason ?? undefined);

  // Step 4: Updating stats
  sendStep(tabId, 'stats', 'active');

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

  const existingReadme = await client.getFile(readmePath).catch(() => null);
  const renderedReadme = renderRootReadme(existingReadme?.content ?? null, updatedStats);
  await client.putFile(
    readmePath,
    renderedReadme,
    `Update README - LC${metadata.id}`,
    existingReadme?.sha,
  );

  const existingRootReadme = await client.getFile(rootReadmePath).catch(() => null);
  const renderedRootReadme = renderCompactReadme(
    existingRootReadme?.content ?? null,
    updatedStats,
    `${config.destinationRoot}/README.md`,
  );
  await client.putFile(
    rootReadmePath,
    renderedRootReadme,
    `Update README - LC${metadata.id}`,
    existingRootReadme?.sha,
  );

  await chrome.storage.local.set({
    stats: updatedStats,
    lastSyncedMetadata: metadata,
    lastSyncedPath: `${folder}/${problemFolder}`,
  });

  sendStep(tabId, 'stats', 'done');

  return {
    path: optimalSolutionPath,
    folderPath: `${folder}/${problemFolder}`,
    aiFailureReason,
  };
}

async function handleGenerateApproach(
  metadata: ProblemMetadata,
  approachType: 'Brute' | 'Better',
): Promise<{ ok: true; code: string } | { ok: false; reason: string }> {
  const config = await loadConfig();
  if (!config.geminiApiKey?.trim()) {
    return { ok: false, reason: 'invalid key' };
  }

  return generateApproachCode({
    metadata,
    approachType,
    optimalCode: metadata.code,
    language: metadata.language,
    apiKey: config.geminiApiKey,
    model: config.geminiModel,
  });
}

async function handleRegenerateNotes(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const stored = await chrome.storage.local.get(['config', 'lastSyncedMetadata']);
  const config = stored.config as ExtensionConfig | undefined;
  const metadata = stored.lastSyncedMetadata as ProblemMetadata | undefined;

  if (!config || !config.githubToken || !config.repoOwner || !config.repoName) {
    return { ok: false, reason: 'Extension is not configured yet.' };
  }
  if (!metadata) {
    return { ok: false, reason: 'No recently synced problem found to regenerate notes for.' };
  }
  if (!config.geminiApiKey?.trim()) {
    return { ok: false, reason: 'Please set your Gemini API key in settings first.' };
  }

  const model = config.geminiModel?.trim() || DEFAULT_GEMINI_MODEL;
  const result = await generateNotes(metadata, config.geminiApiKey, model);
  if (!result.ok) {
    return { ok: false, reason: result.reason };
  }

  const client = new GitHubClient(
    config.githubToken,
    config.repoOwner,
    config.repoName,
    config.branch,
  );

  const folder = resolveDestinationFolder(metadata, config);
  const optimalFileName = resolveApproachFileName(metadata, config, 'optimal');
  const problemFolder = optimalFileName.replace(/\.[^./]+$/, '');
  const explanationPath = `${config.destinationRoot}/${folder}/${problemFolder}/README.md`;

  const existingExplanation = await client.getFile(explanationPath).catch(() => null);
  const body = renderGeminiNotesReadme(metadata, result.data);

  await client.putFile(
    explanationPath,
    body,
    `Regenerate AI notes for LC${metadata.id} - ${metadata.title}`,
    existingExplanation?.sha,
  );

  return { ok: true };
}
