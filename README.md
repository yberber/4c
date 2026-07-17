# Four Color Theorem Explorer

Interactive canvas app for exploring the Four Color Theorem: every planar
graph is properly colorable with at most 4 colors. Draw a graph and the app
always colors it with the exact minimum number of colors, while live stats
(V, E, F, components, χ, crossings) and formulas (Euler, planarity bound,
the theorem itself) update in real time.

**Live demo:** https://yuberber-4c.static.hf.space (fullscreen) ·
[Space page](https://huggingface.co/spaces/yuberber/4c) ·
[mirror on GitHub Pages](https://yberber.github.io/4c/)

## Run

    npm run serve

Then open http://localhost:8000.

## Controls

| Action | Effect |
|---|---|
| Left click on empty canvas | Add vertex |
| Drag from vertex to vertex | Add edge |
| Space + drag vertex | Move vertex |
| Double-click vertex / edge | Delete it |
| Drag on empty space | Marquee-select vertices |
| Delete / Backspace | Delete the selection |
| Shift+Delete | Clear the whole canvas |
| Ctrl+Z / Ctrl+Y | Undo / redo |
| Esc | Cancel drag |
| Mouse wheel | Zoom (cursor-centered) |
| Right / Middle / Shift drag | Pan the view |

The panel collapses like a popup via its `−` button (a round button reopens
it). The `①` icon in the panel header toggles showing each vertex's degree
inside its circle. The `⊘` icon toggles dashed-ring markers on "closed"
vertices — vertices from which no crossing-free edge can currently be drawn
to any non-adjacent vertex. Closed-ness is recomputed from the drawing after
every change, so deleting an edge or moving a vertex can reopen a vertex and
its ring disappears automatically.

Crossing edges are highlighted red; the face count and Euler's formula are
only valid for crossing-free drawings.

## Random graph

The panel's **Random graph** section generates a graph with an animation:
give a vertex count (2–80), optionally an edge count (leave empty for the
**maximum** — edges are added until no crossing-free edge remains, which
lands exactly on a maximal planar triangulation, E = 3V − 6, when space
allows), and set the speed slider (live-adjustable mid-run). Generate
clears the canvas, pops the vertices in one by one, then adds random
routable edges — shorter pairs preferred, so the result looks like an
organic web. The whole run is a single undoable step; press Esc or the
Stop button to keep what has been built so far. The canvas ignores input
while a run is in progress.

## Coloring modes

**Assigned color** shows the computed minimum coloring. **All feasible
colors** shows, per vertex, every color of the χ-palette its neighbors do
not block — so the display depends on the current minimum. **All feasible
colors (of 4)** (the default) uses the fixed four-color theorem palette
instead: a lone vertex shows all four colors, and the display does not
change just because a K4 elsewhere raised χ. (The palette widens beyond 4
only if χ does, e.g. for a non-planar K5.)

## Vertex names

The "Vertex names" dropdown labels vertices below their circle: **Off**,
**By color** (every color class shares one letter, A = first color),
**V1, V2, …** or **A, B, C, …** (both in draw order). Letter modes continue
past Z spreadsheet-style: AA, AB, AC, …

## K4 groups

The `K₄` icon (off by default) highlights every complete four-vertex group
(all six mutual edges — drawn planar they form three triangular faces).
Each group gets its own colored hull outline (hues cycle, outlines stagger
so overlapping groups stay separable), and the panel lists one color-coded
chip per group — hover a chip to ring that group's four vertices in its
color.
Such a group is a hard barrier: a fifth vertex adjacent to all four would
form K5, which is not planar — so no future vertex can ever connect to the
whole group without a crossing.

## Kempe chains

The `⇆` icon enters Kempe-chain mode — the central device of Kempe's 1879
proof attempt and of the modern proof's discharging arguments. Click a
vertex to highlight the connected component of its color together with a
partner color (click again to cycle the partner); press Enter to swap the
two colors along the chain, which always keeps the coloring proper. Swaps
permute the current coloring only, so they are not part of undo history —
pressing Enter again reverses the swap.

## Shared-neighbor edge analysis

Every edge connects two vertices; **shared neighbors** counts how many
other vertices are adjacent to both endpoints (equivalently, how many
triangles the edge belongs to). The panel's **Shared neighbors** dropdown
highlights every edge matching a chosen count (1, 2, or 3+) in amber.

The `◆` icon toggles **diamond check**: for edges with exactly two shared
neighbors — an edge shared by two triangles, forming a diamond — it colors
the edge green if those two triangle-apex vertices have the same color, red
if they differ. Edges with any other shared-neighbor count are left
unstyled. Turning on the dropdown highlight or the diamond check cancels
the other; only one overlay shows at a time.

## Develop

    npm test

Pure logic lives in `src/graph.js`, `src/coloring.js`, `src/geometry.js`,
`src/stats.js` (unit-tested with Vitest). `src/app.js` is the canvas UI.

Redeploy with `scripts/deploy-pages.sh` (GitHub Pages, uses gh CLI) and
`scripts/deploy-hf.sh` (HF Space, needs `~/.hf_token`). Both push the
current working tree as a single fresh commit, so repo history stays out of
the public deploy targets.
