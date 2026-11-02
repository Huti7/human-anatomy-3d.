import * as THREE from 'three';
import { OrbitControls } from '../lib/OrbitControls.js';
import { MeshoptDecoder } from '../lib/meshopt_decoder.module.js';
import { computeBoundsTree, acceleratedRaycast } from '../lib/three-mesh-bvh.module.js';
import { INFO } from './data.js';
import { EXPLANATIONS, SYSTEM_NOTES, SOURCE_SYSTEMS } from './explanations.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// ---------------------------------------------------------------------------
// systems
// ---------------------------------------------------------------------------
const ICONS = {
  skin: '',
  bones: '<path d="M8.6 8.6l6.8 6.8"/><circle cx="6.2" cy="8" r="2.1"/><circle cx="8" cy="6.2" r="2.1"/><circle cx="16" cy="17.8" r="2.1"/><circle cx="17.8" cy="16" r="2.1"/>',
  muscles: '<path d="M4 8c2.7-2.6 5.3-2.6 8 0s5.3 2.6 8 0M4 12.5c2.7-2.6 5.3-2.6 8 0s5.3 2.6 8 0M4 17c2.7-2.6 5.3-2.6 8 0s5.3 2.6 8 0"/>',
  nerves: '<path d="M9 9V6.5a2.5 2.5 0 1 0-2.5 2.5H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0v2.5a2.5 2.5 0 1 0 2.5-2.5H15zm0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 15H9z"/>',
  joints: '<path d="M4 6l16 12V6L4 18z"/>',
  vessels: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  lymph: '<circle cx="12" cy="7.5" r="3.3"/><circle cx="7.6" cy="12.6" r="3.3"/><circle cx="16.4" cy="12.6" r="3.3"/><path d="M12 13.5v7M10 20.5h4"/>',
  organs: '<circle cx="12" cy="12" r="8"/><path d="M4 12h16a8 8 0 0 1-16 0z" fill="currentColor" stroke="none"/>',
};
const LAYERS = [
  { id: 'skin', name: 'Skin', hint: 'Show complete outer surface', color: '#d8b394' },
  { id: 'bones', name: 'Bones & cartilage', color: '#b9a98a' },
  { id: 'muscles', name: 'Muscles', color: '#b4473b' },
  { id: 'nerves', name: 'Nervous system', color: '#b8942c' },
  { id: 'joints', name: 'Joints & ligaments', color: '#4f9a92' },
  { id: 'vessels', name: 'Heart & vessels', color: '#b04a5a' },
  { id: 'lymph', name: 'Lymphatic system', color: '#6f925f' },
  { id: 'organs', name: 'Internal organs', color: '#a2775a' },
];
const LAYER = Object.fromEntries(LAYERS.map((l) => [l.id, l]));
// colour of each structure, by its source system
const PART_COLOR = {
  skeletal: 0xe9e1cb, borrowed: 0xc3c9cc, muscular: 0xb8432f, 'donor-muscle': 0xae5544,
  nervous: 0xe0b33e, brain: 0xdcaaa4, sensory: 0xbdd0d4, connective: 0xa9cfc5,
  cardiac: 0xa83a3c, arterial: 0xc23b2e, venous: 0x4f78a6, lymphatic: 0x8fae7f,
  respiratory: 0xd59aa2, digestive: 0xcf9f72, urinary: 0xb97c63, endocrine: 0xcfa59c, reproductive: 0xc8a499,
  integumentary: 0xe2bc9c, fascia: 0xf1ebe0,
};
const SYSTEM_LABEL = { ...Object.fromEntries(SOURCE_SYSTEMS.map((s) => [s.id, s.name])), fascia: 'Tendons & fascia' };
const DEFAULT_ON = ['bones', 'muscles'];
const HI = new THREE.Color(0x2a9d86);
const HOVER = new THREE.Color(0xf2c86a);
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const hex = (n) => '#' + n.toString(16).padStart(6, '0');
const fmt = (n) => n.toLocaleString('en-US');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const state = {
  sex: 'male', view: 'explorer', on: new Set(DEFAULT_ON), selected: null, hovered: null,
  isolate: false, xray: false, atlasLayer: 'bones', query: '', oneSide: true, page: 1, ctx: null,
};

// ---------------------------------------------------------------------------
// data
// ---------------------------------------------------------------------------
const bodies = {}; // sex -> { man, parts, layers: { id: { status, geo, parts } } }
async function loadBody(sex) {
  if (bodies[sex]) return bodies[sex];
  const man = await (await fetch(`model/${sex}.json`)).json();
  const parts = man.parts.map((p, n) => ({ ...p, n, sex, color: PART_COLOR[p.system] ?? 0xcccccc }));
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], p.b[0][a]); max[a] = Math.max(max[a], p.b[1][a]); }
  const layers = {};
  for (const id of Object.keys(man.layers)) layers[id] = { status: 'idle', parts: parts.filter((p) => p.layer === id).sort((a, b) => a.i[0] - b.i[0]) };
  bodies[sex] = { man, parts, layers, bounds: { min, max } };
  return bodies[sex];
}

