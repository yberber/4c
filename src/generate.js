// Random graph generation: vertex placement and incremental edge picking.
// All randomness comes through an injected rng() → [0, 1) function, so the
// app can pass Math.random while tests pass a seeded generator.

import { hasEdge } from './graph.js';
import { canRouteNewEdge } from './routing.js';

// Mulberry32 — tiny seedable PRNG, plenty for layout randomness.
export function createRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Up to `count` positions inside `rect`, each at least `minGap` from every
// other and from `existing` points. Rejection sampling with a bounded try
// budget per point: a rect too small for the request yields fewer points
// instead of looping forever.
export function randomPositions(count, rect, minGap, rng, existing = []) {
  const placed = [];
  const taken = [...existing];
  for (let i = 0; i < count; i++) {
    for (let attempt = 0; attempt < 200; attempt++) {
      const p = { x: rect.x + rng() * rect.width, y: rect.y + rng() * rect.height };
      if (taken.every(q => Math.hypot(q.x - p.x, q.y - p.y) >= minGap)) {
        placed.push(p);
        taken.push(p);
        break;
      }
    }
  }
  return placed;
}

// A random vertex pair that can still get a crossing-free edge, or null
// when the drawing is saturated. Short pairs are preferred (with jitter):
// they are far more likely to be routable and give organic, web-like
// graphs instead of long arcs across the drawing.
export function pickRoutableEdge(graph, routes, rng) {
  const vs = graph.vertices;
  const candidates = [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      if (hasEdge(graph, vs[i].id, vs[j].id)) continue;
      const dist = Math.hypot(vs[i].x - vs[j].x, vs[i].y - vs[j].y);
      candidates.push({ a: vs[i].id, b: vs[j].id, score: dist * (0.3 + rng()) });
    }
  }
  candidates.sort((p, q) => p.score - q.score);
  for (const c of candidates) {
    if (canRouteNewEdge(graph, routes, c.a, c.b)) return { a: c.a, b: c.b };
  }
  return null;
}
