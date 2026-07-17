import { neighbors } from './graph.js';

// Exact minimum proper coloring via backtracking.
// Returns { chi, colors: Map<vertexId, colorIndex in 0..chi-1> }.
// Terminates because k = |V| colors always suffice.
export function minimumColoring(graph) {
  if (graph.vertices.length === 0) return { chi: 0, colors: new Map() };
  const adj = new Map(
    graph.vertices.map(v => [v.id, new Set(neighbors(graph, v.id))]),
  );
  // High-degree vertices first: fails fast, prunes the search tree.
  const ids = graph.vertices
    .map(v => v.id)
    .sort((a, b) => adj.get(b).size - adj.get(a).size);
  for (let k = 1; ; k++) {
    const colors = new Map();
    if (assignColors(ids, adj, k, 0, colors, -1)) return { chi: k, colors };
  }
}

function assignColors(ids, adj, k, index, colors, maxUsed) {
  if (index === ids.length) return true;
  const id = ids[index];
  // Symmetry breaking: color c may only be introduced after 0..c-1 are in use.
  const limit = Math.min(k - 1, maxUsed + 1);
  for (let c = 0; c <= limit; c++) {
    let clashes = false;
    for (const nb of adj.get(id)) {
      if (colors.get(nb) === c) {
        clashes = true;
        break;
      }
    }
    if (clashes) continue;
    colors.set(id, c);
    if (assignColors(ids, adj, k, index + 1, colors, Math.max(maxUsed, c))) {
      return true;
    }
    colors.delete(id);
  }
  return false;
}

// Palette colors (0..paletteSize-1) the vertex can take while its neighbors
// keep their assigned colors. Always contains the vertex's own color.
export function feasibleColors(graph, coloring, vertexId, paletteSize = coloring.chi) {
  const used = new Set(
    neighbors(graph, vertexId).map(n => coloring.colors.get(n)),
  );
  const result = [];
  for (let c = 0; c < paletteSize; c++) {
    if (!used.has(c)) result.push(c);
  }
  return result;
}

// Connected component of vertexId in the subgraph of the two colors
// {own color, otherColor}. Swapping the two colors inside it keeps the
// coloring proper (Kempe chain).
export function kempeChain(graph, coloring, vertexId, otherColor) {
  const own = coloring.colors.get(vertexId);
  const allowed = new Set([own, otherColor]);
  const chain = new Set([vertexId]);
  const stack = [vertexId];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const n of neighbors(graph, current)) {
      if (!chain.has(n) && allowed.has(coloring.colors.get(n))) {
        chain.add(n);
        stack.push(n);
      }
    }
  }
  return chain;
}

// Swap colors a and b on every chain member (in place).
export function swapKempeChain(coloring, chain, a, b) {
  for (const id of chain) {
    const c = coloring.colors.get(id);
    coloring.colors.set(id, c === a ? b : a);
  }
}

// Display strategies: each maps a vertex to the list of palette colors to
// render on it. Add new modes here; the UI picks them up automatically.
export const coloringModes = [
  {
    id: 'assigned',
    label: 'Assigned color',
    vertexColors: (graph, coloring, vertexId) => [coloring.colors.get(vertexId)],
  },
  {
    id: 'feasible',
    label: 'All feasible colors',
    vertexColors: (graph, coloring, vertexId) =>
      feasibleColors(graph, coloring, vertexId),
  },
  {
    // Fixed theorem palette: independent of the current chi, so a lone
    // vertex shows all four colors. Widens only if chi ever exceeds 4.
    id: 'feasible4',
    label: 'All feasible colors (of 4)',
    vertexColors: (graph, coloring, vertexId) =>
      feasibleColors(graph, coloring, vertexId, Math.max(4, coloring.chi)),
  },
];
