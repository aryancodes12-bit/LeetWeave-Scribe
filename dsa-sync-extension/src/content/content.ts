import { lookupProblemBySlug } from '../shared/dataset.js';
import { languageToExtension } from '../shared/language.js';
import type { ExtensionConfig, ProblemApproaches, ProblemMetadata } from '../shared/types.js';
import { LwsShadowUI } from './ui.js';
import { initAudioContext } from './sound.js';

const EVENT_NAME = 'lws:accepted';

interface AcceptedEventDetail {
  slug: string;
  lang: string;
  code: string;
  runtime: string | null;
  memory: string | null;
  snapshots?: string[];
}

interface StepUpdateMessage {
  type: 'DSA_STEP_UPDATE';
  step: 'submitting' | 'pushing' | 'notes' | 'stats';
  status: 'active' | 'done';
  detail?: string;
}

const ui = new LwsShadowUI();

// Prime the WebAudio AudioContext on page interactions
window.addEventListener('click', initAudioContext, { passive: true });

function getSlugFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/problems\/([^/]+)\/?/);
  return match?.[1] ?? null;
}

// Listen for background step updates
chrome.runtime.onMessage.addListener((message: StepUpdateMessage) => {
  if (message.type === 'DSA_STEP_UPDATE') {
    ui.updateStep(message.step, message.status, message.detail);
  }
});

window.addEventListener(EVENT_NAME, (event) => {
  const detail = (event as CustomEvent<AcceptedEventDetail>).detail;
  handleAccepted(detail).catch((err) => {
    if (isContextInvalidatedError(err)) {
      console.warn('[LWS] Extension was reloaded — refresh this page to keep syncing.');
      ui.showError({
        message: 'Extension was updated — please refresh this LeetCode tab.',
      });
      return;
    }
    console.error('[LWS] failed to handle accepted submission:', err);
    ui.showError({ message: 'Sync failed — see console for details.' });
  });
});

function isContextInvalidatedError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('Extension context invalidated') ||
    msg.includes("reading 'sendMessage'") ||
    msg.includes('chrome.runtime')
  );
}

async function handleAccepted(detail: AcceptedEventDetail): Promise<void> {
  const slug = detail.slug || getSlugFromUrl();
  if (!slug) return;

  const info = lookupProblemBySlug(slug);
  if (!info) {
    ui.showError({
      message: `"${slug}" isn't in the bundled problem dataset yet — skipped.`,
    });
    return;
  }

  const stored = await chrome.storage.local.get('config');
  const config = stored.config as ExtensionConfig | undefined;

  if (!config || !config.githubToken || !config.repoOwner || !config.repoName) {
    ui.showError({
      message: "LeetWeave Scribe isn't configured yet — click the extension icon to connect a repo.",
    });
    return;
  }

  const metadata: ProblemMetadata = {
    id: info.id,
    slug: info.slug,
    title: info.title,
    difficulty: info.difficulty,
    topics: info.topics,
    url: `https://leetcode.com/problems/${info.slug}/`,
    language: languageToExtension(detail.lang),
    code: detail.code,
  };

  const snapshots = detail.snapshots ?? [];

  const onGenerateApproach = async (
    type: 'Brute' | 'Better',
  ): Promise<{ ok: true; code: string } | { ok: false; reason: string }> => {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          type: 'DSA_GENERATE_APPROACH',
          metadata,
          approachType: type,
        },
        (res) => {
          if (chrome.runtime?.lastError) {
            resolve({ ok: false, reason: chrome.runtime.lastError.message ?? 'Request failed' });
            return;
          }
          resolve(res ?? { ok: false, reason: 'No response from background' });
        },
      );
    });
  };

  const onPush = (approaches: ProblemApproaches) => {
    metadata.approaches = approaches;

    chrome.runtime.sendMessage(
      {
        type: 'DSA_SYNC_ACCEPTED',
        metadata,
      },
      (response) => {
        if (chrome.runtime?.lastError) {
          ui.showError({
            message: chrome.runtime.lastError.message ?? 'Sync failed.',
            onRetry: () => onPush(approaches),
            soundEnabled: config.soundEnabled,
            soundVolume: config.soundVolume,
          });
          return;
        }

        if (response?.ok) {
          const folderUrl = `https://github.com/${config.repoOwner}/${config.repoName}/tree/${config.branch}/${config.destinationRoot}/${response.folderPath}`;
          ui.showSuccess({
            metadata,
            folderUrl,
            aiFailureReason: response.aiFailureReason,
            soundEnabled: config.soundEnabled,
            soundVolume: config.soundVolume,
          });
        } else {
          ui.showError({
            message: response?.error ?? 'Sync failed.',
            onRetry: () => onPush(approaches),
            soundEnabled: config.soundEnabled,
            soundVolume: config.soundVolume,
          });
        }
      },
    );
  };

  ui.showAcceptedPanel({
    metadata,
    snapshots,
    config,
    onPush,
    onGenerateApproach,
  });
}
