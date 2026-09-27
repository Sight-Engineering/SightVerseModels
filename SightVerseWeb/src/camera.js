// Camera rig: cinematic orbit (rotate / zoom / pan) + first-person walk mode + smooth fly-to.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { clamp, lerp, angleDelta, easeInOutCubic } from './util.js';
import { heightAt } from './terrain.js';

const EYE = 1.75;
const ISLAND_LIMIT = 232;

export class CameraRig {
  constructor({ camera, dom, colliders = [] }) {
    this.camera = camera;
    this.dom = dom;
    this.colliders = colliders;
    this.mode = 'orbit';
    this.tween = null;
    this.listeners = new Set();

    const c = (this.controls = new OrbitControls(camera, dom));
    c.enableDamping = true;
    c.dampingFactor = 0.07;
    c.rotateSpeed = 0.55;
    c.zoomSpeed = 0.9;
    c.zoomToCursor = true;
    c.screenSpacePanning = false;
    c.minDistance = 6;
    c.maxDistance = 620;
    c.minPolarAngle = 0.1;
    c.maxPolarAngle = Math.PI * 0.492;
    c.panSpeed = 0.9;

    // walk state
    this.walk = {
      x: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, t: 0,
      keys: new Set(), joy: new THREE.Vector2(), look: new THREE.Vector2(), dragging: false, moved: 0,
    };

    this._bindInput();
  }

  onChange(fn) { this.listeners.add(fn); }
  _emit() { this.listeners.forEach((fn) => fn(this.mode)); }
  get isTweening() { return !!this.tween; }

  // ------------------------------------------------------------------ input
  _bindInput() {
    const dom = this.dom;
    const typing = (e) => /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '');
    window.addEventListener('keydown', (e) => {
      if (typing(e)) return;
      this.walk.keys.add(e.code);
      if (this.mode === 'walk' && /^(Arrow|Space)/.test(e.code)) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.walk.keys.delete(e.code));
    window.addEventListener('blur', () => this.walk.keys.clear());

    // cancel a fly-to when the user grabs the camera
    const cancel = () => { if (this.tween) this.cancelTween(); };
    dom.addEventListener('pointerdown', cancel);
    dom.addEventListener('wheel', cancel, { passive: true });

    // drag-to-look in walk mode
    let id = null, lx = 0, ly = 0;
    dom.addEventListener('pointerdown', (e) => {
      if (this.mode !== 'walk' || e.pointerType === 'touch' && e.clientX < window.innerWidth * 0.4) return;
      if (e.button !== 0 && e.pointerType === 'mouse') return;
      id = e.pointerId; lx = e.clientX; ly = e.clientY; this.walk.moved = 0;
      dom.setPointerCapture?.(id);
    });
    dom.addEventListener('pointermove', (e) => {
      if (this.mode !== 'walk' || e.pointerId !== id) return;
      const dx = e.clientX - lx, dy = e.clientY - ly;
      lx = e.clientX; ly = e.clientY;
      this.walk.moved += Math.abs(dx) + Math.abs(dy);
      this.walk.yaw -= dx * 0.0034;
      this.walk.pitch = clamp(this.walk.pitch - dy * 0.0034, -1.25, 1.25);
    });
    const end = (e) => { if (e.pointerId === id) { id = null; dom.releasePointerCapture?.(e.pointerId); } };
    dom.addEventListener('pointerup', end);
    dom.addEventListener('pointercancel', end);
  }

  setJoystick(x, y) { this.walk.joy.set(x, y); }

  /** smoothly turn the walker to face a world position */
  faceToward(x, z) {
    this.faceTarget = Math.atan2(-(x - this.walk.x), -(z - this.walk.z));
  }

  // ------------------------------------------------------------------ fly-to
  flyTo({ position, target }, duration = 2.4) {
    this.cancelTween();
    const cam = this.camera;
    const fromT = this.controls.target.clone();
    const fromS = new THREE.Spherical().setFromVector3(cam.position.clone().sub(fromT));
    const toS = new THREE.Spherical().setFromVector3(position.clone().sub(target));
    const travel = fromT.distanceTo(target) + cam.position.distanceTo(position) * 0.5;
    const lift = clamp(travel * 0.18, 0, 90);
    return new Promise((resolve) => {
      this.tween = { t: 0, duration, fromT, toT: target.clone(), fromS, toS, lift, resolve };
      this.controls.enabled = false;
    });
  }

