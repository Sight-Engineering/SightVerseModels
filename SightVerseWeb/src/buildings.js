// Loads the four company buildings, tunes their materials for realism, places them on the island
// and creates the invisible hit-boxes used for hover / click / collision.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { BUILDINGS } from './config.js';
import { heightAt } from './terrain.js';

const GLASS = /glass|glazing/i;

function tuneMaterials(root, aniso) {
  const mats = new Set();
  root.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => mats.add(m));
  });
  for (const m of mats) {
    for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'emissiveMap']) {
      if (m[k]) m[k].anisotropy = aniso;
    }
    // meshes exported without any material (e.g. the scanned Contact building) get glTF's default
    // fully-metallic white, which glows under HDRI light - give them a matte stone look instead
    if (!m.name && m.metalness === 1 && m.roughness === 1 && !m.map && !m.metalnessMap) {
      m.metalness = 0;
      m.roughness = 0.9;
      m.color.set(0xaea698);
    }
    const looksLikeGlass = GLASS.test(m.name) || (m.transparent && m.opacity < 0.75 && !m.map);
    if (looksLikeGlass) {
      m.transparent = true;
      m.opacity = Math.min(m.opacity, 0.32);
      m.roughness = 0.04;
      m.metalness = 0.0;
      m.envMapIntensity = 1.5;
      m.depthWrite = false;
      m.userData.isGlass = true;
    } else if (m.transparent && m.opacity >= 0.99 && !m.map && !m.alphaMap) {
      // opaque materials wrongly exported as BLEND cause sorting glitches
      m.transparent = false;
      m.depthWrite = true;
    }
    if (m.metalness > 0.6 && m.roughness < 0.05) m.roughness = 0.12; // mirror-like metals look fake without a real environment
  }
  return [...mats];
}

export async function loadBuildings({ aniso, onBytes, expectedBytes = {} }) {
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  const base = import.meta.env.BASE_URL + 'models/';
  const group = new THREE.Group();
  group.name = 'Buildings';

  const items = await Promise.all(BUILDINGS.map(async (cfg) => {
    let last = 0;
    const gltf = await loader.loadAsync(`${base}${cfg.model}.glb`, (e) => { onBytes?.(e.loaded - last); last = e.loaded; });
    const model = gltf.scene;
    const materials = tuneMaterials(model, aniso);

    const holder = new THREE.Group();
    holder.name = cfg.label;
    holder.add(model);
    holder.rotation.y = THREE.MathUtils.degToRad(cfg.rotationDeg || 0);
    const [x, z] = cfg.position;
    holder.position.set(x, heightAt(x, z) - 0.12 - (cfg.sink || 0), z);
    holder.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    // invisible hit-box for cheap hover / click tests
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(size.x, size.y, size.z),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    proxy.position.copy(center);
    proxy.userData.buildingId = cfg.id;
    proxy.name = 'hit-' + cfg.id;

    const highlightables = materials.filter((m) => !m.userData.isGlass);
    highlightables.forEach((m) => { m.userData.baseEmissive = m.emissive.clone(); m.userData.baseEmissiveIntensity = m.emissiveIntensity; });

    group.add(holder);
    return {
      id: cfg.id, cfg, holder, box, size, center, proxy, materials: highlightables,
      accent: new THREE.Color(cfg.accent),
      top: new THREE.Vector3(center.x, box.max.y, center.z),
      radius: Math.hypot(size.x, size.z) * 0.5,
    };
  }));

  const byId = Object.fromEntries(items.map((b) => [b.id, b]));

  /** amount 0..1 - a soft accent-coloured glow used for hover / selection */
  function setHighlight(id, amount) {
    const b = byId[id];
    if (!b) return;
    for (const m of b.materials) {
      if (amount <= 0.001) {
        m.emissive.copy(m.userData.baseEmissive);
        m.emissiveIntensity = m.userData.baseEmissiveIntensity;
      } else {
        m.emissive.copy(b.accent);
        m.emissiveIntensity = amount * 0.16;
      }
    }
  }

  return { group, items, byId, proxies: items.map((b) => b.proxy), setHighlight };
}
