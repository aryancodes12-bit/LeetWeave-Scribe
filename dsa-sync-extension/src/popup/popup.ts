import type { ExtensionConfig, ProblemMetadata, SyncStats } from '../shared/types.js';
import { emptyStats } from '../shared/types.js';
import { getDifficultyTotals } from '../shared/dataset.js';
import { ASSUMED_MANUAL_SECONDS_PER_PROBLEM } from '../shared/stats.js';
import { listGeminiModels, DEFAULT_GEMINI_MODEL } from '../shared/gemini.js';

const app = document.getElementById('app')!;
const subtitle = document.getElementById('header-subtitle')!;
const statusRow = document.getElementById('status-row')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const navWrap = document.getElementById('nav-wrap')!;
const navSlider = document.getElementById('nav-slider')!;
const navTabDash = document.getElementById('nav-tab-dash')!;
const navTabSettings = document.getElementById('nav-tab-settings')!;

let currentTab: 'dash' | 'settings' = 'dash';
let cachedConfig: ExtensionConfig | undefined;
let cachedStats: SyncStats = emptyStats();
let cachedLastSynced: ProblemMetadata | undefined;

async function main(): Promise<void> {
  const isExtensionEnv = typeof chrome !== 'undefined' && Boolean(chrome.storage?.local);
  const stored = isExtensionEnv
    ? await chrome.storage.local.get(['config', 'stats', 'lastSyncedMetadata'])
    : {
        config: {
          repoOwner: 'aryancodes12-bit',
          repoName: 'DSA-Journey',
          branch: 'main',
          destinationRoot: 'organized',
          organization: 'topic',
          rules: [],
          fallbackFolder: 'Uncategorized',
          namingPattern: 'LC{id}',
          githubToken: 'ghp_demo_token_123',
          geminiApiKey: 'AIzaSy_demo_key_xyz',
          geminiModel: DEFAULT_GEMINI_MODEL,
          autoPushSeconds: 8,
          soundEnabled: true,
          soundVolume: 0.5,
        },
        stats: {
          total: 42,
          easy: 20,
          medium: 18,
          hard: 4,
          currentStreak: 7,
          longestStreak: 14,
          lastSyncedAt: new Date().toISOString(),
          recent: [{ id: 283, title: 'Move Zeroes', difficulty: 'Easy', language: 'java', date: '2026-10-09' }],
          timeSavedSeconds: 15120,
        },
        lastSyncedMetadata: {
          id: 283,
          slug: 'move-zeroes',
          title: 'Move Zeroes',
          difficulty: 'Easy',
          topics: ['Array', 'Two Pointers'],
          url: 'https://leetcode.com/problems/move-zeroes/',
          language: 'java',
          code: 'class Solution {}',
        },
      };
  cachedConfig = stored.config as ExtensionConfig | undefined;
  cachedStats = { ...emptyStats(), ...(stored.stats ?? {}) };
  cachedLastSynced = stored.lastSyncedMetadata as ProblemMetadata | undefined;

  if (!cachedConfig || !cachedConfig.githubToken || !cachedConfig.repoOwner || !cachedConfig.repoName) {
    subtitle.textContent = 'Not connected';
    setStatus(false);
    navWrap.style.display = 'none';
    renderView('settings');
  } else {
    subtitle.textContent = `${cachedConfig.repoOwner}/${cachedConfig.repoName}`;
    setStatus(true);
    navWrap.style.display = 'block';
    setupNavListeners();
    renderView('dash');
  }
}

