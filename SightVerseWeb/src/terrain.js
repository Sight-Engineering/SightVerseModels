// Procedural island: analytic heightfield, splat-mapped PBR ground (sand / grass / rock / gravel),
// paths, and the data textures the water + minimap need.

import * as THREE from 'three';
import { ISLAND, BUILDINGS } from './config.js';
import { makeNoise, fbm, smoothstep, lerp, distToSegment, mulberry32 } from './util.js';

export const SIZE = ISLAND.size;
const GRID = 1024;                    // splat / height data resolution
const MESH_SEGMENTS = 380;            // terrain mesh cells per side (2 m)
const PAD = ISLAND.padHeight;

const N1 = makeNoise(11), N2 = makeNoise(23), N3 = makeNoise(37), N4 = makeNoise(51);

const pads = BUILDINGS.map((b) => ({ id: b.id, x: b.position[0], z: b.position[1] }));

// ------------------------------------------------------------------ paths
const rand = mulberry32(7);
export const paths = pads.map((p) => {
  const len = Math.hypot(p.x, p.z);
  const dx = p.x / len, dz = p.z / len;
  const end = { x: p.x - dx * 46, z: p.z - dz * 46 };
  const wobble = (rand() - 0.5) * 22;
  const pts = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const bend = Math.sin(t * Math.PI) * wobble;
    pts.push({ x: lerp(0, end.x, t) - dz * bend, z: lerp(0, end.z, t) + dx * bend });
  }
  return pts;
});

export function pathDistance(x, z) {
  let best = Infinity;
  for (const pts of paths) {
    for (let i = 0; i < pts.length - 1; i++) {
      best = Math.min(best, distToSegment(x, z, pts[i].x, pts[i].z, pts[i + 1].x, pts[i + 1].z));
    }
  }
  return Math.min(best, Math.max(0, Math.hypot(x, z) - ISLAND.plazaRadius));
}

// ------------------------------------------------------------------ height
export function heightAt(x, z) {
  const R = Math.hypot(x, z);
  const rr = R + fbm(N1, x * 0.0055, z * 0.0055, 3) * 38;                // irregular coastline
  let h = PAD - 9.5 * smoothstep(172, 272, rr);                          // plateau -> sea floor
  h -= 9 * smoothstep(255, 380, R);                                      // hide the mesh edge deep under water
  h += fbm(N2, x * 0.011, z * 0.011, 4) * 0.9 * smoothstep(15, 70, R);   // gentle rolling ground
  const hillMask = smoothstep(96, 150, R) * (1 - smoothstep(196, 232, rr));
  const hillN = fbm(N3, x * 0.0075, z * 0.0075, 4) * 0.5 + 0.5;
  h += hillMask * Math.max(0, hillN - 0.25) * 22;                        // wooded hills / coastal bluffs
  // level ground for plaza and buildings
  let flat = 1 - smoothstep(ISLAND.plazaRadius, ISLAND.plazaRadius + 40, R);
  for (const p of pads) {
    const d = Math.hypot(x - p.x, z - p.z);
    flat = Math.max(flat, 1 - smoothstep(ISLAND.padRadius, ISLAND.padRadius + 45, d));
  }
  return lerp(h, PAD, flat);
}

/** Distance (m) to the nearest building centre. */
export function nearestPadDistance(x, z) {
  let d = Infinity;
  for (const p of pads) d = Math.min(d, Math.hypot(x - p.x, z - p.z));
  return d;
}

// ------------------------------------------------------------------ data maps
const tick = () => new Promise((r) => setTimeout(r, 0));

