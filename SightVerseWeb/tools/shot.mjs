// Dev helper: drives the running dev server with the system Edge/Chrome and saves screenshots.
//   node tools/shot.mjs _shots/scenario.json
// scenario = { url?, width?, height?, quality?, steps: [{ name, eval?, wait?, click? }] }
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const file = process.argv[2] || '_shots/scenario.json';
const sc = JSON.parse(fs.readFileSync(file, 'utf8'));
const out = path.resolve('_shots');
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=d3d11', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: sc.width || 1600, height: sc.height || 900 }, deviceScaleFactor: sc.dpr || 1 });
const logs = [];
page.on('console', (m) => { const t = m.text(); if (!/vite|X4122|GPU stall/i.test(t)) logs.push(`[${m.type()}] ${t}`.slice(0, 400)); });
page.on('pageerror', (e) => logs.push('[pageerror] ' + e.message));

const url = sc.url || `http://127.0.0.1:5173/?skipintro&quality=${sc.quality || 'high'}${sc.debug ? '&debug' : ''}`;
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#enter-btn:not([hidden])', { timeout: 120000 });
await page.click('#enter-btn');
await page.waitForTimeout(1500);

for (const step of sc.steps) {
  if (step.eval) {
    try {
      const r = await page.evaluate(step.eval);
      if (r !== undefined && r !== null) console.log(`${step.name || 'eval'} ->`, typeof r === 'string' ? r : JSON.stringify(r));
    } catch (e) { console.log(`${step.name} eval error:`, e.message); }
  }
  if (step.click) await page.click(step.click);
  if (step.keys) for (const k of step.keys) await page.keyboard.press(k);
  await page.waitForTimeout(step.wait ?? 1200);
  if (step.name) {
    await page.screenshot({ path: path.join(out, step.name + '.png') });
    console.log('saved', step.name + '.png');
  }
}
console.log('--- console (' + logs.length + ')');
for (const l of logs.slice(0, 40)) console.log(l);
await browser.close();
