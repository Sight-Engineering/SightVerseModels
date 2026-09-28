// Exports the AR scene for the native Android app.
//   1. npm run dev   2. node tools/export-ar.mjs
// Raw GLBs go to _arexport/raw, then they are cleaned up (JPEG/PNG textures <= 1024 px, deduped,
// no meshopt/webp - Android's Filament renderer reads them as-is) into ../SightVerseAR/app/src/main/assets/.
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, simplify, simplifyPrimitive, textureCompress, weld, weldPrimitive } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
await MeshoptSimplifier.ready;

const RAW = path.resolve('_arexport/raw');
const DEST = path.resolve('../SightVerseAR/app/src/main/assets');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(DEST, { recursive: true });

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text().slice(0, 300)); });
await page.exposeFunction('saveFile', (name, b64) => {
  fs.writeFileSync(path.join(RAW, name), Buffer.from(b64, 'base64'));
  console.log('saved', name, (Buffer.byteLength(b64, 'base64') / 1e6).toFixed(1), 'MB');
});
await page.goto('http://127.0.0.1:5173/?skipintro&quality=high&exportar', { waitUntil: 'load' });
await page.waitForSelector('#enter-btn:not([hidden])', { timeout: 180000 });
const log = await page.evaluate(() => window.__exportAR((n, b) => window.saveFile(n, b)));
console.log(log.join('\n'));
await browser.close();

// ---- clean up for Android
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
for (const f of fs.readdirSync(RAW)) {
  if (!f.endsWith('.glb')) { fs.copyFileSync(path.join(RAW, f), path.join(DEST, f)); continue; }
  const doc = await io.read(path.join(RAW, f));
  // the scanned boulder is ~58k verts per copy - a few hundred is plenty at tabletop size
  for (const n of doc.getRoot().listNodes()) {
    if (!/boulder/.test(n.getName()) || !n.getMesh()) continue;
    for (const prim of n.getMesh().listPrimitives()) {
      weldPrimitive(prim);
      simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio: 0.02, error: 0.02 });
    }
  }
  const lite = f === 'base.glb'
    ? [simplify({ simplifier: MeshoptSimplifier, ratio: 0.35, error: 0.002, lockBorder: true })]
    : [];
  await doc.transform(
    dedup(), weld(), ...lite, prune(),
    textureCompress({ encoder: sharp, targetFormat: 'jpeg', resize: [1024, 1024], quality: 85, slots: /^(?!baseColor)/ }),
    textureCompress({ encoder: sharp, resize: [1024, 1024], slots: /baseColor/ }),
  );
  await io.write(path.join(DEST, f), doc);
  console.log('android asset', f, (fs.statSync(path.join(DEST, f)).size / 1e6).toFixed(1), 'MB');
}