async function buildDataMaps(onProgress) {
  const H = new Float32Array(GRID * GRID);
  const cell = SIZE / GRID;
  for (let j = 0; j < GRID; j++) {
    const z = (j + 0.5) * cell - SIZE / 2;
    for (let i = 0; i < GRID; i++) H[j * GRID + i] = heightAt((i + 0.5) * cell - SIZE / 2, z);
    if (j % 64 === 63) { onProgress?.(j / GRID * 0.5); await tick(); }
  }

  // Path mask: draw the polylines with a canvas (fast + anti-aliased)
  const cv = document.createElement('canvas');
  cv.width = cv.height = GRID;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.fillStyle = '#000'; g.fillRect(0, 0, GRID, GRID);
  g.strokeStyle = '#fff'; g.fillStyle = '#fff';
  g.lineCap = 'round'; g.lineJoin = 'round';
  const toPx = (v) => (v / SIZE + 0.5) * GRID;
  g.lineWidth = 4.6 / cell;
  for (const pts of paths) {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(toPx(p.x), toPx(p.z)) : g.moveTo(toPx(p.x), toPx(p.z))));
    g.stroke();
  }
  g.beginPath();
  g.arc(toPx(0), toPx(0), ISLAND.plazaRadius / cell, 0, Math.PI * 2);
  g.fill();
  const pathPx = g.getImageData(0, 0, GRID, GRID).data;

  const splat = new Uint8Array(GRID * GRID * 4);
  for (let j = 0; j < GRID; j++) {
    const z = (j + 0.5) * cell - SIZE / 2;
    for (let i = 0; i < GRID; i++) {
      const idx = j * GRID + i;
      const x = (i + 0.5) * cell - SIZE / 2;
      const h = H[idx];
      const hx = H[j * GRID + Math.min(GRID - 1, i + 1)] - H[j * GRID + Math.max(0, i - 1)];
      const hz = H[Math.min(GRID - 1, j + 1) * GRID + i] - H[Math.max(0, j - 1) * GRID + i];
      const slope = Math.hypot(hx, hz) / (2 * cell);
      const nz = fbm(N4, x * 0.03, z * 0.03, 3);
      const sand = smoothstep(1.55, 0.7, h + nz * 0.4);
      const rock = Math.min(1, smoothstep(0.42, 0.85, slope + nz * 0.08) + smoothstep(9, 15, h + nz * 2) * 0.5);
      const grass = Math.max(0, 1 - Math.max(sand, rock));
      const o = idx * 4;
      splat[o] = sand * 255;
      splat[o + 1] = grass * 255;
      splat[o + 2] = rock * 255;
      splat[o + 3] = pathPx[o]; // red channel of the canvas
    }
    if (j % 64 === 63) { onProgress?.(0.5 + j / GRID * 0.5); await tick(); }
  }

  // 512^2 height texture for the water shader (R8: (h + 12) / 24)
  const HT = 512;
  const heightBytes = new Uint8Array(HT * HT);
  for (let j = 0; j < HT; j++) for (let i = 0; i < HT; i++) {
    heightBytes[j * HT + i] = Math.round(Math.min(1, Math.max(0, (H[(j * 2) * GRID + i * 2] + 12) / 24)) * 255);
  }
  return { H, splat, heightBytes, HT };
}