async function ensureLayer(sex, id) {
  const B = await loadBody(sex);
  const L = B.layers[id];
  if (!L) return null;
  if (L.status === 'ready') return L;
  if (L.promise) return L.promise;
  L.status = 'loading';
  renderSystems();
  L.promise = (async () => {
    await MeshoptDecoder.ready;
    const M = B.man.layers[id];
    const buf = new Uint8Array(await (await fetch(`model/${M.file}`)).arrayBuffer());
    const nv = M.vertexCount;
    const q = new Uint8Array(nv * 8);
    MeshoptDecoder.decodeVertexBuffer(q, nv, 8, buf.subarray(M.vb[0], M.vb[0] + M.vb[1]));
    const qu = new Uint16Array(q.buffer);
    const pos = new Float32Array(nv * 3);
    for (let i = 0; i < nv; i++) for (let a = 0; a < 3; a++) pos[i * 3 + a] = M.min[a] + (qu[i * 4 + a] / 65535) * M.scale[a];
    const nb = new Uint8Array(nv * 4);
    MeshoptDecoder.decodeVertexBuffer(nb, nv, 4, buf.subarray(M.nb[0], M.nb[0] + M.nb[1]));
    const ib = new Uint8Array(M.indexCount * 4);
    MeshoptDecoder.decodeIndexBuffer(ib, M.indexCount, 4, buf.subarray(M.ib[0], M.ib[0] + M.ib[1]));
    const col = new Uint8Array(nv * 3);
    const c = new THREE.Color();
    for (const p of L.parts) {
      c.setHex(p.color);
      const r = Math.round(c.r * 255), g = Math.round(c.g * 255), b = Math.round(c.b * 255);
      for (let v = p.v[0]; v < p.v[0] + p.v[1]; v++) { col[v * 3] = r; col[v * 3 + 1] = g; col[v * 3 + 2] = b; }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.InterleavedBufferAttribute(new THREE.InterleavedBuffer(new Int8Array(nb.buffer), 4), 3, 0, true));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(ib.buffer), 1));
    geo.computeBoundingSphere();
    geo.computeBoundsTree({ indirect: true });
    L.geo = geo;
    L.starts = Int32Array.from(L.parts.map((p) => p.i[0]));
    L.status = 'ready';
    renderSystems();
    return L;
  })().catch((err) => { console.error(err); L.status = 'error'; L.promise = null; renderSystems(); return null; });
  return L.promise;
}

/** the structure that owns triangle `face` of a layer */
function partAt(L, face) {
  const k = face * 3, s = L.starts;
  let lo = 0, hi = s.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (s[mid] <= k) lo = mid; else hi = mid - 1; }
  return L.parts[lo];
}

/** geometry of one structure, sharing the layer's buffers */
function partGeometry(p) {
  const L = bodies[p.sex].layers[p.layer];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', L.geo.attributes.position);
  g.setAttribute('normal', L.geo.attributes.normal);
  g.setIndex(new THREE.BufferAttribute(L.geo.index.array.subarray(p.i[0], p.i[0] + p.i[1]), 1));
  g.boundingSphere = new THREE.Box3(new THREE.Vector3(...p.b[0]), new THREE.Vector3(...p.b[1])).getBoundingSphere(new THREE.Sphere());
  return g;
}
const partBox = (p) => new THREE.Box3(new THREE.Vector3(...p.b[0]), new THREE.Vector3(...p.b[1]));

// ---------------------------------------------------------------------------
// descriptions
// ---------------------------------------------------------------------------
const baseName = (name) => name.toLowerCase().trim()
  .replace(/\s*\((?:left|right)\)\s*$/, '').replace(/^(?:left|right)\s+/, '').replace(/\b(?:left|right)\s+/g, '').replace(/\s+[a-z]$/, '').trim();
const EXPL_KEYS = Object.keys(EXPLANATIONS).sort((a, b) => b.length - a.length);
const INFO_BY_NAME = {};
for (const [k, I] of Object.entries(INFO)) {
  for (const n of [I.name, I.latin]) {
    if (!n) continue;
    const s = n.toLowerCase().replace(/\s*\(.*?\)\s*/g, ' ').replace(/^(?:musculus|nervus|os)\s+/, '').trim();
    INFO_BY_NAME[s] ??= k;
  }
}
const INFO_NAMES = Object.keys(INFO_BY_NAME).filter((k) => k.length > 4).sort((a, b) => b.length - a.length);
function describe(p) {
  const key = p.name.toLowerCase().trim(), base = baseName(p.name);
  const infoKey = INFO_BY_NAME[base] ?? INFO_BY_NAME[key] ?? INFO_BY_NAME[INFO_NAMES.find((k) => base.endsWith(' ' + k) || base.startsWith(k + ' ')) ?? ''];
  const I = infoKey ? INFO[infoKey] : null;
  const own = EXPLANATIONS[key] ?? EXPLANATIONS[base] ?? EXPLANATIONS[EXPL_KEYS.find((k) => base.startsWith(k + ' ') || base.endsWith(' ' + k)) ?? ''];
  const system = SYSTEM_NOTES[p.sex]?.[p.system] ?? SOURCE_SYSTEMS.find((s) => s.id === p.system)?.description ?? '';
  return { text: I?.desc ?? own ?? system, fallback: !I && !own, facts: I?.facts ?? [], latin: I?.latin, sexNote: I?.female };
}
const sideOf = (name) => (/\bleft\b/i.test(name) ? 'Left' : /\bright\b/i.test(name) ? 'Right' : '');

