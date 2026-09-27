// Converts the raw Poly Haven downloads in ./_raw into small, web-ready files in ./public
//   node tools/process-assets.mjs            -> everything
//   node tools/process-assets.mjs models     -> only models (also: hdri, textures)

import fs from 'node:fs';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, flatten, join, weld, prune, simplify, textureCompress, meshopt, reorder, getGLPrimitiveCount,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const RAW = path.resolve('_raw');
const PUB = path.resolve('public');
const want = process.argv.slice(2);
const run = (k) => !want.length || want.includes(k);
const mb = (b) => (b / 1e6).toFixed(2) + ' MB';

// ---------------------------------------------------------------- HDRI (copied as-is)
if (run('hdri')) {
  fs.mkdirSync(path.join(PUB, 'env'), { recursive: true });
  for (const f of fs.readdirSync(path.join(RAW, 'hdri'))) {
    fs.copyFileSync(path.join(RAW, 'hdri', f), path.join(PUB, 'env', f));
    console.log('hdri', f);
  }
}

// ---------------------------------------------------------------- terrain textures
if (run('textures')) {
  const out = path.join(PUB, 'textures');
  fs.mkdirSync(out, { recursive: true });
  const TERRAIN_TEX = ['coast_sand_01', 'forrest_ground_01', 'rocky_terrain', 'floor_pebbles_01'];
  for (const id of TERRAIN_TEX) {
    for (const [map, suffix] of [['Diffuse', 'diff'], ['nor_gl', 'nor']]) {
      const src = path.join(RAW, 'tex', id, `${map}.jpg`);
      if (!fs.existsSync(src)) continue;
      const dest = path.join(out, `${id}_${suffix}.webp`);
      await sharp(src).resize(1024, 1024, { fit: 'inside' }).webp({ quality: suffix === 'nor' ? 88 : 84 }).toFile(dest);
      console.log('texture', path.basename(dest), mb(fs.statSync(dest).size));
    }
  }
}

// ---------------------------------------------------------------- vegetation / rock models
// lods: one simplify setting per level of detail (null = keep as is). Level 0 -> <id>.glb, 1 -> <id>_lod1.glb ...
const MODELS = {
  island_tree_01:  { lods: [{ ratio: 0.035, error: 0.04 }, { ratio: 0.010, error: 0.08 }, { ratio: 0.003, error: 0.15 }], tex: [1024, 512, 256] },
  island_tree_02:  { lods: [{ ratio: 0.05,  error: 0.04 }, { ratio: 0.014, error: 0.08 }, { ratio: 0.004, error: 0.15 }], tex: [1024, 512, 256] },
  fern_02:         { lods: [null], tex: [1024] },
  boulder_01:      { lods: [{ ratio: 0.06, error: 0.02 }], tex: [1024] },
  coast_rocks_05:  { lods: [{ ratio: 0.04, error: 0.02 }], tex: [1024] },
};

if (run('models')) {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
  const outDir = path.join(PUB, 'models', 'env');
  fs.mkdirSync(outDir, { recursive: true });
  const tris = (doc) => doc.getRoot().listMeshes().reduce(
    (n, m) => n + m.listPrimitives().reduce((k, p) => k + getGLPrimitiveCount(p), 0), 0);

  for (const [id, cfg] of Object.entries(MODELS)) {
    const src = path.join(RAW, 'models', id, `${id}.gltf`);
    if (!fs.existsSync(src)) { console.log('skip (missing)', id); continue; }
    for (let l = 0; l < cfg.lods.length; l++) {
      const doc = await io.read(src);          // fresh copy per LOD
      const t0 = tris(doc);
      const steps = [dedup(), flatten(), join({ keepNamed: false }), weld()];
      if (cfg.lods[l]) steps.push(simplify({ simplifier: MeshoptSimplifier, ...cfg.lods[l] }));
      steps.push(prune());
      await doc.transform(...steps);
      const tex = cfg.tex[l];
      await doc.transform(
        textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [tex, tex], quality: 80 }),
        reorder({ encoder: MeshoptEncoder }),
        meshopt({ encoder: MeshoptEncoder, level: 'high' }),
      );
      const dest = path.join(outDir, `${id}${l ? '_lod' + l : ''}.glb`);
      await io.write(dest, doc);
      console.log(`model ${id} LOD${l}: ${t0} -> ${tris(doc)} tris, ${mb(fs.statSync(dest).size)}`);
    }
  }
}
console.log('done');
