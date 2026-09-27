// Image-based lighting from a real HDRI sky (Poly Haven, CC0).
//
// The HDR contains the sun as a handful of extremely bright pixels. For correct, sharp shadows we
//   1. find those pixels, work out the sun direction and the irradiance they deliver,
//   2. clamp them in the image (so image-based lighting doesn't double-count the sun), and
//   3. drive a real DirectionalLight with exactly that direction / colour / intensity.
// We also measure the horizon colour so distance fog melts seamlessly into the sky.

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const SUN_CLAMP = 12; // radiance level the sun disc is clamped to inside the IBL image

const h2f = (h) => {
  const e = (h >> 10) & 0x1f, f = h & 0x3ff;
  if (e === 0) return 6.103515625e-5 * (f / 1024);
  if (e === 31) return 65504;
  return Math.pow(2, e - 15) * (1 + f / 1024);
};

function analyse(tex) {
  const { data, width: W, height: H } = tex.image;
  const threshold = THREE.DataUtils.toHalfFloat(SUN_CLAMP * 0.6);
  const dOmega = ((2 * Math.PI) / W) * (Math.PI / H);
  const dir = new THREE.Vector3();
  const irr = new THREE.Vector3();
  let weightSum = 0;

  for (let j = 0; j < H; j++) {
    const el = Math.PI / 2 - ((j + 0.5) / H) * Math.PI;
    const ce = Math.cos(el), se = Math.sin(el);
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      if (data[o] < threshold && data[o + 1] < threshold && data[o + 2] < threshold) continue;
      const r = h2f(data[o]), g = h2f(data[o + 1]), b = h2f(data[o + 2]);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (lum <= SUN_CLAMP) continue;
      const f = SUN_CLAMP / lum;
      const w = dOmega * ce;
      const ex = r * (1 - f) * w, eg = g * (1 - f) * w, eb = b * (1 - f) * w;
      irr.x += ex; irr.y += eg; irr.z += eb;
      const phi = ((i + 0.5) / W - 0.5) * Math.PI * 2;
      const lw = lum * (1 - f) * w;
      dir.x += ce * Math.cos(phi) * lw;
      dir.y += se * lw;
      dir.z += ce * Math.sin(phi) * lw;
      weightSum += lw;
      data[o] = THREE.DataUtils.toHalfFloat(r * f);
      data[o + 1] = THREE.DataUtils.toHalfFloat(g * f);
      data[o + 2] = THREE.DataUtils.toHalfFloat(b * f);
    }
  }

  // horizon colour: mean of the band 0.5deg..5deg above the horizon
  const horizon = new THREE.Color(0, 0, 0);
  let n = 0;
  const jA = Math.floor(H * (0.5 - 5 / 180)), jB = Math.floor(H * (0.5 - 0.5 / 180));
  for (let j = jA; j <= jB; j++) {
    for (let i = 0; i < W; i += 4) {
      const o = (j * W + i) * 4;
      horizon.r += h2f(data[o]); horizon.g += h2f(data[o + 1]); horizon.b += h2f(data[o + 2]);
      n++;
    }
  }
  if (n) horizon.multiplyScalar(1 / n);

  const lumE = 0.2126 * irr.x + 0.7152 * irr.y + 0.0722 * irr.z;
  return {
    sunDir: weightSum > 0 ? dir.normalize() : new THREE.Vector3(0.4, 0.8, 0.3).normalize(),
    sunColor: lumE > 0 ? new THREE.Color(irr.x / lumE, irr.y / lumE, irr.z / lumE) : new THREE.Color(1, 1, 1),
    sunIntensity: lumE,
    horizon,
  };
}

export function createEnvironment({ renderer, scene, sun }) {
  const cache = new Map();
  let current = null;

  async function load(key, url, onProgress) {
    if (cache.has(key)) return cache.get(key);
    const loader = new HDRLoader();
    const tex = await new Promise((resolve, reject) => loader.load(url, resolve, onProgress, reject));
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const info = analyse(tex);
    const pmrem = new THREE.PMREMGenerator(renderer);
    const rt = pmrem.fromEquirectangular(tex);
    pmrem.dispose();
    const entry = { key, tex, env: rt.texture, ...info };
    cache.set(key, entry);
    return entry;
  }

  function apply(key, exposure = 1) {
    const e = cache.get(key);
    if (!e) return;
    current = e;
    scene.background = e.tex;
    scene.environment = e.env;
    scene.backgroundIntensity = 1;
    scene.environmentIntensity = 1;
    if (scene.fog) scene.fog.color.copy(e.horizon);
    sun.color.copy(e.sunColor);
    sun.intensity = e.sunIntensity;
    renderer.toneMappingExposure = exposure;
  }

  return {
    load,
    apply,
    get current() { return current; },
    get sunDir() { return current ? current.sunDir : new THREE.Vector3(0.4, 0.8, 0.3).normalize(); },
  };
}
