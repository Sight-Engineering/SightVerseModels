// The central plaza feature: a polished black-marble sculptural fountain (a tapered, curving
// blade with a carved groove that a thin water curtain flows down into a round basin), surrounded
// by a ring of pink flowers and an outer ring of red roses inside black-marble kerbs.
// Everything is procedural - no extra downloads.

import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { heightAt, paths } from './terrain.js';
import { mulberry32, smoothstep } from './util.js';

const TAU = Math.PI * 2;

// ------------------------------------------------------------------ layout (metres, plaza centre = 0,0)
const BASIN_R = 7.3;            // outer radius of the black marble basin
const WATER_Y = 0.9;            // water level above the plaza floor
const PLINTH_R = 8.7;           // low step around the basin
const PAVE_R = 10.1;            // dark stone paving disc
const PINK_R = [10.55, 13.3];   // pink flower bed
const ROSE_R = [13.75, 17.45];  // red rose bed
const GAP_HALF = 0.23;          // half-angle (rad) of the walkways that cross the beds
const SCULPT_H = 10.4;
const SCULPT_Y0 = 0.15;

// ------------------------------------------------------------------ geometry helpers
/** Parametric grid surface. fn(u, v) -> { p:[x,y,z], c?:[r,g,b], uv?:[u,v] } */
function gridGeo(nu, nv, fn, wrapU = false) {
  const vu = wrapU ? nu : nu + 1, vv = nv + 1;
  const pos = new Float32Array(vu * vv * 3), col = new Float32Array(vu * vv * 3), uv = new Float32Array(vu * vv * 2);
  for (let j = 0; j < vv; j++) {
    for (let i = 0; i < vu; i++) {
      const r = fn(i / nu, j / nv);
      const k = j * vu + i;
      pos.set(r.p, k * 3);
      col.set(r.c || [1, 1, 1], k * 3);
      uv.set(r.uv || [i / nu, j / nv], k * 2);
    }
  }
  const idx = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const i1 = wrapU ? (i + 1) % nu : i + 1;
      const a = j * vu + i, b = j * vu + i1, c = (j + 1) * vu + i, d = (j + 1) * vu + i1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The sculpture body: a tapering, back-leaning blade with a vertical groove carved in the front (+z). */
function sculptureSection(t, phi) {
  const cap = Math.sqrt(Math.min(1, (1 - t) / 0.05));          // rounded top edge
  const a = (0.3 + 3.6 * Math.pow(1 - t, 2.1)) * cap;          // concave, flame-like sides
  const b = (0.5 + 1.0 * Math.pow(1 - t, 1.3)) * cap;          // slim slab
  const lean = -2.4 * t * t;
  const gd = 0.78 * smoothstep(0.03, 0.14, t) * (1 - smoothstep(0.8, 0.95, t));
  const dphi = Math.atan2(Math.sin(phi - Math.PI / 2), Math.cos(phi - Math.PI / 2));
  const s = 1 - gd * Math.exp(-Math.pow(dphi / 0.5, 2));
  const cs = Math.cos(phi), sn = Math.sin(phi);
  const q = 0.62;                                              // superellipse -> flatter faces, crisper edges
  const ex = Math.sign(cs) * Math.pow(Math.abs(cs), q), ez = Math.sign(sn) * Math.pow(Math.abs(sn), q);
  return [a * ex * s, SCULPT_Y0 + SCULPT_H * t, lean + b * ez * s];
}

function sculptureGeometry() {
  return gridGeo(80, 140, (u, v) => ({ p: sculptureSection(v, u * TAU), uv: [u * 4, v * 6] }), true);
}

/** Thin ribbon that hugs the groove: the falling water curtain. u = -1..1 across, v = 0 (water) .. 1 (top). */
function curtainGeometry() {
  const tTop = 0.9, tBot = (WATER_Y - SCULPT_Y0) / SCULPT_H;
  return gridGeo(14, 70, (u, v) => {
    const t = tBot + (tTop - tBot) * v;
    const half = 0.2 + 0.1 * (1 - v);
    const phi = Math.PI / 2 + (u - 0.5) * 2 * half;
    const p = sculptureSection(t, phi);
    p[2] += 0.055;
    return { p, uv: [(u - 0.5) * 2, v] };
  });
}

function rose() {
  const parts = [];
  // tight spiral bud in the middle
  parts.push(gridGeo(16, 7, (u, v) => {
    const phi = u * TAU, th = 0.12 + v * 1.75;
    const k = 1 + 0.17 * Math.sin(3 * phi + 7 * th);
    const R = 0.27 * k * (0.65 + 0.5 * v);
    const s = 0.34 + 0.66 * v;
    return { p: [R * Math.sin(th) * Math.cos(phi), 0.3 + 0.3 * Math.cos(th) - 0.05 * v, R * Math.sin(th) * Math.sin(phi)], c: [s, s, s] };
  }, true));
  // two layers of open petals
  const petal = (alpha, scale, y0, lift) => gridGeo(3, 4, (u, s) => {
    const v = (u - 0.5) * 2;
    const half = 0.62 * (0.45 + 0.55 * Math.sin(Math.PI * (0.2 + 0.8 * s)));
    const rho = scale * (0.12 + 0.32 * s);
    const ang = alpha + v * half;
    const y = y0 + lift * Math.sin(s * 1.6) + 0.06 * v * v * (0.4 + s);
    const sh = 0.5 + 0.5 * s;
    return { p: [rho * Math.cos(ang), y, rho * Math.sin(ang)], c: [sh, sh, sh] };
  });
  for (let k = 0; k < 5; k++) parts.push(petal((k / 5) * TAU, 1.0, 0.1, 0.28));
  for (let k = 0; k < 5; k++) parts.push(petal((k / 5) * TAU + 0.63, 0.7, 0.24, 0.2));
  return mergeGeometries(parts);
}

function pinkFlower() {
  const petals = [], centre = [];
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * TAU;
    const ca = Math.cos(a), sa = Math.sin(a);
    petals.push(gridGeo(2, 3, (u, s) => {
      const v = (u - 0.5) * 2;
      const half = 0.075 + 0.06 * Math.sin(Math.PI * Math.pow(s, 0.8));
      const rho = 0.05 + 0.27 * s, z = v * half;
      const y = 0.12 + 0.07 * s + 0.025 * v * v;
      const sh = 0.78 + 0.22 * s;
      return { p: [rho * ca - z * sa, y, rho * sa + z * ca], c: [sh, sh, sh] };
    }));
  }
  centre.push(gridGeo(8, 4, (u, v) => {
    const phi = u * TAU, th = v * 1.55;
    return { p: [0.075 * Math.sin(th) * Math.cos(phi), 0.13 + 0.06 * Math.cos(th), 0.075 * Math.sin(th) * Math.sin(phi)], c: [0.98, 0.78, 0.12] };
  }, true));
  return { petals: mergeGeometries(petals), centre: mergeGeometries(centre) };
}