// ------------------------------------------------------------------ mesh + material
function buildMesh() {
  const n = MESH_SEGMENTS + 1;
  const pos = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = (i / MESH_SEGMENTS - 0.5) * SIZE, z = (j / MESH_SEGMENTS - 0.5) * SIZE;
      const o = (j * n + i) * 3;
      pos[o] = x; pos[o + 1] = heightAt(x, z); pos[o + 2] = z;
    }
  }
  const idx = new Uint32Array(MESH_SEGMENTS * MESH_SEGMENTS * 6);
  let k = 0;
  for (let j = 0; j < MESH_SEGMENTS; j++) {
    for (let i = 0; i < MESH_SEGMENTS; i++) {
      const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

async function loadTexture(loader, url, srgb, aniso) {
  const t = await loader.loadAsync(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  return t;
}

const FRAG_HEAD = /* glsl */ `
  varying vec3 vWPos;
  uniform sampler2D tSplat;
  uniform sampler2D tD0, tD1, tD2, tD3, tN0, tN1, tN2, tN3;
  uniform float uSize;
  mat3 tsFrame(vec3 eye_pos, vec3 surf_norm, vec2 uv) {
    vec3 q0 = dFdx(eye_pos.xyz); vec3 q1 = dFdy(eye_pos.xyz);
    vec2 st0 = dFdx(uv.st);      vec2 st1 = dFdy(uv.st);
    vec3 N = surf_norm;
    vec3 q1perp = cross(q1, N);  vec3 q0perp = cross(N, q0);
    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;
    float det = max(dot(T, T), dot(B, B));
    float scale = (det == 0.0) ? 0.0 : inversesqrt(det);
    return mat3(T * scale, B * scale, N);
  }
`;

const MAP_FRAGMENT = /* glsl */ `
  vec2 spUv = vWPos.xz / uSize + 0.5;
  vec4 tw = texture2D(tSplat, spUv);
  float pathAmt = smoothstep(0.32, 0.68, tw.a);
  vec3 wgt = tw.rgb / max(tw.r + tw.g + tw.b, 1e-3) * (1.0 - pathAmt);
  vec2 uS = vWPos.xz / 6.0, uG = vWPos.xz / 5.0, uR = vWPos.xz / 7.0, uP = vWPos.xz / 3.5;
  vec3 cS = mix(texture2D(tD0, uS).rgb, texture2D(tD0, uS * 0.213 + 0.37).rgb, 0.4);
  vec3 cG = mix(texture2D(tD1, uG).rgb, texture2D(tD1, uG * 0.187 + 0.11).rgb, 0.4);
  vec3 cR = mix(texture2D(tD2, uR).rgb, texture2D(tD2, uR * 0.241 + 0.53).rgb, 0.35);
  vec3 cP = texture2D(tD3, uP).rgb;
  vec3 alb = cS * wgt.r + cG * wgt.g + cR * wgt.b + cP * pathAmt;
  float macro = texture2D(tD1, vWPos.xz * 0.0117).g;
  alb *= 0.72 + 0.56 * macro;
  float lush = wgt.g * smoothstep(1.5, 5.0, vWPos.y);
  alb = mix(alb, alb * vec3(0.86, 1.18, 0.62), lush * 0.75);   // push the grass towards a healthier green
  float wet = 1.0 - smoothstep(0.0, 0.9, vWPos.y);
  alb *= 1.0 - 0.45 * wet * wgt.r;
  diffuseColor.rgb *= alb;
`;

const ROUGHNESS_FRAGMENT = /* glsl */ `
  float roughnessFactor = clamp(0.93 - 0.42 * wet * wgt.r - 0.08 * wgt.b, 0.2, 1.0);
`;

const NORMAL_FRAGMENT_MAPS = /* glsl */ `
  vec3 nS = texture2D(tN0, uS).xyz * 2.0 - 1.0;
  vec3 nG = texture2D(tN1, uG).xyz * 2.0 - 1.0;
  vec3 nR = texture2D(tN2, uR).xyz * 2.0 - 1.0;
  vec3 nP = texture2D(tN3, uP).xyz * 2.0 - 1.0;
  vec3 nb = nS * wgt.r + nG * wgt.g + nR * wgt.b + nP * pathAmt;
  nb = normalize(vec3(nb.xy * 1.15, max(nb.z, 0.25)));
  normal = normalize(tsFrame(-vViewPosition, normal, vWPos.xz * 0.2) * nb);
`;

export async function createTerrain({ renderer, onProgress }) {
  const data = await buildDataMaps(onProgress);
  const geometry = buildMesh();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const splatTex = new THREE.DataTexture(data.splat, GRID, GRID, THREE.RGBAFormat, THREE.UnsignedByteType);
  splatTex.minFilter = THREE.LinearMipmapLinearFilter;
  splatTex.magFilter = THREE.LinearFilter;
  splatTex.generateMipmaps = true;
  splatTex.wrapS = splatTex.wrapT = THREE.ClampToEdgeWrapping;
  splatTex.anisotropy = aniso;
  splatTex.needsUpdate = true;

  const heightTex = new THREE.DataTexture(data.heightBytes, data.HT, data.HT, THREE.RedFormat, THREE.UnsignedByteType);
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  const tl = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL + 'textures/';
  const files = {
    tD0: ['coast_sand_01_diff', true], tD1: ['forrest_ground_01_diff', true], tD2: ['rocky_terrain_diff', true], tD3: ['floor_pebbles_01_diff', true],
    tN0: ['coast_sand_01_nor', false], tN1: ['forrest_ground_01_nor', false], tN2: ['rocky_terrain_nor', false], tN3: ['floor_pebbles_01_nor', false],
  };
  const T = Object.fromEntries(await Promise.all(Object.entries(files).map(
    async ([k, [f, srgb]]) => [k, await loadTexture(tl, `${base}${f}.webp`, srgb, aniso)],
  )));

  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.tSplat = { value: splatTex };
    shader.uniforms.uSize = { value: SIZE };
    for (const [k, v] of Object.entries(T)) shader.uniforms[k] = { value: v };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <map_fragment>', MAP_FRAGMENT)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS_FRAGMENT)
      .replace('#include <normal_fragment_maps>', NORMAL_FRAGMENT_MAPS);
  };
  material.customProgramCacheKey = () => 'sv-terrain';

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  mesh.name = 'Terrain';

  return { mesh, heightTex, splatTex, heightGrid: { data: data.H, size: GRID }, pads, paths };
}
