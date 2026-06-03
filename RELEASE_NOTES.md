# Release Notes

## 1.0.2

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
