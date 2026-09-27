import * as THREE from 'three';
import { BUILDINGS, COMPANY, ISLAND } from './config.js';
import { clamp, lerp, smoothstep, angleDelta } from './util.js';
import { createTerrain, heightAt, paths, SIZE } from './terrain.js';
import { createWater } from './water.js';
import { createEnvironment } from './sky.js';
import { loadBuildings } from './buildings.js';
import { createVegetation, vegetationBytes } from './vegetation.js';
import { createFountain } from './fountain.js';
import { createAR, arSessionSupported } from './ar.js';
import { CameraRig } from './camera.js';
import { createPostFX } from './postfx.js';
import { createUI } from './ui.js';

const params = new URLSearchParams(location.search);
const BASE = import.meta.env.BASE_URL;
const isTouch = matchMedia('(pointer: coarse)').matches;

// ---------------------------------------------------------------- quality tiers
const dpr = window.devicePixelRatio || 1;
const TIERS = {
  ultra:  { pr: Math.min(dpr, 2),   shadow: 4096, ao: true,  bloom: true,  msaa: 4, veg: 1.0, post: true },
  high:   { pr: Math.min(dpr, 1.5), shadow: 2048, ao: true,  bloom: true,  msaa: 4, veg: 1.0, post: true },
  medium: { pr: 1,                  shadow: 2048, ao: false, bloom: true,  msaa: 2, veg: 0.7, post: true },
  low:    { pr: 0.85,               shadow: 1024, ao: false, bloom: false, msaa: 0, veg: 0.4, post: false },
};
const TIER_ORDER = ['ultra', 'high', 'medium', 'low'];
let tierName = params.get('quality') in TIERS ? params.get('quality') : (isTouch ? 'medium' : 'ultra');

// ---------------------------------------------------------------- renderer / scene
const canvas = document.getElementById('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance', stencil: false });
} catch (e) {
  document.getElementById('loader-label').textContent = 'WebGL is not available';
  document.getElementById('loader-note').hidden = false;
  document.getElementById('loader-note').textContent = 'Your browser or device could not start 3D graphics. Try a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.';
  throw e;
}
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.info.autoReset = false;
renderer.xr.enabled = true;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xb7c9d6, 0.00024);
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.5, 9000);
camera.position.set(420, 330, 560);

const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true;
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 1400;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- UI
const state = { selected: null, hover: null, mood: 'day', mode: 'orbit', entered: false, arMode: false };
let buildings = null, rig = null, post = null, veg = null, terrain = null, water = null, fountain = null, islandRoot = null, ar = null;
const hl = {};                       // per-building highlight amounts (smoothed)
let viewShift = 0, viewShiftY = 0;

const HOME = {
  position: new THREE.Vector3(146, 159, 208),
  target: new THREE.Vector3(0, 6, 0),
};
const AR_TABLETOP_METRES = 1.3;   // real-world footprint of the whole island once placed in AR

const ui = createUI({
  onSelect: (id) => select(id),
  onClose: () => closeSelection(true),
  onHome: () => goHome(),
  onMode: (m) => setMode(m),
  onMood: () => toggleMood(),
  onPinHover: (id) => { state.hover = id; },
  onJoystick: (x, y) => rig?.setJoystick(x, y),
  onMinimap: (x, z) => travelTo(x, z),
  onAR: () => ar?.enter(),
});

// ---------------------------------------------------------------- loading progress
const load = { bytes: 0, expected: 5.5e6 + 9.5e6 + vegetationBytes() + 3.3e6, compute: 0 };
const COMPUTE_WEIGHT = 4e6;
const refreshProgress = (label) => ui.setProgress((load.bytes + load.compute * COMPUTE_WEIGHT) / (load.expected + COMPUTE_WEIGHT) * 0.985, label);

// ---------------------------------------------------------------- boot
const env = createEnvironment({ renderer, scene, sun });