// ---------------------------------------------------------------------------
// rendering helpers
// ---------------------------------------------------------------------------
function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x8a7458, 1.25));
  const key = new THREE.DirectionalLight(0xffffff, 1.8); key.position.set(1.5, 3, 2.5); scene.add(key);
  const fill = new THREE.DirectionalLight(0xffe9cc, 0.7); fill.position.set(-2, 1.5, 1); scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.0); rim.position.set(0, 2, -3); scene.add(rim);
}
function floorShadow() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 64);
  grd.addColorStop(0, 'rgba(70,45,20,0.32)'); grd.addColorStop(0.5, 'rgba(70,45,20,0.1)'); grd.addColorStop(1, 'rgba(70,45,20,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.7), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.001;
  return m;
}
const layerMaterial = (id) => id === 'skin'
  ? new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.52, metalness: 0, sheen: 0.5, sheenRoughness: 0.6, sheenColor: new THREE.Color(0xffd9c4), clearcoat: 0.08, clearcoatRoughness: 0.6 })
  : id === 'muscles'
    ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.48, metalness: 0 })
    : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
const overlayMaterial = (color, intensity = 0.45) => new THREE.MeshStandardMaterial({
  color, emissive: color, emissiveIntensity: intensity, roughness: 0.5, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
});
let tweens = [];
function tween(targets, to, dur = 650) {
  const from = targets.map((v) => v.clone()), start = performance.now();
  tweens.push((now) => {
    const t = Math.min(1, (now - start) / dur);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    targets.forEach((v, i) => v.lerpVectors(from[i], to[i], e));
    return t < 1;
  });
}
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// 3D explorer
// ---------------------------------------------------------------------------
const viewport = $('#viewport');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
viewport.appendChild(renderer.domElement);
const scene = new THREE.Scene();
addLights(scene);
scene.add(floorShadow());
const camera = new THREE.PerspectiveCamera(32, 1, 0.01, 50);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.12;
controls.maxDistance = 7;
controls.autoRotateSpeed = 1.4;
controls.zoomToCursor = true; // scroll/pinch zooms toward the point under the pointer
controls.zoomSpeed = 1.1;
const bodyGroup = new THREE.Group();
scene.add(bodyGroup);
const meshes = {}; // `${sex}:${layer}` -> mesh
const selMesh = new THREE.Mesh(undefined, overlayMaterial(HI));
const hovMesh = new THREE.Mesh(undefined, overlayMaterial(HOVER, 0.35));
selMesh.visible = hovMesh.visible = false;
selMesh.renderOrder = 3; hovMesh.renderOrder = 2;
scene.add(selMesh, hovMesh);
let needsRender = true;
const invalidate = () => { needsRender = true; };
controls.addEventListener('change', invalidate);

function layerMesh(sex, id) {
  const k = `${sex}:${id}`;
  if (!meshes[k]) {
    const L = bodies[sex].layers[id];
    const m = new THREE.Mesh(L.geo, layerMaterial(id));
    m.userData = { sex, layer: id };
    bodyGroup.add(m);
    meshes[k] = m;
  }
  return meshes[k];
}

function applyVisibility() {
  for (const m of Object.values(meshes)) {
    const on = m.userData.sex === state.sex && state.on.has(m.userData.layer) && !state.isolate;
    m.visible = on;
    const mat = m.material;
    const xr = state.xray && on;
    const op = !xr ? 1 : m.userData.layer === 'skin' ? 0.12 : m.userData.layer === 'muscles' ? 0.22 : 0.45;
    if (mat.transparent !== op < 1) mat.needsUpdate = true;
    mat.transparent = op < 1; mat.opacity = op; mat.depthWrite = op >= 1;
  }
  selMesh.material.color.copy(state.isolate && state.selected ? new THREE.Color(state.selected.color) : HI);
  selMesh.material.emissiveIntensity = state.isolate ? 0.08 : 0.45;
  invalidate();
}

async function setLayer(id, on) {
  const B = bodies[state.sex];
  if (!B?.layers[id]) return;
  if (on) state.on.add(id); else state.on.delete(id);
  renderSystems();
  if (on) {
    const L = await ensureLayer(state.sex, id);
    if (L && bodies[state.sex] === B) layerMesh(state.sex, id);
  }
  applyVisibility();
  showStatus();
}

function showStatus() {
  const B = bodies[state.sex];
  const loading = B ? [...state.on].filter((id) => B.layers[id]?.status === 'loading') : [];
  const el = $('#layerStatus');
  el.textContent = loading.length ? `Loading ${loading.map((id) => LAYER[id].name.toLowerCase()).join(', ')}…` : '';
  el.classList.toggle('show', loading.length > 0);
}

// ---- systems panel ----
function renderSystems() {
  const B = bodies[state.sex];
  const list = $('#systemList');
  list.innerHTML = LAYERS.map((l) => {
    const L = B?.layers[l.id];
    const on = state.on.has(l.id) && !!L;
    const count = L ? `${fmt(L.parts.length)} structures` : 'Not in this reference body';
    const loading = L?.status === 'loading' ? ' · loading' : L?.status === 'error' ? ' · failed to load, tap to retry' : '';
    if (l.id === 'skin') {
      return `<button type="button" class="sys skin" role="switch" aria-checked="${on}" data-layer="skin"${L ? '' : ' aria-disabled="true"'}>
        <span class="ring" aria-hidden="true"></span><b>${l.name}</b><small>${loading ? 'Loading…' : l.hint}</small></button>`;
    }
    return `<button type="button" class="sys" role="switch" aria-checked="${on}" data-layer="${l.id}"${L ? '' : ' aria-disabled="true"'}>
      <span class="ico" aria-hidden="true"><svg viewBox="0 0 24 24" stroke="${l.color}" style="color:${l.color}">${ICONS[l.id]}</svg></span>
      <span><b>${l.name}</b><small>${count}${loading}</small></span><span class="switch" aria-hidden="true"></span></button>`;
  }).join('');
  showStatus();
}
$('#systemList').addEventListener('click', (e) => {
  const b = e.target.closest('[data-layer]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  const id = b.dataset.layer;
  setLayer(id, !state.on.has(id));
});
$('#btnClear').addEventListener('click', () => {
  state.on.clear();
  state.isolate = false;
  deselect();
  renderSystems();
  applyVisibility();
});

// ---- picking ----
const ray = new THREE.Raycaster();
ray.firstHitOnly = true;
const ndc = new THREE.Vector2();
function pick(ev, dom, cam, list) {
  const r = dom.getBoundingClientRect();
  ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, cam);
  let best = null;
  for (const m of list) {
    if (!m.visible) continue;
    if (state.xray && m.userData.layer !== undefined && m.material.opacity < 0.3) continue;
    const h = ray.intersectObject(m, false)[0];
    if (h && (!best || h.distance < best.distance)) best = { ...h, mesh: m };
  }
  if (!best) return null;
  const { sex, layer } = best.mesh.userData;
  return partAt(bodies[sex].layers[layer], best.faceIndex);
}
const visibleMeshes = () => Object.values(meshes).filter((m) => m.visible);

