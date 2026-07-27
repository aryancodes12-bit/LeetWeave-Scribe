import type { ExtensionConfig, SyncStats } from '../shared/types.js';
import { emptyStats } from '../shared/types.js';
import { getDifficultyTotals } from '../shared/dataset.js';
import { ASSUMED_MANUAL_SECONDS_PER_PROBLEM } from '../shared/stats.js';

const app = document.getElementById('app')!;
const subtitle = document.getElementById('header-subtitle')!;
const statusRow = document.getElementById('status-row')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;

async function main(): Promise<void> {
  const stored = await chrome.storage.local.get(['config', 'stats']);
  const config = stored.config as ExtensionConfig | undefined;
  const stats: SyncStats = { ...emptyStats(), ...(stored.stats ?? {}) };

  if (!config || !config.githubToken) {
    subtitle.textContent = 'Not connected';
    setStatus(false);
    renderSetupForm(config);
  } else {
    subtitle.textContent = `${config.repoOwner}/${config.repoName}`;
    setStatus(true);
    renderDashboard(config, stats);
  }
}

function setStatus(connected: boolean): void {
  statusRow.className = `ext-status-row${connected ? '' : ' disconnected'}`;
  statusDot.className = `dot${connected ? '' : ' off'}`;
  statusText.textContent = connected ? 'Connected' : 'Disconnected';
}

function renderSetupForm(existing?: Partial<ExtensionConfig>): void {
  app.innerHTML = `
    <label for="repoOwner">GitHub username / org</label>
    <input id="repoOwner" placeholder="aryancodes12-bit" value="${escapeAttr(existing?.repoOwner ?? '')}" />

    <label for="repoName">Repository name</label>
    <input id="repoName" placeholder="DSA-Journey" value="${escapeAttr(existing?.repoName ?? '')}" />

    <div class="row">
      <div>
        <label for="branch">Branch</label>
        <input id="branch" placeholder="main" value="${escapeAttr(existing?.branch ?? 'main')}" />
      </div>
      <div>
        <label for="destinationRoot">Folder</label>
        <input id="destinationRoot" placeholder="organized" value="${escapeAttr(existing?.destinationRoot ?? 'organized')}" />
      </div>
    </div>

    <label for="organization">Organize by</label>
    <select id="organization">
      <option value="topic" ${existing?.organization === 'topic' ? 'selected' : ''}>Topic</option>
      <option value="difficulty" ${existing?.organization === 'difficulty' ? 'selected' : ''}>Difficulty</option>
    </select>

    <label for="fallbackFolder">Fallback folder</label>
    <input id="fallbackFolder" placeholder="Uncategorized" value="${escapeAttr(existing?.fallbackFolder ?? 'Uncategorized')}" />

    <label for="namingPattern">File naming</label>
    <select id="namingPattern">
      <option value="LC{id}">LC{id} → LC268.java</option>
      <option value="{title}">{title} → MissingNumber.java</option>
      <option value="{id}-{slug}">{id}-{slug} → 268-missing-number.java</option>
    </select>

    <label for="githubToken">GitHub Personal Access Token</label>
    <input id="githubToken" type="password" placeholder="ghp_..." value="${escapeAttr(existing?.githubToken ?? '')}" />

    <button id="save" class="primary full-width setup-save">Connect &amp; Save</button>
    <p class="hint">
      Needs a token with <strong>repo</strong> scope.
      <a id="token-link" href="#">Create one on GitHub →</a>
    </p>
    <p id="status"></p>
  `;

  document.getElementById('token-link')!.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/settings/tokens/new?scopes=repo&description=LeetWeave-Scribe' });
  });

  document.getElementById('save')!.addEventListener('click', async () => {
    const config: ExtensionConfig = {
      repoOwner: getValue('repoOwner'),
      repoName: getValue('repoName'),
      branch: getValue('branch') || 'main',
      destinationRoot: getValue('destinationRoot') || 'organized',
      organization: getValue('organization') as ExtensionConfig['organization'],
      rules: existing?.rules ?? [],
      fallbackFolder: getValue('fallbackFolder') || 'Uncategorized',
      namingPattern: getValue('namingPattern'),
      githubToken: getValue('githubToken'),
    };

    const status = document.getElementById('status')!;

    if (!config.repoOwner || !config.repoName || !config.githubToken) {
      status.textContent = 'Repo owner, repo name, and token are all required.';
      status.className = 'error';
      return;
    }

    status.textContent = 'Saving...';
    status.className = '';
    await chrome.storage.local.set({ config });
    status.textContent = '✓ Saved. Go solve a problem!';
    status.className = 'success';
    setTimeout(() => main(), 800);
  });
}

