# @softwarity/sigmet-draw

Draw **SIGMET/AIRMET geometries** on a map and (de)serialize them to/from
**ICAO/WMO TAC** (the coded text form, WMO-No.49 Vol II, App. 6).

It is a **headless library that grafts onto your map** — like Terra Draw. You
bring a MapLibre **or** OpenLayers map (basemap, controls, projection are yours);
the library adds the SIGMET drawing on top through a thin adapter, exposes
imperative tools (`circle()`, `meridian()`, …) and a `change` event, and never
depends on a concrete map engine.

The user picks a tool, a default geometry is **dropped** on the map, and they
just drag the handles — there is no freehand drawing. Each shape is clipped to
the FIR and its TAC is produced live.

## The 12 geometry templates

Each form is **parametric** (a few parameters + handles); the displayed area is
*derived* and clipped to the FIR, and the TAC is *serialized* from the parameters.

| # | Kind | TAC form | Handles |
|---|------|----------|---------|
| 1 | `meridian` | `E OF W012` | vertical line, pick side (E/W) |
| 2 | `parallel` | `N OF N54` | horizontal line, pick side (N/S) |
| 3 | `lineSide` | `SW OF LINE p1 - p2 [- p3 - p4]` | oblique line (2–4 pts, ends snap to the FIR border), pick side |
| 4 | `latBand` | `N OF S50 AND S OF N54` | two horizontal lines |
| 5 | `lonBand` | `E OF W012 AND W OF E005` | two vertical lines |
| 6 | `corridor` | `… OF LINE … AND … OF LINE …` | two oblique lines, area between |
| 7 | `quadrant` | `N OF N54 AND E OF W012` | a corner, click to pick the quadrant |
| 8 | `polygon` | `WI p1 - p2 - … - pn` | polygon vertices |
| 9 | `circle` | `WI 250NM OF PSN N2706 W07306` | centre + radius handle |
| 10 | `wideLine` | `APRX 50KM WID LINE BTN p1 - p2 [- p3 - p4]` | polyline (2–4 pts) + width handle |
| 11 | `entireFir` | `ENTIRE FIR` | — |
| 12 | `point` | `N48 E010` | single marker (constrained to the FIR) |

Lines/polygons drop their interior points **collinear** with their neighbours
from the result (and grey them out); line endpoints snap to the FIR boundary.

## Usage

### Headless graft (the primary API)

```ts
import { Map } from "maplibre-gl";
import { SigmetDraw, MapLibreAdapter } from "@softwarity/sigmet-draw";

const map = new Map({ container: "map", style, center, zoom }); // YOUR map
const sigmet = new SigmetDraw({
  adapter: new MapLibreAdapter({ map }),
  fir,                                   // GeoJSON Polygon/MultiPolygon — required
});

sigmet.on("change", ({ geometry, tac, area }) => console.log(tac));

circleBtn.onclick   = () => sigmet.circle();   // wire YOUR buttons
meridianBtn.onclick = () => sigmet.meridian();
clearBtn.onclick    = () => sigmet.clear();
```

OpenLayers is identical with `new OpenLayersAdapter({ map })` (an `ol/Map`). The
consumer loads the engine's stylesheet (`maplibre-gl/dist/maplibre-gl.css` or
`ol/ol.css`). Engine capabilities differ: globe is MapLibre-only.

`SigmetDraw` methods: `circle()`, `meridian()`, `parallel()`, `latBand()`,
`lonBand()`, `quadrant()`, `lineSide()`, `corridor()`, `polygon()`, `wideLine()`,
`point()`, `entireFir()`, `clear()`, plus `on("change", cb)`, `ready()`,
`firBounds()`, `destroy()`.

### Core only (no map)

```ts
import { toTAC, fromTAC, toArea } from "@softwarity/sigmet-draw/core";

const g = fromTAC("WI 250NM OF PSN N2706 W07306");
toTAC(g);                          // "WI 250NM OF PSN N2706 W07306"
toTAC(g, { minutes: "always" });   // pad whole-degree minutes (N5400)
toArea(g, { fir });                // GeoJSON Feature, clipped to the FIR
```

## Architecture

One repo, **one npm package** (built with `tsc`), plus a `demo/` served/built by
Vite. The map engine is confined to the adapters; everything above is agnostic.

```
src/
  core/                pure logic — 12 templates, TAC ↔ params, area (turf) — no map dep
  map/
    adapter.ts         MapAdapter interface (ready/setOverlay/onPointer/…)
    maplibre-adapter.ts   MapLibreAdapter({ map })   + createMapLibreMap
    openlayers-adapter.ts OpenLayersAdapter({ map }) + createOpenLayersMap
    sigmet-draw.ts     SigmetDraw — the engine-agnostic drawing logic
test/                  vitest (core)
demo/                  Vite demo: graft on both engines, FIR selector (incl. an
                       antimeridian FIR), dev-composed buttons
```

Package exports: `.` (all), `./core` (pure logic), `./maplibre`, `./openlayers`
(per-engine adapters, so a consumer pulls only the engine it uses). MapLibre and
OpenLayers are optional `peerDependencies`.

### Notable details

- **FIR is required** — used for clipping, the centre/point-inside-FIR
  constraint, line-endpoint snapping, and rendered as an outline.
- **Antimeridian** — a FIR straddling 180° is detected and handled in an
  unwrapped longitude frame; TAC is re-normalised to ±180.
- Geometry via **Turf 7** (`circle`, `buffer`, `intersect`, `booleanPointInPolygon`).

## Development

```bash
npm install
npm run build     # tsc → dist
npm test          # vitest (core)
npm run demo      # Vite dev server
npm run demo:build  # static build → docs/ (GitHub Pages)
```

## References

- WMO-No.49 Vol II, Appendix 6 — SIGMET/AIRMET templates & examples (A6-1/2/3).
- ICAO Annex 3 / PANS-ABC (Doc 8400) for abbreviations.
