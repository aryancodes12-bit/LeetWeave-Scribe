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
import { GitHubClient, GitHubApiError, CommitFileInput } from '../shared/github.js';
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

function sendPhaseA(
  tabId: number | undefined,
  folderPath: string,
  totalDurationSeconds: number,
): void {
  if (tabId === undefined) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: 'DSA_PHASE_A_DONE',
      folderPath,
      totalDurationSeconds,
    })
    .catch(() => {
      // Tab may have navigated or closed
    });
}

function sendPhaseB(
  tabId: number | undefined,
  aiFailureReason: string | null,
): void {
  if (tabId === undefined) return;
  chrome.tabs
    .sendMessage(tabId, {
      type: 'DSA_PHASE_B_DONE',
      aiFailureReason,
    })
    .catch(() => {
      // Tab may have navigated or closed
    });
}

export async function syncProblem(
  metadata: ProblemMetadata,
  tabId?: number,
): Promise<{
  path: string;
  folderPath: string;
  aiFailureReason: string | null;
  totalDurationSeconds: number;
}> {
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

  const commentPrefix = getCommentPrefix(metadata.language);

  // Prepare code file inputs
  const codeFilesData: Array<{ path: string; content: string }> = [
    { path: optimalSolutionPath, content: metadata.code },
  ];

  const betterCode = metadata.approaches?.better?.trim();
  if (betterCode) {
    const betterFileName = resolveApproachFileName(metadata, config, 'better');
    const betterPath = `${baseDir}/${betterFileName}`;
    const isAi = metadata.approaches?.aiGenerated?.better;
    const content = isAi
      ? `${commentPrefix} AI-generated, not verified on LeetCode\n\n${betterCode}`
      : betterCode;
    codeFilesData.push({ path: betterPath, content });
  }

  const bruteCode = metadata.approaches?.brute?.trim();
  if (bruteCode) {
    const bruteFileName = resolveApproachFileName(metadata, config, 'brute');
    const brutePath = `${baseDir}/${bruteFileName}`;
    const isAi = metadata.approaches?.aiGenerated?.brute;
    const content = isAi
      ? `${commentPrefix} AI-generated, not verified on LeetCode\n\n${bruteCode}`
      : bruteCode;
    codeFilesData.push({ path: brutePath, content });
  }

  // Step 2: Pushing code
  sendStep(tabId, 'pushing', 'active');

  // Start uploading code blobs in parallel with Gemini
  const codeBlobsPromise = Promise.all(
    codeFilesData.map(async (f) => ({
      path: f.path,
      sha: await client.createBlob(f.content),
    })),
  );

  // Start pre-fetching existing files in parallel
  const existingFilesPromise = Promise.all([
    client.getFile(explanationPath).catch(() => null),
    loadStats(client, statsPath),
    client.getFile(readmePath).catch(() => null),
    client.getFile(rootReadmePath).catch(() => null),
  ]);

  // Start Gemini in parallel
  const apiKey = config.geminiApiKey?.trim();
  const model = config.geminiModel?.trim() || DEFAULT_GEMINI_MODEL;
  const geminiPromise = apiKey
    ? generateNotes(metadata, apiKey, model)
    : Promise.resolve({ ok: false as const, reason: 'Missing Gemini API key' });

  // Race Gemini against ~4000ms threshold to prevent Pages check cancellation noise
  const raceTimeout = new Promise<{ done: false }>((resolve) =>
    setTimeout(() => resolve({ done: false }), 4000),
  );
  const geminiRace = geminiPromise.then((res) => ({ done: true as const, res }));
  const raceResult = await Promise.race([geminiRace, raceTimeout]);

  let aiFailureReason: string | null = null;
  const commitMessage = `Add LC${metadata.id} - ${metadata.title}`;

  if (raceResult.done) {
    // ─── SINGLE COMMIT FLOW (Gemini finished within ~4s) ───
    const geminiRes = raceResult.res;
    const [existingExplanation, baseStats, existingReadme, existingRootReadme] =
      await existingFilesPromise;
    const codeBlobs = await codeBlobsPromise;

    sendStep(tabId, 'pushing', 'done');
    sendStep(tabId, 'notes', 'active');

    const alreadyHasNotes = hasExistingAiNotes(existingExplanation?.content);
    let explanationBody: string | null = null;

    if (geminiRes.ok) {
      explanationBody = renderGeminiNotesReadme(metadata, geminiRes.data);
    } else {
      aiFailureReason = geminiRes.reason;
      if (!alreadyHasNotes) {
        if (!apiKey) {
          explanationBody = renderFailedNotesReadme(
            metadata,
            'Add a Gemini API key in extension settings to auto-generate technical notes.',
          );
        } else {
          explanationBody = renderFailedNotesReadme(metadata, geminiRes.reason);
        }
      }
    }

    sendStep(tabId, 'notes', 'done', aiFailureReason ?? undefined);
    sendStep(tabId, 'stats', 'active');

    const automatedSeconds = (Date.now() - startedAt) / 1000;
    const updatedStats = applySolvedProblem(baseStats, metadata, automatedSeconds);
    const renderedReadme = renderRootReadme(existingReadme?.content ?? null, updatedStats);
    const renderedRootReadme = renderCompactReadme(
      existingRootReadme?.content ?? null,
      updatedStats,
      `${config.destinationRoot}/README.md`,
    );

    const allFiles: CommitFileInput[] = [...codeBlobs];
    if (explanationBody !== null) {
      allFiles.push({ path: explanationPath, content: explanationBody });
    }
    allFiles.push({ path: statsPath, content: JSON.stringify(updatedStats, null, 2) });
    allFiles.push({ path: readmePath, content: renderedReadme });
    allFiles.push({ path: rootReadmePath, content: renderedRootReadme });

    await client.commitFiles(allFiles, commitMessage);

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
      totalDurationSeconds: (Date.now() - startedAt) / 1000,
    };
  } else {
    // ─── TWO-PHASE COMMIT FLOW (Gemini took > 4s) ───
    // Phase A: Push code files immediately in one commit
    const codeBlobs = await codeBlobsPromise;
    await client.commitFiles(codeBlobs, commitMessage);
    sendStep(tabId, 'pushing', 'done');

    const phaseADuration = (Date.now() - startedAt) / 1000;
    sendPhaseA(tabId, `${folder}/${problemFolder}`, phaseADuration);

    // Phase B: Wait for Gemini notes and push README + stats
    sendStep(tabId, 'notes', 'active');

    const [geminiRes, [existingExplanation, baseStats, existingReadme, existingRootReadme]] =
      await Promise.all([geminiPromise, existingFilesPromise]);

    const alreadyHasNotes = hasExistingAiNotes(existingExplanation?.content);
    let explanationBody: string | null = null;

    if (geminiRes.ok) {
      explanationBody = renderGeminiNotesReadme(metadata, geminiRes.data);
    } else {
      aiFailureReason = geminiRes.reason;
      if (!alreadyHasNotes) {
        if (!apiKey) {
          explanationBody = renderFailedNotesReadme(
            metadata,
            'Add a Gemini API key in extension settings to auto-generate technical notes.',
          );
        } else {
          explanationBody = renderFailedNotesReadme(metadata, geminiRes.reason);
        }
      }
    }

    sendStep(tabId, 'notes', 'done', aiFailureReason ?? undefined);
    sendStep(tabId, 'stats', 'active');

    const automatedSeconds = (Date.now() - startedAt) / 1000;
    const updatedStats = applySolvedProblem(baseStats, metadata, automatedSeconds);
    const renderedReadme = renderRootReadme(existingReadme?.content ?? null, updatedStats);
    const renderedRootReadme = renderCompactReadme(
      existingRootReadme?.content ?? null,
      updatedStats,
      `${config.destinationRoot}/README.md`,
    );

    const phaseBFiles: CommitFileInput[] = [];
    if (explanationBody !== null) {
      phaseBFiles.push({ path: explanationPath, content: explanationBody });
    }
    phaseBFiles.push({ path: statsPath, content: JSON.stringify(updatedStats, null, 2) });
    phaseBFiles.push({ path: readmePath, content: renderedReadme });
    phaseBFiles.push({ path: rootReadmePath, content: renderedRootReadme });

    await client.commitFiles(
      phaseBFiles,
      `Add notes & stats for LC${metadata.id} - ${metadata.title}`,
    );

    await chrome.storage.local.set({
      stats: updatedStats,
      lastSyncedMetadata: metadata,
      lastSyncedPath: `${folder}/${problemFolder}`,
    });

    sendStep(tabId, 'stats', 'done');
    sendPhaseB(tabId, aiFailureReason);

    return {
      path: optimalSolutionPath,
      folderPath: `${folder}/${problemFolder}`,
      aiFailureReason,
      totalDurationSeconds: (Date.now() - startedAt) / 1000,
    };
  }
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

  const body = renderGeminiNotesReadme(metadata, result.data);

  await client.commitFiles(
    [{ path: explanationPath, content: body }],
    `Regenerate AI notes for LC${metadata.id} - ${metadata.title}`,
  );

  return { ok: true };
}