  cancelTween() {
    if (!this.tween) return;
    const { resolve } = this.tween;
    this.tween = null;
    if (this.mode === 'orbit') this.controls.enabled = true;
    resolve?.(false);
  }

  _stepTween(dt) {
    const tw = this.tween;
    tw.t = Math.min(1, tw.t + dt / tw.duration);
    const k = easeInOutCubic(tw.t);
    const arc = Math.sin(Math.PI * k);
    const target = new THREE.Vector3().lerpVectors(tw.fromT, tw.toT, k);
    const s = new THREE.Spherical(
      lerp(tw.fromS.radius, tw.toS.radius, k) + arc * tw.lift,
      clamp(lerp(tw.fromS.phi, tw.toS.phi, k) - arc * 0.10, 0.12, Math.PI * 0.49),
      tw.fromS.theta + angleDelta(tw.fromS.theta, tw.toS.theta) * k,
    );
    this.controls.target.copy(target);
    this.camera.position.copy(target).add(new THREE.Vector3().setFromSpherical(s));
    this.camera.lookAt(target);
    if (tw.t >= 1) {
      const { resolve } = tw;
      this.tween = null;
      if (this.mode === 'orbit') { this.controls.enabled = true; this.controls.update(); }
      resolve?.(true);
    }
  }

