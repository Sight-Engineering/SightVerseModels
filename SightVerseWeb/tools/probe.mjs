// Dev helper: prints building bounds vs terrain height from the running dev server.
import { chromium } from 'playwright-core';
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto('http://127.0.0.1:5173/?skipintro&quality=low', { waitUntil: 'load' });
await page.waitForSelector('#enter-btn:not([hidden])', { timeout: 120000 });
const code = process.argv[2] || 'Object.keys(window.__sv)';
const r = await page.evaluate(code);
console.log(JSON.stringify(r, null, 1));
await browser.close();
