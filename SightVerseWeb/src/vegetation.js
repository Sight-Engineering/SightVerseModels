// Scatters real (scanned / hand-modelled, CC0 Poly Haven) trees, ferns, grass and rocks across the
// island. Everything is GPU-instanced, split into spatial chunks so it frustum-culls, and each
// chunk switches between up to three levels of detail by distance to the camera.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { makeNoise, fbm, mulberry32 } from './util.js';
import { ISLAND } from './config.js';
import { heightAt, pathDistance } from './terrain.js';

const CELL = 96;
const LOD_DISTANCE = [140, 320];   // chunk distance where LOD1 / LOD2 begin

// files: lod0 [, lod1, lod2] in /models/env ; kind decides where instances may be placed
const SPECIES = [
  { id: 'island_tree_01',  kind: 'tree',   count: 34,  scale: [1.7, 2.7], wind: 0.0016, lods: 3, bytes: 2.3e6 },
  { id: 'island_tree_02',  kind: 'tree',   count: 70,  scale: [1.9, 3.0], wind: 0.0016, lods: 3, bytes: 2.1e6 },
  { id: 'boulder_01',      kind: 'rock',   count: 30,  scale: [1.6, 5.0], wind: 0,      lods: 1, bytes: 1.3e6 },
  { id: 'coast_rocks_05',  kind: 'shore',  count: 22,  scale: [1.6, 3.6], wind: 0,      lods: 1, bytes: 1.0e6 },
  { id: 'fern_02',         kind: 'ground', count: 320, scale: [1.0, 2.2], wind: 0.06,   lods: 1, bytes: 0.2e6, maxDist: 240 },
];

export function vegetationBytes() { return SPECIES.reduce((n, s) => n + s.bytes * s.lods * (s.lods > 1 ? 0.55 : 1), 0); }