function setStatus(connected: boolean): void {
  statusRow.className = `ext-status-row${connected ? '' : ' disconnected'}`;
  statusDot.className = `dot${connected ? '' : ' off'}`;
  statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function setupNavListeners(): void {
  navTabDash.onclick = () => {
    if (currentTab !== 'dash') {
      navTabDash.classList.add('active');
      navTabDash.setAttribute('aria-selected', 'true');
      navTabSettings.classList.remove('active');
      navTabSettings.setAttribute('aria-selected', 'false');
      if (navSlider) navSlider.style.transform = 'translateX(0)';
      renderView('dash');
    }
  };

  navTabSettings.onclick = () => {
    if (currentTab !== 'settings') {
      navTabSettings.classList.add('active');
      navTabSettings.setAttribute('aria-selected', 'true');
      navTabDash.classList.remove('active');
      navTabDash.setAttribute('aria-selected', 'false');
      if (navSlider) navSlider.style.transform = 'translateX(100%)';
      renderView('settings');
    }
  };
}

function renderView(view: 'dash' | 'settings'): void {
  currentTab = view;
  app.classList.remove('fade-in');
  app.classList.add('fade-out');

  setTimeout(() => {
    if (view === 'dash' && cachedConfig) {
      renderDashboard(cachedConfig, cachedStats, cachedLastSynced);
    } else {
      renderSettings(cachedConfig);
    }
    app.classList.remove('fade-out');
    app.classList.add('fade-in');
  }, 150);
}

function animateNumber(element: HTMLElement, target: number, duration = 650): void {
  if (target <= 0) {
    element.textContent = '0';
    return;
  }
  const startTime = performance.now();
  const step = (currentTime: number) => {
    const elapsed = currentTime - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const ease = 1 - Math.pow(1 - progress, 3);
    const current = Math.floor(ease * target);
    element.textContent = String(current);
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      element.textContent = String(target);
    }
  };
  requestAnimationFrame(step);
}

function renderDashboard(
  config: ExtensionConfig,
  stats: SyncStats,
  lastSynced?: ProblemMetadata,
): void {
  const totals = getDifficultyTotals();

  const repoChip = `
    <div class="repo-chip">
      <a class="repo-chip-left" id="chip-repo-link" href="#" title="Open repository in GitHub">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1H4.5a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/></svg>
        <span>${escapeHtml(config.repoOwner)}/${escapeHtml(config.repoName)}</span>
      </a>
      <span style="color:var(--text-muted);font-size:10.5px;">${escapeHtml(config.branch)}</span>
    </div>
  `;

  const statGrid = `
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-num" id="stat-solved">0</div>
        <div class="stat-label">Solved</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" id="stat-streak">0</div>
        <div class="stat-label"><span>🔥</span> Streak</div>
      </div>
      <div class="stat-card">
        <div class="stat-num" id="stat-longest">0</div>
        <div class="stat-label">Longest</div>
      </div>
    </div>
  `;

  const diffBars = `
    <div class="diff-bars-card">
      ${diffRowHtml('Easy', stats.easy, totals.easy, 'bar-easy', 'easy')}
      ${diffRowHtml('Medium', stats.medium, totals.medium, 'bar-medium', 'medium')}
      ${diffRowHtml('Hard', stats.hard, totals.hard, 'bar-hard', 'hard')}
    </div>
  `;

  const timeSaved = stats.total > 0
    ? `
      <div class="tinted-card tinted-card-blue">
        <svg style="color:#60a5fa;flex-shrink:0;margin-top:2px;" width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm.5-8.25V4a.5.5 0 0 0-1 0v4a.5.5 0 0 0 .146.354l2.5 2.5a.5.5 0 0 0 .708-.708L8.5 7.75Z"/></svg>
        <div>
          <strong>${formatDuration(stats.timeSavedSeconds)} saved</strong>
          <span>vs manual reorg (~${ASSUMED_MANUAL_SECONDS_PER_PROBLEM / 60}m/problem)</span>
        </div>
      </div>
    `
    : '';

  const lastSync = stats.lastSyncedAt
    ? `
      <div class="tinted-card tinted-card-green">
        <svg style="color:#4ade80;flex-shrink:0;margin-top:2px;" width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-8.75 4.03 6.28-6.278a.75.75 0 0 0-1.06-1.06L6.47 9.69 3.85 7.07a.75.75 0 0 0-1.06 1.06l3.19 3.19c.29.29.77.29 1.06 0Z"/></svg>
        <div style="flex:1;">
          <strong>Synced ${relativeTime(stats.lastSyncedAt)}</strong>
          <span>${escapeHtml(stats.recent[0]?.title ?? '')}</span>
        </div>
        ${lastSynced ? `<button class="lws-btn-inline" id="regenerate-notes-btn" title="Regenerate Gemini technical notes" style="margin-left:auto;">✨ Regenerate</button>` : ''}
      </div>
    `
    : `<div class="empty-state">No problems synced yet — solve one on LeetCode!</div>`;

  app.innerHTML = `
    ${repoChip}
    ${statGrid}
    ${diffBars}
    ${timeSaved}
    ${lastSync}
    <p id="dash-status" class="status-msg"></p>
    <div class="btn-row" style="margin-top:8px;">
      <button id="view-repo">View on GitHub</button>
      <button id="go-settings" class="primary">Settings</button>
    </div>
  `;

  // Count-up animations
  const solvedEl = document.getElementById('stat-solved');
  const streakEl = document.getElementById('stat-streak');
  const longestEl = document.getElementById('stat-longest');
  if (solvedEl) animateNumber(solvedEl, stats.total);
  if (streakEl) animateNumber(streakEl, stats.currentStreak);
  if (longestEl) animateNumber(longestEl, stats.longestStreak);

  // Animate progress bars from 0
  setTimeout(() => {
    setBarWidth('bar-easy', stats.easy, totals.easy);
    setBarWidth('bar-medium', stats.medium, totals.medium);
    setBarWidth('bar-hard', stats.hard, totals.hard);
  }, 50);

  document.getElementById('chip-repo-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({
      url: `https://github.com/${config.repoOwner}/${config.repoName}/tree/${config.branch}/${config.destinationRoot}`,
    });
  });

  document.getElementById('view-repo')?.addEventListener('click', () => {
    chrome.tabs.create({
      url: `https://github.com/${config.repoOwner}/${config.repoName}/tree/${config.branch}/${config.destinationRoot}`,
    });
  });

  document.getElementById('go-settings')?.addEventListener('click', () => {
    navTabSettings.click();
  });

  document.getElementById('regenerate-notes-btn')?.addEventListener('click', async () => {
    const btn = document.getElementById('regenerate-notes-btn') as HTMLButtonElement | null;
    const statusMsg = document.getElementById('dash-status')!;
    if (btn) {
      btn.textContent = 'Generating...';
      btn.disabled = true;
    }
    statusMsg.className = 'status-msg';
    statusMsg.textContent = 'Regenerating Gemini technical notes...';

    chrome.runtime.sendMessage({ type: 'DSA_REGENERATE_NOTES' }, (res) => {
      if (btn) {
        btn.textContent = '✨ Regenerate';
        btn.disabled = false;
      }
      if (res?.ok) {
        statusMsg.className = 'status-msg success';
        statusMsg.textContent = '✓ Notes regenerated and pushed to GitHub!';
        setTimeout(() => { statusMsg.textContent = ''; }, 4000);
      } else {
        statusMsg.className = 'status-msg error';
        statusMsg.textContent = `Regeneration failed: ${res?.reason ?? 'Unknown error'}`;
      }
    });
  });
}

