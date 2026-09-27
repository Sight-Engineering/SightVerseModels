// Ocean: a single big plane using a patched MeshStandardMaterial, so it gets image-based reflections,
// sun glints, fog and shadows from three.js for free. Depth colour + shoreline foam come from the
// island height texture; ripples come from a procedurally generated tileable normal map.

import * as THREE from 'three';
import { SIZE } from './terrain.js';
import { mulberry32 } from './util.js';

function makeWaterNormalMap(size = 512, aniso = 4) {
  const rand = mulberry32(99);
  const waves = [];
  for (let i = 0; i < 30; i++) {
    const mag = 2 + Math.floor(rand() * 30);
    const ang = rand() * Math.PI * 2;
    const fx = Math.round(Math.cos(ang) * mag), fy = Math.round(Math.sin(ang) * mag);
    if (!fx && !fy) continue;
    waves.push({ fx, fy, amp: 1 / (1 + Math.hypot(fx, fy) * 0.3), ph: rand() * Math.PI * 2 });
  }
  const dxs = new Float32Array(size * size), dys = new Float32Array(size * size);
  let sumSq = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      let dx = 0, dy = 0;
      for (const w of waves) {
        const s = -Math.sin(Math.PI * 2 * (w.fx * u + w.fy * v) + w.ph) * Math.PI * 2 * w.amp;
        dx += s * w.fx; dy += s * w.fy;
      }
      const i = y * size + x;
      dxs[i] = dx; dys[i] = dy;
      sumSq += dx * dx + dy * dy;
    }
  }
  const k = 0.5 / Math.sqrt(sumSq / (size * size * 2)); // RMS slope = 0.5
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    let nx = -dxs[i] * k, ny = -dys[i] * k, nz = 1;
    const l = Math.hypot(nx, ny, nz);
    nx /= l; ny /= l; nz /= l;
    data[i * 4] = (nx * 0.5 + 0.5) * 255;
    data[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
    data[i * 4 + 2] = (nz * 0.5 + 0.5) * 255;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = aniso;
  tex.needsUpdate = true;
  return tex;
}

const FRAG_HEAD = /* glsl */ `
  varying vec3 vWPos;
  uniform float uTime, uSize;
  uniform sampler2D tWaterN, tHeight;
  uniform vec3 uShallow, uDeep;
`;

const MAP_FRAGMENT = /* glsl */ `
  float hd = texture2D(tHeight, vWPos.xz / uSize + 0.5).r * 24.0 - 12.0;
  float depthM = max(0.0, -hd);
  float kDeep = 1.0 - exp(-depthM * 0.26);
  vec3 wcol = mix(uShallow, uDeep, kDeep);
  float wAlpha = mix(0.16, 0.97, 1.0 - exp(-depthM * 0.7));
  float fn = clamp(0.5 + (texture2D(tWaterN, vWPos.xz * 0.09 + vec2(uTime * 0.011, 0.0)).r - 0.5) * 3.0, 0.0, 1.0);
  float shore = smoothstep(1.5, 0.0, depthM);
  float bands = smoothstep(0.55, 0.95, sin(depthM * 5.2 - uTime * 1.15 + fn * 3.2) * 0.5 + 0.5);
  float foam = clamp(shore * (bands * 0.8 + 0.35 * fn) + smoothstep(0.2, 0.0, depthM), 0.0, 1.0);
  diffuseColor.rgb = mix(wcol, vec3(0.9, 0.95, 0.97), foam);
  diffuseColor.a = max(wAlpha, foam * 0.9);
`;

const ROUGHNESS_FRAGMENT = /* glsl */ `
  float roughnessFactor = mix(0.075, 0.7, foam);
`;

const NORMAL_FRAGMENT_MAPS = /* glsl */ `
  vec2 wp = vWPos.xz;
  vec3 n1 = texture2D(tWaterN, wp * 0.041 + vec2(uTime * 0.010, uTime * 0.006)).xyz * 2.0 - 1.0;
  vec3 n2 = texture2D(tWaterN, wp * 0.109 + vec2(-uTime * 0.017, uTime * 0.013)).xyz * 2.0 - 1.0;
  vec3 n3 = texture2D(tWaterN, wp * 0.53 + vec2(uTime * 0.041, -uTime * 0.032)).xyz * 2.0 - 1.0;
  float camDist = length(vViewPosition);
  float fadeHF = smoothstep(420.0, 40.0, camDist);
  vec2 wslope = n1.xy * 0.55 + n2.xy * 0.38 * (0.35 + 0.65 * fadeHF) + n3.xy * 0.14 * fadeHF;
  wslope *= mix(0.35, 0.8, kDeep) * (1.0 - foam * 0.6);
  vec3 wnorm = normalize(vec3(wslope.x, 1.0, wslope.y));
  normal = normalize((viewMatrix * vec4(wnorm, 0.0)).xyz);
`;

export function createWater({ renderer, heightTex }) {
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const normalTex = makeWaterNormalMap(512, aniso);
  const uniforms = {
    uTime: { value: 0 },
    uSize: { value: SIZE },
    tWaterN: { value: normalTex },
    tHeight: { value: heightTex },
    uShallow: { value: new THREE.Color(0.02, 0.36, 0.38) },
    uDeep: { value: new THREE.Color(0.004, 0.045, 0.085) },
  };

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff, roughness: 0.04, metalness: 0, transparent: true, depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FRAG_HEAD)
      .replace('#include <map_fragment>', MAP_FRAGMENT)
      .replace('#include <roughnessmap_fragment>', ROUGHNESS_FRAGMENT)
      .replace('#include <normal_fragment_maps>', NORMAL_FRAGMENT_MAPS);
  };
  material.customProgramCacheKey = () => 'sv-water';

  const geo = new THREE.PlaneGeometry(9000, 9000, 1, 1);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'Ocean';
  mesh.renderOrder = 1;
  mesh.frustumCulled = false;

  return {
    mesh,
    uniforms,
    update(t) { uniforms.uTime.value = t; },
  };
}
