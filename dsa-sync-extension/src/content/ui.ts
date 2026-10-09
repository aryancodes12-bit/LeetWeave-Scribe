import type { ExtensionConfig, ProblemApproaches, ProblemMetadata } from '../shared/types.js';
import { playSuccessChime, playErrorTone } from './sound.js';

export interface StepState {
  step: 'submitting' | 'pushing' | 'notes' | 'stats';
  status: 'pending' | 'active' | 'done';
  detail?: string;
}

export interface ShowPanelParams {
  metadata: ProblemMetadata;
  snapshots: string[];
  config: ExtensionConfig;
  onPush: (approaches: ProblemApproaches) => Promise<void>;
}

export class LwsShadowUI {
  private host: HTMLElement | null = null;
  private shadow: ShadowRoot | null = null;
  private countdownTimer: number | null = null;
  private isTyping = false;
  private remainingSeconds = 8;
  private steps: Record<'submitting' | 'pushing' | 'notes' | 'stats', 'pending' | 'active' | 'done'> = {
    submitting: 'pending',
    pushing: 'pending',
    notes: 'pending',
    stats: 'pending',
  };

  constructor() {
    this.init();
  }

  private init(): void {
    let existingHost = document.getElementById('lws-shadow-host');
    if (existingHost) {
      existingHost.remove();
    }
    this.host = document.createElement('div');
    this.host.id = 'lws-shadow-host';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    document.body.appendChild(this.host);
  }