async function boot() {
  if (!renderer.capabilities.isWebGL2) throw new Error('This browser does not support WebGL 2.');
  applyTier(tierName, true);
  refreshProgress('Lighting the sky');

  const exclusions = BUILDINGS.map((b) => ({ x: b.position[0], z: b.position[1], r: (b.footprint || 70) * 0.62 + 8 }));
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

  const [, t, b, v] = await Promise.all([
    env.load('day', `${BASE}env/day.hdr`).then(() => { load.bytes += 5.5e6; refreshProgress('Sky ready'); }),
    createTerrain({ renderer, onProgress: (p) => { load.compute = p; refreshProgress('Sculpting the island'); } }).then((r) => { refreshProgress('Island ready'); return r; }),
    loadBuildings({ aniso, onBytes: (n) => { load.bytes += n; refreshProgress('Loading buildings'); } }),
    createVegetation({ exclusions, onBytes: (n) => { load.bytes += n; refreshProgress('Growing vegetation'); } }),
  ]);
  terrain = t; buildings = b; veg = v;
  load.bytes += 3.3e6;

  islandRoot = new THREE.Group();
  islandRoot.name = 'IslandRoot';        // everything that AR shrinks onto a real surface - stays at identity on desktop/mobile web
  scene.add(islandRoot);

  terrain.mesh.castShadow = true;
  islandRoot.add(terrain.mesh);
  water = createWater({ renderer, heightTex: terrain.heightTex });
  islandRoot.add(water.mesh);
  islandRoot.add(buildings.group, ...buildings.proxies, veg.group);
  fountain = createFountain({ yaw: Math.atan2(HOME.position.x, HOME.position.z) });   // groove faces the opening camera view
  islandRoot.add(fountain.group);
  buildings.items.forEach((it) => { hl[it.id] = 0; });

  const colliders = buildings.items.map((it) => {
    const s = 1.0, cx = it.center.x, cz = it.center.z;
    return { minX: cx - it.size.x * 0.5 * s, maxX: cx + it.size.x * 0.5 * s, minZ: cz - it.size.z * 0.5 * s, maxZ: cz + it.size.z * 0.5 * s };
  });
  colliders.push(...fountain.colliders);
  rig = new CameraRig({ camera, dom: canvas, colliders });
  camera.position.set(420, 330, 560);
  rig.controls.target.set(0, 0, 0);
  rig.controls.update();
  rig.onChange((m) => { state.mode = m; ui.setMode(m); camera.fov = m === 'walk' ? 68 : 50; camera.updateProjectionMatrix(); });

  post = createPostFX({ renderer, scene, camera });
  applyTier(tierName, true);

  env.apply('day', 1.0);
  ui.initMinimap({ heightGrid: terrain.heightGrid, size: SIZE, buildings: buildings.items, paths });

  refreshProgress('Compiling shaders');
  try { await renderer.compileAsync(scene, camera); } catch { /* not fatal */ }
  fitSun(true);

  ar = createAR({
    renderer, scene, camera, islandRoot,
    scale: AR_TABLETOP_METRES / SIZE,          // the whole island, edge to edge, fits on a table
    pick,
    onSelectBuilding: (id) => arSelect(id),
    onEnter: () => { state.arMode = true; rig.controls.enabled = false; ui.setARMode(true); },
    onExit: () => { state.arMode = false; rig.controls.enabled = true; ui.setARMode(false); ui.closePanel(); state.selected = null; },
    toast: (m) => ui.toast(m),
  });
  arSessionSupported().then((ok) => ui.setARAvailable(ok));

  renderer.setAnimationLoop(frame);
  ui.setMode('orbit');
  ui.ready(enter);
}

boot().catch((err) => {
  console.error(err);
  ui.fail(String(err?.message || err));
});

// ---------------------------------------------------------------- quality handling
function applyTier(name, silent) {
  tierName = name;
  const t = TIERS[name];
  renderer.setPixelRatio(t.pr);
  renderer.setSize(innerWidth, innerHeight, false);
  canvas.style.width = '100%'; canvas.style.height = '100%';
  sun.shadow.mapSize.set(t.shadow, t.shadow);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  veg?.setDensity(t.veg);
  fountain?.setDensity(t.veg);
  if (post) {
    post.apply(t);
    post.setSize(innerWidth, innerHeight, t.pr);
  }
  if (!silent) ui.toast('Graphics: ' + name);
}
function stepDownQuality() {
  const i = TIER_ORDER.indexOf(tierName);
  if (i < TIER_ORDER.length - 1) { applyTier(TIER_ORDER[i + 1], true); ui.toast('Adjusted graphics for smoother performance'); }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  applyTier(tierName, true);
});