function diffRowHtml(label: string, count: number, total: number, barClass: string, id: string): string {
  return `
    <div class="diff-row">
      <span class="diff-label">${label}</span>
      <div class="bar-track">
        <div class="bar-fill ${barClass}" id="bar-${id}"></div>
      </div>
      <span class="diff-count">${count} / ${total}</span>
    </div>
  `;
}

function setBarWidth(id: string, count: number, total: number): void {
  const el = document.getElementById(id);
  if (!el) return;
  const pct = total > 0 ? Math.min(100, (count / total) * 100) : 0;
  el.style.width = `${pct}%`;
}

function renderSettings(existing?: Partial<ExtensionConfig>): void {
  app.innerHTML = `
    <div class="settings-scroll-wrap">
      <!-- Section 1: Repository Details -->
      <div class="glass-card">
        <div class="form-group-title">
          <span>📁</span> Repository Settings
        </div>

        <label for="repoOwner">GitHub Username or Org</label>
        <input id="repoOwner" placeholder="e.g. aryancodes12-bit" value="${escapeAttr(existing?.repoOwner ?? '')}" />

        <label for="repoName">Repository Name</label>
        <input id="repoName" placeholder="e.g. DSA-Journey" value="${escapeAttr(existing?.repoName ?? '')}" />

        <div class="form-row">
          <div>
            <label for="branch">Branch</label>
            <input id="branch" placeholder="main" value="${escapeAttr(existing?.branch ?? 'main')}" />
          </div>
          <div>
            <label for="destinationRoot">Root Folder</label>
            <input id="destinationRoot" placeholder="organized" value="${escapeAttr(existing?.destinationRoot ?? 'organized')}" />
          </div>
        </div>

        <label for="organization">Organize Subfolders By</label>
        <select id="organization">
          <option value="topic" ${existing?.organization === 'topic' ? 'selected' : ''}>Topic (Array, Two Pointers...)</option>
          <option value="difficulty" ${existing?.organization === 'difficulty' ? 'selected' : ''}>Difficulty (Easy, Medium, Hard)</option>
        </select>
            <input id="geminiModelCustom" placeholder="e.g. gemini-3.5-flash" style="display:none;margin-top:6px;" value="${escapeAttr(existing?.geminiModel ?? '')}" />

        <label for="fallbackFolder">Fallback Folder</label>
        <input id="fallbackFolder" placeholder="Uncategorized" value="${escapeAttr(existing?.fallbackFolder ?? 'Uncategorized')}" />

        <label for="namingPattern">File Naming Pattern</label>
        <select id="namingPattern">
          <option value="LC{id}" ${existing?.namingPattern === 'LC{id}' ? 'selected' : ''}>LC{id} → LC283.java</option>
          <option value="{title}" ${existing?.namingPattern === '{title}' ? 'selected' : ''}>{title} → MoveZeroes.java</option>
          <option value="{id}-{slug}" ${existing?.namingPattern === '{id}-{slug}' ? 'selected' : ''}>{id}-{slug} → 283-move-zeroes.java</option>
        </select>
            <input id="geminiModelCustom" placeholder="e.g. gemini-3.5-flash" style="display:none;margin-top:6px;" value="${escapeAttr(existing?.geminiModel ?? '')}" />
      </div>

      <!-- Section 2: Tokens & AI Keys -->
      <div class="glass-card">
        <div class="form-group-title">
          <span>🔑</span> Credentials &amp; AI
        </div>

        <label for="githubToken">GitHub Personal Access Token (PAT)</label>
        <input id="githubToken" type="password" placeholder="ghp_..." value="${escapeAttr(existing?.githubToken ?? '')}" />
        <p class="hint">
          Requires <strong>repo</strong> scope.
          <a id="token-link" href="#">Generate token on GitHub →</a>
        </p>

        <label for="geminiApiKey">Google Gemini API Key</label>
        <div class="input-with-toggle">
          <input id="geminiApiKey" type="password" placeholder="AIzaSy..." value="${escapeAttr(existing?.geminiApiKey ?? '')}" />
          <button type="button" class="input-toggle-btn" id="toggle-gemini-key" title="Show/hide key" aria-label="Show or hide API key">👁️</button>
        </div>
        <p class="hint">
          Powers structured technical notes &amp; multi-approach generation.
          <a id="gemini-link" href="#">Get a key from Google AI Studio →</a>
        </p>

        <div class="form-row">
          <div>
            <div style="display:flex;align-items:center;justify-content:space-between;margin:9px 0 4px;">
              <label for="geminiModelSelect" style="margin:0;">Gemini Model</label>
              <button type="button" class="lws-btn-inline" id="refresh-models-btn" title="Refresh available models from Google API" style="font-size:10px;padding:2px 7px;">↻ Refresh</button>
            </div>
            <select id="geminiModelSelect">
              <option value="gemini-3.5-flash">gemini-3.5-flash (Default)</option>
              <option value="gemini-flash-latest">gemini-flash-latest</option>
              <option value="gemini-2.5-flash">gemini-2.5-flash</option>
              <option value="gemini-2.0-flash">gemini-2.0-flash</option>
              <option value="gemini-1.5-flash">gemini-1.5-flash</option>
              <option value="gemini-1.5-pro">gemini-1.5-pro</option>
              <option value="__custom__">Custom / Enter manually...</option>
            </select>
            <input id="geminiModelCustom" placeholder="e.g. gemini-3.5-flash" style="display:none;margin-top:6px;" value="${escapeAttr(existing?.geminiModel ?? '')}" />
          </div>
          <div>
            <label for="autoPushSeconds">Auto-push (seconds)</label>
            <input id="autoPushSeconds" type="number" min="0" max="60" value="${existing?.autoPushSeconds ?? 8}" />
          </div>
        </div>
      </div>

      <!-- Section 3: Audio & Sync Preferences -->
      <div class="glass-card">
        <div class="form-group-title">
          <span>🔊</span> Preferences
        </div>

        <div class="switch-row">
          <span class="switch-label">Sound Effects</span>
          <input type="checkbox" id="soundEnabled" style="width:auto;cursor:pointer;" ${existing?.soundEnabled !== false ? 'checked' : ''} />
        </div>

        <label for="soundVolume">Sound Volume (<span id="vol-display">${Math.round((existing?.soundVolume ?? 0.5) * 100)}%</span>)</label>
        <input type="range" id="soundVolume" min="0" max="1" step="0.05" value="${existing?.soundVolume ?? 0.5}" style="cursor:pointer;" />

        <div class="btn-row" style="margin-top:14px;">
          <button id="export-config">Export JSON</button>
          <button id="import-config">Import JSON</button>
        </div>
      </div>
    </div>

    <!-- Sticky Glass Footer with Save Button -->
    <div class="glass-footer-sticky">
      <button id="save-config" class="primary full-width">Save Configuration</button>
      <p id="save-status" class="status-msg"></p>
    </div>
  `;

  // Model select & custom fallback handling
  const modelSelect = document.getElementById('geminiModelSelect') as HTMLSelectElement;
  const modelCustom = document.getElementById('geminiModelCustom') as HTMLInputElement;
  const currentModel = existing?.geminiModel?.trim() || DEFAULT_GEMINI_MODEL;

  let modelFound = false;
  for (let i = 0; i < modelSelect.options.length; i++) {
    if (modelSelect.options[i]!.value === currentModel) {
      modelSelect.selectedIndex = i;
      modelFound = true;
      break;
    }
  }

  // Mask toggle for Gemini Key
  const geminiInput = document.getElementById('geminiApiKey') as HTMLInputElement;
  const toggleBtn = document.getElementById('toggle-gemini-key');
  toggleBtn?.addEventListener('click', () => {
    if (geminiInput.type === 'password') {
      geminiInput.type = 'text';
      toggleBtn.textContent = '🔒';
    } else {
      geminiInput.type = 'password';
      toggleBtn.textContent = '👁️';
    }
  });

  document.getElementById('token-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/settings/tokens/new?scopes=repo&description=LeetWeave-Scribe' });
  });

  document.getElementById('gemini-link')?.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://aistudio.google.com/apikey' });
  });

  const volSlider = document.getElementById('soundVolume') as HTMLInputElement;
  const volDisplay = document.getElementById('vol-display')!;
  volSlider?.addEventListener('input', () => {
    volDisplay.textContent = `${Math.round(parseFloat(volSlider.value) * 100)}%`;
  });

  document.getElementById('save-config')?.addEventListener('click', async () => {
    const status = document.getElementById('save-status')!;
    const owner = getValue('repoOwner');
    const name = getValue('repoName');
    const token = getValue('githubToken');

    if (!owner || !name || !token) {
      status.className = 'status-msg error';
      status.textContent = 'Repo owner, repo name, and GitHub token are required.';
      return;
    }

    const autoSec = parseInt(getValue('autoPushSeconds'), 10);

    const newConfig: ExtensionConfig = {
      repoOwner: owner,
      repoName: name,
      branch: getValue('branch') || 'main',
      destinationRoot: getValue('destinationRoot') || 'organized',
      organization: getValue('organization') as ExtensionConfig['organization'],
      rules: existing?.rules ?? [],
      fallbackFolder: getValue('fallbackFolder') || 'Uncategorized',
      namingPattern: getValue('namingPattern') || 'LC{id}',
      githubToken: token,
      geminiApiKey: getValue('geminiApiKey'),
      geminiModel: getValue('geminiModel') || DEFAULT_GEMINI_MODEL,
      autoPushSeconds: isNaN(autoSec) ? 8 : Math.max(0, autoSec),
      soundEnabled: (document.getElementById('soundEnabled') as HTMLInputElement).checked,
      soundVolume: parseFloat(volSlider.value) || 0.5,
    };

    status.className = 'status-msg';
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      await chrome.storage.local.set({ config: newConfig });
    }
    cachedConfig = newConfig;

    status.className = 'status-msg success';
    status.textContent = '✓ Configuration saved!';

    setTimeout(() => {
      main();
    }, 600);
  });

  document.getElementById('export-config')?.addEventListener('click', async () => {
    const status = document.getElementById('save-status')!;
    await navigator.clipboard.writeText(JSON.stringify(cachedConfig ?? {}, null, 2));
    status.className = 'status-msg success';
    status.textContent = '✓ Copied config JSON to clipboard.';
    setTimeout(() => { status.textContent = ''; }, 3000);
  });

  document.getElementById('import-config')?.addEventListener('click', async () => {
    const pasted = prompt('Paste your exported settings JSON:');
    if (!pasted) return;
    try {
      const imported = JSON.parse(pasted) as ExtensionConfig;
      await chrome.storage.local.set({ config: imported });
      main();
    } catch {
      alert('Invalid settings JSON.');
    }
  });
}

function getValue(id: string): string {
  const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
  return el ? el.value.trim() : '';
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${Math.round(totalSeconds)}s`;
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text.replace(/"/g, '&quot;');
}

main();