function renderDashboard(config: ExtensionConfig, stats: SyncStats): void {
  const totals = getDifficultyTotals();

  const repoChip = `
    <div class="repo-chip">
      ${repoIconSvg()}
      ${escapeHtml(config.repoOwner)}/${escapeHtml(config.repoName)}
    </div>
  `;

  const statGrid = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-num">${stats.total}</div><div class="stat-label">Solved</div></div>
      <div class="stat-card"><div class="stat-num">${stats.currentStreak}</div><div class="stat-label">Streak</div></div>
      <div class="stat-card"><div class="stat-num">${stats.longestStreak}</div><div class="stat-label">Longest</div></div>
    </div>
  `;

  const diffBars = `
    <div class="diff-bars">
      ${diffRow('Easy', stats.easy, totals.easy, 'var(--easy)')}
      ${diffRow('Medium', stats.medium, totals.medium, 'var(--medium)')}
      ${diffRow('Hard', stats.hard, totals.hard, 'var(--hard)')}
    </div>
  `;

  const timeSaved = stats.total > 0
    ? `
      <div class="time-saved">
        ${clockIconSvg()}
        <div class="time-saved-text">
          <strong>${formatDuration(stats.timeSavedSeconds)} saved</strong>
          <span>vs. manual GitHub reorg + push (est. ${ASSUMED_MANUAL_SECONDS_PER_PROBLEM / 60} min/problem)</span>
        </div>
      </div>
    `
    : '';

  const lastSync = stats.lastSyncedAt
    ? `
      <div class="last-sync">
        ${checkIconSvg()}
        <div class="last-sync-text">
          <strong>Synced ${relativeTime(stats.lastSyncedAt)}</strong>
          <span>${escapeHtml(stats.recent[0]?.title ?? '')}</span>
        </div>
      </div>
    `
    : `<div class="empty-state">No problems synced yet — solve one on LeetCode.</div>`;

  app.innerHTML = `
    ${repoChip}
    ${statGrid}
    ${diffBars}
    ${timeSaved}
    ${lastSync}
    <div class="ext-footer">
      <button id="view-repo">View Repo</button>
      <button id="edit-config" class="primary">Edit Settings</button>
    </div>
    <div class="ext-footer" style="margin-top:8px;">
      <button id="export-config">Export Settings</button>
      <button id="import-config">Import Settings</button>
    </div>
    <p id="export-status" class="hint" style="text-align:center;"></p>
  `;

  document.getElementById('view-repo')!.addEventListener('click', () => {
    chrome.tabs.create({
      url: `https://github.com/${config.repoOwner}/${config.repoName}/tree/${config.branch}/${config.destinationRoot}`,
    });
  });

  document.getElementById('edit-config')!.addEventListener('click', () => {
    renderSetupForm(config);
  });

  document.getElementById('export-config')!.addEventListener('click', async () => {
    await navigator.clipboard.writeText(JSON.stringify(config, null, 2));
    const el = document.getElementById('export-status')!;
    el.textContent = '✓ Copied to clipboard — paste it somewhere safe (it contains your token).';
    setTimeout(() => (el.textContent = ''), 4000);
  });

  document.getElementById('import-config')!.addEventListener('click', async () => {
    const pasted = prompt('Paste your previously exported settings JSON:');
    if (!pasted) return;
    try {
      const imported = JSON.parse(pasted) as ExtensionConfig;
      await chrome.storage.local.set({ config: imported });
      main();
    } catch {
      const el = document.getElementById('export-status')!;
      el.textContent = 'That didn\'t look like valid exported settings.';
    }
  });
}

function diffRow(label: string, count: number, total: number, color: string): string {
  const pct = total > 0 ? Math.min(100, (count / total) * 100) : 0;
  return `
    <div class="diff-row">
      <span class="diff-label">${label}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color};"></div></div>
      <span class="diff-count">${count} / ${total}</span>
    </div>
  `;
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

function formatDuration(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${mins}m`;
  if (mins > 0) return `${mins}m`;
  return `${Math.round(totalSeconds)}s`;
}

function clockIconSvg(): string {
  return `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 16A8 8 0 1 1 8 0a8 8 0 0 1 0 16Zm.5-8.25V4a.5.5 0 0 0-1 0v4a.5.5 0 0 0 .146.354l2.5 2.5a.5.5 0 0 0 .708-.708L8.5 7.75Z"/></svg>`;
}

function repoIconSvg(): string {
  return `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 1 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.714 1.7.75.75 0 1 1-1.072 1.05A2.495 2.495 0 0 1 2 11.5Zm10.5-1H4.5a1 1 0 0 0-1 1v6.708A2.486 2.486 0 0 1 4.5 9h8Z"/></svg>`;
}

function checkIconSvg(): string {
  return `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M16 8A8 8 0 1 1 0 8a8 8 0 0 1 16 0Zm-8.75 4.03 6.28-6.278a.75.75 0 0 0-1.06-1.06L6.47 9.69 3.85 7.07a.75.75 0 0 0-1.06 1.06l3.19 3.19c.29.29.77.29 1.06 0Z"/></svg>`;
}

function getValue(id: string): string {
  return (document.getElementById(id) as HTMLInputElement | HTMLSelectElement).value.trim();
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