// ---------------------------------------------------------------- sun / shadow fitting
const _c = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3();
function fitSun() {
  if (!rig) return;
  const sd = env.sunDir.clone();
  if (sd.y < 0.12) { sd.y = 0.12; sd.normalize(); }
  const walking = state.mode === 'walk';
  const center = _c.copy(walking ? camera.position : rig.controls.target);
  center.y = Math.max(0, center.y - (walking ? 1.7 : 0));
  const dist = camera.position.distanceTo(rig.controls.target);
  const half = walking ? 85 : clamp(dist * 0.8, 70, 320);
  const texel = (half * 2) / TIERS[tierName].shadow;
  // snap centre to the shadow-texel grid so shadows don't shimmer while moving
  _r.set(0, 1, 0).cross(sd).normalize();
  _u.crossVectors(sd, _r);
  const a = center.dot(_r), b = center.dot(_u);
  center.addScaledVector(_r, Math.round(a / texel) * texel - a).addScaledVector(_u, Math.round(b / texel) * texel - b);
  sun.position.copy(center).addScaledVector(sd, 700);
  sun.target.position.copy(center);
  const sc = sun.shadow.camera;
  sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
  sc.updateProjectionMatrix();
  sun.shadow.bias = -0.00025;
  sun.shadow.normalBias = texel * 1.6;
}

// ---------------------------------------------------------------- selection + navigation
function viewFor(item) {
  const cfg = item.cfg;
  const out = new THREE.Vector2(item.center.x, item.center.z);
  const baseAngle = Math.atan2(out.x, out.y);                // direction from island centre to building
  const az = baseAngle + Math.PI + THREE.MathUtils.degToRad(cfg.viewAngleDeg ?? 32); // camera sits on the hub side, turned a little
  // fit both the footprint and the full height (tall towers) inside the vertical field of view
  const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const fitV = (item.size.y * 0.98) / tanHalf;
  const aspectEff = Math.min(camera.aspect, 1.8) * (innerWidth > 720 ? 0.75 : 0.9);   // portrait phones need to stand further back
  const fitH = (Math.max(item.size.x, item.size.z) * 0.62) / (tanHalf * aspectEff);
  const dist = cfg.viewDistance ?? Math.max(item.radius * 1.9 + 14, fitV, fitH);
  const height = cfg.viewHeight ?? item.size.y * 0.42 + 10;
  const target = new THREE.Vector3(item.center.x, Math.max(6, item.size.y * 0.36), item.center.z);
  const position = new THREE.Vector3(
    item.center.x + Math.sin(az) * dist,
    heightAt(item.center.x, item.center.z) + height,
    item.center.z + Math.cos(az) * dist,
  );
  return { position, target };
}

async function select(id) {
  if (!buildings) return;
  const item = buildings.byId[id];
  if (!item) return;
  state.selected = id;
  ui.openPanel(id);
  ui.fadeHint();
  if (state.arMode) return;                  // the camera is the phone in AR - nothing to fly
  if (state.mode === 'walk') {
    rig.faceToward(item.center.x, item.center.z);
  } else {
    await rig.flyTo(viewFor(item), 2.4);
  }
}

/** Tapping a building's miniature while it's placed in AR - just show the panel, no camera moves. */
function arSelect(id) { select(id); }

function closeSelection(fly) {
  ui.closePanel();
  state.selected = null;
  if (state.arMode) return;
  if (fly && state.mode === 'orbit') rig.flyTo(HOME, 2.2);
}

function goHome() {
  ui.closePanel();
  state.selected = null;
  if (state.mode === 'walk') setMode('orbit');
  rig.flyTo(HOME, 2.4);
}

function travelTo(x, z) {
  // clicking the minimap: on a building -> select it, otherwise move there
  if (!buildings) return;
  for (const it of buildings.items) {
    if (Math.hypot(x - it.center.x, z - it.center.z) < it.radius * 0.8) { select(it.id); return; }
  }
  const px = clamp(x, -215, 215), pz = clamp(z, -215, 215);
  if (state.mode === 'walk') {
    if (heightAt(px, pz) > 0.4) { rig.walk.x = px; rig.walk.z = pz; }
    else ui.toast('That spot is in the water');
  } else {
    const y = Math.max(2, heightAt(px, pz));
    rig.flyTo({ position: new THREE.Vector3(px + 60, y + 55, pz + 90), target: new THREE.Vector3(px, y + 2, pz) }, 2.2);
    closeSelection(false);
  }
}

