// Downloads CC0 environment assets from Poly Haven (https://polyhaven.com, CC0 licence)
// into ./_raw  (git-ignored).  Run:  node tools/fetch-assets.mjs
// Then run:  node tools/process-assets.mjs   to convert them into ./public/ web-ready files.

import fs from 'node:fs';
import path from 'node:path';

const RAW = path.resolve('_raw');
const API = 'https://api.polyhaven.com/files/';

const HDRIS = {
  day: 'kloofendal_48d_partly_cloudy_puresky',
  sunset: 'belfast_sunset_puresky',
};
const TEXTURES = ['coast_sand_01', 'forrest_ground_01', 'rocky_terrain', 'floor_pebbles_01'];
const TEXTURE_MAPS = ['Diffuse', 'nor_gl'];
// (island_tree_03 and fir_tree_01 exist but are 80-480 MB scans - skipped on purpose)
const MODELS = ['island_tree_01', 'island_tree_02', 'fern_02', 'boulder_01', 'coast_rocks_05'];

const getJSON = async (id) => {
  const r = await fetch(API + id);
  if (!r.ok) throw new Error(`${id}: HTTP ${r.status}`);
  return r.json();
};
const download = async (url, dest) => {
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  fs.writeFileSync(dest, Buffer.from(await r.arrayBuffer()));
  console.log('  ok', path.relative(RAW, dest).replace(/\\/g, '/'), (fs.statSync(dest).size / 1e6).toFixed(2) + ' MB');
};
const safe = async (label, fn) => { try { await fn(); } catch (e) { console.log(`  !! ${label}: ${e.message}`); } };

console.log('HDRIs'); 
for (const [key, id] of Object.entries(HDRIS)) {
  await safe(id, async () => {
    const f = await getJSON(id);
    await download(f.hdri['2k'].hdr.url, path.join(RAW, 'hdri', `${key}.hdr`));
  });
}

console.log('Textures');
for (const id of TEXTURES) {
  await safe(id, async () => {
    const f = await getJSON(id);
    for (const map of TEXTURE_MAPS) {
      const entry = f[map]?.['1k']?.jpg;
      if (!entry) { console.log(`  -- ${id}: no ${map} 1k jpg`); continue; }
      await download(entry.url, path.join(RAW, 'tex', id, `${map}.jpg`));
    }
  });
}

console.log('Models');
for (const id of MODELS) {
  await safe(id, async () => {
    const f = await getJSON(id);
    const g = f.gltf?.['1k']?.gltf;
    if (!g) { console.log(`  -- ${id}: no 1k gltf`); return; }
    const dir = path.join(RAW, 'models', id);
    await download(g.url, path.join(dir, `${id}.gltf`));
    for (const [rel, inc] of Object.entries(g.include || {})) await download(inc.url, path.join(dir, rel));
  });
}
console.log('done');
