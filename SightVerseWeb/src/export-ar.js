// Dev tool: exports the AR version of the island (no sky / sea / ground, buildings enlarged) as
// plain GLB files for the native Android AR app. Loaded only with ?exportar in the URL.
// Everything shares one coordinate system (island metres, plaza floor at y = 0) so the app can
// drop all files on the same anchor with the same scale and they line up.

import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS, COMPANY } from './config.js';

const KEEP = ['position', 'normal', 'uv', 'color'];

/** Copies the parts of any lit three.js material that glTF can carry. */
function plainMaterial(m, vertexColors) {
  const out = new THREE.MeshStandardMaterial({
    name: m.name, color: m.color?.clone() ?? new THREE.Color(1, 1, 1),
    map: m.map ?? null, normalMap: m.normalMap ?? null, roughnessMap: m.roughnessMap ?? null,
    metalnessMap: m.metalnessMap ?? null, aoMap: m.aoMap ?? null, emissiveMap: m.emissiveMap ?? null,
    emissive: m.emissive?.clone() ?? new THREE.Color(0, 0, 0), emissiveIntensity: m.emissiveIntensity ?? 1,
    roughness: m.roughness ?? 0.8, metalness: m.metalness ?? 0,
    transparent: !!m.transparent, opacity: m.opacity ?? 1, side: m.side ?? THREE.FrontSide,
    alphaTest: m.alphaTest ?? 0, vertexColors,
  });
  return out;
}

/** Geometry with only glTF-friendly attributes, non-indexed-safe, transformed by `matrix`. */
function prepGeometry(g, matrix, colorMul) {
  const c = g.clone();
  for (const k of Object.keys(c.attributes)) if (!KEEP.includes(k)) c.deleteAttribute(k);
  // quantized (int16 / normalized) attributes would clamp once transformed - expand to float32
  for (const k of Object.keys(c.attributes)) {
    const a = c.attributes[k];
    if (a.array instanceof Float32Array && !a.normalized && !a.isInterleavedBufferAttribute) continue;
    const n = a.count, s = a.itemSize, f = new Float32Array(n * s);
    for (let i = 0; i < n; i++) for (let j = 0; j < s; j++) f[i * s + j] = a.getComponent ? a.getComponent(i, j) : [a.getX(i), a.getY(i), a.getZ(i), a.getW?.(i)][j];
    c.setAttribute(k, new THREE.BufferAttribute(f, s));
  }
  c.morphAttributes = {};
  if (!c.attributes.normal) c.computeVertexNormals();
  if (colorMul) {
    const n = c.attributes.position.count;
    const col = new Float32Array(n * 3);
    const src = c.attributes.color;
    for (let i = 0; i < n; i++) {
      col[i * 3] = (src ? src.getX(i) : 1) * colorMul.r;
      col[i * 3 + 1] = (src ? src.getY(i) : 1) * colorMul.g;
      col[i * 3 + 2] = (src ? src.getZ(i) : 1) * colorMul.b;
    }
    c.setAttribute('color', new THREE.BufferAttribute(col, 3));
  } else if (c.attributes.color && c.attributes.color.itemSize === 4) {
    const src = c.attributes.color, n = src.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = src.getX(i); col[i * 3 + 1] = src.getY(i); col[i * 3 + 2] = src.getZ(i); }
    c.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  c.applyMatrix4(matrix);
  return c;
}

/** Turns every (instanced) lit mesh under `root` into one plain merged mesh per source mesh. */
function bake(root, lift, { skip } = {}) {
  root.updateMatrixWorld(true);
  const out = new THREE.Group();
  const shift = new THREE.Matrix4().makeTranslation(0, -lift, 0);
  const tmp = new THREE.Matrix4(), col = new THREE.Color();
  root.traverse((o) => {
    if (!o.isMesh || skip?.(o)) return;
    let m = Array.isArray(o.material) ? o.material[0] : o.material;
    // animated shader water (curtain / foam) -> a still, glassy white stand-in
    if (m?.isShaderMaterial) m = new THREE.MeshStandardMaterial({ name: 'water-fx', color: 0xe8f4ff, transparent: true, opacity: 0.55, roughness: 0.08, side: THREE.DoubleSide });
    if (!m || !(m.isMeshStandardMaterial || m.isMeshLambertMaterial || m.isMeshPhongMaterial || m.isMeshBasicMaterial)) return;
    let hidden = false;
    for (let p = o; p; p = p.parent) if (!p.visible) hidden = true;
    const parts = [];
    if (o.isInstancedMesh) {
      const count = o.userData.total ?? o.count;
      for (let i = 0; i < count; i++) {
        o.getMatrixAt(i, tmp);
        const mat = new THREE.Matrix4().multiplyMatrices(o.matrixWorld, tmp).premultiply(shift);
        let mul = null;
        if (o.instanceColor) { o.getColorAt(i, col); mul = col.clone(); }
        parts.push(prepGeometry(o.geometry, mat, mul));
      }
    } else if (!hidden) {
      parts.push(prepGeometry(o.geometry, o.matrixWorld.clone().premultiply(shift), null));
    }
    if (!parts.length) return;
    const hasColor = parts.some((p) => p.attributes.color);
    if (hasColor) parts.forEach((p) => {
      if (!p.attributes.color) {
        const n = p.attributes.position.count;
        p.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(1), 3));
      }
    });
    const hasUv = parts.every((p) => p.attributes.uv);
    if (!hasUv) parts.forEach((p) => p.deleteAttribute('uv'));
    const merged = mergeGeometries(parts.map((p) => (p.index ? p : p)), false);
    if (!merged) { console.warn('[export] could not merge', o.name); return; }
    const mesh = new THREE.Mesh(merged, plainMaterial(m, hasColor));
    mesh.name = o.name || m.name || 'part';
    out.add(mesh);
  });
  return out;
}

