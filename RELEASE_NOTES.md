# Release Notes

## 1.0.0

First public release.

### Features

- **12 SIGMET/AIRMET location forms**: circle (`WI nnNM OF PSN`), meridian/parallel half-planes (`E/W/N/S OF`), latitude/longitude bands, quadrant, side-of-line (`… OF LINE`, 2–4 points), corridor (band between two lines), wide line (`APRX nnKM WID LINE BTN`, 2–4 points), polygon (`WI`), point, and `ENTIRE FIR`.
- **TAC round-trip**: `toTAC` / `fromTAC` encode and decode ICAO/WMO text; `toArea` derives the GeoJSON area, clipped to the FIR.
- **Headless "graft" design**: bring your own map — the library never owns it. Adapters for **MapLibre GL** and **OpenLayers** are included, behind a small `MapAdapter` interface; the look is identical across engines.
- **Drop-then-drag UX**: selecting a tool drops a default geometry inside the FIR; the user only drags handles. Geometry is clipped to the FIR live and the TAC is produced on every edit (`on("change")`).
- **Editing aids**: collinear-vertex snapping (aligned points are magnetically snapped and dropped from the TAC), wide-line width that follows ICAO units (KM up to 99, then NM, capped at 99), and antimeridian-crossing FIR support.
- **Customisable styling**: one engine-agnostic `SigmetStyle` spec (area fill/outline, construction guides, vertices, collinear vertices, control handles, label) with partial overrides and a live `setStyle`.
- **Dynamic on-shape label**: render any text on the shape (e.g. the live TAC) via the `label` option / `setLabel`.
- **Pure core**: the 12 templates, the TAC codec and `toArea` live in `./core` with no map dependency.

---
