import {
  createGraph, addVertex, addEdge, removeVertex, removeEdge, neighbors,
  cloneGraph, hasVertexNear, verticesInRect, findK4s, commonNeighbors,
} from './graph.js';
import { createHistory, record, undo, redo } from './history.js';
import { minimumColoring, coloringModes, kempeChain, swapKempeChain } from './coloring.js';
import { computeStats } from './stats.js';
import { pointSegmentDistance, convexHull, inflateHull } from './geometry.js';
import { routeEdges, closedVertices } from './routing.js';
import { createView, screenToWorld, zoomAt, panBy } from './view.js';
import { namingModes } from './naming.js';
import { randomPositions, pickRoutableEdge } from './generate.js';

const VERTEX_RADIUS = 14;
const EDGE_HIT_DISTANCE = 6;
const CLICK_SLOP = 5;
const SPAWN_MS = 350;
const DELETE_GUARD_MS = 500;
const MIN_VERTEX_GAP = VERTEX_RADIUS * 2.5;
const POP_MS = 250;
const RING_SPREAD = 26;

// Okabe-Ito palette: colorblind-safe, mutually distinct.
const PALETTE = [
  '#E69F00', '#56B4E9', '#009E73', '#F0E442',
  '#0072B2', '#D55E00', '#CC79A7', '#999999',
];

// Hues for K4 group outlines — distinct from the semantic red/blue/white.
const K4_COLORS = ['#B57EDC', '#45C4B0', '#E36FA5', '#C9A227'];

const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const el = id => document.getElementById(id);

const state = {
  graph: createGraph(),
  coloring: { chi: 0, colors: new Map() },
  stats: null,
  routes: [],
  view: createView(),
  history: null, // initialized at boot
  lastCreated: null, // { id, time } — guards dblclick-delete after create
  showDegrees: true,
  showClosed: true,
  closedSet: new Set(), // derived: recomputed on every graph change
  showK4: false,
  k4s: [], // derived: all 4-cliques, recomputed on topology change
  k4Focus: null, // index into k4s while its panel chip is hovered
  edgeCommon: [], // derived: per-edge list of common-neighbor ids, recomputed on topology change
  sharedFilter: 'none', // 'none' | 1 | 2 | 3 (3 means "3+") — dropdown highlight
  diamondCheck: false, // toggle: color 2-shared-neighbor edges green/red by neighbor-color agreement
  selection: new Set(), // marquee-selected vertex ids; cleared on any mutation
  kempeMode: false,
  kempe: null, // { vertexId, otherColor } — active Kempe chain selection
  mode: coloringModes.find(m => m.id === 'feasible4'),
  naming: namingModes[0],
  spaceDown: false,
  // null | {type:'pending',x,y} | {type:'edge',fromId,x,y} | {type:'move',id}
  // | {type:'pan',x,y} (client coords)
  drag: null,
  generating: null, // active random generation { queue, edgesLeft, timer }
};

// --- hit testing ---

function vertexAt(x, y) {
  for (let i = state.graph.vertices.length - 1; i >= 0; i--) {
    const v = state.graph.vertices[i];
    if (Math.hypot(v.x - x, v.y - y) <= VERTEX_RADIUS) return v;
  }
  return null;
}

function edgeAt(x, y) {
  for (let i = 0; i < state.graph.edges.length; i++) {
    const points = state.routes[i].points;
    for (let s = 0; s + 1 < points.length; s++) {
      if (pointSegmentDistance({ x, y }, points[s], points[s + 1]) <= EDGE_HIT_DISTANCE) {
        return state.graph.edges[i];
      }
    }
  }
  return null;
}

// --- recompute pipeline ---

function topologyChanged() {
  state.coloring = minimumColoring(state.graph);
  state.k4s = findK4s(state.graph);
  state.k4Focus = null; // group indexes shift with the graph
  state.edgeCommon = state.graph.edges.map(e => commonNeighbors(state.graph, e.a, e.b));
  drawingChanged();
}

function drawingChanged() {
  state.routes = routeEdges(state.graph);
  state.stats = computeStats(state.graph, state.coloring, state.routes);
  // Skip the closed-vertex scan mid-move and mid-generation (costly); it
  // refreshes when the gesture/animation ends because both clear their
  // state before committing.
  if ((state.drag === null || state.drag.type !== 'move') && state.generating === null) {
    state.closedSet = closedVertices(state.graph, state.routes);
  }
  render();
  updatePanel();
}