const tooltip = $('#tooltip');
let lastMove = null;
renderer.domElement.addEventListener('pointermove', (ev) => { if (ev.pointerType === 'mouse') lastMove = ev; });
renderer.domElement.addEventListener('pointerleave', () => { lastMove = null; setHover(null); tooltip.classList.remove('show'); });
function processHover() {
  if (!lastMove || state.view !== 'explorer') return;
  const ev = lastMove; lastMove = null;
  if (ev.buttons) { tooltip.classList.remove('show'); return; }
  const p = state.isolate ? null : pick(ev, renderer.domElement, camera, visibleMeshes());
  setHover(p);
  if (p) {
    tooltip.textContent = p.name;
    const r = viewport.getBoundingClientRect();
    tooltip.style.left = ev.clientX - r.left + 'px';
    tooltip.style.top = ev.clientY - r.top + 'px';
    tooltip.classList.add('show');
    renderer.domElement.style.cursor = 'pointer';
  } else {
    tooltip.classList.remove('show');
    renderer.domElement.style.cursor = '';
  }
}
function setHover(p) {
  if (p === state.hovered) return;
  state.hovered = p;
  if (p && p !== state.selected) { hovMesh.geometry = partGeometry(p); hovMesh.visible = true; } else hovMesh.visible = false;
  invalidate();
}
let downAt = null;
renderer.domElement.addEventListener('pointerdown', (ev) => { downAt = { x: ev.clientX, y: ev.clientY }; });
renderer.domElement.addEventListener('pointerup', (ev) => {
  if (!downAt || Math.hypot(ev.clientX - downAt.x, ev.clientY - downAt.y) > 6 || ev.button !== 0) return;
  if (state.isolate) return;
  const p = pick(ev, renderer.domElement, camera, visibleMeshes());
  if (p) select(p); else deselect();
});

// double-click (or double-tap) a structure to fly to it
renderer.domElement.addEventListener('dblclick', (ev) => {
  const p = pick(ev, renderer.domElement, camera, visibleMeshes());
  if (p) { select(p); focusPart(p); }
});

function select(p, focus = false) {
  state.selected = p;
  selMesh.geometry = partGeometry(p);
  selMesh.visible = true;
  hovMesh.visible = false;
  applyVisibility();
  renderInfo(p);
  openPanel('infoPanel');
  if (focus) focusPart(p);
}
function deselect() {
  state.selected = null;
  state.isolate = false;
  selMesh.visible = false;
  applyVisibility();
  closePanel('infoPanel');
}

function infoHTML(p, actions = '') {
  const d = describe(p);
  const L = LAYER[p.layer];
  const side = sideOf(p.name);
  const borrowed = p.system === 'borrowed'
    ? '<div class="note"><b>Male-derived bone</b>The female reference has no skull, rib, arm or foot bones of its own, so this bone is taken from the male reference body and fitted into place.</div>' : '';
  const donor = p.system === 'donor-muscle'
    ? '<div class="note"><b>Donor muscle</b>This leg muscle comes from a second female body (the Visible Human Female), fitted to this skeleton, because the female reference models almost no muscle of its own.</div>' : '';
  const za = p.src === 'Z-Anatomy'
    ? '<div class="note za"><b>Added from Z-Anatomy</b>BodyParts3D has no model of this structure, so it comes from the open Z-Anatomy atlas (CC BY-SA 4.0), which is built on the same body.</div>' : '';
  const sexNote = d.sexNote ? `<div class="note"><b>Male vs female</b>${esc(d.sexNote)}</div>` : '';
  return `
    <div class="badges">
      <span class="badge"><i style="background:${L.color}"></i>${L.name}</span>
      ${SYSTEM_LABEL[p.system] && SYSTEM_LABEL[p.system] !== L.name ? `<span class="badge"><i style="background:${hex(p.color)}"></i>${esc(SYSTEM_LABEL[p.system])}</span>` : ''}
      ${side ? `<span class="badge">${side} side</span>` : ''}
    </div>
    <h2 id="infoTitle">${esc(p.name)}</h2>
    <p class="id">${d.latin ? `<i>${esc(d.latin)}</i> · ` : ''}${p.fma && p.fma.startsWith('FMA') ? `${p.fma.replace('FMA', 'FMA ')} · ` : ''}${state.sex === 'female' ? '♀ Female' : '♂ Male'} reference</p>
    <p class="desc">${esc(d.text)}</p>
    ${d.fallback ? `<p class="fallback">General description of the ${esc((SYSTEM_LABEL[p.system] || L.name).toLowerCase())}.</p>` : ''}
    ${d.facts.length ? `<h3>Key facts</h3><ul class="facts">${d.facts.map((f) => `<li>${esc(f)}</li>`).join('')}</ul>` : ''}
    ${sexNote}${borrowed}${donor}${za}
    ${actions}`;
}
function renderInfo(p) {
  $('#infoBody').innerHTML = infoHTML(p, `
    <div class="actions">
      <button type="button" class="btn" data-act="focus">Zoom to Part</button>
      <button type="button" class="btn ghost" data-act="isolate">${state.isolate ? 'Show Whole Body' : 'Show Only This Part'}</button>
      <button type="button" class="btn ghost" data-act="atlas">Open in Parts Atlas</button>
    </div>`);
}
$('#infoBody').addEventListener('click', (ev) => {
  const act = ev.target.closest('[data-act]')?.dataset.act;
  const p = state.selected;
  if (!act || !p) return;
  if (act === 'focus') focusPart(p);
  if (act === 'isolate') {
    state.isolate = !state.isolate;
    applyVisibility();
    renderInfo(p);
    if (state.isolate) focusPart(p); else camPreset('reset');
  }
  if (act === 'atlas') {
    state.atlasLayer = p.layer; state.query = ''; $('#atlasSearch').value = ''; state.page = 1;
    switchView('atlas');
    openContext(p);
  }
});