export async function createVegetation({ exclusions, onBytes }) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = import.meta.env.BASE_URL + 'models/env/';
  const rand = mulberry32(2024);
  const noise = makeNoise(77);
  const windTime = { value: 0 };
  const root = new THREE.Group();
  root.name = 'Vegetation';

  // ---------------------------------------------------------------- load models (+ LODs)
  const loaded = {};
  await Promise.all(SPECIES.map(async (sp) => {
    loaded[sp.id] = [];
    for (let l = 0; l < sp.lods; l++) {
      const url = `${base}${sp.id}${l ? '_lod' + l : ''}.glb`;
      let last = 0;
      const gltf = await loader.loadAsync(url, (e) => { onBytes?.((e.loaded - last)); last = e.loaded; });
      gltf.scene.updateMatrixWorld(true);
      const parts = [];
      gltf.scene.traverse((o) => {
        if (!o.isMesh) return;
        const mat = o.material.clone();
        mat.side = THREE.DoubleSide;
        applyWind(mat, sp.wind);
        parts.push({ geometry: o.geometry, material: mat, matrix: o.matrixWorld.clone() });
      });
      loaded[sp.id].push(parts);
    }
  }));

  function applyWind(mat, k) {
    if (!k) return;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uWindTime = windTime;
      shader.uniforms.uWindK = { value: k };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uWindTime; uniform float uWindK;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iO = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 iO = vec3(0.0);
          #endif
          float sw = max(transformed.y, 0.0); sw = sw * sw * uWindK;
          float ph = uWindTime * 1.35 + iO.x * 0.09 + iO.z * 0.07;
          transformed.x += sin(ph + transformed.y * 0.35) * sw;
          transformed.z += cos(ph * 0.83 + transformed.y * 0.3) * sw * 0.7;`);
    };
    mat.customProgramCacheKey = () => 'sv-wind-' + k;
  }

  // ---------------------------------------------------------------- placement
  const okLand = (x, z, minH) => {
    const h = heightAt(x, z);
    if (h < minH) return null;
    for (const e of exclusions) if (Math.hypot(x - e.x, z - e.z) < e.r) return null;
    return h;
  };
  const placements = {};
  const treeHash = new Map();
  const cellKey = (x, z, s) => Math.floor(x / s) + ',' + Math.floor(z / s);
  const farFromTrees = (x, z, minD) => {
    const cx = Math.floor(x / 20), cz = Math.floor(z / 20);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const arr = treeHash.get((cx + i) + ',' + (cz + j));
      if (arr) for (const t of arr) if (Math.hypot(x - t.x, z - t.z) < minD) return false;
    }
    return true;
  };

  for (const sp of SPECIES) {
    const list = [];
    let tries = 0;
    while (list.length < sp.count && tries++ < sp.count * 400) {
      const ang = rand() * Math.PI * 2;
      const R = Math.sqrt(rand()) * 235;
      const x = Math.cos(ang) * R, z = Math.sin(ang) * R;
      let h = null;
      if (sp.kind === 'tree') {
        if (R < 40 || fbm(noise, x * 0.018, z * 0.018, 3) < -0.15) continue;
        if (pathDistance(x, z) < 5) continue;
        h = okLand(x, z, 1.7);
        if (h === null || !farFromTrees(x, z, 11)) continue;
        const key = cellKey(x, z, 20);
        (treeHash.get(key) || treeHash.set(key, []).get(key)).push({ x, z });
      } else if (sp.kind === 'rock') {
        if (R < 45 || pathDistance(x, z) < 6) continue;
        h = okLand(x, z, 1.0);
        if (h === null) continue;
      } else if (sp.kind === 'shore') {
        const hh = heightAt(x, z);
        if (hh > 0.7 || hh < -0.9 || R < 120) continue;
        h = hh;
      } else {
        // ground cover: hugs paths, tree bases and the forest edge
        if (R < 36 || pathDistance(x, z) < 3.4) continue;
        const nearPath = pathDistance(x, z) < 11;
        const cluster = fbm(noise, x * 0.03 + 9, z * 0.03, 3);
        if (!nearPath && cluster < 0.05) continue;
        h = okLand(x, z, 1.6);
        if (h === null) continue;
      }
      const s = sp.scale[0] + rand() * (sp.scale[1] - sp.scale[0]);
      // trees sink slightly so the flat base disc of the scan sits below the grass
      list.push({ x, y: h - (sp.kind === 'tree' ? 0.09 * s : 0), z, s, yaw: rand() * Math.PI * 2, tilt: sp.kind === 'rock' || sp.kind === 'shore' ? (rand() - 0.5) * 0.35 : (rand() - 0.5) * 0.06 });
    }
    placements[sp.id] = list;
  }

  // ---------------------------------------------------------------- chunked instancing
  const chunks = new Map(); // key -> { cx, cz, entries: [{ sp, lodMeshes: [[InstancedMesh...]] }] }
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler(), tmpP = new THREE.Vector3(), tmpS = new THREE.Vector3();

  for (const sp of SPECIES) {
    const byChunk = new Map();
    for (const p of placements[sp.id]) {
      const k = cellKey(p.x, p.z, CELL);
      (byChunk.get(k) || byChunk.set(k, []).get(k)).push(p);
    }
    for (const [k, items] of byChunk) {
      let chunk = chunks.get(k);
      if (!chunk) {
        const [ix, iz] = k.split(',').map(Number);
        chunk = { cx: (ix + 0.5) * CELL, cz: (iz + 0.5) * CELL, entries: [] };
        chunks.set(k, chunk);
      }
      const lodMeshes = loaded[sp.id].map((parts) => parts.map((part) => {
        const im = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        im.castShadow = true;
        im.receiveShadow = true;
        items.forEach((p, i) => {
          tmpE.set(p.tilt, p.yaw, p.tilt * 0.7);
          tmpQ.setFromEuler(tmpE);
          const sink = sp.kind === 'rock' || sp.kind === 'shore' ? -0.12 * p.s : 0;
          tmpP.set(p.x, p.y + sink, p.z);
          tmpS.set(p.s, p.s * (0.94 + (p.yaw % 1) * 0.12), p.s);
          tmpM.compose(tmpP, tmpQ, tmpS).multiply(part.matrix);
          im.setMatrixAt(i, tmpM);
        });
        im.instanceMatrix.needsUpdate = true;
        im.computeBoundingSphere();
        im.computeBoundingBox();
        im.userData.total = items.length;
        im.visible = false;
        root.add(im);
        return im;
      }));
      chunk.entries.push({ sp, lodMeshes });
    }
  }

  let density = 1;
  function update(camera) {
    const cp = camera.position;
    for (const chunk of chunks.values()) {
      const d = Math.max(0, Math.hypot(cp.x - chunk.cx, cp.z - chunk.cz) - CELL * 0.7);
      const lod = d < LOD_DISTANCE[0] ? 0 : d < LOD_DISTANCE[1] ? 1 : 2;
      for (const e of chunk.entries) {
        const use = Math.min(lod, e.lodMeshes.length - 1);
        const hide = e.sp.maxDist && d > e.sp.maxDist;
        e.lodMeshes.forEach((meshes, l) => meshes.forEach((m) => {
          m.visible = !hide && l === use;
          if (m.visible) m.count = Math.max(1, Math.floor(m.userData.total * density));
        }));
      }
    }
  }

  return {
    group: root,
    placements,
    update,
    setTime(t) { windTime.value = t; },
    setDensity(d) { density = d; },
    stats() {
      let tris = 0, draw = 0;
      root.traverse((o) => { if (o.isInstancedMesh && o.visible) { draw++; tris += (o.geometry.index ? o.geometry.index.count / 3 : 0) * o.count; } });
      return { tris, draw };
    },
  };
}