// Recompute AND snapshot the graph into the undo history.
function commit() {
  state.selection.clear();
  state.kempe = null;
  topologyChanged();
  state.history = record(state.history, cloneGraph(state.graph));
}

function applyHistory() {
  state.graph = cloneGraph(state.history.present);
  state.selection.clear();
  state.kempe = null;
  topologyChanged();
}

// The active Kempe chain, derived from the current coloring (or null).
function activeKempeChain() {
  if (state.kempe === null) return null;
  return kempeChain(state.graph, state.coloring, state.kempe.vertexId, state.kempe.otherColor);
}

// Select a vertex's Kempe chain; clicking the same vertex cycles through
// the remaining palette colors as the partner.
function selectKempe(vertexId) {
  if (state.coloring.chi < 2) return;
  const own = state.coloring.colors.get(vertexId);
  if (state.kempe !== null && state.kempe.vertexId === vertexId) {
    let next = (state.kempe.otherColor + 1) % state.coloring.chi;
    if (next === own) next = (next + 1) % state.coloring.chi;
    state.kempe = { vertexId, otherColor: next };
  } else {
    state.kempe = { vertexId, otherColor: own === 0 ? 1 : 0 };
  }
  render();
}

function clearCanvas() {
  if (state.graph.vertices.length === 0) return;
  state.graph = createGraph();
  commit();
}

// --- random generation ---

// World-space rectangle of the viewport, minus margins and the panel.
function generationRect() {
  const tl = screenToWorld(state.view, 60, 60);
  const br = screenToWorld(state.view, window.innerWidth - 330, window.innerHeight - 60);
  return {
    x: tl.x,
    y: tl.y,
    width: Math.max(120, br.x - tl.x),
    height: Math.max(120, br.y - tl.y),
  };
}

// Read live so the slider takes effect mid-animation.
function generationDelay() {
  return 660 - 60 * Number(el('gen-speed').value); // speed 1..10 → 600..60 ms
}

// Replace the canvas with an animated random graph: vertices pop in one by
// one, then random crossing-free edges are added until the requested count
// (or, with no count given, until no routable pair remains). The whole run
// is a single undoable step.
function startGeneration() {
  state.drag = null;
  const count = Math.min(80, Math.max(2, Math.floor(Number(el('gen-v').value)) || 12));
  const edgesRaw = el('gen-e').value.trim();
  const edgesLeft = edgesRaw === '' ? Infinity : Math.max(0, Math.floor(Number(edgesRaw)) || 0);
  const positions = randomPositions(count, generationRect(), MIN_VERTEX_GAP * 2, Math.random);
  if (positions.length < 2) return;
  state.graph = createGraph();
  state.selection.clear();
  state.kempe = null;
  state.generating = { queue: positions, edgesLeft, timer: null };
  el('gen-run').textContent = 'Stop';
  el('gen-run').classList.add('running');
  topologyChanged();
  state.generating.timer = setTimeout(generationStep, generationDelay());
}

function generationStep() {
  const gen = state.generating;
  if (gen === null) return;
  if (gen.queue.length > 0) {
    const p = gen.queue.shift();
    const v = addVertex(state.graph, p.x, p.y);
    animateSpawn(v.id);
    topologyChanged();
  } else if (gen.edgesLeft > 0) {
    const pick = pickRoutableEdge(state.graph, state.routes, Math.random);
    if (pick === null) {
      finishGeneration();
      return;
    }
    addEdge(state.graph, pick.a, pick.b);
    gen.edgesLeft--;
    topologyChanged();
  } else {
    finishGeneration();
    return;
  }
  gen.timer = setTimeout(generationStep, generationDelay());
}

// Stop (naturally or via Esc / the Stop button) and commit one undo step.
function finishGeneration() {
  if (state.generating === null) return;
  clearTimeout(state.generating.timer);
  state.generating = null;
  el('gen-run').textContent = 'Generate';
  el('gen-run').classList.remove('running');
  commit();
}

// --- spawn animation ---

const spawnAnimations = new Map(); // vertexId -> start timestamp

