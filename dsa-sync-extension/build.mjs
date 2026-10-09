import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';

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
});

cpSync('manifest.json', `${outdir}/manifest.json`);
mkdirSync(`${outdir}/icons`, { recursive: true });
if (existsSync('icons')) cpSync('icons', `${outdir}/icons`, { recursive: true });
mkdirSync(`${outdir}/popup`, { recursive: true });
cpSync('src/popup/popup.html', `${outdir}/popup/popup.html`);

console.log('✅ Extension built to dist/ — load it via chrome://extensions -> Load unpacked');
