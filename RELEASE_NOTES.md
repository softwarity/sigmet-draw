# Release Notes

## 1.1.1

### Features

- **Read-only mode**: `sigmet.setReadonly(true)` freezes editing — it hides the toolbar and every grab handle/guide and ignores pointer edits, while the area + on-shape label stay visible. `setReadonly(false)` restores everything; `isReadonly` reads the state. Toggle as often as you like (re-renders on each flip). The demo gains an external **Read-only** checkbox in its top bar.

Pre-release audit follow-ups (no behaviour change for the common, non-antimeridian case).

### Fixes

- **Antimeridian — loaded geometry**: `load()` now re-expresses longitudes in the FIR working frame, so a geometry from `fromTAC()` lines up with an antimeridian-crossing FIR (its handles, clipping and pointer input no longer disagree with the coordinates).
- **Antimeridian — `lonBand` editing**: dragging a `west > east` (AM-crossing) band no longer collapses it — the bounds clamp only to the FIR bbox instead of forcing `west ≤ east`.
- **Degenerate line on translate/rotate**: after a whole-line drag or transform, the line-side / corridor endpoints are re-snapped to the FIR border *and re-validated* (`lineUsable`); a step that would leave the line collapsed or self-crossing is rejected, so no degenerate TAC is emitted.
- **Transform scale floor**: the polygon/line transform can no longer blow up its scale when the remembered handle anchor sits near the centroid (`r0` is floored like the cursor distance).
- **Strict role parsing**: vertex roles are parsed with a strict `^[a-z]\d+$` matcher, so a malformed/empty suffix can't silently resolve to vertex 0.

### Internal / API