function animateSpawn(vertexId) {
  spawnAnimations.set(vertexId, performance.now());
  if (spawnAnimations.size === 1) requestAnimationFrame(animationTick);
}

function animationTick() {
  const now = performance.now();
  for (const [id, start] of spawnAnimations) {
    if (now - start >= SPAWN_MS || !state.graph.vertices.some(v => v.id === id)) {
      spawnAnimations.delete(id);
    }
  }
  render();
  if (spawnAnimations.size > 0) requestAnimationFrame(animationTick);
}

function easeOutBack(t) {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2;
}

// --- rendering ---

function resize() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  render();
}

function render() {
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  ctx.translate(state.view.x, state.view.y);
  ctx.scale(state.view.scale, state.view.scale);
  const pos = new Map(state.graph.vertices.map(v => [v.id, v]));
  const chain = activeKempeChain();
  updateKempeStatus(chain);

  if (state.showK4) {
    state.k4s.forEach((quad, i) => {
      const hull = convexHull(quad.map(id => pos.get(id)));
      // Staggered inflation keeps coincident borders of vertex-sharing
      // groups visually separable.
      const outline = inflateHull(hull, 26 + (i % K4_COLORS.length) * 5);
      ctx.strokeStyle = K4_COLORS[i % K4_COLORS.length];
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      tracePolygon(outline);
      ctx.stroke();
    });
  }

  const focusQuad = state.k4Focus !== null ? new Set(state.k4s[state.k4Focus]) : null;
  state.graph.edges.forEach((e, i) => {
    const route = state.routes[i];
    const crossing = state.stats !== null && state.stats.crossings.edgeIndexes.has(i);
    const selected = state.selection.has(e.a) && state.selection.has(e.b);
    const inChain = chain !== null && chain.has(e.a) && chain.has(e.b);
    const common = state.edgeCommon[i];
    let diamond = null; // 'same' | 'diff' | null
    if (state.diamondCheck && common.length === 2) {
      const c0 = state.coloring.colors.get(common[0]);
      const c1 = state.coloring.colors.get(common[1]);
      diamond = c0 === c1 ? 'same' : 'diff';
    }
    const sharedHit = state.sharedFilter !== 'none'
      && (state.sharedFilter === 3 ? common.length >= 3 : common.length === state.sharedFilter);
    ctx.strokeStyle = inChain ? '#e8eaf0'
      : crossing ? '#ff5555'
      : diamond === 'same' ? '#7dd87d'
      : diamond === 'diff' ? '#ff7d7d'
      : sharedHit ? '#E69F00'
      : selected ? '#56B4E9' : '#5a6072';
    ctx.lineWidth = inChain ? 3 : crossing || diamond !== null || sharedHit || selected ? 2.5 : 2;
    const a = pos.get(e.a);
    const b = pos.get(e.b);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    if (route.control === null) {
      ctx.lineTo(b.x, b.y);
    } else {
      ctx.quadraticCurveTo(route.control.x, route.control.y, b.x, b.y);
    }
    ctx.stroke();
  });

  if (state.drag !== null && state.drag.type === 'edge') {
    const from = pos.get(state.drag.fromId);
    ctx.strokeStyle = '#8892aa';
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(state.drag.x, state.drag.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  state.graph.vertices.forEach((v, index) => {
    const colors = state.mode
      .vertexColors(state.graph, state.coloring, v.id)
      .map(c => PALETTE[c % PALETTE.length]);
    const start = spawnAnimations.get(v.id);
    let scale = 1;
    if (start !== undefined) {
      const elapsed = performance.now() - start;
      scale = elapsed >= POP_MS ? 1 : easeOutBack(elapsed / POP_MS);
      drawSpawnRing(v, colors[0], elapsed);
    }
    drawVertex(v, colors, scale, state.selection.has(v.id));
    if (state.showDegrees) drawDegree(v);
    if (state.showClosed && state.closedSet.has(v.id)) drawClosedRing(v);
    if (chain !== null && chain.has(v.id)) drawKempeRing(v);
    if (focusQuad !== null && focusQuad.has(v.id)) {
      drawFocusRing(v, K4_COLORS[state.k4Focus % K4_COLORS.length]);
    }
    const name = state.naming.name(state.graph, state.coloring, v.id, index);
    if (name !== null) drawName(v, name);
  });

  if (state.drag !== null && state.drag.type === 'select') {
    const { x0, y0, x1, y1 } = state.drag;
    ctx.fillStyle = 'rgba(86, 180, 233, 0.10)';
    ctx.strokeStyle = '#56B4E9';
    ctx.lineWidth = 1;
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
}

// Name label below the vertex, clear of the rings (closed +3.5, kempe +8).
function drawName(v, name) {
  ctx.font = '600 12px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#12141a';
  ctx.fillStyle = '#e8eaf0';
  const y = v.y + VERTEX_RADIUS + 11;
  ctx.strokeText(name, v.x, y);
  ctx.fillText(name, v.x, y);
}

function tracePolygon(points) {
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.closePath();
}

// Hovered K4 chip: ring the member vertices in the group's hue.
function drawFocusRing(v, hue) {
  ctx.strokeStyle = hue;
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(v.x, v.y, VERTEX_RADIUS + 8, 0, Math.PI * 2);
  ctx.stroke();
}

function drawKempeRing(v) {
  ctx.strokeStyle = '#56B4E9';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(v.x, v.y, VERTEX_RADIUS + 8, 0, Math.PI * 2);
  ctx.stroke();
}

function updateKempeStatus(chain) {
  const status = el('kempe-status');
  if (chain === null) {
    status.hidden = true;
    return;
  }
  const own = state.coloring.colors.get(state.kempe.vertexId);
  const other = state.kempe.otherColor;
  const dot = c => `<span style="color:${PALETTE[c % PALETTE.length]}">&#9679;</span>`;
  status.innerHTML =
    `Kempe ${dot(own)} &#8646; ${dot(other)} &middot; ${chain.size} vertices &middot; Enter: swap`;
  status.hidden = false;
}

// Thick solid ring hugging the vertex border (keeps the dark outline
// visible between the fill and the marker).
function drawClosedRing(v) {
  ctx.strokeStyle = '#9aa1b5';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.arc(v.x, v.y, VERTEX_RADIUS + 3.5, 0, Math.PI * 2);
  ctx.stroke();
}

function drawDegree(v) {
  ctx.font = '600 11px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#12141a';
  ctx.fillStyle = '#ffffff';
  const degree = String(neighbors(state.graph, v.id).length);
  ctx.strokeText(degree, v.x, v.y);
  ctx.fillText(degree, v.x, v.y);
}

function drawSpawnRing(v, color, elapsed) {
  const t = Math.min(elapsed / SPAWN_MS, 1);
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.5 * (1 - t);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(v.x, v.y, VERTEX_RADIUS + RING_SPREAD * t, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function drawVertex(v, colors, scale = 1, selected = false) {
  const r = VERTEX_RADIUS * Math.max(scale, 0.01);
  const slice = (Math.PI * 2) / colors.length;
  ctx.shadowColor = colors[0];
  ctx.shadowBlur = 10;
  colors.forEach((color, i) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(v.x, v.y);
    ctx.arc(
      v.x, v.y, r,
      -Math.PI / 2 + i * slice,
      -Math.PI / 2 + (i + 1) * slice,
    );
    ctx.closePath();
    ctx.fill();
  });
  ctx.shadowBlur = 0;
  ctx.strokeStyle = selected ? '#e8eaf0' : '#12141a';
  ctx.lineWidth = selected ? 3 : 2;
  ctx.beginPath();
  ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
  ctx.stroke();
}

// --- panel ---

function updatePanel() {
  const s = state.stats;
  el('stat-v').textContent = s.V;
  el('stat-e').textContent = s.E;
  el('stat-f').textContent = s.planarDrawing ? s.F : '— (crossings)';
  el('stat-c').textContent = s.C;
  el('stat-chi').textContent = s.chi;
  el('stat-cross').textContent = s.crossings.pairs;
  el('stat-closed').textContent = state.closedSet.size;
  el('stat-k4').textContent = state.k4s.length;
  updateK4Chips();

  const euler = el('formula-euler');
  if (s.planarDrawing) {
    const lhs = s.V - s.E + s.F;
    const ok = lhs === 1 + s.C;
    euler.textContent =
      `V − E + F = ${s.V} − ${s.E} + ${s.F} = ${lhs} = 1 + C ${ok ? '✓' : '✗'}`;
    euler.className = ok ? 'ok' : 'bad';
  } else {
    euler.textContent = 'V − E + F: needs a crossing-free drawing';
    euler.className = 'muted';
  }

  const bound = el('formula-bound');
  if (s.V >= 3) {
    const ok = s.E <= 3 * s.V - 6;
    bound.textContent =
      `E ≤ 3V − 6: ${s.E} ≤ ${3 * s.V - 6} ${ok ? '✓' : '✗ (not planar)'}`;
    bound.className = ok ? 'ok' : 'bad';
  } else {
    bound.textContent = 'E ≤ 3V − 6: needs V ≥ 3';
    bound.className = 'muted';
  }

  const fct = el('formula-4ct');
  if (s.planarDrawing) {
    const ok = s.chi <= 4;
    fct.textContent = `Four Color Theorem: χ = ${s.chi} ≤ 4 ${ok ? '✓' : '✗'}`;
    fct.className = ok ? 'ok' : 'bad';
  } else {
    fct.textContent = `χ = ${s.chi} (theorem applies to planar graphs only)`;
    fct.className = 'muted';
  }
}

function updateK4Chips() {
  const list = el('k4-list');
  list.hidden = !state.showK4 || state.k4s.length === 0;
  const indexOf = new Map(state.graph.vertices.map((v, i) => [v.id, i]));
  list.innerHTML = state.k4s
    .map((quad, i) => {
      const label = state.naming.id === 'none'
        ? `#${i + 1}`
        : quad
          .map(id => state.naming.name(state.graph, state.coloring, id, indexOf.get(id)))
          .join('·');
      const hue = K4_COLORS[i % K4_COLORS.length];
      return `<span class="k4-chip" data-k4="${i}" style="border-color:${hue};color:${hue}">${label}</span>`;
    })
    .join('');
}

function setupPanel() {
  const select = el('mode-select');
  for (const mode of coloringModes) {
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = mode.label;
    select.appendChild(option);
  }
  select.value = state.mode.id;
  select.addEventListener('change', () => {
    state.mode = coloringModes.find(m => m.id === select.value);
    select.blur();
    render();
  });

  const naming = el('naming-select');
  for (const mode of namingModes) {
    const option = document.createElement('option');
    option.value = mode.id;
    option.textContent = mode.label;
    naming.appendChild(option);
  }
  naming.value = state.naming.id;
  naming.addEventListener('change', () => {
    state.naming = namingModes.find(m => m.id === naming.value);
    naming.blur();
    render();
    updateK4Chips(); // chip labels follow the naming mode
  });

  el('toggle-k4').addEventListener('click', (event) => {
    state.showK4 = !state.showK4;
    state.k4Focus = null;
    event.currentTarget.classList.toggle('active', state.showK4);
    render();
    updateK4Chips();
  });

  function sharedFilterValue(raw) {
    if (raw === 'none') return 'none';
    if (raw === '3+') return 3;
    return Number(raw);
  }

  el('shared-select').addEventListener('change', () => {
    state.sharedFilter = sharedFilterValue(el('shared-select').value);
    if (state.sharedFilter !== 'none' && state.diamondCheck) {
      state.diamondCheck = false;
      el('toggle-diamond').classList.remove('active');
    }
    el('shared-select').blur();
    render();
  });

  el('toggle-diamond').addEventListener('click', (event) => {
    state.diamondCheck = !state.diamondCheck;
    event.currentTarget.classList.toggle('active', state.diamondCheck);
    if (state.diamondCheck && state.sharedFilter !== 'none') {
      state.sharedFilter = 'none';
      el('shared-select').value = 'none';
    }
    render();
  });

  // Delegated hover: chips are rebuilt via innerHTML on every update.
  el('k4-list').addEventListener('mouseover', (event) => {
    const chip = event.target.closest('.k4-chip');
    if (chip === null) return;
    state.k4Focus = Number(chip.dataset.k4);
    render();
  });
  el('k4-list').addEventListener('mouseout', () => {
    if (state.k4Focus === null) return;
    state.k4Focus = null;
    render();
  });

  el('gen-run').addEventListener('click', () => {
    if (state.generating !== null) finishGeneration();
    else startGeneration();
  });

  el('toggle-kempe').addEventListener('click', (event) => {
    state.kempeMode = !state.kempeMode;
    event.currentTarget.classList.toggle('active', state.kempeMode);
    if (!state.kempeMode) state.kempe = null;
    render();
  });

  el('toggle-closed').addEventListener('click', (event) => {
    state.showClosed = !state.showClosed;
    event.currentTarget.classList.toggle('active', state.showClosed);
    render();
  });

  el('toggle-degrees').addEventListener('click', (event) => {
    state.showDegrees = !state.showDegrees;
    event.currentTarget.classList.toggle('active', state.showDegrees);
    render();
  });

  el('panel-close').addEventListener('click', () => {
    el('panel').classList.add('collapsed');
    el('panel-open').hidden = false;
  });
  el('panel-open').addEventListener('click', () => {
    el('panel').classList.remove('collapsed');
    el('panel-open').hidden = true;
  });

  el('toggle-stats').addEventListener('change', (event) => {
    el('stats-section').hidden = !event.target.checked;
  });
  el('toggle-formulas').addEventListener('change', (event) => {
    el('formulas-section').hidden = !event.target.checked;
  });
}

// --- interactions ---

function canvasPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return screenToWorld(state.view, event.clientX - rect.left, event.clientY - rect.top);
}

canvas.addEventListener('wheel', (event) => {
  event.preventDefault();
  const rect = canvas.getBoundingClientRect();
  const factor = Math.exp(-event.deltaY * 0.0015);
  state.view = zoomAt(
    state.view,
    event.clientX - rect.left,
    event.clientY - rect.top,
    factor,
  );
  render();
}, { passive: false });

canvas.addEventListener('mousedown', (event) => {
  if (state.generating !== null) return; // canvas is read-only while generating
  if (event.button === 1 || event.button === 2 || (event.button === 0 && event.shiftKey)) {
    event.preventDefault(); // middle button would start autoscroll
    state.drag = { type: 'pan', x: event.clientX, y: event.clientY };
    return;
  }
  if (event.button !== 0) return;
  const { x, y } = canvasPoint(event);
  if (state.kempeMode) {
    // Inspection mode: left clicks pick/cycle Kempe chains, nothing else.
    const target = vertexAt(x, y);
    if (target !== null) {
      selectKempe(target.id);
    } else if (state.kempe !== null) {
      state.kempe = null;
      render();
    }
    return;
  }
  const v = vertexAt(x, y);
  if (v !== null && state.spaceDown) {
    state.drag = { type: 'move', id: v.id, startX: v.x, startY: v.y };
  } else if (v !== null) {
    state.drag = { type: 'edge', fromId: v.id, x, y };
  } else {
    state.drag = { type: 'pending', x, y };
  }
});

window.addEventListener('mousemove', (event) => {
  if (state.drag === null) return;
  if (state.drag.type === 'pan') {
    state.view = panBy(state.view, event.clientX - state.drag.x, event.clientY - state.drag.y);
    state.drag.x = event.clientX;
    state.drag.y = event.clientY;
    render();
    return;
  }
  const { x, y } = canvasPoint(event);
  if (state.drag.type === 'pending') {
    if (Math.hypot(x - state.drag.x, y - state.drag.y) > CLICK_SLOP) {
      // Dragging on empty space becomes a marquee selection.
      state.drag = { type: 'select', x0: state.drag.x, y0: state.drag.y, x1: x, y1: y };
      render();
    }
  } else if (state.drag.type === 'select') {
    state.drag.x1 = x;
    state.drag.y1 = y;
    render();
  } else if (state.drag.type === 'move') {
    if (hasVertexNear(state.graph, x, y, MIN_VERTEX_GAP, state.drag.id)) return;
    const v = state.graph.vertices.find(v => v.id === state.drag.id);
    v.x = x;
    v.y = y;
    drawingChanged(); // crossings can change while moving; the coloring cannot
  } else if (state.drag.type === 'edge') {
    state.drag.x = x;
    state.drag.y = y;
    render();
  }
});

window.addEventListener('mouseup', (event) => {
  if (state.drag === null) return;
  if (state.drag.type === 'pan') {
    state.drag = null;
    return;
  }
  if (event.button !== 0) return;
  const { x, y } = canvasPoint(event);
  const drag = state.drag;
  state.drag = null;
  if (drag.type === 'select') {
    state.selection = new Set(verticesInRect(state.graph, drag.x0, drag.y0, drag.x1, drag.y1));
    render();
  } else if (drag.type === 'pending') {
    if (Math.hypot(x - drag.x, y - drag.y) <= CLICK_SLOP) {
      if (state.selection.size > 0) {
        // Like a file manager: a plain click first clears the selection.
        state.selection.clear();
        render();
        return;
      }
      // No vertex on top of another vertex or an edge (also lets a
      // double-click on an edge reach the dblclick delete handler).
      if (hasVertexNear(state.graph, x, y, MIN_VERTEX_GAP) || edgeAt(x, y) !== null) return;
      const v = addVertex(state.graph, x, y);
      state.lastCreated = { id: v.id, time: performance.now() };
      commit();
      animateSpawn(v.id);
    }
  } else if (drag.type === 'edge') {
    const target = vertexAt(x, y);
    if (target !== null && target.id !== drag.fromId
        && addEdge(state.graph, drag.fromId, target.id) !== null) {
      commit();
    } else {
      render(); // clear the rubber band
    }
  } else if (drag.type === 'move') {
    const v = state.graph.vertices.find(v => v.id === drag.id);
    if (v !== undefined && (v.x !== drag.startX || v.y !== drag.startY)) {
      commit();
    }
  }
});

// Right button pans; keep the browser context menu away.
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

canvas.addEventListener('dblclick', (event) => {
  if (state.generating !== null) return;
  const { x, y } = canvasPoint(event);
  const v = vertexAt(x, y);
  if (v !== null) {
    // Double-clicking empty canvas creates a vertex on the first click;
    // don't let the second click's dblclick immediately delete it.
    const justCreated = state.lastCreated !== null
      && state.lastCreated.id === v.id
      && performance.now() - state.lastCreated.time < DELETE_GUARD_MS;
    if (justCreated) return;
    removeVertex(state.graph, v.id);
    commit();
    return;
  }
  const e = edgeAt(x, y);
  if (e !== null) {
    removeEdge(state.graph, e.a, e.b);
    commit();
  }
});

window.addEventListener('keydown', (event) => {
  // Let form fields keep their native keys (digits, Backspace, arrows…).
  const target = event.target;
  if (target.tagName === 'SELECT'
      || (target.tagName === 'INPUT' && target.type !== 'checkbox')) {
    return;
  }
  // While generating, the only shortcut is Esc = stop & keep what exists.
  if (state.generating !== null) {
    if (event.code === 'Escape') finishGeneration();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyZ') {
    event.preventDefault();
    state.history = event.shiftKey ? redo(state.history) : undo(state.history);
    applyHistory();
    return;
  }
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyY') {
    event.preventDefault();
    state.history = redo(state.history);
    applyHistory();
    return;
  }
  if (event.code === 'Enter' && state.kempe !== null) {
    event.preventDefault();
    const chain = activeKempeChain();
    const own = state.coloring.colors.get(state.kempe.vertexId);
    swapKempeChain(state.coloring, chain, own, state.kempe.otherColor);
    // Keep the same color pair highlighted so Enter again reverses the swap.
    state.kempe = { vertexId: state.kempe.vertexId, otherColor: own };
    drawingChanged();
    return;
  }
  if (event.code === 'Delete' || event.code === 'Backspace') {
    if (state.drag !== null) return;
    event.preventDefault();
    if (event.shiftKey) {
      clearCanvas();
    } else if (state.selection.size > 0) {
      for (const id of state.selection) removeVertex(state.graph, id);
      commit();
    }
    return;
  }
  if (event.code === 'Space') {
    state.spaceDown = true;
    event.preventDefault(); // keep the page from scrolling
    canvas.style.cursor = 'grab';
  } else if (event.code === 'Escape') {
    if (state.drag !== null || state.selection.size > 0 || state.kempe !== null) {
      state.drag = null;
      state.selection.clear();
      state.kempe = null;
      render();
    }
  }
});

window.addEventListener('keyup', (event) => {
  if (event.code === 'Space') {
    state.spaceDown = false;
    canvas.style.cursor = 'crosshair';
  }
});

// --- boot ---

window.addEventListener('resize', resize);
setupPanel();
resize();
state.history = createHistory(cloneGraph(state.graph));
topologyChanged();