function setMode(m) {
  if (!rig || m === state.mode) return;
  let start;
  if (m === 'walk') {
    closeSelection(false);
    ui.toast('Walk mode - use W A S D and drag to look');
    // if the orbit target sits on a building, start on its hub-facing side looking at it
    const t = rig.controls.target;
    const it = buildings.items.find((b) => Math.abs(t.x - b.center.x) < b.size.x * 0.55 && Math.abs(t.z - b.center.z) < b.size.z * 0.55);
    if (it) {
      const d = new THREE.Vector2(-it.center.x, -it.center.z);
      if (d.lengthSq() < 1) d.set(0, 1);
      d.normalize();
      const dist = Math.max(it.size.x, it.size.z) * 0.5 + 10;
      const x = it.center.x + d.x * dist, z = it.center.z + d.y * dist;
      start = { x, z, yaw: Math.atan2(-(it.center.x - x), -(it.center.z - z)) };
    }
  }
  rig.setMode(m, start);
}

async function toggleMood() {
  if (!env || !state.entered) return;
  const next = state.mood === 'day' ? 'sunset' : 'day';
  await ui.fadeOut();
  try {
    await env.load(next, `${BASE}env/${next}.hdr`);
    env.apply(next, next === 'sunset' ? 1.0 : 1.0);
    state.mood = next;
    ui.setMoodIcon(next);
  } catch (e) {
    console.warn(e);
    ui.toast('Could not load that sky');
  }
  fitSun();
  ui.fadeIn();
}

async function enter() {
  state.entered = true;
  ui.hideLoader();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (params.has('skipintro') || reduced) {
    camera.position.copy(HOME.position); rig.controls.target.copy(HOME.target); rig.controls.update();
  } else {
    rig.flyTo(HOME, 7.5);
  }
  setTimeout(() => ui.toast(COMPANY.intro, 6500), 1600);
  ui.setHint('orbit');
}

// ---------------------------------------------------------------- pointer picking
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let pointer = { x: 0, y: 0, inside: false, dirty: false };
let down = null;

canvas.addEventListener('pointermove', (e) => {
  pointer = { x: e.clientX, y: e.clientY, inside: true, dirty: true };
});
canvas.addEventListener('pointerleave', () => { pointer.inside = false; state.hover = null; });
canvas.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: performance.now() };
  canvas.classList.add('dragging');
  if (e.pointerType !== 'mouse') pointer = { x: e.clientX, y: e.clientY, inside: true, dirty: true };
});
addEventListener('pointerup', (e) => {
  canvas.classList.remove('dragging');
  if (!down || e.target !== canvas) { down = null; return; }
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
  const quick = performance.now() - down.t < 700;
  down = null;
  if (moved > 6 || !quick || !buildings) return;
  const hit = pick(e.clientX, e.clientY);
  if (hit) select(hit);
});

function pick(x, y) {
  if (!buildings) return null;
  ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
  const cam = renderer.xr.isPresenting ? (renderer.xr.updateCamera(camera), renderer.xr.getCamera()) : camera;
  raycaster.setFromCamera(ndc, cam);
  const hits = raycaster.intersectObjects(buildings.proxies, false);
  return hits.length ? hits[0].object.userData.buildingId : null;
}

addEventListener('keydown', (e) => {
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || !state.entered) return;
  if (e.key === 'Escape') { if (!document.getElementById('help').hidden) ui.toggleHelp(false); else if (ui.panelOpen) closeSelection(true); }
  else if (e.code === 'KeyT') toggleMood();
  else if (e.code === 'KeyF') setMode(state.mode === 'walk' ? 'orbit' : 'walk');
  else if (e.code === 'KeyO') setMode('orbit');
  else if (e.code === 'KeyH') ui.toggleHelp();
  else if (/^Digit[1-9]$/.test(e.code)) { const b = BUILDINGS[Number(e.code.slice(5)) - 1]; if (b) select(b.id); }
});

// ---------------------------------------------------------------- per-frame
const v3 = new THREE.Vector3();
let last = performance.now(), time = 0, frameCount = 0;
let fpsAcc = 0, fpsFrames = 0, slowSeconds = 0, statTimer = 0, miniTimer = 0;