- **Removed the `other` style token** (and the `OtherStyle` export): the opposite-side / quadrant-pick surface is an internal, invisible click zone — there's no reason to theme it. *(Breaking only if you set `style.other`.)*
- Exported the missing `TropicalCycloneGeometry` type (it's produced by `fromTAC`).
- `setCursor` is now private on both adapters (it was never part of the `MapAdapter` contract).
- De-duplicated the hover-cursor logic into a shared `cursorForHit` helper; added a `KM_PER_NM` constant for the scattered `1.852` conversions; added `lineUsable` to the pure geometry helpers.
- **God-module split**: the ~19 pure lon/lat helpers (haversine, bearing, destination, projection, polyline sampling, bbox, antimeridian (un)wrap, role parsing) moved out of `sigmet-draw.ts` into a new `geo.ts` — the controller drops ~290 lines and the helpers are now directly unit-testable.
- Tests: **+29** — `lineUsable`; a controller harness (fake adapter) covering move-handle translate, vertex-merge rejection, `lonBand` wrap, antimeridian `load` unwrap and read-only mode; and a full `geo.ts` suite. **154 total.**

---

## 1.0.4

### Features

- **Move handle with chevron icon**: the polygon, circle and **buffer of line** (wide line) now carry a **move** handle — a small dot ringed by four outward chevrons (N/E/S/W) — that translates the whole shape, with a `move` (four-arrow) hover cursor. Edits (move, scale, rotate, vertex) are allowed as long as **at least one point stays inside the FIR** — handles and even most points may leave it (the circle keeps its centre in, as before). The icon renders on both the MapLibre and OpenLayers adapters; its dot and glyph are themed from the unified `iconHandle` token (see the style restructure below).
- **Polygon transform handle**: a handle at the top-right bounding-box corner now **scales *and* rotates** the whole ring about its centroid — drag in/out to resize, drag around to spin. It carries a rotate/resize glyph (a curved double-headed arrow between two radial chevrons, no centre dot) that **spins with the handle's orbit angle**. The handle rides its material position during the gesture (so rotation stays stable). Editing a 7-point area no longer means dragging every vertex.
- **Circle resize glyph**: the circle's radius handle now shows the same radial resize chevrons (centre ↔ exterior, no rotation arc) over a small dot, spinning with its bearing — consistent with the polygon transform handle.
- **Buffer of line — transform handle**: the wide line gains the same corner **scale+rotate** handle as the polygon, placed just outside its envelope (so it never crowds the move/width/vertex handles). Its width handle shows the same **resize chevrons** as the circle radius and **rides the whole buffer border** — it slides along the straight sides and, when dragged past an end, follows the **rounded cap arc** (its offset is stored as a bearing relative to the line, so it survives edits). It starts from an extremity so it doesn't sit on the move handle. Scale + rotate share the polygon's `applyTransform`/`transformRest` core, so there's no start-of-rotation jump. The redundant centreline guide is no longer drawn — the filled buffer already shows it.
- **Line side & corridor — draggable lines + transform**: their construction lines are now **grabbable** (drag the line body to translate it — incrementally, no grab jump; each corridor leg moves on its own), and each gains the same corner **scale + rotate** handle as the polygon (the corridor's rotates both legs about their joint centroid). Throughout, the **two endpoints stay pinned to the FIR border** (re-snapped after any drag/transform), and edits respect the *one-point-in-FIR* rule. New lines are created along the **SW→NE diagonal (~45°)** so they read differently from the horizontal/vertical lat- and lon-bands (the diagonal is clipped to the FIR bbox so the two corridor legs stay distinct instead of collapsing onto one line). The move cursor now appears only on lines you can actually drag (those carrying a role).

### Fixes

- **Polygon default vertices**: a new polygon now starts with **7** vertices (the WMO maximum for a `WI` polygon) instead of 5; redundant/collinear corners are still auto-dropped from the TAC and area.
- **Orphan / isolated polygon nodes & spurious crossings**: collinear simplification dropped a vertex when it was near-straight with its *immediate* neighbours, so a gently bowing run was removed wholesale — the dropped handles floated off the outline and the surviving chord could cut across a concavity. `collapseRing` is now a proper **Douglas-Peucker** simplification using distance to the *segment* (not the infinite line), which provably keeps every dropped vertex within `tol` of the simplified outline — no orphan nodes, no collapse-induced crossing. Verified by an exhaustive drag sweep.
- **Small polygons**: the snap / merge / collapse tolerances now scale with the **polygon's own size**, not the FIR span. A small polygon's FIR-relative thresholds used to dwarf it, fusing nearby vertices and flagging them all as collinear (ignored). They're now scale-invariant.
- **Vertex editing (all editable shapes)**: a vertex moves and acts only on its adjacent edge(s). It keeps a clearance from every other vertex (can't merge two points) and from every non-adjacent edge — so it can't land on a segment, cross one (bow-tie), **or sweep its edge over another vertex**. The guard applies to the polygon and to the open-line shapes — **line side**, **corridor** legs and **buffer of line** (wide line) — which had the same self-crossing bug. The vertex sticks just shy of the obstacle until the cursor leads it elsewhere.
- **MapLibre teardown**: `destroy()` now also removes the handle-glyph images (`sigmet-move/transform/resize`) it added to the host map, and an in-flight async icon load is dropped if the adapter was torn down meanwhile (no use-after-destroy `addImage` on the host map).

### Breaking — style API restructured

The `SigmetStyle` tokens are renamed and flattened around two ideas — *things you grab by a dot* and *things you grab by a line* — with consistent `fill` / `stroke` / `width` naming:

```
area:       { fill, stroke, width, opacity }          // was { fill:{color,opacity}, line:{color,width} }
other:      { fill, opacity }                          // was { fill:{color,opacity} }
iconHandle: { fill, stroke, width, radius }           // merges vertex + controlHandle + moveHandle
lineHandle: { stroke, width }                          // was guide
label:      { color, halo, size, width }               // width = max label px (wraps); halo from size
tooltip:    { color, background, size }                // was { …, fontSize, padding, borderRadius, maxWidth }
```

- All handles (vertex / control / move / resize / transform / radius) now share **one** `iconHandle` look; the smaller move/resize dot is derived (×0.7) and the glyphs are coloured from `iconHandle.stroke`.
- `lineHandle` styles the draggable meridian/parallel lines.
- Removed exports: `FillStyle`, `LineStyle`, `PointStyle`. Added: `AreaStyle`, `OtherStyle`, `IconHandleStyle`, `LineHandleStyle`.
- **Collinear (TAC-redundant) vertices are always shown as a smaller, stroke-less grey dot** — that state is no longer styleable (the old `collinearVertex` token is gone, with no replacement).
- Dropped (now internal constants): line `dash`, label `offsetY`, tooltip `padding` / `borderRadius` / `maxWidth`.

### Internal

- New pure, unit-tested geometry helpers: `segmentsCross` (proper crossing), `segmentDistance` (segment-to-segment clearance), and `ringMoveValid` / `lineMoveValid` (closed-ring & open-polyline edit legality: vertex/edge clearances + edge-vs-vertex sweep guard, sharing one `pathMoveValid` core). `collapseRing` is now a Douglas-Peucker simplification (segment distance). New `moveIconDataUri` style helper for the chevron move icon. Tests: +22.

---

## 1.0.3

 - Remove firs.geojson file from root 

---

## 1.0.2

- Remove angular cache files
- Complete .gitignore to prevent them from being added again
- Add tests for toolbar

---

## 1.0.1

### Fixes

- **Hover tooltip crash**: hovering a shape that momentarily doesn't intersect the FIR (an empty area) no longer throws — `updateTooltip` now skips areas with no fillable ring.
- **Empty intersection**: `clip()` treats a valid-but-empty JSTS result as a genuine no-overlap (instead of passing an empty geometry downstream).
- **Latitude band**: a reversed-but-legal encoding (`N OF N54 AND S OF N50`) is now sorted so `south ≤ north` instead of building a degenerate rectangle. Longitude bands are left untouched (a `west > east` band legitimately crosses the antimeridian).
- **Antimeridian detection** is now structural — the FIR touches both ±180 edges (split form) or has an edge jump > 180° (jump form) — instead of a bbox-width heuristic that could misfire on a very wide non-crossing FIR.
- **MapLibre**: a drag released outside the map canvas no longer leaves panning disabled (a window-level `mouseup` finishes the drag, mirroring the OpenLayers adapter).

### Internal

- **OpenLayers** hit-testing forwards the full feature property bag (parity with MapLibre).
- Removed the unused `setCursor` from the public `MapAdapter` interface (kept private in each adapter).
- Documented the tropical-cyclone placeholder centre (`toArea`) and the process-global toolbar `<style>` injection.
- Added `prepublishOnly` (build + test) and `engines.node >= 18`.
- Tests: +17 (tooltip style merge, latBand sorting, toolbar 12-position layout, `SigmetToolbar` controller); added `jsdom` for the DOM-level toolbar tests.

---

## 1.0.0

First public release.

### Geometry & TAC

- **The SIGMET/AIRMET location forms**: circle (`WI nnNM OF PSN`), tropical-cyclone circle (`WI nnnNM OF TC CENTRE`, separate tool — centre supplied by the caller, radius 0–999), meridian/parallel half-planes (`E/W/N/S OF`), latitude/longitude bands, quadrant, side-of-line (`… OF LINE`, 2–4 points), corridor (band between two lines), wide line (`APRX nnKM WID LINE BTN`, 2–4 points), polygon (`WI`), point, and `ENTIRE FIR`.
- **TAC round-trip**: `toTAC` / `fromTAC` encode and decode ICAO/WMO text; `toArea` derives the GeoJSON area, clipped to the FIR. Coordinate validation rejects out-of-range degrees and minutes ≥ 60.
- **Units rule**: circle/wide-line radii & widths follow the 2-digit form (KM up to 99, then NM, capped at 99); the tropical cyclone allows 3 digits (up to 999). `nauticalMilesOnly: true` forces NM everywhere.
- **Antimeridian-crossing FIRs** handled in an unwrapped longitude frame; `clip()` self-heals JSTS robustness failures (precision snap + `buffer(0)`).
- **Pure core**: the templates, the TAC codec and `toArea` live in `./core` with no map dependency.

### Headless "graft" drawing

- **Bring your own map** — the library never owns it. Adapters for **MapLibre GL** and **OpenLayers** behind a small `MapAdapter`; identical behaviour across engines, with no destructive teardown (`destroy()` removes only what it added).
- **Drop-then-drag UX**: selecting a tool drops a default geometry inside the FIR; the user only drags handles. The area is clipped to the FIR live.
- **Editing aids**: collinear-vertex snapping (aligned points snap onto the line and drop from the TAC), drag re-renders coalesced to one per frame.
- **Events**: `on("tac", (tac) => …)` for the common case, or `on("change", (r) => …)` for the full result (`geometry` + `tac` + `area`); `off(…)` to unsubscribe.

### Toolbar, styling, overlays

- **Turnkey toolbar** (`toolbar` option + live `sigmet.toolbar` controller): native control group with built-in icons, every tool wired. 12 positions (top/bottom/left/right, centred or cornered — the edge sets the bar orientation), per-side `padding`, `gap`, `tools`/`clear` selection. The tropical-cyclone button is greyed until `toolbar.tcCenter` is set. Or build your own from the exported `DEFAULT_TOOLS` / `TOOL_ICONS`.
- **Engine-agnostic `SigmetStyle`** (translated natively per engine): tokens for `area` fill/outline, `other`, `guide`, `vertex`, `collinearVertex`, `controlHandle`, `label`, `tooltip`. Partial overrides at construction (`style`) or live (`setStyle`).
- **Dynamic label & tooltip**: `label` prints text **on** the shape, `tooltip` shows a floating box **on hover** — both `(result) => string`, set at construction or live (`setLabel` / `setTooltip`).
- **`firCenter()` / `firBounds()`** helpers; `load()`, `setFir()`, `clear()`, `ready()`, `destroy()`.

---