function focusPart(p) { focusBox(partBox(p), camera, controls, viewDirFor(p)); }
function focusBox(box, cam = camera, ctl = controls, dirOverride = null) {
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const dist = Math.max(0.24, (sph.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.3);
  const dir = dirOverride ? dirOverride.clone().normalize() : cam.position.clone().sub(ctl.target).normalize();
  const to = [sph.center.clone().add(dir.multiplyScalar(dist)), sph.center.clone()];
  if (reduceMotion) { cam.position.copy(to[0]); ctl.target.copy(to[1]); invalidate(); return; }
  tween([cam.position, ctl.target], to);
}
function bodyFrame() {
  const B = bodies[state.sex];
  const h = B ? B.bounds.max[1] : 1.75;
  return { target: new THREE.Vector3(0, h * 0.5, 0), dist: h * 2.15 };
}
function camPreset(name) {
  const { target, dist } = bodyFrame();
  const dirs = { front: [0, 0.06, 1], back: [0, 0.06, -1], left: [1, 0.06, 0], right: [-1, 0.06, 0], reset: [0.32, 0.08, 1] };
  const d = new THREE.Vector3(...dirs[name]).normalize().multiplyScalar(dist);
  const to = [target.clone().add(d), target];
  if (reduceMotion) { camera.position.copy(to[0]); controls.target.copy(to[1]); invalidate(); return; }
  tween([camera.position, controls.target], to);
}
$$('.toolbar [data-cam]').forEach((b) => b.addEventListener('click', () => camPreset(b.dataset.cam)));
$('#btnRotate').addEventListener('click', (e) => {
  controls.autoRotate = !controls.autoRotate;
  e.currentTarget.setAttribute('aria-pressed', controls.autoRotate);
});
$('#btnXray').addEventListener('click', (e) => {
  state.xray = !state.xray;
  e.currentTarget.setAttribute('aria-pressed', state.xray);
  applyVisibility();
});

// ---- search ----
const searchInput = $('#search');
function searchParts(q, limit = 12) {
  const B = bodies[state.sex];
  if (!B || !q) return [];
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = B.parts.filter((p) => { const n = p.name.toLowerCase(); return words.every((w) => n.includes(w)); });
  hits.sort((a, b) => (a.name.length - b.name.length) || a.name.localeCompare(b.name));
  return hits.slice(0, limit);
}
searchInput.addEventListener('input', () => {
  const q = searchInput.value.trim();
  const res = searchParts(q);
  $('#searchResults').innerHTML = q
    ? (res.length ? res.map((p) => `<li><button type="button" data-n="${p.n}"><i style="background:${hex(p.color)}"></i><span>${esc(p.name)}</span></button></li>`).join('')
      : '<li class="coverage">No structure matches that name.</li>')
    : '';
});
$('#searchResults').addEventListener('click', async (ev) => {
  const b = ev.target.closest('[data-n]');
  if (!b) return;
  const p = bodies[state.sex].parts[+b.dataset.n];
  searchInput.value = ''; $('#searchResults').innerHTML = '';
  if (!state.on.has(p.layer)) await setLayer(p.layer, true); else await ensureLayer(state.sex, p.layer);
  select(p, true);
});

// ---------------------------------------------------------------------------
// panels, views, sex
// ---------------------------------------------------------------------------
function openPanel(id) {
  const el = document.getElementById(id);
  el.classList.add('open'); el.setAttribute('aria-hidden', 'false');
  if (id === 'contextPanel') $('#backdrop').classList.add('show');
}
function closePanel(id) {
  const el = document.getElementById(id);
  el.classList.remove('open'); el.setAttribute('aria-hidden', 'true');
  if (id === 'contextPanel') { $('#backdrop').classList.remove('show'); state.ctx = null; $$('.card.selected').forEach((c) => c.classList.remove('selected')); }
}
$$('[data-close]').forEach((b) => b.addEventListener('click', () => { if (b.dataset.close === 'infoPanel') deselect(); else closePanel(b.dataset.close); }));
$('#backdrop').addEventListener('click', () => closePanel('contextPanel'));
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (state.ctx) closePanel('contextPanel'); else if (state.selected) deselect();
});