function frame(now, xrFrame) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  time += dt;
  frameCount++;

  if (state.arMode) {
    water.update(time);
    veg.setTime(time);
    veg.update(camera);
    fountain.update(time, camera, renderer);
    ar.update(xrFrame);
    renderer.info.reset();
    renderer.render(scene, camera);          // no post-processing / no OrbitControls while the phone is the camera
    return;
  }

  rig.update(dt);
  applyViewOffset(dt);
  fitSun();
  water.update(time);
  veg.setTime(time);
  veg.update(camera);
  fountain.update(time, camera, renderer);

  updateHover(dt);
  updatePins();
  miniTimer += dt;
  if (miniTimer > 0.06) { miniTimer = 0; ui.drawMinimap(rig.getMarker(), state.selected, state.hover); }

  renderer.info.reset();
  if (TIERS[tierName].post && post) post.render(dt, time);
  else renderer.render(scene, camera);

  // adaptive quality: if we stay under ~26 fps for 3 s, drop a tier
  fpsAcc += dt; fpsFrames++;
  if (fpsAcc >= 1) {
    const fps = fpsFrames / fpsAcc;
    slowSeconds = fps < 26 && time > 8 ? slowSeconds + 1 : 0;
    if (slowSeconds >= 3) { slowSeconds = 0; stepDownQuality(); }
    if (params.has('debug')) {
      const s = veg.stats();
      ui.setDebug(`fps ${fps.toFixed(0)}  tier ${tierName}\ncalls ${renderer.info.render.calls}  tris ${(renderer.info.render.triangles / 1e6).toFixed(2)}M\nveg draws ${s.draw}  tris ${(s.tris / 1e6).toFixed(2)}M\nmode ${state.mode}`);
    }
    fpsAcc = 0; fpsFrames = 0;
  }
}

function applyViewOffset(dt) {
  const target = state.entered ? ui.panelWidth * 0.5 : 0;
  const targetY = state.entered ? ui.panelHeight * 0.5 : 0;   // phones: panel is a bottom sheet, lift the scene above it
  viewShift = lerp(viewShift, target, 1 - Math.exp(-5 * dt));
  viewShiftY = lerp(viewShiftY, targetY, 1 - Math.exp(-5 * dt));
  if (Math.abs(viewShift) > 0.5 || Math.abs(viewShiftY) > 0.5) camera.setViewOffset(innerWidth, innerHeight, viewShift, viewShiftY, innerWidth, innerHeight);
  else if (camera.view?.enabled) camera.clearViewOffset();
}

function updateHover(dt) {
  if (pointer.dirty && pointer.inside && !down && buildings && state.entered && !rig.isTweening) {
    pointer.dirty = false;
    const id = pick(pointer.x, pointer.y);
    if (id !== state.hover) state.hover = id;
    ui.setCursor(!!id);
  }
  ui.setPinHot(state.hover);
  for (const it of buildings.items) {
    const target = it.id === state.hover ? 0.6 : it.id === state.selected ? 0.08 : 0;
    const cur = hl[it.id];
    if (Math.abs(cur - target) > 0.002) {
      hl[it.id] = lerp(cur, target, 1 - Math.exp(-9 * dt));
      buildings.setHighlight(it.id, hl[it.id]);
    }
  }
}

function updatePins() {
  if (!state.entered) return;
  const list = [];
  const W = innerWidth, H = innerHeight;
  for (const it of buildings.items) {
    v3.set(it.center.x, it.top.y + 5, it.center.z).project(camera);
    const dist = camera.position.distanceTo(it.center);
    const inView = v3.z < 1 && Math.abs(v3.x) < 1.15 && Math.abs(v3.y) < 1.15;
    const far = state.mode === 'walk' ? 260 : 900;
    const near = it.radius * 0.9;
    let opacity = inView ? smoothstep(far, far * 0.8, dist) * smoothstep(near * 0.6, near * 1.1, dist) : 0;
    if (state.selected && state.selected !== it.id) opacity *= 0.55;
    list.push({
      id: it.id, x: (v3.x * 0.5 + 0.5) * W, y: (-v3.y * 0.5 + 0.5) * H, opacity,
      selected: state.selected === it.id,
    });
  }
  ui.updatePins(list);
}

// debugging / testing hooks
window.__sv = {
  get scene() { return scene; }, get camera() { return camera; }, get rig() { return rig; }, get renderer() { return renderer; },
  get buildings() { return buildings; }, get state() { return state; }, get veg() { return veg; }, get fountain() { return fountain; },
  get islandRoot() { return islandRoot; }, get ar() { return ar; }, THREE,
  select, setMode, applyTier, toggleMood, goHome, HOME, viewFor,
  frames: () => frameCount,
};
