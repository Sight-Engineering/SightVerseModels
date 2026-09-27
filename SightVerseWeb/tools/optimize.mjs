// Web-optimises the four Sight Verse GLB models.
//   node tools/optimize.mjs            -> all models
//   node tools/optimize.mjs Contact    -> just one
//
// Reads  ../Assets/<Name>.glb  (originals are never modified)
// Writes ./public/models/<Name>.glb  (meshopt-compressed, WebP textures, 1 unit = 1 metre,
//                                     centred on X/Z, sitting on y = 0)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, flatten, join, weld, prune, simplify, metalRough, textureCompress,
  getBounds, meshopt, reorder, normals, getGLPrimitiveCount,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(here, '../../Assets');
const OUT = path.resolve(here, '../public/models');
fs.mkdirSync(OUT, { recursive: true });

// footprint = largest horizontal extent (metres) the model is scaled to.
// simplify  = fraction of triangles to keep (only for the heavy scan).
const MODELS = {
  AboutUs:  { footprint: 70 },
  Clients:  { footprint: 70 },
  Services: { footprint: 70 },
  Contact:  { src: 'casa-vc-2-pisos/source/Casa VC 2 pisos.glb', footprint: 60 },
};

await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  });

const tris = (doc) => doc.getRoot().listMeshes().reduce(
  (n, m) => n + m.listPrimitives().reduce((k, p) => k + getGLPrimitiveCount(p), 0), 0);
const mb = (b) => (b / 1e6).toFixed(2) + ' MB';

const only = process.argv.slice(2);
const report = {};

for (const [name, cfg] of Object.entries(MODELS)) {
  if (only.length && !only.includes(name)) continue;
  const inFile = path.join(SRC, cfg.src || name + '.glb');
  const outFile = path.join(OUT, name + '.glb');
  const t0 = Date.now();
  const doc = await io.read(inFile);
  const before = { bytes: fs.statSync(inFile).size, tris: tris(doc), meshes: doc.getRoot().listMeshes().length };
  console.log(`\n[${name}] in: ${mb(before.bytes)}  ${before.tris} tris  ${before.meshes} meshes  ${doc.getRoot().listMaterials().length} materials`);

  const steps = [];
  // Old spec/gloss materials (Services) -> metal/rough so modern three.js can render them.
  if (doc.getRoot().listExtensionsUsed().some((e) => e.extensionName === 'KHR_materials_pbrSpecularGlossiness')) {
    steps.push(metalRough());
  }
  if (cfg.dropUVs) { // this scan has UVs but no texture: dropping them lets the mesh weld/simplify far better
    for (const m of doc.getRoot().listMeshes()) for (const p of m.listPrimitives()) { p.setAttribute('TEXCOORD_0', null); p.setAttribute('NORMAL', null); }
  }
  steps.push(dedup(), flatten(), join({ keepNamed: false }), weld());
  if (cfg.simplify) steps.push(simplify({ simplifier: MeshoptSimplifier, ...cfg.simplify }), normals({ overwrite: true }));
  steps.push(prune());
  await doc.transform(...steps);

  // ---- normalise: centre X/Z, sit on y=0, scale to target footprint (1 unit = 1 m) ----
  const scene = doc.getRoot().getDefaultScene() || doc.getRoot().listScenes()[0];
  const b = getBounds(scene);
  const size = [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
  const s = cfg.footprint / Math.max(size[0], size[2]);
  const cx = (b.max[0] + b.min[0]) / 2, cz = (b.max[2] + b.min[2]) / 2;
  const root = doc.createNode('Root').setScale([s, s, s]).setTranslation([-cx * s, -b.min[1] * s, -cz * s]);
  for (const child of scene.listChildren()) { scene.removeChild(child); root.addChild(child); }
  scene.addChild(root);
  console.log(`[${name}] raw bounds size ${size.map((v) => v.toFixed(2)).join(' x ')}  -> scale ${s.toExponential(3)}`
    + `  final ${size.map((v) => (v * s).toFixed(1)).join(' x ')} m`);

  // ---- textures + geometry compression ----
  const hasTex = doc.getRoot().listTextures().length > 0;
  const post = [];
  if (hasTex) post.push(textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [2048, 2048], quality: 88 }));
  post.push(reorder({ encoder: MeshoptEncoder }), meshopt({ encoder: MeshoptEncoder, level: 'high' }));
  await doc.transform(...post);

  await io.write(outFile, doc);
  const after = { bytes: fs.statSync(outFile).size, tris: tris(doc), meshes: doc.getRoot().listMeshes().length };
  report[name] = {
    bytes: after.bytes, tris: after.tris, meshes: after.meshes,
    size: size.map((v) => +(v * s).toFixed(2)),
  };
  console.log(`[${name}] out: ${mb(after.bytes)}  ${after.tris} tris  ${after.meshes} meshes  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}

const reportFile = path.join(OUT, 'report.json');
const prev = fs.existsSync(reportFile) ? JSON.parse(fs.readFileSync(reportFile, 'utf8')) : {};
fs.writeFileSync(reportFile, JSON.stringify({ ...prev, ...report }, null, 2));
console.log('\nDone. Sizes:', JSON.stringify(report));