  public showAcceptedPanel(params: {
    metadata: ProblemMetadata;
    snapshots: string[];
    config: ExtensionConfig;
    onPush: (approaches: ProblemApproaches) => void;
    onGenerateApproach: (type: 'Brute' | 'Better') => Promise<{ ok: true; code: string } | { ok: false; reason: string }>;
  }): void {
    if (!this.shadow) this.init();
    if (!this.shadow) return;

    this.remainingSeconds = params.config.autoPushSeconds ?? 8;
    this.isTyping = false;
    if (this.countdownTimer) clearInterval(this.countdownTimer);

    this.shadow.innerHTML = `
      <style>${this.getCss()}</style>
      <div class="lws-container lws-spring-in" role="region" aria-live="polite" aria-label="LeetWeave Scribe Panel">
        <div class="lws-header">
          <div class="lws-title-row">
            <span class="lws-logo">✨</span>
            <div class="lws-title-group">
              <strong class="lws-title">${escapeHtml(params.metadata.title)}</strong>
              <div class="lws-badges">
                <span class="lws-badge lws-badge-${params.metadata.difficulty.toLowerCase()}">${params.metadata.difficulty}</span>
                <span class="lws-badge lws-badge-lang">${params.metadata.language}</span>
              </div>
            </div>
            <button class="lws-close-btn" id="lws-dismiss-btn" title="Dismiss" aria-label="Close">×</button>
          </div>
          
          <div class="lws-auto-push-bar" id="lws-countdown-bar">
            <span>Auto-pushing in <strong id="lws-countdown">${this.remainingSeconds}</strong>s...</span>
            <button class="lws-btn-inline" id="lws-pause-btn">Pause</button>
          </div>
        </div>

        <div class="lws-tabs" role="tablist">
          <button class="lws-tab active" id="tab-btn-optimal" role="tab" aria-selected="true">Optimal (Submitted)</button>
          <button class="lws-tab" id="tab-btn-better" role="tab" aria-selected="false">Better</button>
          <button class="lws-tab" id="tab-btn-brute" role="tab" aria-selected="false">Brute</button>
        </div>

        <div class="lws-tab-panel active" id="panel-optimal" role="tabpanel">
          <div class="lws-code-preview"><pre><code>${escapeHtml(params.metadata.code)}</code></pre></div>
        </div>

        <div class="lws-tab-panel" id="panel-better" role="tabpanel">
          <div class="lws-panel-controls">
            <select id="better-snapshot-select" class="lws-select">
              <option value="">${params.snapshots.length ? 'Select from run snapshots...' : 'No run snapshots captured'}</option>
              ${params.snapshots.map((_, i) => `<option value="${i}">Captured Run #${i + 1}</option>`).join('')}
            </select>
            <button class="lws-btn lws-btn-ai" id="better-ai-btn">✨ Generate with AI</button>
          </div>
          <textarea id="better-code-input" class="lws-textarea" placeholder="Paste or edit Better approach code here..."></textarea>
        </div>

        <div class="lws-tab-panel" id="panel-brute" role="tabpanel">
          <div class="lws-panel-controls">
            <select id="brute-snapshot-select" class="lws-select">
              <option value="">${params.snapshots.length ? 'Select from run snapshots...' : 'No run snapshots captured'}</option>
              ${params.snapshots.map((_, i) => `<option value="${i}">Captured Run #${i + 1}</option>`).join('')}
            </select>
            <button class="lws-btn lws-btn-ai" id="brute-ai-btn">✨ Generate with AI</button>
          </div>
          <textarea id="brute-code-input" class="lws-textarea" placeholder="Paste or edit Brute approach code here..."></textarea>
        </div>

        <div class="lws-footer">
          <button class="lws-btn lws-btn-secondary" id="lws-cancel-btn">Skip</button>
          <button class="lws-btn lws-btn-primary" id="lws-push-btn">Push to GitHub</button>
        </div>
      </div>
    `;

    const countdownEl = this.shadow.getElementById('lws-countdown');
    const countdownBar = this.shadow.getElementById('lws-countdown-bar');
    const pauseBtn = this.shadow.getElementById('lws-pause-btn');

    const betterInput = this.shadow.getElementById('better-code-input') as HTMLTextAreaElement;
    const bruteInput = this.shadow.getElementById('brute-code-input') as HTMLTextAreaElement;

    let betterIsAi = false;
    let bruteIsAi = false;

    const pauseCountdown = (reasonText?: string) => {
      this.isTyping = true;
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      if (countdownBar) {
        countdownBar.innerHTML = `<span>${escapeHtml(reasonText ?? 'Countdown paused while editing')}</span>`;
      }
    };

    pauseBtn?.addEventListener('click', () => pauseCountdown('Countdown paused by user'));

    const triggerPush = () => {
      if (this.countdownTimer) clearInterval(this.countdownTimer);
      const approaches: ProblemApproaches = {
        optimal: params.metadata.code,
        better: betterInput?.value.trim() || undefined,
        brute: bruteInput?.value.trim() || undefined,
        aiGenerated: {
          better: betterIsAi,
          brute: bruteIsAi,
        },
      };
      this.showStepper();
      params.onPush(approaches);
    };

    // Auto-push timer
    if (this.remainingSeconds > 0) {
      this.countdownTimer = window.setInterval(() => {
        if (this.isTyping) return;
        this.remainingSeconds -= 1;
        if (countdownEl) countdownEl.textContent = String(this.remainingSeconds);
        if (this.remainingSeconds <= 0) {
          if (this.countdownTimer) clearInterval(this.countdownTimer);
          triggerPush();
        }
      }, 1000);
    } else {
      triggerPush();
      return;
    }

    // Tabs switching
    const setupTab = (btnId: string, panelId: string) => {
      const btn = this.shadow?.getElementById(btnId);
      const panel = this.shadow?.getElementById(panelId);
      btn?.addEventListener('click', () => {
        this.shadow?.querySelectorAll('.lws-tab').forEach((t) => {
          t.classList.remove('active');
          t.setAttribute('aria-selected', 'false');
        });
        this.shadow?.querySelectorAll('.lws-tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        btn.setAttribute('aria-selected', 'true');
        panel?.classList.add('active');
      });
    };

    setupTab('tab-btn-optimal', 'panel-optimal');
    setupTab('tab-btn-better', 'panel-better');
    setupTab('tab-btn-brute', 'panel-brute');

    // Pause timer on input interactions
    [betterInput, bruteInput].forEach((input) => {
      input?.addEventListener('input', () => pauseCountdown('Paused while editing code'));
      input?.addEventListener('focus', () => pauseCountdown('Paused while editing code'));
    });

    // Snapshots dropdowns
    const betterSelect = this.shadow.getElementById('better-snapshot-select') as HTMLSelectElement;
    betterSelect?.addEventListener('change', () => {
      pauseCountdown('Loaded snapshot');
      const idx = parseInt(betterSelect.value, 10);
      if (!isNaN(idx) && params.snapshots[idx]) {
        betterInput.value = params.snapshots[idx];
        betterIsAi = false;
      }
    });

    const bruteSelect = this.shadow.getElementById('brute-snapshot-select') as HTMLSelectElement;
    bruteSelect?.addEventListener('change', () => {
      pauseCountdown('Loaded snapshot');
      const idx = parseInt(bruteSelect.value, 10);
      if (!isNaN(idx) && params.snapshots[idx]) {
        bruteInput.value = params.snapshots[idx];
        bruteIsAi = false;
      }
    });

    // AI Generate buttons
    const betterAiBtn = this.shadow.getElementById('better-ai-btn');
    betterAiBtn?.addEventListener('click', async () => {
      pauseCountdown('Generating Better approach with AI...');
      if (!betterAiBtn) return;
      const originalText = betterAiBtn.textContent;
      betterAiBtn.textContent = 'Generating...';
      betterAiBtn.setAttribute('disabled', 'true');

      const res = await params.onGenerateApproach('Better');
      betterAiBtn.removeAttribute('disabled');
      betterAiBtn.textContent = originalText;

      if (res.ok) {
        betterInput.value = res.code;
        betterIsAi = true;
      } else {
        alert(`Failed to generate Better approach: ${res.reason}`);
      }
    });

    const bruteAiBtn = this.shadow.getElementById('brute-ai-btn');
    bruteAiBtn?.addEventListener('click', async () => {
      pauseCountdown('Generating Brute approach with AI...');
      if (!bruteAiBtn) return;
      const originalText = bruteAiBtn.textContent;
      bruteAiBtn.textContent = 'Generating...';
      bruteAiBtn.setAttribute('disabled', 'true');

      const res = await params.onGenerateApproach('Brute');
      bruteAiBtn.removeAttribute('disabled');
      bruteAiBtn.textContent = originalText;

      if (res.ok) {
        bruteInput.value = res.code;
        bruteIsAi = true;
      } else {
        alert(`Failed to generate Brute approach: ${res.reason}`);
      }
    });

    this.shadow.getElementById('lws-push-btn')?.addEventListener('click', triggerPush);
    this.shadow.getElementById('lws-cancel-btn')?.addEventListener('click', () => this.dismiss());
    this.shadow.getElementById('lws-dismiss-btn')?.addEventListener('click', () => this.dismiss());
  }

  public showStepper(): void {
    if (!this.shadow) return;
    this.steps = {
      submitting: 'active',
      pushing: 'pending',
      notes: 'pending',
      stats: 'pending',
    };
    this.renderStepperHtml();
  }

  public updateStep(
    step: 'submitting' | 'pushing' | 'notes' | 'stats',
    status: 'active' | 'done',
    detail?: string,
  ): void {
    this.steps[step] = status;
    const stepEl = this.shadow?.getElementById(`step-${step}`);
    if (!stepEl) return;

    stepEl.className = `lws-step lws-step-${status}`;
    const indicator = stepEl.querySelector('.lws-step-indicator');
    if (indicator) {
      if (status === 'done') {
        indicator.innerHTML = this.getCheckmarkSvg();
      } else if (status === 'active') {
        indicator.innerHTML = `<span class="lws-spinner"></span>`;
      }
    }
    if (detail) {
      const detailEl = stepEl.querySelector('.lws-step-detail');
      if (detailEl) detailEl.textContent = detail;
    }
  }

  private renderStepperHtml(): void {
    if (!this.shadow) return;
    this.shadow.innerHTML = `
      <style>${this.getCss()}</style>
      <div class="lws-container lws-spring-in lws-syncing-card" role="region" aria-live="polite">
        <div class="lws-header">
          <div class="lws-title-row">
            <span class="lws-logo">⚡</span>
            <strong class="lws-title">Syncing with GitHub...</strong>
          </div>
        </div>

        <div class="lws-stepper">
          <div class="lws-step lws-step-${this.steps.submitting}" id="step-submitting">
            <div class="lws-step-indicator">${this.steps.submitting === 'done' ? this.getCheckmarkSvg() : '<span class="lws-spinner"></span>'}</div>
            <div class="lws-step-text">
              <span class="lws-step-label">Submitting</span>
              <span class="lws-step-detail">Connecting to repository</span>
            </div>
          </div>

          <div class="lws-step lws-step-${this.steps.pushing}" id="step-pushing">
            <div class="lws-step-indicator">${this.steps.pushing === 'done' ? this.getCheckmarkSvg() : this.steps.pushing === 'active' ? '<span class="lws-spinner"></span>' : '2'}</div>
            <div class="lws-step-text">
              <span class="lws-step-label">Pushing code</span>
              <span class="lws-step-detail">Uploading solutions to GitHub</span>
            </div>
          </div>

          <div class="lws-step lws-step-${this.steps.notes}" id="step-notes">
            <div class="lws-step-indicator">${this.steps.notes === 'done' ? this.getCheckmarkSvg() : this.steps.notes === 'active' ? '<span class="lws-spinner"></span>' : '3'}</div>
            <div class="lws-step-text">
              <span class="lws-step-label">Writing notes</span>
              <span class="lws-step-detail">Generating Gemini technical notes</span>
            </div>
          </div>

          <div class="lws-step lws-step-${this.steps.stats}" id="step-stats">
            <div class="lws-step-indicator">${this.steps.stats === 'done' ? this.getCheckmarkSvg() : this.steps.stats === 'active' ? '<span class="lws-spinner"></span>' : '4'}</div>
            <div class="lws-step-text">
              <span class="lws-step-label">Updating stats</span>
              <span class="lws-step-detail">Syncing progress and READMEs</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  public showSuccess(params: {
    metadata: ProblemMetadata;
    folderUrl?: string;
    aiFailureReason?: string | null;
    soundEnabled?: boolean;
    soundVolume?: number;
  }): void {
    if (!this.shadow) return;

    if (params.soundEnabled !== false) {
      playSuccessChime(params.soundVolume ?? 0.5);
    }

    const approachesPushed: string[] = ['Optimal'];
    if (params.metadata.approaches?.better) approachesPushed.push('Better');
    if (params.metadata.approaches?.brute) approachesPushed.push('Brute');

    this.shadow.innerHTML = `
      <style>${this.getCss()}</style>
      <div class="lws-container lws-spring-in lws-success-card" role="alert" aria-live="polite">
        <canvas class="lws-confetti-canvas" id="lws-confetti"></canvas>
        <div class="lws-header">
          <div class="lws-title-row">
            <span class="lws-success-icon">✓</span>
            <div>
              <strong class="lws-title" style="font-size:14px;color:#4ade80;">Pushed to GitHub!</strong>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.7);margin-top:2px;">${escapeHtml(params.metadata.title)}</div>
            </div>
            <button class="lws-close-btn" id="lws-success-close" aria-label="Close">×</button>
          </div>
        </div>

        <div class="lws-success-body">
          <div class="lws-pushed-badges">
            ${approachesPushed.map((app) => `<span class="lws-pill">✓ ${app}</span>`).join(' ')}
          </div>

          ${
            params.folderUrl
              ? `<a href="${escapeHtml(params.folderUrl)}" target="_blank" class="lws-folder-link" rel="noreferrer">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2A1.75 1.75 0 0 0 4.9 1H1.75Z"/></svg>
                  View Solution &amp; Notes on GitHub →
                </a>`
              : ''
          }

          ${
            params.aiFailureReason
              ? `<div class="lws-ai-warning">
                  ⚠️ AI notes note: ${escapeHtml(params.aiFailureReason)}
                </div>`
              : ''
          }
        </div>
      </div>
    `;

    const canvas = this.shadow.getElementById('lws-confetti') as HTMLCanvasElement;
    if (canvas) {
      this.triggerConfetti(canvas);
    }

    this.shadow.getElementById('lws-success-close')?.addEventListener('click', () => this.dismiss());

    setTimeout(() => {
      this.dismiss();
    }, 9000);
  }

  public showError(params: {
    message: string;
    onRetry?: () => void;
    soundEnabled?: boolean;
    soundVolume?: number;
  }): void {
    if (!this.shadow) return;

    if (params.soundEnabled !== false) {
      playErrorTone(params.soundVolume ?? 0.5);
    }

    this.shadow.innerHTML = `
      <style>${this.getCss()}</style>
      <div class="lws-container lws-shake lws-error-card" role="alert" aria-live="assertive">
        <div class="lws-header">
          <div class="lws-title-row">
            <span class="lws-error-icon">✕</span>
            <div>
              <strong class="lws-title" style="color:#f87171;">Sync Failed</strong>
              <div style="font-size:11.5px;color:rgba(255,255,255,0.7);margin-top:2px;">${escapeHtml(params.message)}</div>
            </div>
            <button class="lws-close-btn" id="lws-error-close" aria-label="Close">×</button>
          </div>
        </div>

        <div class="lws-footer" style="margin-top:12px;">
          <button class="lws-btn lws-btn-secondary" id="lws-error-dismiss">Dismiss</button>
          ${params.onRetry ? `<button class="lws-btn lws-btn-primary" id="lws-retry-btn">Retry</button>` : ''}
        </div>
      </div>
    `;

    this.shadow.getElementById('lws-error-close')?.addEventListener('click', () => this.dismiss());
    this.shadow.getElementById('lws-error-dismiss')?.addEventListener('click', () => this.dismiss());
    this.shadow.getElementById('lws-retry-btn')?.addEventListener('click', () => {
      params.onRetry?.();
    });
  }

  public dismiss(): void {
    if (this.countdownTimer) clearInterval(this.countdownTimer);
    if (this.shadow) {
      this.shadow.innerHTML = '';
    }
  }

  private triggerConfetti(canvas: HTMLCanvasElement): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      canvas.remove();
      return;
    }

