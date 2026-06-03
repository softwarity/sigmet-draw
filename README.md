# @softwarity/sigmet-draw

[![npm version](https://img.shields.io/npm/v/@softwarity/sigmet-draw.svg)](https://www.npmjs.com/package/@softwarity/sigmet-draw)
[![minzipped size](https://img.shields.io/bundlephobia/minzip/@softwarity/sigmet-draw)](https://bundlephobia.com/package/@softwarity/sigmet-draw)
[![install size](https://packagephobia.com/badge?p=@softwarity/sigmet-draw)](https://packagephobia.com/result?p=@softwarity/sigmet-draw)

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
| 9b | `tropicalCyclone(center)` | `WI 250NM OF TC CENTRE` | **fixed** centre (caller-provided) + radius handle |
| 10 | `wideLine` | `APRX 50KM WID LINE BTN p1 - p2 [- p3 - p4]` | polyline (2–4 pts) + width handle |
| 11 | `entireFir` | `ENTIRE FIR` | — |
| 12 | `point` | `N48 E010` | single marker (constrained to the FIR) |

Lines/polygons drop their interior points **collinear** with their neighbours
from the result (and grey them out); line endpoints snap to the FIR boundary;
dragging a vertex near collinearity snaps it onto the line.

**Radius/width units** follow the 2-digit/3-digit TAC rule: KM up to the cap,
then NM (physically larger), capped — circle/wide-line `0…99`, tropical cyclone
`0…999`. Pass `nauticalMilesOnly: true` to always emit NM. The tropical-cyclone
centre is **not** part of the TAC (it lives in the TC SIGMET's `PSN` element), so
`fromTAC("WI 250NM OF TC CENTRE")` returns the geometry with a placeholder centre
that `SigmetDraw` resolves to the FIR centroid for display.

## Usage

### Headless graft (the primary API)

```ts
import { Map } from "maplibre-gl";
import { SigmetDraw, MapLibreAdapter } from "@softwarity/sigmet-draw";

const map = new Map({ container: "map", style, center, zoom }); // YOUR map
const sigmet = new SigmetDraw({
  adapter: new MapLibreAdapter({ map }),
  fir,                                   // GeoJSON Polygon/MultiPolygon — required
  label: (r) => r.tac,                   // optional on-shape text (omit for none)
  tooltip: (r) => r.tac,                 // optional floating tooltip on hover
  nauticalMilesOnly: false,              // optional — never emit KM when true
  toolbar: { position: "top-left" },     // optional turnkey toolbar (see below)
  style: { area: { fill: { color: "#e11d48", opacity: 0.3 } } }, // optional, see below
});

sigmet.on("tac", (tac) => console.log(tac));                    // just the TAC — common case
sigmet.on("change", ({ geometry, tac, area }) => { /* full result */ });

circleBtn.onclick   = () => sigmet.circle();   // wire YOUR buttons
meridianBtn.onclick = () => sigmet.meridian();
clearBtn.onclick    = () => sigmet.clear();
```

OpenLayers is identical with `new OpenLayersAdapter({ map })` (an `ol/Map`). The
consumer loads the engine's stylesheet (`maplibre-gl/dist/maplibre-gl.css` or
`ol/ol.css`). Engine capabilities differ: globe is MapLibre-only.

`SigmetDraw` methods: `circle()`, `tropicalCyclone(center)`, `meridian()`, `parallel()`,
`latBand()`, `lonBand()`, `quadrant()`, `lineSide()`, `corridor()`, `polygon()`,
`wideLine()`, `point()`, `entireFir()`, `clear()`, plus `on/off("change"|"tac", cb)`,
`load(geometry)`, `setFir(fir)`, `firBounds()`, `firCenter()`, `setStyle(…)`,
`setLabel(fn)`, `setTooltip(fn)`, `ready()`, `destroy()`, and the `toolbar`
controller (when the `toolbar` option is enabled). See the full reference below.

### Turnkey toolbar (batteries-included)

Instead of wiring your own buttons, enable the built-in toolbar **in the options**
(native control group, built-in icons, every tool wired):

```ts
const sigmet = new SigmetDraw({
  adapter, fir,
  toolbar: {                                       // presence renders the toolbar
    position: "top-left",                          // see the 12 positions below
    padding: { top: "12px", left: "8px" },         // CSS length, or per-side
    gap: "2px",                                     // spacing between buttons
    orientation: "horizontal",                     // optional; implied by position
    className: "my-toolbar",                        // extra class for your CSS
    tools: ["circle", "tropicalCyclone", "polygon"],// pick/order (default: all)
    clear: true,                                    // include the clear button
    tcCenter: null,                                 // see below
  },
});
```

**Positions** — the first token is the anchored edge (which also sets the bar's
orientation: `top`/`bottom` ⇒ horizontal, `left`/`right` ⇒ vertical); a bare edge
is centred along it:

```
top         top-left     top-right
bottom      bottom-left  bottom-right
left        left-top     left-bottom
right       right-top    right-bottom
```

**Padding** is a CSS length applied to the anchored edge(s), or a per-side object
`{ top?, right?, bottom?, left? }`.

Then tweak it **live** through `sigmet.toolbar`:

```ts
sigmet.toolbar.tcCenter = { lat, lon };          // enable the TC button (real TC position)
sigmet.toolbar.tcCenter = null;                  // grey it out again
sigmet.toolbar.position = "right";               // re-place on the fly (vertical bar)
sigmet.toolbar.padding  = { top: "20px", left: "12px" };
```

The **tropical-cyclone button is disabled until `tcCenter` is set** — it needs a
centre, and there is no sensible default (a real host has the TC position; the
demo uses the FIR centroid). The buttons live inside the engine's **native control
group** (`maplibregl-ctrl-group` / `ol-control`), so they automatically inherit
the host engine's native button look; the library only ensures the SVG icons are
centred and visible. Override anything via the `.sigmet-toolbar` class (or your
`className`). Prefer full control? Build your own `ToolbarItem[]` and call
`adapter.addToolbar(items, options)` directly — `DEFAULT_TOOLS` and `TOOL_ICONS`
are exported.

### Styling & dynamic label

One engine-agnostic `SigmetStyle` (translated natively by each adapter — identical
on MapLibre/OpenLayers). Override only what you want, at construction (`style`) or
live (`setStyle`). A dynamic `label` prints text **on** the shape; a `tooltip`
shows a floating box **on hover** over it — both are `(result) => string`.

```ts
sigmet.setStyle({
  area: { fill: { color: "#e11d48", opacity: 0.3 }, line: { color: "#e11d48", width: 2 } },
  guide: { color: "#22d3ee", width: 3 },   // construction segments/curves
  vertex: { color: "#fff" },               // points kept in the TAC
  collinearVertex: { color: "#64748b" },   // aligned points (ignored)
  controlHandle: { color: "#22d3ee" },     // radius / width handle
  label: { color: "#fff", size: 13, haloColor: "#0b1622" },
  tooltip: { background: "#0b1622", color: "#e6edf3", fontSize: 12 },
});
sigmet.setLabel((r) => r.geometry.kind);   // on-shape text (null to hide)
sigmet.setTooltip((r) => r.tac);           // hover tooltip (null to hide)
```

Tokens: `area.fill`, `area.line`, `other.fill`, `guide`, `vertex`,
`collinearVertex`, `controlHandle`, `label`, `tooltip`. See `DEFAULT_STYLE` /
`mergeStyle`.

### Core only (no map)

```ts
import { toTAC, fromTAC, toArea } from "@softwarity/sigmet-draw/core";

const g = fromTAC("WI 250NM OF PSN N2706 W07306");
toTAC(g);                          // "WI 250NM OF PSN N2706 W07306"
toTAC(g, { minutes: "always" });   // pad whole-degree minutes (N5400)
toArea(g, { fir });                // GeoJSON Feature, clipped to the FIR
```

## Reference

### `new SigmetDraw(options)`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `adapter` | `MapAdapter` | — | Wraps your map (`new MapLibreAdapter({ map })` / `new OpenLayersAdapter({ map })`). **Required.** |
| `fir` | `Feature \| Polygon \| MultiPolygon` | — | FIR polygon for clipping/constraints/snapping. **Required.** |
| `label` | `(r: SigmetResult) => string` | — | On-shape text (return `""` to hide). |
| `tooltip` | `(r: SigmetResult) => string` | — | Floating text on hover over the geometry. |
| `nauticalMilesOnly` | `boolean` | `false` | Force NM for radii/widths (never emit KM). |
| `toolbar` | `boolean \| ToolbarConfig` | — | Render the turnkey toolbar (see below). |
| `style` | `SigmetStyleInput` | — | Partial style override (merged onto `DEFAULT_STYLE`). |

### Events — `on(event, cb)` / `off(event, cb)`

| Event | Callback | Fires |
|-------|----------|-------|
| `"tac"` | `(tac: string) => void` | on every placement/edit — **the common case** |
| `"change"` | `(r: SigmetResult) => void` | same, with the full result `{ geometry, tac, area }` |

### Methods

`circle()`, `tropicalCyclone(center)`, `meridian()`, `parallel()`, `latBand()`,
`lonBand()`, `quadrant()`, `lineSide()`, `corridor()`, `polygon()`, `wideLine()`,
`point()`, `entireFir()` · `clear()` · `load(geometry)` · `setFir(fir)` ·
`firBounds()` → `[minLon,minLat,maxLon,maxLat]` · `firCenter()` → `LatLng` ·
`setStyle(partial)` · `setLabel(fn|null)` · `setTooltip(fn|null)` ·
`ready(): Promise` · `destroy()` · `toolbar` (the controller, see below).

### `SigmetStyle` tokens

| Token | Fields |
|-------|--------|
| `area.fill` | `color`, `opacity` |
| `area.line` | `color`, `width`, `dash?` |
| `other.fill` | `color`, `opacity` |
| `guide` | `color`, `width`, `dash?` |
| `vertex` / `collinearVertex` / `controlHandle` | `radius`, `color`, `strokeColor`, `strokeWidth` |
| `label` | `color`, `size`, `haloColor`, `haloWidth`, `offsetY` |
| `tooltip` | `background`, `color`, `fontSize`, `padding`, `borderRadius`, `maxWidth` |

Helpers: `DEFAULT_STYLE`, `mergeStyle(base, partial)`, `rgba(hex, opacity)`.

### `ToolbarConfig` / `sigmet.toolbar`

Config (construction): `position` (12 values, see above), `padding`
(`string | { top?, right?, bottom?, left? }`), `gap`, `orientation`, `className`,
`tools` (`ToolName[]`), `clear` (`boolean`), `tcCenter` (`LatLng | null`).
Live via `sigmet.toolbar`: `tcCenter` (set to enable the TC button / `null` to grey
it out), `position`, `orientation`, `padding`, `gap`. Build a fully custom toolbar
with `adapter.addToolbar(items, options)` + the exported `DEFAULT_TOOLS` / `TOOL_ICONS`.

## Architecture

One repo, **one npm package** (built with `tsc`), plus a standalone **Angular
demo** in `demo/` (deployed to GitHub Pages). The map engine is confined to the
adapters; everything above is agnostic.

```
src/
  core/                pure logic — 12 templates, TAC ↔ params, area (turf) — no map dep
  map/
    adapter.ts         MapAdapter interface (ready/setOverlay/onPointer/addToolbar/…)
    maplibre-adapter.ts   MapLibreAdapter({ map })   + createMapLibreMap
    openlayers-adapter.ts OpenLayersAdapter({ map }) + createOpenLayersMap
    sigmet-draw.ts     SigmetDraw — the engine-agnostic drawing logic
    style.ts           SigmetStyle spec + DEFAULT_STYLE / mergeStyle
    tools.ts           DEFAULT_TOOLS + TOOL_ICONS (turnkey toolbar)
    geometry.ts        pure helpers (collapse, snap, radius/width units)
    toolbar.ts         native toolbar builder
test/                  vitest (core + geometry/style helpers)
demo/                  Angular demo: graft on both engines, FIR selector grouped
                       by geometry (antimeridian, poles, equator, huge, …), live
                       style editor, turnkey toolbar
```

Package exports: `.` (all), `./core` (pure logic), `./maplibre`, `./openlayers`
(per-engine adapters, so a consumer pulls only the engine it uses). MapLibre and
OpenLayers are optional `peerDependencies`.

### Notable details

- **FIR is required** — used for clipping, the centre/point-inside-FIR
  constraint and line-endpoint snapping. The **host** draws the FIR outline on
  its own map; the library only consumes the polygon.
- **Antimeridian** — a FIR straddling 180° is detected and handled in an
  unwrapped longitude frame; TAC is re-normalised to ±180.
- Geometry via **Turf 7** (`circle`, `buffer`, `intersect`, `booleanPointInPolygon`).

## Development

```bash
npm install
npm run build            # tsc → dist
npm test                 # vitest (core + geometry/style helpers)

# demo (separate Angular app that consumes ../dist):
cd demo && npm install
npm run build            # lib first, then…
cd demo && npx ng serve  # dev server
```

## References

- WMO-No.49 Vol II, Appendix 6 — SIGMET/AIRMET templates & examples (A6-1/2/3).
- ICAO Annex 3 / PANS-ABC (Doc 8400) for abbreviations.
