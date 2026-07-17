export function createGraph() {
  return { vertices: [], edges: [], nextId: 1 };
}

export function addVertex(graph, x, y) {
  const v = { id: graph.nextId++, x, y };
  graph.vertices.push(v);
  return v;
}

export function addEdge(graph, a, b) {
  if (a === b || hasEdge(graph, a, b)) return null;
  const e = { a, b };
  graph.edges.push(e);
  return e;
}

export function hasEdge(graph, a, b) {
  return graph.edges.some(
    e => (e.a === a && e.b === b) || (e.a === b && e.b === a),
  );
}

export function removeVertex(graph, id) {
  graph.vertices = graph.vertices.filter(v => v.id !== id);
  graph.edges = graph.edges.filter(e => e.a !== id && e.b !== id);
}

export function removeEdge(graph, a, b) {
  graph.edges = graph.edges.filter(
    e => !((e.a === a && e.b === b) || (e.a === b && e.b === a)),
  );
}

export function cloneGraph(g) {
  return {
    vertices: g.vertices.map(v => ({ ...v })),
    edges: g.edges.map(e => ({ ...e })),
    nextId: g.nextId,
  };
}

export function hasVertexNear(g, x, y, gap, excludeId = null) {
  return g.vertices.some(
    v => v.id !== excludeId && Math.hypot(v.x - x, v.y - y) < gap,
  );
}

// Vertex ids adjacent to both a and b (excludes a and b themselves).
export function commonNeighbors(graph, a, b) {
  return neighbors(graph, a).filter(n => hasEdge(graph, b, n));
}

// All 4-cliques, each as a sorted array of vertex ids (deduplicated).
// A K4 is a hard barrier: a fifth vertex adjacent to all four would form
// K5, which is not planar.
export function findK4s(graph) {
  const seen = new Set();
  const result = [];
  for (const e of graph.edges) {
    const common = commonNeighbors(graph, e.a, e.b);
    for (let i = 0; i < common.length; i++) {
      for (let j = i + 1; j < common.length; j++) {
        if (!hasEdge(graph, common[i], common[j])) continue;
        const quad = [e.a, e.b, common[i], common[j]].sort((a, b) => a - b);
        const key = quad.join('-');
        if (!seen.has(key)) {
          seen.add(key);
          result.push(quad);
        }
      }
    }
  }
  return result;
}

// Vertices whose centers lie in the rectangle spanned by two corners.
export function verticesInRect(graph, x1, y1, x2, y2) {
  const [minX, maxX] = x1 < x2 ? [x1, x2] : [x2, x1];
  const [minY, maxY] = y1 < y2 ? [y1, y2] : [y2, y1];
  return graph.vertices
    .filter(v => v.x >= minX && v.x <= maxX && v.y >= minY && v.y <= maxY)
    .map(v => v.id);
}

export function edgesShareEndpoint(e, f) {
  return e.a === f.a || e.a === f.b || e.b === f.a || e.b === f.b;
}

export function neighbors(graph, id) {
  const result = [];
  for (const e of graph.edges) {
    if (e.a === id) result.push(e.b);
    else if (e.b === id) result.push(e.a);
  }
  return result;
}

export function componentCount(graph) {
  const seen = new Set();
  let count = 0;
  for (const v of graph.vertices) {
    if (seen.has(v.id)) continue;
    count++;
    const stack = [v.id];
    seen.add(v.id);
    while (stack.length > 0) {
      const current = stack.pop();
      for (const n of neighbors(graph, current)) {
        if (!seen.has(n)) {
          seen.add(n);
          stack.push(n);
        }
      }
    }
  }
  return count;
}
