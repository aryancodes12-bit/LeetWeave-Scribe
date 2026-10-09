let audioCtx: AudioContext | null = null;

/**
 * Initializes or resumes the WebAudio AudioContext upon user interaction.
 * Crucial for satisfying browser autoplay policies.
 */
export function initAudioContext(): void {
  try {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioContextClass) {
        audioCtx = new AudioContextClass();
      }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  } catch {
    // AudioContext might be unsupported or blocked in strict sandboxes
  }
}

// Bind to early user events so the context is unlocked before an Accepted verdict fires
if (typeof window !== 'undefined') {
  window.addEventListener('click', initAudioContext, { once: false, passive: true });
  window.addEventListener('keydown', initAudioContext, { once: false, passive: true });
}

/**
 * Plays a pleasant rising 3-note chime (C5 -> E5 -> G5) on successful sync.
 */
export function playSuccessChime(volume = 0.5): void {
  initAudioContext();
  if (!audioCtx || audioCtx.state !== 'running') return;

  const masterVol = Math.max(0, Math.min(1, volume));
  if (masterVol <= 0) return;

  const notes = [523.25, 659.25, 783.99]; // C5, E5, G5
  const startTime = audioCtx.currentTime;

  notes.forEach((freq, idx) => {
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime + idx * 0.1);

    const noteStart = startTime + idx * 0.1;
    const noteDuration = idx === notes.length - 1 ? 0.35 : 0.22;

    gain.gain.setValueAtTime(0.001, noteStart);
    gain.gain.exponentialRampToValueAtTime(0.3 * masterVol, noteStart + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + noteDuration);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start(noteStart);
    osc.stop(noteStart + noteDuration);
  });
}

/**
 * Plays a soft low tone on error.
 */
export function playErrorTone(volume = 0.5): void {
  initAudioContext();
  if (!audioCtx || audioCtx.state !== 'running') return;

  const masterVol = Math.max(0, Math.min(1, volume));
  if (masterVol <= 0) return;

  const startTime = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();

  osc.type = 'triangle';
  osc.frequency.setValueAtTime(220, startTime);
  osc.frequency.exponentialRampToValueAtTime(140, startTime + 0.3);

  gain.gain.setValueAtTime(0.001, startTime);
  gain.gain.exponentialRampToValueAtTime(0.25 * masterVol, startTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.32);

  osc.connect(gain);
  gain.connect(audioCtx.destination);

  osc.start(startTime);
  osc.stop(startTime + 0.35);
}
