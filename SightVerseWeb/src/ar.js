// WebXR "immersive-ar" support: place a scaled-down copy of the island on a real surface,
// then drag to rotate, pinch to resize, and tap a building to read about it - all through the
// browser, no app install. Handheld AR (ARCore via Chrome on Android) is mono, so this keeps
// the render path simple (no stereo, no post-processing) and reuses the app's own tap-to-select.

import * as THREE from 'three';

/** Resolves true only when the browser + device can actually start an immersive-ar session. */
export function arSessionSupported() {
  if (!navigator.xr?.isSessionSupported) return Promise.resolve(false);
  return navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
}

/**
 * @param {object} o
 * @param {THREE.WebGLRenderer} o.renderer
 * @param {THREE.Scene} o.scene
 * @param {THREE.PerspectiveCamera} o.camera
 * @param {THREE.Object3D} o.islandRoot - everything that should shrink onto the table
 * @param {number} o.scale - island-units -> metres scale once placed (e.g. 1.3 / islandSize)
 * @param {(x:number,y:number)=>string|null} o.pick - hit-tests the building proxies at a screen point
 * @param {(id:string)=>void} o.onSelectBuilding
 * @param {()=>void} o.onEnter
 * @param {()=>void} o.onExit
 * @param {(msg:string)=>void} o.toast
 */
export function createAR({ renderer, scene, camera, islandRoot, scale, pick, onSelectBuilding, onEnter, onExit, toast }) {
  const overlay = document.getElementById('ar-overlay');
  const hintEl = document.getElementById('ar-hint');
  const exitBtn = document.getElementById('ar-exit');
  const panelEl = document.getElementById('panel');
  const panelHome = panelEl.parentNode; // where the panel lives outside AR, so we can put it back

  const MIN_SCALE = scale * 0.35, MAX_SCALE = scale * 3;

  const reticle = new THREE.Mesh(
    new THREE.RingGeometry(0.07, 0.09, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x7dd3fc, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);

  let session = null, hitTestSource = null, hitTestSourceRequested = false;
  let placed = false, curScale = scale;
  let prevNear, prevFar, prevShadow;

  // ---------------------------------------------------------------- gestures (dom-overlay forwards real pointer events)
  const pts = new Map();
  let drag = null, rotStart = 0;
  let pinch = null, pinchScaleStart = 1;

  function ignore(e) { return !!e.target.closest('#ar-exit, #panel'); }

  function onPointerDown(e) {
    if (ignore(e)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      drag = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
      rotStart = islandRoot.rotation.y;
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = Math.hypot(a.x - b.x, a.y - b.y);
      pinchScaleStart = curScale;
      drag = null;
    }
  }
  function onPointerMove(e) {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      curScale = THREE.MathUtils.clamp(pinchScaleStart * (d / pinch), MIN_SCALE, MAX_SCALE);
      if (placed) islandRoot.scale.setScalar(curScale);
    } else if (pts.size === 1 && placed && drag) {
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 6 || Math.abs(e.clientY - drag.y) > 6) drag.moved = true;
      islandRoot.rotation.y = rotStart + dx * 0.012;
    }
  }
  function onPointerUp(e) {
    if (ignore(e)) { pts.delete(e.pointerId); return; }
    const wasSingleTap = pts.size === 1 && drag && !drag.moved && performance.now() - drag.t < 600;
    pts.delete(e.pointerId);
    if (pts.size === 0) pinch = null;
    if (wasSingleTap) {
      const id = placed ? pick(e.clientX, e.clientY) : null;
      if (id) onSelectBuilding(id);
      else if (reticle.visible) place();
    }
    if (pts.size < 1) drag = null;
  }

  function place() {
    islandRoot.position.setFromMatrixPosition(reticle.matrix);
    islandRoot.quaternion.setFromRotationMatrix(reticle.matrix);
    islandRoot.scale.setScalar(curScale);
    islandRoot.visible = true;
    placed = true;
    hintEl.textContent = 'Drag to turn it - pinch to resize - tap a building to read about it - tap open ground to move it';
  }

  async function enter() {
    if (!navigator.xr) { toast?.('AR is not available in this browser'); return; }
    let s;
    try {
      s = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay'],
        domOverlay: { root: overlay },
      });
    } catch (err) {
      console.error('[AR] requestSession failed:', err);
      toast?.('Could not start AR - ' + (err?.name ? err.name + ': ' : '') + (err?.message || err));
      return;
    }
    session = s;

    // tabletop placement wants a stable point near the device, not the runtime's own guess of the
    // floor - 'local' is the widely-supported baseline; fall back gracefully if a browser rejects it.
    try { renderer.xr.setReferenceSpaceType('local'); } catch (err) { console.warn('[AR] setReferenceSpaceType failed:', err); }

    islandRoot.visible = false;
    islandRoot.rotation.set(0, 0, 0);
    placed = false;
    curScale = scale;

    prevNear = camera.near; prevFar = camera.far;
    camera.near = 0.05; camera.far = 60; camera.updateProjectionMatrix();
    prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;

    panelHome._arReturn = panelEl.nextSibling; // remember exact spot so it can go back untouched
    overlay.appendChild(panelEl);

    hintEl.textContent = 'Move your phone to find a flat surface, then tap to place the island';
    overlay.hidden = false;
    document.body.classList.add('ar-active');

    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointercancel', onPointerUp);

    session.addEventListener('end', onSessionEnd);
    try {
      await renderer.xr.setSession(session);
    } catch (err) {
      console.error('[AR] renderer.xr.setSession failed:', err);
      toast?.('Could not start AR - ' + (err?.name ? err.name + ': ' : '') + (err?.message || err));
      await session.end().catch(() => {});
      return;
    }
    onEnter?.();
  }

  function onSessionEnd() {
    overlay.removeEventListener('pointerdown', onPointerDown);
    overlay.removeEventListener('pointermove', onPointerMove);
    overlay.removeEventListener('pointerup', onPointerUp);
    overlay.removeEventListener('pointercancel', onPointerUp);
    overlay.hidden = true;
    document.body.classList.remove('ar-active');

    if (panelHome._arReturn) panelHome.insertBefore(panelEl, panelHome._arReturn);
    else panelHome.appendChild(panelEl);

    reticle.visible = false;
    hitTestSource = null; hitTestSourceRequested = false; session = null;
    pts.clear(); drag = null; pinch = null;

    islandRoot.visible = true;
    islandRoot.position.set(0, 0, 0);
    islandRoot.rotation.set(0, 0, 0);
    islandRoot.scale.setScalar(1);

    camera.near = prevNear; camera.far = prevFar; camera.updateProjectionMatrix();
    renderer.shadowMap.enabled = prevShadow;

    onExit?.();
  }

  exitBtn.addEventListener('click', () => session?.end());

  /** Call once per frame from the app's own animation loop while presenting, with the XRFrame. */
  function update(xrFrame) {
    if (!xrFrame || !session) return;
    if (!hitTestSourceRequested) {
      hitTestSourceRequested = true;
      session.requestReferenceSpace('viewer').then((viewerSpace) => {
        session.requestHitTestSource({ space: viewerSpace }).then((src) => { hitTestSource = src; });
      }).catch(() => {});
    }
    const refSpace = renderer.xr.getReferenceSpace();
    if (hitTestSource && refSpace) {
      const results = xrFrame.getHitTestResults(hitTestSource);
      if (results.length) {
        const pose = results[0].getPose(refSpace);
        reticle.visible = true;
        reticle.matrix.fromArray(pose.transform.matrix);
      } else {
        reticle.visible = false;
      }
    }
  }

  return { enter, update, get active() { return !!session; } };
}