function switchView(v) {
  state.view = v;
  $$('.tab').forEach((t) => { const on = t.dataset.view === v; t.classList.toggle('active', on); if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $$('.view').forEach((el) => el.classList.toggle('active', el.id === v));
  if (v === 'atlas') renderAtlas();
  if (v === 'explorer') { resize(); invalidate(); }
  try { history.replaceState(null, '', v === 'atlas' ? '#atlas' : '#explorer'); } catch { /* sandboxed */ }
}
$$('.tab').forEach((t) => t.addEventListener('click', (e) => { e.preventDefault(); switchView(t.dataset.view); }));
window.addEventListener('hashchange', () => switchView(location.hash === '#atlas' ? 'atlas' : 'explorer'));
function zoomBy(f) {
  const d = camera.position.clone().sub(controls.target);
  const len = THREE.MathUtils.clamp(d.length() * f, controls.minDistance, controls.maxDistance);
  const to = [controls.target.clone().add(d.setLength(len)), controls.target.clone()];
  if (reduceMotion) { camera.position.copy(to[0]); invalidate(); } else tween([camera.position, controls.target], to, 300);
}
$('#btnZoomIn').addEventListener('click', () => zoomBy(0.75));
$('#btnZoomOut').addEventListener('click', () => zoomBy(1.33));

async function setSex(sex) {
  if (state.sex === sex) return;
  state.sex = sex;
  $$('.sex-toggle button').forEach((b) => b.setAttribute('aria-checked', b.dataset.sex === sex));
  deselect();
  closePanel('contextPanel');
  setHover(null);
  await loadBody(sex);
  renderSystems();
  renderCoverage();
  applyVisibility();
  camPreset('reset');
  for (const id of [...state.on]) if (bodies[sex].layers[id]) setLayer(id, true);
  if (state.view === 'atlas') renderAtlas();
}
$$('.sex-toggle button').forEach((b) => b.addEventListener('click', () => setSex(b.dataset.sex)));

function renderCoverage() {
  const B = bodies[state.sex];
  const credit = 'Anatomy data: BodyParts3D © DBCLS (CC BY 4.0)' + (state.sex === 'female' ? '; HuBMAP Human Reference Atlas and Andreassen et al. 2023 (CC BY 4.0)' : '; face, deep back and abdominal-wall muscles from Z-Anatomy (CC BY-SA 4.0)') + ', packaged by the open-source Human Atlas project.';
  $('#coverage').innerHTML = (state.sex === 'male'
    ? `Adult male reference body (BodyParts3D 4.0): ${fmt(B.parts.length)} separately selectable structures.`
    : `Adult female reference body (Human Reference Atlas): ${fmt(B.parts.length)} structures. Its source has no muscles above the hips, and its skull, rib, arm and foot bones are taken from the male body and shown in grey.`)
    + ` <br>${credit} <a href="ATTRIBUTION.md" target="_blank" rel="noopener">Credits</a>`;
  $('#scopeLine').textContent = state.sex === 'male' ? 'Male reference · BodyParts3D' : 'Female reference · Human Reference Atlas';
  searchInput.placeholder = `Search ${fmt(B.parts.length)} structures…`;
}

// ---------------------------------------------------------------------------
// Parts Atlas: every structure on its own
// ---------------------------------------------------------------------------
const PAGE = 60;
const thumbR = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
thumbR.setPixelRatio(1);
thumbR.setSize(260, 260);
const thumbScene = new THREE.Scene();
addLights(thumbScene);
const thumbCam = new THREE.PerspectiveCamera(30, 1, 0.001, 20);
const thumbMesh = new THREE.Mesh(undefined, new THREE.MeshStandardMaterial({ roughness: 0.55 }));
thumbScene.add(thumbMesh);
const thumbCache = new Map();
let thumbQueue = [];
let thumbBusy = false;

function viewDirFor(p) {
  const c = partBox(p).getCenter(new THREE.Vector3());
  const back = c.z < -0.035;
  const side = Math.abs(c.x) > 0.06 ? Math.sign(c.x) : 0.4;
  return new THREE.Vector3(side * 0.45, 0.15, back ? -1 : 1).normalize();
}
function renderThumb(p) {
  thumbMesh.geometry = partGeometry(p);
  thumbMesh.material.color.setHex(p.color);
  const sph = partBox(p).getBoundingSphere(new THREE.Sphere());
  const dist = (sph.radius / Math.sin(THREE.MathUtils.degToRad(thumbCam.fov / 2))) * 1.04;
  thumbCam.position.copy(sph.center).add(viewDirFor(p).multiplyScalar(dist));
  thumbCam.near = dist / 50; thumbCam.far = dist * 4; thumbCam.updateProjectionMatrix();
  thumbCam.lookAt(sph.center);
  thumbR.render(thumbScene, thumbCam);
  return thumbR.domElement.toDataURL('image/webp', 0.85);
}
function pumpThumbs() {
  const t0 = performance.now();
  while (thumbQueue.length && performance.now() - t0 < 20) {
    const j = thumbQueue.shift();
    if (!j.img.isConnected) continue;
    const key = `${j.p.sex}:${j.p.n}`;
    if (!thumbCache.has(key)) thumbCache.set(key, renderThumb(j.p));
    j.img.src = thumbCache.get(key);
  }
  if (thumbQueue.length) requestAnimationFrame(pumpThumbs); else thumbBusy = false;
}
const io = new IntersectionObserver((entries) => {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    const img = $('img', e.target);
    const p = bodies[state.sex]?.parts[+e.target.dataset.n];
    if (!p || p.sex !== state.sex) continue;
    thumbQueue.push({ p, img });
  }
  if (thumbQueue.length && !thumbBusy) { thumbBusy = true; requestAnimationFrame(pumpThumbs); }
}, { root: $('#atlas'), rootMargin: '300px' });

function atlasList() {
  const B = bodies[state.sex];
  const L = B.layers[state.atlasLayer];
  if (!L) return [];
  const words = state.query.toLowerCase().split(/\s+/).filter(Boolean);
  return L.parts.filter((p) => {
    const n = p.name.toLowerCase();
    if (state.oneSide && /\bright\b/.test(n)) return false;
    return words.every((w) => n.includes(w));
  }).sort((a, b) => a.name.localeCompare(b.name));
}

async function renderAtlas() {
  const B = await loadBody(state.sex);
  if (!B.layers[state.atlasLayer]) state.atlasLayer = 'bones';
  $('#catTabs').innerHTML = LAYERS.filter((l) => B.layers[l.id]).map((l) => `
    <button type="button" class="cat-tab" role="tab" aria-selected="${state.atlasLayer === l.id}" data-layer="${l.id}">
      ${l.id === 'skin' ? '<svg viewBox="0 0 24 24" stroke="currentColor"><circle cx="12" cy="12" r="8"/></svg>' : `<svg viewBox="0 0 24 24" stroke="${l.color}" style="color:${l.color}">${ICONS[l.id]}</svg>`}
      ${l.name} <small>${fmt(B.layers[l.id].parts.length)}</small></button>`).join('');
  const grid = $('#grid');
  const L = B.layers[state.atlasLayer];
  if (L.status !== 'ready') {
    grid.innerHTML = '<div class="empty"><div class="spinner" style="margin:0 auto 10px"></div>Loading this system…</div>';
    $('#btnMore').parentElement.hidden = true;
    const ok = await ensureLayer(state.sex, state.atlasLayer);
    if (ok && state.view === 'atlas') renderAtlas();
    return;
  }
  const list = atlasList();
  const shown = list.slice(0, state.page * PAGE);
  $('#atlasSub').textContent = `${fmt(list.length)} structures in ${LAYER[state.atlasLayer].name}${state.oneSide ? ' (one side shown for paired ones)' : ''} · ${state.sex === 'female' ? '♀ female' : '♂ male'} body · select one to see it in the whole system`;
  grid.innerHTML = shown.length ? shown.map((p) => `
    <button type="button" class="card${state.ctx?.p === p ? ' selected' : ''}" data-n="${p.n}">
      <span class="thumb"><img alt="" width="260" height="260"></span>
      <span class="meta"><b>${esc(p.name)}</b><span>${esc(SYSTEM_LABEL[p.system] || LAYER[p.layer].name)}</span></span></button>`).join('')
    : '<div class="empty">No structure in this system matches that name.</div>';
  thumbQueue = [];
  $$('#grid .card').forEach((c) => io.observe(c));
  $('#btnMore').parentElement.hidden = shown.length >= list.length;
  $('#btnMore').textContent = `Show More (${fmt(list.length - shown.length)} Left)`;
}
$('#catTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-layer]'); if (!b) return; state.atlasLayer = b.dataset.layer; state.page = 1; atlasEl.scrollTop = 0; renderAtlas(); });
$('#atlasSearch').addEventListener('input', (e) => { state.query = e.target.value.trim(); state.page = 1; renderAtlas(); });
$('#oneSide').addEventListener('change', (e) => { state.oneSide = e.target.checked; state.page = 1; renderAtlas(); });
$('#btnMore').addEventListener('click', () => { state.page++; renderAtlas(); });
const atlasEl = $('#atlas'), topBtn = $('#btnTop');
atlasEl.addEventListener('scroll', () => { topBtn.hidden = atlasEl.scrollTop < 400; }, { passive: true });
topBtn.addEventListener('click', () => { atlasEl.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' }); $('#catTabs [aria-selected="true"]')?.focus({ preventScroll: true }); });
$('#grid').addEventListener('click', (e) => { const c = e.target.closest('.card'); if (c) openContext(bodies[state.sex].parts[+c.dataset.n]); });

// ---- context slide: the structure inside its whole system ----
const ctxViewport = $('#ctxViewport');
const ctxR = new THREE.WebGLRenderer({ antialias: true, alpha: true });
ctxR.setPixelRatio(Math.min(window.devicePixelRatio, 2));
ctxViewport.appendChild(ctxR.domElement);
const ctxScene = new THREE.Scene();
addLights(ctxScene);
ctxScene.add(floorShadow());
const ctxCam = new THREE.PerspectiveCamera(30, 1, 0.01, 50);
const ctxControls = new OrbitControls(ctxCam, ctxR.domElement);
ctxControls.enableDamping = true;
ctxControls.minDistance = 0.1;
ctxControls.maxDistance = 6;
const ctxLayer = new THREE.Mesh(undefined, layerMaterial());
const ctxSel = new THREE.Mesh(undefined, overlayMaterial(HI, 0.5));
ctxSel.renderOrder = 3;
ctxScene.add(ctxLayer, ctxSel);

function ctxFrame(zoom, instant) {
  const p = state.ctx.p;
  let box;
  if (zoom) box = partBox(p);
  else {
    const B = bodies[p.sex];
    box = new THREE.Box3(new THREE.Vector3(-0.3, 0, -0.2), new THREE.Vector3(0.3, B.bounds.max[1], 0.2));
  }
  const dir = viewDirFor(p).setY(0.08).normalize();
  const sph = box.getBoundingSphere(new THREE.Sphere());
  const dist = zoom ? Math.max(0.2, (sph.radius / Math.sin(THREE.MathUtils.degToRad(ctxCam.fov / 2))) * 1.4) : sph.radius * 3.5;
  const to = [sph.center.clone().add(dir.multiplyScalar(dist)), sph.center.clone()];
  if (instant || reduceMotion) { ctxCam.position.copy(to[0]); ctxControls.target.copy(to[1]); }
  else tween([ctxCam.position, ctxControls.target], to);
  $('#ctxZoom').classList.toggle('active', !!zoom); $('#ctxZoom').setAttribute('aria-pressed', !!zoom);
  $('#ctxFull').classList.toggle('active', !zoom); $('#ctxFull').setAttribute('aria-pressed', !zoom);
}

async function openContext(p, keepCam = false) {
  const wasOpen = !!state.ctx;
  const L = await ensureLayer(p.sex, p.layer);
  if (!L) return;
  state.ctx = { p, zoom: state.ctx?.zoom ?? false };
  ctxLayer.geometry = L.geo;
  ctxSel.geometry = partGeometry(p);
  const lay = LAYER[p.layer];
  const sys = lay.name.toLowerCase();
  $('#ctxHead').innerHTML = `<small>Location in the whole ${esc(sys)}</small><h2 id="ctxTitle">${esc(p.name)}</h2>`;
  $('#ctxLegend').innerHTML = `<span><i style="background:${hex(HI.getHex())}"></i>Selected structure</span><span><i style="background:${lay.color}"></i>Rest of the ${esc(sys)}</span>`;
  $('#ctxBody').innerHTML = infoHTML(p, '<div class="actions"><button type="button" class="btn" data-ctx="explore">View in 3D Body Explorer</button></div>');
  $$('.card').forEach((c) => c.classList.toggle('selected', +c.dataset.n === p.n));
  openPanel('contextPanel');
  resizeCtx();
  if (!wasOpen) ctxFrame(state.ctx.zoom, true); else if (!keepCam) ctxFrame(state.ctx.zoom);
}
$('#ctxZoom').addEventListener('click', () => { if (state.ctx) { state.ctx.zoom = true; ctxFrame(true); } });
$('#ctxFull').addEventListener('click', () => { if (state.ctx) { state.ctx.zoom = false; ctxFrame(false); } });
$('#ctxBody').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-ctx="explore"]') || !state.ctx) return;
  const p = state.ctx.p;
  closePanel('contextPanel');
  switchView('explorer');
  if (!state.on.has(p.layer)) await setLayer(p.layer, true);
  select(p, true);
});
let ctxDown = null;
ctxR.domElement.addEventListener('pointerdown', (e) => { ctxDown = { x: e.clientX, y: e.clientY }; });
ctxR.domElement.addEventListener('pointerup', (e) => {
  if (!ctxDown || Math.hypot(e.clientX - ctxDown.x, e.clientY - ctxDown.y) > 6 || !state.ctx) return;
  ctxLayer.userData = { sex: state.ctx.p.sex, layer: state.ctx.p.layer };
  const p = pick(e, ctxR.domElement, ctxCam, [ctxLayer]);
  if (p) openContext(p, true);
});

