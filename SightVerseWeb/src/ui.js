// All DOM-side behaviour: loader, top bar, pins, info panel, minimap, help, toasts, joystick.

import { BUILDINGS, COMPANY } from './config.js';
import { clamp } from './util.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ICON = {
  mail: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m4 7 8 6 8-6"/></svg>',
  phone: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/></svg>',
  map: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
};

export function createUI(h) {
  const el = {
    loader: $('#loader'), fill: $('#loader-fill'), pct: $('#loader-pct'), label: $('#loader-label'),
    enter: $('#enter-btn'), note: $('#loader-note'),
    topbar: $('#topbar'), nav: $('#nav'), pins: $('#pins'), hint: $('#hint'),
    minimap: $('#minimap'), mmCanvas: $('#minimap-canvas'),
    panel: $('#panel'), panelScroll: $('#panel-scroll'), panelFoot: $('#panel-foot'),
    help: $('#help'), toast: $('#toast'), fade: $('#fade'), joystick: $('#joystick'),
    btnOrbit: $('#btn-orbit'), btnWalk: $('#btn-walk'), btnMood: $('#btn-mood'), debug: $('#debug'),
    canvas: $('#scene'), btnAR: $('#btn-ar'),
  };
  $('#loader-tag').textContent = COMPANY.tagline;

  // ------------------------------------------------------------ nav + pins
  BUILDINGS.forEach((b, i) => {
    const n = document.createElement('button');
    n.type = 'button';
    n.dataset.id = b.id;
    n.textContent = b.label;
    n.style.setProperty('--nav-accent', b.accent);
    n.addEventListener('click', () => h.onSelect(b.id));
    el.nav.appendChild(n);

    const p = document.createElement('button');
    p.type = 'button';
    p.className = 'pin';
    p.dataset.id = b.id;
    p.style.setProperty('--pin', b.accent);
    p.innerHTML = `<span class="dot">${i + 1}</span><span>${esc(b.label)}</span>`;
    p.addEventListener('click', () => h.onSelect(b.id));
    p.addEventListener('pointerenter', () => h.onPinHover(b.id));
    p.addEventListener('pointerleave', () => h.onPinHover(null));
    el.pins.appendChild(p);
  });
  const pinEls = Object.fromEntries([...el.pins.children].map((p) => [p.dataset.id, p]));
  const navEls = Object.fromEntries([...el.nav.children].map((n) => [n.dataset.id, n]));

  // ------------------------------------------------------------ loader
  let shownPct = 0;
  const ui = {
    el,
    setProgress(p, label) {
      shownPct = Math.max(shownPct, clamp(p, 0, 1));
      el.fill.style.width = (shownPct * 100).toFixed(1) + '%';
      el.pct.textContent = Math.round(shownPct * 100) + '%';
      if (label) el.label.textContent = label;
    },
    ready(onEnter) {
      ui.setProgress(1, 'Ready');
      el.enter.hidden = false;
      el.enter.focus({ preventScroll: true });
      el.enter.addEventListener('click', () => onEnter(), { once: true });
    },
    fail(message) {
      el.label.textContent = 'Something went wrong';
      el.note.hidden = false;
      el.note.textContent = message;
    },
    hideLoader() {
      el.loader.classList.add('done');
      setTimeout(() => el.loader.remove(), 1200);
      el.topbar.hidden = false;
      el.minimap.hidden = false;
      el.hint.hidden = false;
    },

    // ------------------------------------------------------------ mode / mood
    setMode(mode) {
      el.btnOrbit.classList.toggle('on', mode === 'orbit');
      el.btnWalk.classList.toggle('on', mode === 'walk');
      ui.setHint(mode);
      const touch = matchMedia('(pointer: coarse)').matches;
      el.joystick.hidden = !(mode === 'walk' && touch);
    },
    setHint(mode) {
      el.hint.classList.remove('faded');
      el.hint.innerHTML = mode === 'walk'
        ? '<b>W A S D</b> move &nbsp;·&nbsp; <b>Drag</b> look &nbsp;·&nbsp; <b>Shift</b> run &nbsp;·&nbsp; <b>Click</b> a building'
        : '<b>Drag</b> rotate &nbsp;·&nbsp; <b>Scroll</b> zoom &nbsp;·&nbsp; <b>Right-drag</b> pan &nbsp;·&nbsp; <b>Click</b> a building';
      clearTimeout(ui._hintTimer);
      ui._hintTimer = setTimeout(() => el.hint.classList.add('faded'), 9000);
    },
    fadeHint() { el.hint.classList.add('faded'); },
    setMoodIcon(mood) { el.btnMood.title = mood === 'day' ? 'Switch to sunset (T)' : 'Switch to daytime (T)'; },

    // ------------------------------------------------------------ pins
    updatePins(list) {
      for (const p of list) {
        const e = pinEls[p.id];
        if (!e) continue;
        e.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) translate(-50%, -100%)`;
        e.style.opacity = p.opacity.toFixed(2);
        e.style.pointerEvents = p.opacity > 0.4 ? 'auto' : 'none';
        e.classList.toggle('sel', !!p.selected);
      }
    },
    setPinHot(id) { for (const [k, e] of Object.entries(pinEls)) e.classList.toggle('hot', k === id); },

    // ------------------------------------------------------------ panel
    setActiveNav(id) {
      for (const [k, n] of Object.entries(navEls)) n.classList.toggle('on', k === id);
      if (id) {
        const b = BUILDINGS.find((x) => x.id === id);
        document.documentElement.style.setProperty('--accent', b.accent);
      } else document.documentElement.style.setProperty('--accent', '#7dd3fc');
    },
    openPanel(id) {
      const i = BUILDINGS.findIndex((b) => b.id === id);
      const b = BUILDINGS[i];
      const prev = BUILDINGS[(i + BUILDINGS.length - 1) % BUILDINGS.length];
      const next = BUILDINGS[(i + 1) % BUILDINGS.length];
      let html = `<div class="p-stagger">
        <p class="p-kicker">${esc(b.kicker)}</p>
        <h2 class="p-title" id="panel-title">${esc(b.title)}</h2>
        <p class="p-summary">${esc(b.summary)}</p>`;
      if (b.facts?.length) {
        html += '<div class="p-facts">' + b.facts.map((f) => `<div class="p-fact"><b>${esc(f.value)}</b><span>${esc(f.label)}</span></div>`).join('') + '</div>';
      }
      for (const s of b.sections || []) html += `<div class="p-sec"><h3>${esc(s.heading)}</h3><p>${esc(s.body)}</p></div>`;
      if (b.clients?.length) html += '<div class="p-tags">' + b.clients.map((c) => `<span>${esc(c)}</span>`).join('') + '</div>';
      if (b.contact) {
        const c = b.contact;
        html += '<div class="p-contact">';
        if (c.email) html += `<a class="p-row" href="mailto:${esc(c.email)}">${ICON.mail}<div><small>Email</small><span>${esc(c.email)}</span></div></a>`;
        if (c.phone) html += `<a class="p-row" href="tel:${esc(c.phone.replace(/[^+\d]/g, ''))}">${ICON.phone}<div><small>Phone</small><span>${esc(c.phone)}</span></div></a>`;
        if (c.address) html += `<a class="p-row" href="https://www.google.com/maps/search/?api=1&amp;query=30.513703397796526%2C47.80720650055131" target="_blank" rel="noopener noreferrer" aria-label="Open address in Google Maps (new tab)">${ICON.map}<div><small>Address · View on map ↗</small><span>${esc(c.address)}</span></div></a>`;
        if (c.hours) html += `<div class="p-row">${ICON.clock}<div><small>Hours</small><span>${esc(c.hours)}</span></div></div>`;
        if (c.links?.length) html += '<div class="p-links">' + c.links.map((l) => `<a class="btn ghost" target="_blank" rel="noopener" href="${esc(l.url)}">${esc(l.label)}</a>`).join('') + '</div>';
        html += '</div>';
      }
      html += '</div>';
      el.panelScroll.innerHTML = html;
      [...el.panelScroll.querySelector('.p-stagger').children].forEach((c, k) => { c.style.animationDelay = 0.12 + k * 0.06 + 's'; });
      el.panelScroll.scrollTop = 0;

      const cta = b.cta
        ? `<button class="btn" type="button" data-goto="${esc(b.cta.goto)}">${esc(b.cta.label)}</button>`
        : b.contact?.email ? `<a class="btn" href="mailto:${esc(b.contact.email)}">Send an email</a>` : '';
      el.panelFoot.innerHTML = `${cta}<span class="grow"></span>
        <button class="btn ghost" type="button" data-goto="${prev.id}" aria-label="Previous: ${esc(prev.label)}">&#8592;</button>
        <button class="btn ghost" type="button" data-goto="${next.id}" aria-label="Next: ${esc(next.label)}">&#8594;</button>`;
      el.panel.classList.add('open');
      el.panel.setAttribute('aria-hidden', 'false');
      ui.setActiveNav(id);
    },
    closePanel() {
      el.panel.classList.remove('open');
      el.panel.setAttribute('aria-hidden', 'true');
      ui.setActiveNav(null);
    },
    get panelOpen() { return el.panel.classList.contains('open'); },
    get panelWidth() { return el.panel.classList.contains('open') && window.innerWidth > 720 ? el.panel.getBoundingClientRect().width + 18 : 0; },

    get panelHeight() { return el.panel.classList.contains('open') && window.innerWidth <= 720 ? el.panel.getBoundingClientRect().height + 8 : 0; },

    // ------------------------------------------------------------ toasts, help, fade
    toast(msg, ms = 2600) {
      el.toast.textContent = msg;
      el.toast.hidden = false;
      clearTimeout(ui._toastTimer);
      ui._toastTimer = setTimeout(() => { el.toast.hidden = true; }, ms);
    },
    toggleHelp(force) { el.help.hidden = force === undefined ? !el.help.hidden : !force; },
    fadeOut() { el.fade.classList.add('on'); return new Promise((r) => setTimeout(r, 380)); },
    fadeIn() { el.fade.classList.remove('on'); },
    setCursor(pointer) { el.canvas.classList.toggle('pointer', !!pointer); },
    setDebug(text) { el.debug.hidden = false; el.debug.textContent = text; },

    // ------------------------------------------------------------ AR
    setARAvailable(ok) { if (el.btnAR) el.btnAR.hidden = !ok; },
    setARMode(active) { document.body.classList.toggle('ar-active', active); },
  };

  el.panelFoot.addEventListener('click', (e) => {
    const g = e.target.closest('[data-goto]');
    if (g) h.onSelect(g.dataset.goto);
  });
  $('#panel-close').addEventListener('click', () => h.onClose());
  $('#help-close').addEventListener('click', () => ui.toggleHelp(false));
  $('#btn-help').addEventListener('click', () => ui.toggleHelp());
  el.btnOrbit.addEventListener('click', () => h.onMode('orbit'));
  el.btnWalk.addEventListener('click', () => h.onMode('walk'));
  el.btnMood.addEventListener('click', () => h.onMood());
  el.btnAR?.addEventListener('click', () => h.onAR());
  $('#btn-fs').addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.documentElement.requestFullscreen?.().catch(() => {});
  });

  // ------------------------------------------------------------ joystick (touch)
  {
    let id = null;
    const stick = el.joystick.querySelector('.stick');
    const set = (e) => {
      const r = el.joystick.getBoundingClientRect();
      let dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
      const max = r.width / 2 - 10;
      const d = Math.hypot(dx, dy);
      if (d > max) { dx *= max / d; dy *= max / d; }
      stick.style.transform = `translate(${dx}px, ${dy}px)`;
      h.onJoystick(dx / max, -dy / max);
    };
    el.joystick.addEventListener('pointerdown', (e) => { id = e.pointerId; el.joystick.setPointerCapture(id); set(e); });
    el.joystick.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e) => { if (e.pointerId !== id) return; id = null; stick.style.transform = ''; h.onJoystick(0, 0); };
    el.joystick.addEventListener('pointerup', end);
    el.joystick.addEventListener('pointercancel', end);
  }

  // ------------------------------------------------------------ minimap
  const MAP_EXTENT = 520; // metres shown across the map
  let mmBase = null;
  const mmCtx = el.mmCanvas.getContext('2d');
  const W = el.mmCanvas.width;
  const toMap = (x, z) => [(x / MAP_EXTENT + 0.5) * W, (z / MAP_EXTENT + 0.5) * W];

  ui.initMinimap = ({ heightGrid, size, buildings, paths }) => {
    const base = document.createElement('canvas');
    base.width = base.height = W;
    const g = base.getContext('2d');
    const img = g.createImageData(W, W);
    const G = heightGrid.size, H = heightGrid.data;
    const sample = (x, z) => {
      const gx = clamp(Math.round((x / size + 0.5) * G - 0.5), 1, G - 2), gz = clamp(Math.round((z / size + 0.5) * G - 0.5), 1, G - 2);
      return H[gz * G + gx];
    };
    for (let py = 0; py < W; py++) {
      for (let px = 0; px < W; px++) {
        const x = (px / W - 0.5) * MAP_EXTENT, z = (py / W - 0.5) * MAP_EXTENT;
        const hgt = sample(x, z);
        const shade = clamp(0.92 + (sample(x - 3, z - 3) - sample(x + 3, z + 3)) * 0.05, 0.75, 1.15);
        let r, gg, b;
        if (hgt < -7) [r, gg, b] = [9, 36, 52];
        else if (hgt < 0) { const t = (hgt + 7) / 7; [r, gg, b] = [9 + t * 30, 36 + t * 100, 52 + t * 96]; }
        else if (hgt < 1.2) [r, gg, b] = [222, 205, 158];
        else if (hgt < 9) { const t = clamp((hgt - 1.2) / 8, 0, 1); [r, gg, b] = [104 - t * 34, 146 - t * 32, 82 - t * 22]; }
        else [r, gg, b] = [128, 124, 112];
        if (hgt >= 0) { r *= shade; gg *= shade; b *= shade; }
        const o = (py * W + px) * 4;
        img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
    // paths
    g.strokeStyle = 'rgba(235,225,200,0.75)';
    g.lineWidth = 2.2; g.lineCap = 'round'; g.lineJoin = 'round';
    for (const pts of paths) {
      g.beginPath();
      pts.forEach((p, i) => { const [mx, my] = toMap(p.x, p.z); i ? g.lineTo(mx, my) : g.moveTo(mx, my); });
      g.stroke();
    }
    g.fillStyle = 'rgba(235,225,200,0.75)';
    g.beginPath(); g.arc(...toMap(0, 0), 30 / MAP_EXTENT * W, 0, Math.PI * 2); g.fill();
    mmBase = { canvas: base, buildings };
  };

  ui.drawMinimap = (marker, selectedId, hoverId) => {
    if (!mmBase) return;
    mmCtx.clearRect(0, 0, W, W);
    mmCtx.drawImage(mmBase.canvas, 0, 0);
    mmBase.buildings.forEach((b, i) => {
      const [x, y] = toMap(b.center.x, b.center.z);
      const on = b.id === selectedId || b.id === hoverId;
      mmCtx.beginPath();
      mmCtx.arc(x, y, on ? 17 : 13, 0, Math.PI * 2);
      mmCtx.fillStyle = b.cfg.accent;
      mmCtx.fill();
      mmCtx.lineWidth = on ? 4 : 3;
      mmCtx.strokeStyle = '#0a1218';
      mmCtx.stroke();
      mmCtx.fillStyle = '#061016';
      mmCtx.font = '700 15px Inter, system-ui, sans-serif';
      mmCtx.textAlign = 'center'; mmCtx.textBaseline = 'middle';
      mmCtx.fillText(String(i + 1), x, y + 1);
    });
    const [mx, my] = toMap(marker.x, marker.z);
    const ang = Math.atan2(-Math.cos(marker.heading), -Math.sin(marker.heading));
    mmCtx.save();
    mmCtx.translate(mx, my); mmCtx.rotate(ang);
    const grad = mmCtx.createRadialGradient(0, 0, 0, 0, 0, 70);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    mmCtx.fillStyle = grad;
    mmCtx.beginPath(); mmCtx.moveTo(0, 0); mmCtx.arc(0, 0, 70, -0.55, 0.55); mmCtx.closePath(); mmCtx.fill();
    mmCtx.fillStyle = '#fff'; mmCtx.strokeStyle = '#0a1218'; mmCtx.lineWidth = 3;
    mmCtx.beginPath(); mmCtx.moveTo(13, 0); mmCtx.lineTo(-9, 9); mmCtx.lineTo(-5, 0); mmCtx.lineTo(-9, -9); mmCtx.closePath();
    mmCtx.stroke(); mmCtx.fill();
    mmCtx.restore();
  };

  el.minimap.addEventListener('click', (e) => {
    const r = el.mmCanvas.getBoundingClientRect();
    const u = (e.clientX - r.left) / r.width, v = (e.clientY - r.top) / r.height;
    if ((u - 0.5) ** 2 + (v - 0.5) ** 2 > 0.25) return;
    h.onMinimap((u - 0.5) * MAP_EXTENT, (v - 0.5) * MAP_EXTENT);
  });

  return ui;
}
