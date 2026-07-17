// Vertex naming strategies. Each mode maps a vertex to a display name (or
// null for none): name(graph, coloring, vertexId, index) where index is the
// vertex's position in graph.vertices (draw order).

// 0 -> A, 25 -> Z, 26 -> AA, ... like spreadsheet column headers.
export function spreadsheetLetters(n) {
  let s = '';
  n += 1;
  while (n > 0) {
    n -= 1;
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26);
  }
  return s;
}

export const namingModes = [
  {
    id: 'none',
    label: 'Off',
    name: () => null,
  },
  {
    id: 'color',
    label: 'By color (A = color)',
    name: (graph, coloring, vertexId) =>
      spreadsheetLetters(coloring.colors.get(vertexId)),
  },
  {
    id: 'numbered',
    label: 'V1, V2, …',
    name: (graph, coloring, vertexId, index) => `V${index + 1}`,
  },
  {
    id: 'letters',
    label: 'A, B, C, …',
    name: (graph, coloring, vertexId, index) => spreadsheetLetters(index),
  },
];
