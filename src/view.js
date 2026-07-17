// View transform for the canvas: screen = world * scale + (x, y).

export function createView() {
  return { scale: 1, x: 0, y: 0 };
}

export function screenToWorld(view, sx, sy) {
  return { x: (sx - view.x) / view.scale, y: (sy - view.y) / view.scale };
}

// Cursor-centered zoom: the world point under (sx, sy) stays fixed.
export function zoomAt(view, sx, sy, factor, min = 0.2, max = 5) {
  const scale = Math.min(max, Math.max(min, view.scale * factor));
  const k = scale / view.scale;
  return { scale, x: sx - (sx - view.x) * k, y: sy - (sy - view.y) * k };
}

export function panBy(view, dx, dy) {
  return { ...view, x: view.x + dx, y: view.y + dy };
}