    const rect = canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;

    canvas.width = rect.width;
    canvas.height = rect.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      color: string;
      rotation: number;
      vRot: number;
      alpha: number;
    }

    const colors = ['#2dd4bf', '#3fb950', '#8b5cf6', '#3b82f6', '#f59e0b', '#ffffff'];
    const particles: Particle[] = [];

    for (let i = 0; i < 60; i++) {
      particles.push({
        x: canvas.width / 2 + (Math.random() - 0.5) * 60,
        y: canvas.height * 0.75,
        vx: (Math.random() - 0.5) * 7,
        vy: -Math.random() * 8 - 3,
        size: Math.random() * 5 + 3,
        color: colors[Math.floor(Math.random() * colors.length)]!,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2,
        alpha: 1,
      });
    }

    let animId: number;
    const startTime = performance.now();

    const render = (time: number) => {
      const elapsed = time - startTime;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      let alive = false;
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.25;
        p.rotation += p.vRot;
        if (elapsed > 700) {
          p.alpha = Math.max(0, 1 - (elapsed - 700) / 500);
        }

        if (p.alpha > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      });

      if (alive && elapsed < 1200) {
        animId = requestAnimationFrame(render);
      } else {
        cancelAnimationFrame(animId);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        canvas.remove();
      }
    };

    animId = requestAnimationFrame(render);
  }

  private getCheckmarkSvg(): string {
    return `
      <svg class="lws-svg-check" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="20 6 9 17 4 12"></polyline>
      </svg>
    `;
  }

  private getCss(): string {
    return `
      :host {
        all: initial;
        position: fixed;
        bottom: 24px;
        right: 24px;
        z-index: 2147483647;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 13px;
        color: #ffffff;
      }

      * { box-sizing: border-box; }

      .lws-container {
        width: 360px;
        background: rgba(20, 18, 48, 0.82);
        backdrop-filter: blur(24px) saturate(180%);
        -webkit-backdrop-filter: blur(24px) saturate(180%);
        border: 1px solid rgba(255, 255, 255, 0.22);
        border-radius: 18px;
        box-shadow: 0 14px 44px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.25);
        padding: 16px;
        position: relative;
        overflow: hidden;
        color: #ffffff;
      }

      @supports not (backdrop-filter: blur(1px)) {
        .lws-container {
          background: rgba(25, 22, 60, 0.95);
        }
      }

      .lws-spring-in {
        animation: lwsSpringIn 0.35s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      }

      .lws-shake {
        animation: lwsShake 0.4s ease-in-out;
      }

      @keyframes lwsSpringIn {
        from { transform: translateY(24px) scale(0.95); opacity: 0; }
        to { transform: translateY(0) scale(1); opacity: 1; }
      }

      @keyframes lwsShake {
        0%, 100% { transform: translateX(0); }
        20%, 60% { transform: translateX(-6px); }
        40%, 80% { transform: translateX(6px); }
      }

      @media (prefers-reduced-motion: reduce) {
        .lws-spring-in, .lws-shake {
          animation: lwsFade 0.2s ease-out !important;
        }
        @keyframes lwsFade {
          from { opacity: 0; }
          to { opacity: 1; }
        }
      }

      /* Animated gradient border sweep while syncing */
      .lws-syncing-card {
        border: 1px solid transparent;
        background: linear-gradient(rgba(20, 18, 48, 0.88), rgba(20, 18, 48, 0.88)) padding-box,
                    linear-gradient(135deg, #8b5cf6, #3b82f6, #2dd4bf, #8b5cf6) border-box;
        background-size: 100% 100%, 300% 300%;
        animation: borderSweep 6s ease infinite;
      }

      @keyframes borderSweep {
        0% { background-position: 0% 0%, 0% 50%; }
        50% { background-position: 0% 0%, 100% 50%; }
        100% { background-position: 0% 0%, 0% 50%; }
      }

      .lws-success-card {
        border-color: rgba(63, 185, 80, 0.45);
        box-shadow: 0 14px 44px rgba(0,0,0,0.5), 0 0 24px rgba(63, 185, 80, 0.35), inset 0 1px 0 rgba(255,255,255,0.3);
      }

      .lws-error-card {
        border-color: rgba(239, 68, 68, 0.55);
        box-shadow: 0 14px 44px rgba(0,0,0,0.5), 0 0 24px rgba(239, 68, 68, 0.4), inset 0 1px 0 rgba(255,255,255,0.2);
      }

      .lws-confetti-canvas {
        position: absolute;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 10;
      }

      .lws-header { margin-bottom: 12px; }
      .lws-title-row { display: flex; align-items: flex-start; gap: 10px; }
      .lws-logo { font-size: 18px; line-height: 1; }
      .lws-title-group { flex: 1; }
      .lws-title { display: block; font-size: 13.5px; font-weight: 700; color: #ffffff; line-height: 1.3; }

      .lws-badges { display: flex; gap: 6px; margin-top: 4px; }
      .lws-badge {
        font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 9999px;
        text-transform: uppercase; letter-spacing: 0.04em;
      }
      .lws-badge-easy { background: rgba(0, 175, 155, 0.2); border: 1px solid rgba(0, 175, 155, 0.45); color: #2dd4bf; }
      .lws-badge-medium { background: rgba(255, 161, 22, 0.2); border: 1px solid rgba(255, 161, 22, 0.45); color: #fbbf24; }
      .lws-badge-hard { background: rgba(239, 71, 67, 0.2); border: 1px solid rgba(239, 71, 67, 0.45); color: #f87171; }
      .lws-badge-lang { background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.16); color: rgba(255, 255, 255, 0.7); }

      .lws-close-btn {
        background: none; border: none; font-size: 18px; color: rgba(255, 255, 255, 0.6);
        cursor: pointer; padding: 0 4px; line-height: 1; border-radius: 4px;
      }
      .lws-close-btn:hover { color: #ffffff; background: rgba(255, 255, 255, 0.1); }

      .lws-auto-push-bar {
        margin-top: 10px; padding: 7px 10px; background: rgba(255, 255, 255, 0.06);
        border: 1px solid rgba(255, 255, 255, 0.12); border-radius: 8px;
        font-size: 11.5px; color: rgba(255, 255, 255, 0.75); display: flex; align-items: center; justify-content: space-between;
      }
      .lws-btn-inline {
        background: rgba(255, 255, 255, 0.1); border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 6px; padding: 2px 7px;
        font-size: 11px; color: #ffffff; cursor: pointer;
      }
      .lws-btn-inline:hover { background: rgba(255, 255, 255, 0.2); }

      /* Frosted pill tabs */
      .lws-tabs {
        display: flex; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.15);
        border-radius: 9999px; padding: 3px; margin-bottom: 10px; gap: 2px;
      }
      .lws-tab {
        flex: 1; background: transparent; border: none; border-radius: 9999px;
        padding: 5px 8px; font-size: 11px; font-weight: 600; color: rgba(255, 255, 255, 0.65); cursor: pointer;
        transition: all 0.15s ease;
      }
      .lws-tab.active {
        background: rgba(255, 255, 255, 0.18); color: #ffffff;
        box-shadow: 0 2px 8px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.25);
      }
      .lws-tab:hover { color: #ffffff; }

      .lws-tab-panel { display: none; }
      .lws-tab-panel.active { display: block; }

      .lws-code-preview {
        max-height: 140px; overflow-y: auto; background: rgba(0, 0, 0, 0.3); border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 10px; padding: 8px 10px; font-family: ui-monospace, "SF Mono", monospace; font-size: 11px;
        color: #e2e8f0;
      }
      .lws-code-preview pre { margin: 0; white-space: pre-wrap; word-break: break-all; }

      .lws-panel-controls { display: flex; gap: 8px; margin-bottom: 8px; }
      .lws-select {
        flex: 1; font-size: 11px; padding: 6px 8px; border: 1px solid rgba(255, 255, 255, 0.18);
        border-radius: 8px; background: rgba(255, 255, 255, 0.08); color: #ffffff;
      }
      .lws-select option { background: #1a163a; color: #ffffff; }
      .lws-btn-ai {
        font-size: 11px; font-weight: 600; padding: 6px 10px; border-radius: 8px;
        background: rgba(45, 212, 191, 0.15); border: 1px solid rgba(45, 212, 191, 0.4); color: #2dd4bf; cursor: pointer;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      }
      .lws-btn-ai:hover { background: rgba(45, 212, 191, 0.25); border-color: rgba(45, 212, 191, 0.6); }

      .lws-textarea {
        width: 100%; height: 110px; resize: vertical; font-family: ui-monospace, "SF Mono", monospace;
        font-size: 11px; padding: 8px 10px; border: 1px solid rgba(255, 255, 255, 0.18); border-radius: 10px;
        background: rgba(0, 0, 0, 0.3); color: #ffffff;
      }
      .lws-textarea:focus { outline: none; border-color: #8b5cf6; box-shadow: 0 0 0 3px rgba(139, 92, 246, 0.4); }

      .lws-footer { display: flex; justify-content: flex-end; gap: 8px; margin-top: 12px; }
      .lws-btn {
        padding: 7px 13px; border-radius: 8px; font-size: 12px; font-weight: 600; cursor: pointer;
        transition: transform 0.1s, background 0.15s; border: 1px solid rgba(255, 255, 255, 0.22);
      }
      .lws-btn:active { transform: scale(0.97); }
      .lws-btn-primary {
        background: linear-gradient(135deg, #2ea043, #238636); color: #ffffff;
        box-shadow: 0 4px 16px rgba(46, 160, 67, 0.45), inset 0 1px 0 rgba(255,255,255,0.3);
      }
      .lws-btn-primary:hover {
        background: linear-gradient(135deg, #34b34c, #29973e);
        box-shadow: 0 6px 20px rgba(46, 160, 67, 0.6);
      }
      .lws-btn-secondary {
        background: rgba(255, 255, 255, 0.1); color: #ffffff;
      }
      .lws-btn-secondary:hover { background: rgba(255, 255, 255, 0.18); }

      /* Stepper */
      .lws-stepper { display: flex; flex-direction: column; gap: 12px; padding: 4px 0; }
      .lws-step { display: flex; align-items: center; gap: 12px; }
      .lws-step-indicator {
        width: 28px; height: 28px; border-radius: 50%; display: flex; align-items: center;
        justify-content: center; font-size: 11px; font-weight: 600; flex-shrink: 0;
        background: rgba(255, 255, 255, 0.08); border: 1px solid rgba(255, 255, 255, 0.2);
        color: rgba(255, 255, 255, 0.6); transition: all 0.25s ease;
      }
      .lws-step-text { display: flex; flex-direction: column; }
      .lws-step-label { font-size: 12.5px; font-weight: 600; color: #ffffff; }
      .lws-step-detail { font-size: 11px; color: rgba(255, 255, 255, 0.65); }

      .lws-step-active .lws-step-indicator {
        background: rgba(139, 92, 246, 0.25); border-color: #8b5cf6; color: #ffffff;
        box-shadow: 0 0 16px rgba(139, 92, 246, 0.6);
        animation: lwsPulse 1.4s infinite;
      }
      .lws-step-done .lws-step-indicator {
        background: #2ea043; border-color: #3fb950; color: #ffffff;
        box-shadow: 0 0 12px rgba(63, 185, 80, 0.5);
      }

      @keyframes lwsPulse {
        0%, 100% { transform: scale(1); box-shadow: 0 0 8px rgba(139, 92, 246, 0.4); }
        50% { transform: scale(1.08); box-shadow: 0 0 18px rgba(139, 92, 246, 0.7); }
      }

      .lws-spinner {
        width: 12px; height: 12px; border: 2px solid rgba(255, 255, 255, 0.3);
        border-top-color: #8b5cf6; border-radius: 50%;
        animation: lwsSpin 0.75s linear infinite;
      }
      @keyframes lwsSpin { to { transform: rotate(360deg); } }

      .lws-svg-check polyline {
        stroke-dasharray: 24;
        stroke-dashoffset: 24;
        animation: lwsStroke 0.35s ease forwards;
      }
      @keyframes lwsStroke { to { stroke-dashoffset: 0; } }

      /* Success view */
      .lws-success-icon {
        width: 32px; height: 32px; border-radius: 50%; background: rgba(63, 185, 80, 0.25);
        border: 1px solid rgba(63, 185, 80, 0.5); color: #4ade80;
        display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;
        box-shadow: 0 0 14px rgba(63, 185, 80, 0.4);
      }
      .lws-error-icon {
        width: 32px; height: 32px; border-radius: 50%; background: rgba(239, 68, 68, 0.25);
        border: 1px solid rgba(239, 68, 68, 0.5); color: #f87171;
        display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 18px;
        box-shadow: 0 0 14px rgba(239, 68, 68, 0.4);
      }
      .lws-pushed-badges { display: flex; gap: 6px; margin: 8px 0; }
      .lws-pill {
        font-size: 11px; font-weight: 600; padding: 2px 8px; border-radius: 9999px;
        background: rgba(63, 185, 80, 0.2); color: #4ade80; border: 1px solid rgba(63, 185, 80, 0.4);
      }
      .lws-folder-link {
        display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600;
        color: #60a5fa; text-decoration: none; margin-top: 6px;
      }
      .lws-folder-link:hover { color: #93c5fd; text-decoration: underline; }
      .lws-ai-warning {
        font-size: 11px; color: #fbbf24; background: rgba(245, 158, 11, 0.15); border: 1px solid rgba(245, 158, 11, 0.35);
        border-radius: 8px; padding: 6px 8px; margin-top: 8px;
      }
    `;
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}
