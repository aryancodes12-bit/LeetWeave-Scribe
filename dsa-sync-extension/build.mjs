import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';

// Node 20.6+ built-in .env loader — no dependency needed. Safe no-op if the
// file doesn't exist (e.g. CI, or a machine that hasn't set up a key yet).
if (existsSync('.env')) {
  process.loadEnvFile('.env');
}

const groqApiKey = process.env.GROQ_API_KEY ?? '';
if (!groqApiKey) {
  console.warn(
    '⚠️  No GROQ_API_KEY found (checked .env and environment). Building without it — ' +
      'per-problem READMEs will ship without AI notes until you add one and rebuild.',
  );
}

const outdir = 'dist';

mkdirSync(outdir, { recursive: true });

// Content scripts declared via manifest's content_scripts array are always loaded
// as classic scripts by Chrome — an ESM bundle (with bare import/export) would
// throw a SyntaxError there. IIFE is required for these two specifically.
await esbuild.build({
  entryPoints: {
    'content/inject': 'src/content/inject.ts',
    'content/content': 'src/content/content.ts',
  },
  bundle: true,
  outdir,
  format: 'iife',
  target: 'chrome111',
  minify: false,
  sourcemap: true,
  loader: { '.json': 'json' },
});

// Background (declared "type": "module" in manifest) and popup (loaded via
// <script type="module">) can both be real ESM.
await esbuild.build({
  entryPoints: {
    'background/background': 'src/background/background.ts',
    'popup/popup': 'src/popup/popup.ts',
  },
  bundle: true,
  outdir,
  format: 'esm',
  target: 'chrome111',
  minify: false,
  sourcemap: true,
  loader: { '.json': 'json' },
  define: {
    __GROQ_API_KEY__: JSON.stringify(groqApiKey),
  },
});

cpSync('manifest.json', `${outdir}/manifest.json`);
mkdirSync(`${outdir}/icons`, { recursive: true });
if (existsSync('icons')) cpSync('icons', `${outdir}/icons`, { recursive: true });
mkdirSync(`${outdir}/popup`, { recursive: true });
cpSync('src/popup/popup.html', `${outdir}/popup/popup.html`);

console.log('✅ Extension built to dist/ — load it via chrome://extensions -> Load unpacked');