// ---------------------------------------------------------------------------
// loop
// ---------------------------------------------------------------------------
function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // keep the body centred in the space left of the systems sidebar on wide screens
  const side = w > 900 ? Math.min(190, ($('#systems').offsetWidth + 14) / 2) : 0;
  if (side) camera.setViewOffset(w, h, side, 0, w, h); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
  invalidate();
}
function resizeCtx() {
  const w = ctxViewport.clientWidth, h = ctxViewport.clientHeight;
  if (!w || !h) return;
  ctxR.setSize(w, h);
  ctxCam.aspect = w / h;
  ctxCam.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
new ResizeObserver(resizeCtx).observe(ctxViewport);

function loop(now) {
  requestAnimationFrame(loop);
  const animating = tweens.length > 0;
  tweens = tweens.filter((f) => f(now));
  if (state.view === 'explorer') {
    processHover();
    const moved = controls.update();
    if (moved || animating || controls.autoRotate || needsRender) { renderer.render(scene, camera); needsRender = false; }
  }
  if (state.ctx) {
    ctxSel.material.emissiveIntensity = reduceMotion ? 0.45 : 0.32 + 0.2 * Math.sin(now / 260);
    ctxControls.update();
    ctxR.render(ctxScene, ctxCam);
  }
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
(async () => {
  try {
    await loadBody('male');
    renderSystems();
    renderCoverage();
    resize();
    const { target, dist } = bodyFrame();
    camera.position.copy(target).add(new THREE.Vector3(0.32, 0.08, 1).normalize().multiplyScalar(dist));
    controls.target.copy(target);
    await Promise.all(DEFAULT_ON.map((id) => setLayer(id, true)));
  } catch (err) {
    console.error(err);
    $('#loading p').textContent = 'The 3D model could not be loaded. Serve this folder with a web server (see the README) and reload.';
    return;
  }
  requestAnimationFrame(loop);
  $('#loading').classList.add('hide');
  if (location.hash === '#atlas') switchView('atlas');
  window.appReady = true;
})();

window.__anatomy = { state, bodies, select, setLayer, setSex, openContext, switchView, searchParts };
