import { componentCount, edgesShareEndpoint } from './graph.js';
import { polylinesCross } from './geometry.js';

// Proper crossings between the routed polylines of non-adjacent edges.
// Returns { pairs, edgeIndexes: Set<index into graph.edges> }.
export function findCrossings(graph, routes) {
  const edgeIndexes = new Set();
  let pairs = 0;
  for (let i = 0; i < graph.edges.length; i++) {
    for (let j = i + 1; j < graph.edges.length; j++) {
      if (edgesShareEndpoint(graph.edges[i], graph.edges[j])) continue;
      if (polylinesCross(routes[i].points, routes[j].points)) {
        pairs++;
        edgeIndexes.add(i);
        edgeIndexes.add(j);
      }
    }
  }
  return { pairs, edgeIndexes };
}

// F comes from Euler's formula for a crossing-free drawing:
// V − E + F = 1 + C (outer face included), so F = E − V + 1 + C.
// With unresolved crossings the drawing is not a planar embedding, so F is null.
export function computeStats(graph, coloring, routes) {
  const V = graph.vertices.length;
  const E = graph.edges.length;
  const C = componentCount(graph);
  const crossings = findCrossings(graph, routes);
  const planarDrawing = crossings.pairs === 0;
  const F = planarDrawing ? E - V + 1 + C : null;
  return { V, E, C, F, chi: coloring.chi, crossings, planarDrawing };
}