  // ------------------------------------------------------------------ modes
  setMode(mode, start) {
    if (mode === this.mode) return;
    const cam = this.camera;
    this.cancelTween();
    if (mode === 'walk') {
      const dir = new THREE.Vector3();
      cam.getWorldDirection(dir);
      const t = this.controls.target;
      // start where the orbit target is (clamped to land), facing the same way
      let x = t.x, z = t.z;
      if (Math.hypot(x, z) > ISLAND_LIMIT * 0.8) { x *= 0.6; z *= 0.6; }
      Object.assign(this.walk, { x, z, yaw: Math.atan2(-dir.x, -dir.z), pitch: -0.04, vx: 0, vz: 0 });
      if (start) Object.assign(this.walk, start);
      this._resolveCollisions();
      this.controls.enabled = false;
      this.mode = 'walk';
      cam.position.set(this.walk.x, heightAt(this.walk.x, this.walk.z) + EYE + 25, this.walk.z);
    } else {
      const w = this.walk;
      const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw);
      const ground = heightAt(w.x, w.z);
      this.mode = 'orbit';
      this.controls.target.set(w.x + fx * 26, ground + 2, w.z + fz * 26);
      cam.position.set(w.x - fx * 18, ground + 22, w.z - fz * 18);
      cam.rotation.order = 'XYZ';
      cam.lookAt(this.controls.target);
      this.controls.enabled = true;
      this.controls.update();
    }
    this._emit();
  }

  /** ground position + heading the minimap should show */
  getMarker() {
    if (this.mode === 'walk') return { x: this.walk.x, z: this.walk.z, heading: this.walk.yaw };
    const p = this.camera.position, t = this.controls.target;
    return { x: t.x, z: t.z, heading: Math.atan2(-(t.x - p.x), -(t.z - p.z)) };
  }

  // ------------------------------------------------------------------ per-frame
  update(dt) {
    if (this.tween) { this._stepTween(dt); return; }
    if (this.mode === 'orbit') this._updateOrbit();
    else this._updateWalk(dt);
  }

  _updateOrbit() {
    const c = this.controls, cam = this.camera;
    const t = c.target;
    const r = Math.hypot(t.x, t.z);
    if (r > ISLAND_LIMIT) { t.x *= ISLAND_LIMIT / r; t.z *= ISLAND_LIMIT / r; }
    t.y = clamp(t.y, 0, 70);
    c.update();
    const floor = Math.max(2.2, heightAt(cam.position.x, cam.position.z) + 2.0);
    if (cam.position.y < floor) cam.position.y = floor;
  }

  _updateWalk(dt) {
    const w = this.walk, cam = this.camera;
    const k = w.keys;
    let ix = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let iz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    ix += w.joy.x; iz += w.joy.y;
    const mag = Math.hypot(ix, iz);
    if (mag > 1) { ix /= mag; iz /= mag; }
    const sprint = k.has('ShiftLeft') || k.has('ShiftRight');

    const fx = -Math.sin(w.yaw), fz = -Math.cos(w.yaw);
    const rx = Math.cos(w.yaw), rz = -Math.sin(w.yaw);
    const maxSpeed = sprint ? 9 : 4.2;
    const tvx = (fx * iz + rx * ix) * maxSpeed;
    const tvz = (fz * iz + rz * ix) * maxSpeed;
    if (this.faceTarget !== undefined) {
      const dy = angleDelta(w.yaw, this.faceTarget);
      w.yaw += dy * (1 - Math.exp(-5 * dt));
      w.pitch = lerp(w.pitch, -0.02, 1 - Math.exp(-5 * dt));
      if (Math.abs(dy) < 0.01) this.faceTarget = undefined;
    }
    const a = 1 - Math.exp(-9 * dt);
    w.vx = lerp(w.vx, tvx, a);
    w.vz = lerp(w.vz, tvz, a);

    const nx = w.x + w.vx * dt, nz = w.z + w.vz * dt;
    const canStand = (x, z) => heightAt(x, z) > 0.25 && Math.hypot(x, z) < ISLAND_LIMIT;
    if (canStand(nx, nz)) { w.x = nx; w.z = nz; }
    else if (canStand(nx, w.z)) w.x = nx;
    else if (canStand(w.x, nz)) w.z = nz;
    this._resolveCollisions();

    const moving = Math.hypot(w.vx, w.vz);
    w.t += dt * (moving > 0.2 ? 1 : 0) * (sprint ? 1.5 : 1);
    const bob = Math.sin(w.t * 9) * 0.03 * Math.min(1, moving / 4);
    const targetY = heightAt(w.x, w.z) + EYE + bob;
    cam.position.x = w.x;
    cam.position.z = w.z;
    cam.position.y = lerp(cam.position.y, targetY, 1 - Math.exp(-12 * dt));
    cam.rotation.order = 'YXZ';
    cam.rotation.set(w.pitch, w.yaw, 0);
  }

  _resolveCollisions() {
    const w = this.walk, r = 0.8;
    for (const b of this.colliders) {
      if (b.kind === 'disc') {                       // round obstacle (fountain basin)
        const dx = w.x - b.x, dz = w.z - b.z, d = Math.hypot(dx, dz), lim = b.r + r;
        if (d < lim) { const k = d > 1e-4 ? lim / d : 0; w.x = b.x + (d > 1e-4 ? dx * k : lim); w.z = b.z + dz * k; }
        continue;
      }
      if (b.kind === 'ring') {                       // flower beds: solid ring with walkways (gaps) cut through it
        const d = Math.hypot(w.x, w.z);
        if (d < b.r0 - r || d > b.r1 + r) continue;
        const az = Math.atan2(w.x, w.z);
        let bestG = 0, bestA = Infinity;
        for (const g of b.gaps) { const a = Math.abs(angleDelta(az, g)); if (a < bestA) { bestA = a; bestG = g; } }
        const lat = (bestA - (b.gapHalf - r / d)) * d;            // how far inside the solid, measured sideways
        if (lat <= 0) continue;                                    // inside a walkway
        const pIn = d - (b.r0 - r), pOut = (b.r1 + r) - d;
        if (pIn <= pOut && pIn <= lat) { const k = (b.r0 - r) / d; w.x *= k; w.z *= k; }
        else if (pOut <= lat) { const k = (b.r1 + r) / d; w.x *= k; w.z *= k; }
        else {
          const side = angleDelta(bestG, az) >= 0 ? 1 : -1;
          const na = bestG + side * (b.gapHalf - r / d);
          w.x = Math.sin(na) * d; w.z = Math.cos(na) * d;
        }
        continue;
      }
      const x = clamp(w.x, b.minX, b.maxX), z = clamp(w.z, b.minZ, b.maxZ);
      const dx = w.x - x, dz = w.z - z;
      const inside = w.x > b.minX && w.x < b.maxX && w.z > b.minZ && w.z < b.maxZ;
      if (inside) {
        const pl = w.x - b.minX, pr = b.maxX - w.x, pt = w.z - b.minZ, pb = b.maxZ - w.z;
        const m = Math.min(pl, pr, pt, pb);
        if (m === pl) w.x = b.minX - r; else if (m === pr) w.x = b.maxX + r;
        else if (m === pt) w.z = b.minZ - r; else w.z = b.maxZ + r;
      } else {
        const d = Math.hypot(dx, dz);
        if (d < r && d > 1e-4) { w.x = x + (dx / d) * r; w.z = z + (dz / d) * r; }
      }
    }
  }
}