function forceTextureFormats(root) {
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      const t = m[k];
      if (!t) continue;
      const cutout = m.transparent || m.alphaTest > 0 || /branch|leaf|leaves|foliage/i.test(m.name);
      t.userData = { ...t.userData, mimeType: k === 'map' && cutout ? 'image/png' : 'image/jpeg' };
      if (k === 'map' && cutout && !m.transparent && !(m.alphaTest > 0)) m.alphaTest = 0.5;
    }
  });
}

async function toGLB(obj) {
  forceTextureFormats(obj);
  const exporter = new GLTFExporter();
  const buf = await exporter.parseAsync(obj, { binary: true, maxTextureSize: 2048, onlyVisible: false });
  let s = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function exportAR(sv, save, { buildingScale = 2 } = {}) {
  const { buildings, fountain, veg } = sv;
  const y0 = fountain.group.position.y;               // plaza floor becomes y = 0
  const log = [];

  // ---- base: fountain + flower beds (+ a plain stand-in for the animated water curtain)
  const base = bake(fountain.group, y0);
  base.name = 'Fountain';

  // ---- trees and boulders, re-instanced from the web app's placements, flattened onto the table
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const url = (f) => import.meta.env.BASE_URL + 'models/env/' + f;
  const INCLUDE_VEGETATION = false;   // trees + rocks left out of the AR app for now
  const species = !INCLUDE_VEGETATION ? [] : [
    { id: 'island_tree_01', file: 'island_tree_01_lod1.glb', sink: 0.09 },
    { id: 'island_tree_02', file: 'island_tree_02_lod1.glb', sink: 0.09 },
    { id: 'boulder_01', file: 'boulder_01.glb', sink: 0.12 },
  ];
  const e = new THREE.Euler(), q = new THREE.Quaternion(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  for (const sp of species) {
    const gltf = await loader.loadAsync(url(sp.file));
    gltf.scene.updateMatrixWorld(true);
    const holder = new THREE.Group();
    gltf.scene.traverse((o) => {
      if (!o.isMesh) return;
      const list = veg.placements[sp.id] || [];
      const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
      const m = new THREE.Matrix4();
      list.forEach((pl, i) => {
        e.set(pl.tilt, pl.yaw, pl.tilt * 0.7); q.setFromEuler(e);
        p.set(pl.x, -sp.sink * pl.s, pl.z);
        sc.set(pl.s, pl.s * (0.94 + (pl.yaw % 1) * 0.12), pl.s);
        m.compose(p, q, sc).multiply(o.matrixWorld);
        im.setMatrixAt(i, m);
      });
      im.material = o.material.clone();
      im.material.side = THREE.DoubleSide;
      holder.add(im);
    });
    const baked = bake(holder, 0);
    baked.children.forEach((c) => { c.name = sp.id; base.add(c); });
    log.push(`${sp.id}: ${(veg.placements[sp.id] || []).length}`);
  }
  await save('base.glb', await toGLB(base));

  // ---- buildings, enlarged about their own base, in the same coordinates
  const info = [];
  for (const it of buildings.items) {
    buildings.setHighlight(it.id, 0);
    const clone = it.holder.clone(true);
    clone.scale.setScalar(buildingScale);
    clone.position.y -= y0;
    const wrap = new THREE.Group();
    wrap.name = 'building-' + it.id;
    wrap.add(clone);
    await save(`building_${it.id}.glb`, await toGLB(wrap));
    const cfg = BUILDINGS.find((b) => b.id === it.id);
    info.push({
      id: cfg.id, label: cfg.label, kicker: cfg.kicker, title: cfg.title, summary: cfg.summary,
      accent: cfg.accent, facts: cfg.facts || [], sections: cfg.sections || [], clients: cfg.clients || [],
      contact: cfg.contact || null, cta: cfg.cta || null, model: `building_${it.id}.glb`,
    });
    log.push(`building ${it.id}`);
  }
  const meta = {
    company: { name: COMPANY.name ?? 'Sight Verse', tagline: COMPANY.tagline ?? '', intro: COMPANY.intro ?? '' },
    tabletopMetres: 1.3, islandSize: 760, buildingScale,
    buildings: info,
  };
  await save('buildings.json', btoa(unescape(encodeURIComponent(JSON.stringify(meta, null, 2)))));
  return log;
}
