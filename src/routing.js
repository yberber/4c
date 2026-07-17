import { pointSegmentDistance, polylinesCross } from './geometry.js';
import { edgesShareEndpoint, hasEdge } from './graph.js';

const CURVE_SEGMENTS = 16;
// Candidate bulge sizes as fractions of the chord length, flattest first.
const OFFSET_FACTORS = [
  0.25, -0.25, 0.5, -0.5, 0.75, -0.75, 1, -1,
  1.25, -1.25, 1.5, -1.5, 2, -2, 2.5, -2.5,
];
// Control-point anchors along the chord: mid bulges plus skewed bulges,
// so obstacles sitting near one endpoint can still be rounded.
const ANCHORS = [0.5, 0.25, 0.75];
export const VERTEX_CLEARANCE = 22;

// Flatten the quadratic Bézier a→b with an arbitrary control point.
export function curveThrough(a, control, b, segments = CURVE_SEGMENTS) {
  const points = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const u = 1 - t;
    points.push({
      x: u * u * a.x + 2 * u * t * control.x + t * t * b.x,
      y: u * u * a.y + 2 * u * t * control.y + t * t * b.y,
    });
  }
  return points;
}

// Midpoint control point displaced `offset` px perpendicular to the chord.
export function controlPoint(a, b, offset) {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: mx - (dy / len) * offset, y: my + (dx / len) * offset };
}

// Midpoint-bulge special case (offset 0 short-circuits to the straight
// polyline); kept for tests and simple callers.
export function curvePoints(a, b, offset, segments = CURVE_SEGMENTS) {
  if (offset === 0) return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  return curveThrough(a, controlPoint(a, b, offset), b, segments);
}

// The flattest acceptable route for the edge, or null when nothing fits:
// straight first, then quadratics whose control point sits at 50/25/75% of
// the chord, displaced perpendicularly by growing fractions of the chord.
function findRoute(graph, routes, edge, a, b) {
  const straight = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
  if (clearsVertices(straight, graph, edge)
      && !crossesRouted(straight, edge, routes, graph)) {
    return { control: null, points: straight };
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const chord = Math.hypot(dx, dy) || 1;
  const nx = -dy / chord;
  const ny = dx / chord;
  for (const factor of OFFSET_FACTORS) {
    for (const anchor of ANCHORS) {
      const control = {
        x: a.x + dx * anchor + nx * factor * chord,
        y: a.y + dy * anchor + ny * factor * chord,
      };
      const points = curveThrough(a, control, b);
      if (!clearsVertices(points, graph, edge)) continue;
      if (crossesRouted(points, edge, routes, graph)) continue;
      return { control, points };
    }
  }
  return null;
}

// Greedy routing: edges are processed in insertion order; each takes the
// flattest curve that clears unrelated vertices and every previously
// routed edge. Falls back to straight (a visible crossing) when nothing
// fits — which is guaranteed to happen somewhere in a non-planar graph.
export function routeEdges(graph) {
  const pos = new Map(graph.vertices.map(v => [v.id, v]));
  const routes = [];
  for (const edge of graph.edges) {
    const a = pos.get(edge.a);
    const b = pos.get(edge.b);
    const route = findRoute(graph, routes, edge, a, b);
    routes.push(route ?? { control: null, points: [{ x: a.x, y: a.y }, { x: b.x, y: b.y }] });
  }
  return routes;
}

// Exact "could routeEdges route a new edge a-b crossing-free?" check —
// greedy routing never re-routes earlier edges, so existing routes are final.
export function canRouteNewEdge(graph, routes, aId, bId) {
  const pos = new Map(graph.vertices.map(v => [v.id, v]));
  const edge = { a: aId, b: bId };
  return findRoute(graph, routes, edge, pos.get(aId), pos.get(bId)) !== null;
}

// Vertices with no crossing-free edge to ANY non-adjacent partner.
// Empty for V < 2 (a lone vertex is not meaningfully "closed").
export function closedVertices(graph, routes) {
  if (graph.vertices.length < 2) return new Set();
  const closed = new Set();
  for (const v of graph.vertices) {
    let open = false;
    for (const u of graph.vertices) {
      if (u.id === v.id || hasEdge(graph, v.id, u.id)) continue;
      if (canRouteNewEdge(graph, routes, v.id, u.id)) {
        open = true;
        break;
      }
    }
    if (!open) closed.add(v.id);
  }
  return closed;
}

function clearsVertices(points, graph, edge) {
  for (const v of graph.vertices) {
    if (v.id === edge.a || v.id === edge.b) continue;
    for (let i = 0; i + 1 < points.length; i++) {
      if (pointSegmentDistance(v, points[i], points[i + 1]) < VERTEX_CLEARANCE) {
        return false;
      }
    }
  }
  return true;
}

function crossesRouted(points, edge, routes, graph) {
  for (let i = 0; i < routes.length; i++) {
    if (edgesShareEndpoint(edge, graph.edges[i])) continue;
    if (polylinesCross(points, routes[i].points)) return true;
  }
  return false;
}