/** Faceted leafy mound the blooms sit on. */
function foliageMound() {
  const g = new THREE.IcosahedronGeometry(1, 3);
  const p = g.attributes.position;
  const col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const amp = 0.15 * (Math.sin(x * 7 + 1.3) * Math.sin(z * 6.1 + 0.4) + Math.sin(y * 9 + x * 3));
    x *= 1 + amp; y *= 1 + amp; z *= 1 + amp;
    if (y < 0) y *= 0.2;
    p.setXYZ(i, x, y, z);
    const h = smoothstep(-0.1, 0.95, y), n = 0.85 + 0.3 * (0.5 + 0.5 * Math.sin(x * 13 + z * 11));
    col[i * 3] = (0.012 + 0.05 * h) * n; col[i * 3 + 1] = (0.06 + 0.13 * h) * n; col[i * 3 + 2] = (0.018 + 0.03 * h) * n;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('normal'); g.deleteAttribute('uv');
  const sm = mergeVertices(g, 1e-4);      // weld -> smooth shading instead of flat facets
  sm.computeVertexNormals();
  return sm;
}

// ------------------------------------------------------------------ textures
function veinTexture() {
  const S = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  g.fillStyle = '#09090b'; g.fillRect(0, 0, S, S);
  const rnd = mulberry32(5);
  for (let i = 0; i < 260; i++) { // fine speckle
    g.fillStyle = `rgba(255,255,255,${0.02 + rnd() * 0.05})`;
    g.fillRect(rnd() * S, rnd() * S, 1 + rnd() * 2, 1 + rnd() * 2);
  }
  for (let v = 0; v < 34; v++) {
    let x = rnd() * S, y = rnd() * S, ang = rnd() * TAU;
    g.lineWidth = 0.5 + rnd() * (v < 6 ? 2.6 : 1.1);
    g.strokeStyle = `rgba(215,215,225,${0.05 + rnd() * (v < 6 ? 0.28 : 0.14)})`;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 40; k++) {
      ang += (rnd() - 0.5) * 0.9;
      x += Math.cos(ang) * (10 + rnd() * 16); y += Math.sin(ang) * (10 + rnd() * 16);
      g.lineTo(x, y);
    }
    g.stroke();
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function pavingTexture() {
  const S = 1024, cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const g = cv.getContext('2d');
  const ppm = S / (PAVE_R * 2), c = S / 2, rnd = mulberry32(9);
  g.fillStyle = '#17181b'; g.fillRect(0, 0, S, S);
  const rings = Math.ceil(PAVE_R / 1.0);
  for (let k = 0; k < rings; k++) {
    const ra = k * ppm, rb = Math.min((k + 1) * ppm, PAVE_R * ppm);
    const n = Math.max(7, Math.round(TAU * (ra + rb) * 0.5 / (1.25 * ppm)));
    const off = rnd() * TAU;
    for (let i = 0; i < n; i++) {
      const a0 = off + (i / n) * TAU + 0.004, a1 = off + ((i + 1) / n) * TAU - 0.004;
      const L = 15 + rnd() * 9;
      g.fillStyle = `hsl(235, 5%, ${L}%)`;
      g.beginPath(); g.arc(c, c, rb - 1.2, a0, a1); g.arc(c, c, ra + 1.2, a1, a0, true); g.closePath(); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ------------------------------------------------------------------ shaders
const CURTAIN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const CURTAIN_FRAG = /* glsl */ `
  varying vec2 vUv; uniform float uTime;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    float x = vUv.x;
    float edge = 1.0 - smoothstep(0.62, 1.0, abs(x));
    float s = n(vec2(x * 8.0, vUv.y * 20.0 + uTime * 5.5)) * 0.6 + n(vec2(x * 21.0 + 3.1, vUv.y * 38.0 + uTime * 9.0)) * 0.4;
    float a = edge * (0.2 + 0.62 * s) * smoothstep(1.0, 0.93, vUv.y) * smoothstep(0.0, 0.04, vUv.y);
    vec3 c = vec3(0.86, 0.95, 1.0) * (0.72 + 0.4 * s);
    gl_FragColor = vec4(c, a);
  }
`;
const FOAM_FRAG = /* glsl */ `
  varying vec2 vUv; uniform float uTime;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    float ring = smoothstep(0.22, 0.5, r) * (1.0 - smoothstep(0.7, 1.0, r));
    float core = 1.0 - smoothstep(0.0, 0.55, r);
    float fl = n(p * 6.0 + vec2(uTime * 1.6, -uTime * 2.1)) * 0.65 + n(p * 13.0 - uTime * 2.4) * 0.35;
    float a = (core * 0.55 + ring * 0.35) * (0.35 + 0.9 * fl);
    gl_FragColor = vec4(vec3(0.92, 0.97, 1.0), clamp(a, 0.0, 0.85));
  }
`;
const SPRAY_VERT = /* glsl */ `
  attribute vec4 aSeed; uniform float uTime, uPx; varying float vA;
  void main() {
    float t = fract(uTime * 0.75 + aSeed.x);
    float ang = (aSeed.y - 0.5) * 2.8;
    float sp = 0.5 + aSeed.z * 1.3;
    float vy = 1.5 + aSeed.w * 1.9;
    float T = 2.0 * vy / 9.8;
    vec3 p = vec3((aSeed.z - 0.5) * 1.3 + sin(ang) * sp * T * t, vy * T * t * (1.0 - t), cos(ang) * sp * T * t * 0.8);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = max(1.5, (0.05 + aSeed.w * 0.07) * uPx / -mv.z);
    vA = smoothstep(0.0, 0.06, t) * (1.0 - smoothstep(0.7, 1.0, t));
  }
`;
const SPRAY_FRAG = /* glsl */ `
  varying float vA;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.05, d) * vA * 0.75;
    if (a < 0.01) discard;
    gl_FragColor = vec4(0.93, 0.98, 1.0, a);
  }
`;

// ------------------------------------------------------------------ the fountain
export function createFountain({ yaw = 0 } = {}) {
  const root = new THREE.Group();
  root.name = 'Fountain';
  root.position.y = heightAt(0, 0);
  const uTime = { value: 0 };
  const rand = mulberry32(31);
  const V2 = THREE.Vector2;

  // gaps in the beds where the four island paths lead into the plaza
  const gaps = paths
    .map((pts) => { const p = pts.find((q) => Math.hypot(q.x, q.z) >= 14) || pts[pts.length - 1]; return Math.atan2(p.x, p.z); })
    .sort((a, b) => a - b);
  const inGap = (az, r, margin = 0) => gaps.some((g) => {
    let d = Math.abs(az - g) % TAU; if (d > Math.PI) d = TAU - d;
    return d < GAP_HALF + margin / r;
  });
  const arcList = () => {
    const out = [];
    gaps.forEach((g, i) => {
      const a0 = g + GAP_HALF, a1 = (i + 1 < gaps.length ? gaps[i + 1] : gaps[0] + TAU) - GAP_HALF;
      if (a1 > a0 + 0.02) out.push([a0, a1]);
    });
    return out;
  };

  // ---------------- materials
  const marble = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, map: veinTexture(), roughness: 0.14, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.15, side: THREE.DoubleSide,
  });

  // ---------------- basin + sculpture (rotated so the groove faces the default camera)
  const fx = new THREE.Group();
  fx.rotation.y = yaw;
  root.add(fx);

  const lathe = (pts, seg = 96) => new THREE.LatheGeometry(pts.map(([r, y]) => new V2(r, y)), seg);
  const basin = new THREE.Mesh(lathe([[0.001, 0.18], [6.6, 0.18], [6.6, 1.1], [6.72, 1.17], [7.16, 1.17], [7.3, 1.1], [7.3, 0]]), marble);
  const plinth = new THREE.Mesh(lathe([[7.25, 0], [7.25, 0.32], [8.55, 0.32], [8.7, 0.27], [8.7, 0]]), marble);
  const sculpture = new THREE.Mesh(sculptureGeometry(), marble);
  for (const m of [basin, plinth, sculpture]) { m.castShadow = true; m.receiveShadow = true; fx.add(m); }

  // water surface: dark mirror with animated ripples travelling out from where the curtain lands
  const zLand = sculptureSection((WATER_Y - SCULPT_Y0) / SCULPT_H, Math.PI / 2)[2] + 0.4;
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x060f13, roughness: 0.03, metalness: 0, envMapIntensity: 1.35 });
  waterMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = uTime;
    sh.uniforms.uYaw = { value: yaw };
    sh.uniforms.uLand = { value: new V2(0, zLand) };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLocal = transformed;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vLocal; uniform float uTime; uniform float uYaw; uniform vec2 uLand;')
      .replace('#include <normal_fragment_maps>', `
        vec2 q = vLocal.xz - uLand;
        float d = max(length(q), 1e-3);
        float ph = d * 5.2 - uTime * 3.1;
        float dh = 0.5 * (5.2 * cos(ph) * (1.0 + 0.9 * d) - sin(ph) * 0.9) / pow(1.0 + 0.9 * d, 2.0);
        vec2 g = (q / d) * dh * 0.075;
        g += vec2(cos(vLocal.x * 1.7 + uTime * 0.9) * 1.7 * 0.012 + cos(vLocal.z * 2.3 - uTime * 1.2 + vLocal.x) * 0.006,
                  cos(vLocal.z * 1.4 - uTime * 0.7) * 1.4 * 0.012 + cos(vLocal.x * 2.9 + uTime * 1.1) * 0.006);
        vec3 nl = normalize(vec3(-g.x, 1.0, -g.y));
        vec3 nw = vec3(nl.x * cos(uYaw) + nl.z * sin(uYaw), nl.y, -nl.x * sin(uYaw) + nl.z * cos(uYaw));
        normal = normalize((viewMatrix * vec4(nw, 0.0)).xyz);`);
  };
  waterMat.customProgramCacheKey = () => 'sv-fountain-water';
  const waterGeo = new THREE.CircleGeometry(6.62, 96); waterGeo.rotateX(-Math.PI / 2);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.position.y = WATER_Y; water.receiveShadow = true;
  fx.add(water);

  // falling curtain
  const curtain = new THREE.Mesh(curtainGeometry(), new THREE.ShaderMaterial({
    uniforms: { uTime }, vertexShader: CURTAIN_VERT, fragmentShader: CURTAIN_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false,
  }));
  curtain.renderOrder = 3;
  fx.add(curtain);

  // foam where the water lands
  const foamGeo = new THREE.PlaneGeometry(3.4, 2.2); foamGeo.rotateX(-Math.PI / 2);
  const foam = new THREE.Mesh(foamGeo, new THREE.ShaderMaterial({
    uniforms: { uTime }, vertexShader: CURTAIN_VERT, fragmentShader: FOAM_FRAG,
    transparent: true, depthWrite: false, fog: false,
  }));
  foam.position.set(0, WATER_Y + 0.03, zLand - 0.15);
  foam.renderOrder = 3;
  fx.add(foam);

  // spray droplets
  const N = 240, seeds = new Float32Array(N * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rand();
  const sprayGeo = new THREE.BufferGeometry();
  sprayGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  sprayGeo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  const sprayMat = new THREE.ShaderMaterial({
    uniforms: { uTime, uPx: { value: 800 } }, vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG,
    transparent: true, depthWrite: false, fog: false,
  });
  const spray = new THREE.Points(sprayGeo, sprayMat);
  spray.position.set(0, WATER_Y + 0.02, zLand - 0.1);
  spray.frustumCulled = false; spray.renderOrder = 4;
  fx.add(spray);

  // warm accent lights along the plinth (they glow at sunset)
  const ledGeo = new THREE.SphereGeometry(0.1, 10, 8);
  const ledMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 1.7, 0.9), toneMapped: false });
  const leds = new THREE.InstancedMesh(ledGeo, ledMat, 32);
  const M = new THREE.Matrix4();
  for (let i = 0; i < 32; i++) {
    const a = (i / 32) * TAU;
    M.makeTranslation(Math.sin(a) * 8.15, 0.36, Math.cos(a) * 8.15);
    leds.setMatrixAt(i, M);
  }
  fx.add(leds);

  // ---------------- paving, soil and kerbs
  const paving = new THREE.Mesh(
    new THREE.CircleGeometry(PAVE_R, 96).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: pavingTexture(), roughness: 0.55, metalness: 0, envMapIntensity: 0.6 }),
  );
  paving.position.y = 0.045; paving.receiveShadow = true;
  root.add(paving);

  const band = (r0, r1, h, rounded) => {
    const prof = rounded
      ? [[r0, 0], [r0, h - 0.05], [r0 + 0.05, h], [r1 - 0.05, h], [r1, h - 0.05], [r1, 0]]
      : [[r0, 0], [r0, h], [r1, h], [r1, 0]];
    const parts = [];
    for (const [a0, a1] of arcList()) {
      parts.push(new THREE.LatheGeometry(prof.map(([r, y]) => new V2(r, y)), Math.max(6, Math.ceil((a1 - a0) / 0.04)), a0, a1 - a0));
      for (const a of [a0, a1]) { // end caps so the kerb ends look solid
        const shape = new THREE.Shape(prof.map(([r, y]) => new V2(r, y)));
        parts.push(new THREE.ShapeGeometry(shape).rotateY(a - Math.PI / 2));
      }
    }
    return parts;
  };
  const kerbGeo = mergeGeometries([
    ...band(10.15, 10.55, 0.3, true), ...band(13.3, 13.75, 0.24, true), ...band(17.45, 17.85, 0.36, true),
  ].map((g) => { g.deleteAttribute('color'); return g; }));
  const kerbs = new THREE.Mesh(kerbGeo, marble);
  kerbs.castShadow = true; kerbs.receiveShadow = true;
  root.add(kerbs);

  const soilGeo = mergeGeometries(band(10.55, 17.45, 0.14, false));
  const soil = new THREE.Mesh(soilGeo, new THREE.MeshStandardMaterial({ color: 0x2b2018, roughness: 1, side: THREE.DoubleSide }));
  soil.receiveShadow = true;
  root.add(soil);

  // ---------------- flower beds
  const up = new THREE.Vector3(0, 1, 0);
  const mounds = [], roses = [], pinks = [];
  const col = new THREE.Color();
  const beds = [
    { r: PINK_R, spacing: 1.2, size: [0.6, 0.85], height: 0.42, blooms: [7, 11], list: pinks, scale: [0.75, 1.05] },
    { r: ROSE_R, spacing: 1.5, size: [0.8, 1.1], height: 0.7, blooms: [5, 8], list: roses, scale: [0.5, 0.72] },
  ];
  for (const bed of beds) {
    const rows = Math.max(1, Math.round((bed.r[1] - bed.r[0]) / bed.spacing));
    for (let i = 0; i < rows; i++) {
      const r = bed.r[0] + ((i + 0.5) / rows) * (bed.r[1] - bed.r[0]);
      const count = Math.round((TAU * r) / bed.spacing);
      for (let k = 0; k < count; k++) {
        const az = ((k + (i % 2 ? 0.5 : 0) + (rand() - 0.5) * 0.4) / count) * TAU - Math.PI;
        const rr = r + (rand() - 0.5) * 0.45;
        if (inGap(az, rr, 1.0)) continue;
        const x = Math.sin(az) * rr, z = Math.cos(az) * rr;
        const s = bed.size[0] + rand() * (bed.size[1] - bed.size[0]);
        const sy = bed.height * (0.85 + rand() * 0.3);
        const tint = 0.85 + rand() * 0.3;
        mounds.push({ p: new THREE.Vector3(x, 0.1, z), q: new THREE.Quaternion().setFromAxisAngle(up, rand() * TAU), s: new THREE.Vector3(s, sy, s), c: new THREE.Color(tint, tint, tint) });
        const nb = bed.blooms[0] + Math.floor(rand() * (bed.blooms[1] - bed.blooms[0] + 1));
        for (let b = 0; b < nb; b++) {
          const th = rand() * TAU, dy = 0.3 + 0.7 * Math.pow(rand(), 0.7), hz = Math.sqrt(1 - dy * dy);
          const d = new THREE.Vector3(hz * Math.cos(th), dy, hz * Math.sin(th));
          const pos = new THREE.Vector3(x + d.x * s * 0.95, 0.1 + d.y * sy * 1.02, z + d.z * s * 0.95);
          const n = new THREE.Vector3(d.x / s, d.y / sy, d.z / s).normalize().multiplyScalar(0.65).addScaledVector(up, 0.35).normalize();
          const q = new THREE.Quaternion().setFromUnitVectors(up, n).multiply(new THREE.Quaternion().setFromAxisAngle(up, rand() * TAU));
          const k2 = bed.scale[0] + rand() * (bed.scale[1] - bed.scale[0]);
          if (bed.list === roses) col.setHSL(((355 + rand() * 10) % 360) / 360, 0.85 + rand() * 0.12, 0.44 + rand() * 0.12, THREE.SRGBColorSpace);
          else col.setHSL((322 + rand() * 28) / 360, 0.7 + rand() * 0.25, 0.7 + rand() * 0.14, THREE.SRGBColorSpace);
          bed.list.push({ p: pos, q, s: new THREE.Vector3(k2, k2, k2), c: col.clone() });
        }
      }
    }
  }

  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const windPatch = (mat, k) => {
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTime = uTime;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            vec3 iO = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
          #else
            vec3 iO = vec3(0.0);
          #endif
          float sw = max(transformed.y, 0.0);
          transformed.x += sin(uTime * 1.7 + iO.x * 0.9 + iO.z * 0.6) * sw * ${k.toFixed(3)};
          transformed.z += cos(uTime * 1.3 + iO.z * 0.8 + iO.x * 0.5) * sw * ${k.toFixed(3)};`);
    };
    mat.customProgramCacheKey = () => 'sv-flower-wind-' + k;
  };
  const bloomMeshes = [];
  const makeInstances = (geo, mat, list, tinted, isBloom) => {
    const m = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((e, i) => { M.compose(e.p, e.q, e.s); m.setMatrixAt(i, M); if (tinted) m.setColorAt(i, e.c); });
    m.instanceMatrix.needsUpdate = true;
    if (m.instanceColor) m.instanceColor.needsUpdate = true;
    m.computeBoundingSphere();
    m.userData.total = list.length;
    m.receiveShadow = true;
    root.add(m);
    if (isBloom) bloomMeshes.push(m);
    return m;
  };

  const foliageMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide });
  const roseMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, side: THREE.DoubleSide });
  const pinkMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, side: THREE.DoubleSide });
  const pollenMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 });
  windPatch(foliageMat, 0.012); windPatch(roseMat, 0.04); windPatch(pinkMat, 0.06); windPatch(pollenMat, 0.06);

  makeInstances(foliageMound(), foliageMat, mounds, true, false).castShadow = true;
  shuffle(roses); shuffle(pinks);
  makeInstances(rose(), roseMat, roses, true, true);
  const pf = pinkFlower();
  makeInstances(pf.petals, pinkMat, pinks, true, true);
  makeInstances(pf.centre, pollenMat, pinks, false, true);

  // ---------------- walking collisions (the walker can't wade through the basin or the beds)
  const colliders = [
    { kind: 'disc', x: 0, z: 0, r: PLINTH_R + 0.1 },
    { kind: 'ring', r0: 10.15, r1: 17.85, gaps, gapHalf: GAP_HALF },
  ];

  const sz = new THREE.Vector2();
  return {
    group: root,
    colliders,
    counts: { roses: roses.length, pinks: pinks.length, mounds: mounds.length },
    update(time, camera, renderer) {
      uTime.value = time;
      renderer.getDrawingBufferSize(sz);
      sprayMat.uniforms.uPx.value = sz.y / (2 * Math.tan((camera.fov * Math.PI) / 360));
    },
    setDensity(d) { for (const m of bloomMeshes) m.count = Math.max(1, Math.floor(m.userData.total * d)); },
  };
}
