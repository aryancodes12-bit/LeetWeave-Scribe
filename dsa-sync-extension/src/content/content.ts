import { lookupProblemBySlug } from '../shared/dataset.js';
import { languageToExtension } from '../shared/language.js';
import type { ProblemMetadata } from '../shared/types.js';

const EVENT_NAME = 'lws:accepted';

interface AcceptedEventDetail {
  lang: string;
  code: string;
  runtime: string | null;
  memory: string | null;
}

function getSlugFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/problems\/([^/]+)\/?/);
  return match?.[1] ?? null;
}

window.addEventListener(EVENT_NAME, (event) => {
  const detail = (event as CustomEvent<AcceptedEventDetail>).detail;
  handleAccepted(detail).catch((err) => {
    if (isContextInvalidatedError(err)) {
      // Happens whenever the extension was reloaded/updated while this LeetCode
      // tab was already open — the content script is orphaned from the old
      // instance. Not a real failure; refreshing the page reconnects it.
      console.warn('[LWS] Extension was reloaded — refresh this page to keep syncing.');
      showToast({
        status: 'error',
        message: 'Extension updated — refresh this page to keep syncing.',
      });
      return;
    }
    console.error('[LWS] failed to handle accepted submission:', err);
    showToast({ status: 'error', message: 'Sync failed — see console for details.' });
  });
});

function isContextInvalidatedError(err: unknown): boolean {
  return err instanceof Error && err.message.includes('Extension context invalidated');
}

async function handleAccepted(detail: AcceptedEventDetail): Promise<void> {
  const slug = getSlugFromUrl();
  if (!slug) return;

  const info = lookupProblemBySlug(slug);
  if (!info) {
    showToast({
      status: 'error',
      message: `"${slug}" isn't in the bundled problem dataset yet — skipped.`,
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

  showToast({ status: 'syncing', message: metadata.title });

  chrome.runtime.sendMessage({ type: 'DSA_SYNC_ACCEPTED', metadata }, (response) => {
    if (chrome.runtime.lastError) {
      showToast({ status: 'error', message: chrome.runtime.lastError.message ?? 'Sync failed.' });
      return;
    }
    if (response?.ok) {
      showToast({
        status: 'success',
        message: `${metadata.title} synced to your repo`,
        detail: response.path,
      });
    } else {
      showToast({ status: 'error', message: response?.error ?? 'Sync failed.' });
    }
  });
}

// --- Minimal toast UI, matching the earlier mockup, injected without a framework ---

interface ToastOptions {
  status: 'syncing' | 'success' | 'error';
  message: string;
  detail?: string;
}

function showToast(options: ToastOptions): void {
  const existing = document.getElementById('lws-toast');
  existing?.remove();

  const toast = document.createElement('div');
  toast.id = 'lws-toast';
  toast.setAttribute(
    'style',
    [
      'position:fixed',
      'bottom:24px',
      'right:24px',
      'width:320px',
      'background:#fff',
      'border-radius:10px',
      'box-shadow:0 8px 28px rgba(0,0,0,.22)',
      'border:1px solid #d0d7de',
      'padding:14px 16px',
      'font-family:-apple-system,Segoe UI,sans-serif',
      'font-size:12.5px',
      'color:#1f2328',
      'z-index:2147483647',
      'animation:lws-slide-in .35s ease-out',
    ].join(';'),
  );

  if (!document.getElementById('lws-toast-style')) {
    const style = document.createElement('style');
    style.id = 'lws-toast-style';
    style.textContent = `
      @keyframes lws-slide-in {
        from { transform: translateY(12px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
    `;
    document.head.appendChild(style);
  }

  const color = options.status === 'error' ? '#c0362c' : '#1a7f37';
  const bg = options.status === 'error' ? '#ffebe9' : '#dafbe1';
  const icon = options.status === 'error' ? '✕' : options.status === 'syncing' ? '…' : '✓';
  const title = options.status === 'error' ? 'Sync failed' : options.status === 'syncing' ? 'Syncing...' : 'Pushed to GitHub';

  toast.innerHTML = `
    <div style="display:flex;gap:12px;">
      <div style="width:32px;height:32px;border-radius:8px;background:${bg};color:${color};display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;font-size:15px;">${icon}</div>
      <div style="line-height:1.45;">
        <strong style="display:block;font-size:13px;color:#1f2328;margin-bottom:2px;">${escapeHtml(title)}</strong>
        <span style="color:#59636e;">${escapeHtml(options.message)}</span>
        ${options.detail ? `<div style="font-family:monospace;font-size:11px;color:#59636e;background:#f6f8fa;padding:2px 6px;border-radius:4px;display:inline-block;margin-top:4px;">${escapeHtml(options.detail)}</div>` : ''}
      </div>
    </div>
  `;

  document.body.appendChild(toast);

  if (options.status !== 'syncing') {
    setTimeout(() => toast.remove(), 6000);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
