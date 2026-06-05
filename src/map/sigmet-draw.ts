/**
 * `SigmetDraw` — headless SIGMET drawing, grafted onto a host map via a
 * {@link MapAdapter} (à la Terra Draw). It owns the parametric edit state, turns
 * pointer events into parameter changes, derives the area (core `toArea`, clipped
 * to the FIR) and TAC (`toTAC`), and emits `change`. It never touches the map
 * library directly — only the adapter.
 *
 * The host owns the map (basemap, controls, projection, zoom) AND draws the FIR
 * outline itself; this module only consumes the **FIR** polygon (for clipping,
 * the centre-inside-FIR constraint and edge snapping).
 *
 * UX: selecting a tool DROPS a default geometry; the user only drags handles.
 */
import booleanPointInPolygon from "@turf/boolean-point-in-polygon";
import type {
  Feature,
  FeatureCollection,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";

import { toArea, toTAC } from "../core/index.js";
import type { FirInput, LatLng, SigmetGeometry } from "../core/index.js";
import type { MapAdapter, PointerEvent } from "./adapter.js";
import {
  bboxOf,
  bearingDeg,
  clamp,
  crossesAntimeridian,
  destinationPoint,
  extendLine,
  haversineNM,
  midpoint,
  oppositeSide,
  pointAtFraction,
  pointsBbox,
  pointsMean,
  pointsSpan,
  projectFraction,
  projectOnSegment,
  ringsOf,
  snapSide,
  unwrapGeometry,
  unwrapSigmetGeometry,
  vertexIndex,
  type Bbox,
} from "./geo.js";
import {
  collapseCollinear,
  collapseRing,
  KM_PER_NM,
  lineMoveValid,
  lineUsable,
  perpDist,
  radiusFor,
  ringMoveValid,
  widthFor,
} from "./geometry.js";
import { DEFAULT_STYLE, mergeStyle } from "./style.js";
import type { SigmetStyle, SigmetStyleInput } from "./style.js";
import { SigmetToolbar } from "./toolbar-controller.js";
import type { ToolbarConfig } from "./toolbar-controller.js";

/** Returns the text to show on the shape for a given result (`""` hides it). */
export type LabelFn = (result: SigmetResult) => string;

export interface SigmetDrawOptions {
  /** Adapter wrapping the host map (`new MapLibreAdapter({ map })`, …). */
  adapter: MapAdapter;
  /**
   * FIR polygon — required for clipping, the centre constraint and edge snapping.
   * NOTE: the host draws the FIR on its own map; SigmetDraw only consumes the data.
   */
  fir: FirInput;
  /** Partial style override for the drawing overlays (merged onto the defaults). */
  style?: SigmetStyleInput;
  /** Force radii/widths to nautical miles only (never emit KM). Default: false. */
  nauticalMilesOnly?: boolean;
  /**
   * Render a turnkey native toolbar (built-in icons, all tools wired). `true` for
   * defaults, or a config object (position, padding, tools, `tcCenter`, …). Tweak
   * it live afterwards via {@link SigmetDraw.toolbar}.
   */
  toolbar?: boolean | ToolbarConfig;
  /**
   * Dynamic text rendered on the shape — e.g. `(r) => r.tac`. Omit for no label;
   * return `""` from the function to hide it for a given geometry.
   */
  label?: LabelFn;
  /**
   * Floating tooltip shown on hover over the geometry — e.g. `(r) => r.tac`.
   * Omit for none; styleable via `style.tooltip`.
   */
  tooltip?: LabelFn;
}

export interface SigmetResult {
  geometry: SigmetGeometry;
  tac: string;
  area: Feature<Polygon | MultiPolygon | Point>;
}

/** The `role` of the handle/guide currently being dragged (e.g. "center", "lon", "north"). */
type DragTarget = string;

const fc = (features: Feature[]): FeatureCollection => ({
  type: "FeatureCollection",
  features,
});
const EMPTY = fc([]);
/** Placeholder area emitted when a shape momentarily doesn't intersect the FIR. */
const EMPTY_AREA: Feature<Polygon> = {
  type: "Feature",
  properties: {},
  geometry: { type: "Polygon", coordinates: [] },
};
const pointFeature = (
  lon: number,
  lat: number,
  role: string,
  extra?: Record<string, unknown>,
): Feature => ({
  type: "Feature",
  properties: { role, ...(extra ?? {}) },
  geometry: { type: "Point", coordinates: [lon, lat] },
});
const lineFeature = (coords: [number, number][], role?: string): Feature => ({
  type: "Feature",
  properties: role ? { role } : {},
  geometry: { type: "LineString", coordinates: coords },
});
const hLine = (minLon: number, maxLon: number, lat: number, role: string) =>
  lineFeature([[minLon, lat], [maxLon, lat]], role);
const vLine = (minLat: number, maxLat: number, lon: number, role: string) =>
  lineFeature([[lon, minLat], [lon, maxLat]], role);

/** Polygon centroid (shoelace) of a closed ring; falls back to the vertex mean
 *  for a degenerate (zero-area) ring. `area` is the absolute signed area. */
const ringCentroid = (ring: Position[]): { x: number; y: number; area: number } | null => {
  if (ring.length < 3) return null;
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const x0 = ring[i]![0]!;
    const y0 = ring[i]![1]!;
    const x1 = ring[i + 1]![0]!;
    const y1 = ring[i + 1]![1]!;
    const cross = x0 * y1 - x1 * y0;
    a += cross;
    cx += (x0 + x1) * cross;
    cy += (y0 + y1) * cross;
  }
  if (a === 0) {
    let mx = 0;
    let my = 0;
    for (const c of ring) {
      mx += c[0]!;
      my += c[1]!;
    }
    return { x: mx / ring.length, y: my / ring.length, area: 0 };
  }
  a *= 0.5;
  return { x: cx / (6 * a), y: cy / (6 * a), area: Math.abs(a) };
};

/** True if the area has at least one polygon ring to hit-test against. */
const hasFill = (area: Feature<Polygon | MultiPolygon | Point>): boolean => {
  const g = area.geometry;
  if (g.type === "Polygon") return (g.coordinates[0]?.length ?? 0) >= 4;
  if (g.type === "MultiPolygon") return (g.coordinates[0]?.[0]?.length ?? 0) >= 4;
  return false;
};

/** Anchor point for the on-shape label: centroid of the area's LARGEST polygon
 *  (handles MultiPolygon from clipping); `null` for empty/degenerate geometry. */
const labelAnchor = (area: Feature<Polygon | MultiPolygon | Point>): [number, number] | null => {
  const g = area.geometry;
  if (g.type === "Point") return g.coordinates as [number, number];
  const polys = g.type === "Polygon" ? [g.coordinates] : g.coordinates;
  let best: [number, number] | null = null;
  let bestArea = -1;
  for (const poly of polys) {
    const ring = poly[0] as Position[] | undefined;
    if (!ring) continue;
    const c = ringCentroid(ring);
    if (c && c.area >= bestArea) {
      bestArea = c.area;
      best = [c.x, c.y];
    }
  }
  return best;
};

export class SigmetDraw {
  private readonly adapter: MapAdapter;
  private firFeature!: Feature<Polygon | MultiPolygon>;
  private firBbox!: Bbox;
  /** All boundary rings of the FIR, for snapping line endpoints to the border. */
  private firRingList!: [number, number][][];
  private readonly listeners = new Set<(r: SigmetResult) => void>();
  private readonly tacListeners = new Set<(tac: string) => void>();
  private readonly readyPromise: Promise<void>;

  private active: SigmetGeometry | null = null;
  private dragTarget: DragTarget | null = null;
  /** Live position of the polygon scale/rotate handle while it is being dragged. */
  private sizeAnchor: LatLng | null = null;
  /** Cursor at the previous drag step — for incremental whole-line translation. */
  private dragLast: LatLng | null = null;
  private destroyed = false;
  /** Read-only mode: no handles, no editing, toolbar hidden. */
  private readOnly = false;
  /** When true, radii/widths are always nautical miles (never KM). */
  private nmOnly = false;
  private _toolbar?: SigmetToolbar;
  /** Coalesces drag re-renders to one per animation frame (turf work is costly). */
  private renderScheduled = false;
  /** UI-only: bearing of the circle's radius handle so it follows the cursor. */
  private circleBearing = 90;
  /** UI-only: width handle placement, relative to the line so it survives edits:
   * fraction along the line (0..1) and which side (+1 / -1). */
  private widthT = 0; // width handle pinned to the line's start (an extremity)
  /** Offset bearing of the width handle, relative to the line direction (deg).
   *  ±90 = a straight side; other values ride a rounded cap. */
  private widthAngle = 90;
  /** Longitude frame: identity normally; shifts negatives by +360 for a FIR that
   * crosses the antimeridian, so all geometry is contiguous. */
  private unwrapLon!: (lon: number) => number;
  private lonBounds!: [number, number];
  private style: SigmetStyle;
  private labelFn: LabelFn | null;
  private tooltipFn: LabelFn | null;
  private lastResult: SigmetResult | null = null;

  constructor(opts: SigmetDrawOptions) {
    this.adapter = opts.adapter;
    this.style = mergeStyle(DEFAULT_STYLE, opts.style);
    this.labelFn = opts.label ?? null;
    this.tooltipFn = opts.tooltip ?? null;
    this.nmOnly = opts.nauticalMilesOnly ?? false;
    if (opts.toolbar) {
      const cfg: ToolbarConfig = opts.toolbar === true ? {} : opts.toolbar;
      this._toolbar = new SigmetToolbar(this, this.adapter, cfg);
    }
    // Hand the resolved style to the adapter before it builds its overlays.
    this.adapter.setStyle(this.style);
    this.applyFir(opts.fir);

    this.readyPromise = this.adapter.ready().then(() => {
      // The FIR is drawn by the host on its own map — not by this module.
      this.adapter.onPointer((ev) => this.onPointer(ev));
      this._toolbar?.attach();
    });
  }

  /** The turnkey toolbar controller (when `toolbar` was enabled in the options),
   *  for live tweaks: `sigmet.toolbar.tcCenter = …`, `…position = "bottom"`, etc. */
  get toolbar(): SigmetToolbar | undefined {
    return this._toolbar;
  }

  /** Restyle the overlays live (partial override, merged onto the current style). */
  setStyle(style: SigmetStyleInput): void {
    this.style = mergeStyle(this.style, style);
    this.adapter.setStyle(this.style);
  }

  /** Set (or clear, with `null`) the dynamic on-shape text, then re-render. */
  setLabel(label: LabelFn | null): void {
    this.labelFn = label;
    if (this.active) this.renderActive();
  }

  /** Set (or clear, with `null`) the hover tooltip content function. */
  setTooltip(tooltip: LabelFn | null): void {
    this.tooltipFn = tooltip;
    if (!tooltip) this.adapter.setTooltip(null, { lat: 0, lon: 0 });
  }

  /** Whether the drawing is in read-only mode. */
  get isReadonly(): boolean {
    return this.readOnly;
  }

  /**
   * Read-only (frozen) mode: hides the toolbar and every grab handle/guide, and
   * ignores pointer editing — the area + label stay visible. Toggle freely.
   */
  setReadonly(on: boolean): void {
    if (on === this.readOnly) return;
    this.readOnly = on;
    if (on) {
      this.dragTarget = null; // drop any in-progress drag
      this.adapter.setPanEnabled(true);
    }
    this._toolbar?.setVisible(!on);
    this.renderActive();
  }

  private applyFir(fir: FirInput): void {
    const raw: Feature<Polygon | MultiPolygon> =
      fir.type === "Feature" ? fir : { type: "Feature", properties: {}, geometry: fir };
    const crosses = crossesAntimeridian(raw);
    this.unwrapLon = crosses ? (lon) => (lon < 0 ? lon + 360 : lon) : (lon) => lon;
    this.lonBounds = crosses ? [0, 360] : [-180, 180];
    this.firFeature = crosses
      ? { type: "Feature", properties: {}, geometry: unwrapGeometry(raw.geometry, this.unwrapLon) }
      : raw;
    this.firBbox = bboxOf(this.firFeature);
    this.firRingList = ringsOf(this.firFeature);
  }

  /** Swap the FIR without recreating the map; clears the current drawing. */
  setFir(fir: FirInput): void {
    this.applyFir(fir);
    this.clear();
  }

  /** Resolves once grafted onto the map (overlays attached, pointer wired). */
  ready(): Promise<void> {
    return this.readyPromise;
  }

  /** FIR bounding box `[minLon, minLat, maxLon, maxLat]` (in the working lon frame;
   * may exceed 180° for an antimeridian FIR). Use it to fit the map to the FIR. */
  firBounds(): [number, number, number, number] {
    return this.firBbox;
  }

  /** Centroid of the FIR (largest polygon) — a natural centre for e.g. a tropical
   *  cyclone circle. In the working longitude frame, like the rest of the API. */
  firCenter(): LatLng {
    const a = labelAnchor(this.firFeature);
    return a ? { lon: a[0], lat: a[1] } : this.interiorPoint();
  }

  /** Subscribe to the full result on every placement/edit (`tac` + `geometry` + `area`). */
  on(event: "change", cb: (r: SigmetResult) => void): void;
  /** Subscribe to just the TAC string — the common case. */
  on(event: "tac", cb: (tac: string) => void): void;
  on(event: "change" | "tac", cb: ((r: SigmetResult) => void) | ((tac: string) => void)): void {
    if (event === "tac") this.tacListeners.add(cb as (tac: string) => void);
    else this.listeners.add(cb as (r: SigmetResult) => void);
  }

  /** Unsubscribe a listener previously added with {@link on}. */
  off(event: "change", cb: (r: SigmetResult) => void): void;
  off(event: "tac", cb: (tac: string) => void): void;
  off(event: "change" | "tac", cb: ((r: SigmetResult) => void) | ((tac: string) => void)): void {
    if (event === "tac") this.tacListeners.delete(cb as (tac: string) => void);
    else this.listeners.delete(cb as (r: SigmetResult) => void);
  }

  /** Load an existing geometry (e.g. from `fromTAC`) and render it for editing. */
  load(geometry: SigmetGeometry): void {
    this.circleBearing = 90;
    this.widthT = 0;
    this.widthAngle = 90;
    // Bring longitudes into the FIR working frame (matters only for an
    // antimeridian-crossing FIR, where the controller works in 0..360).
    this.active = unwrapSigmetGeometry(geometry, this.unwrapLon);
    this.renderActive();
  }

  /** Drop a circle at the current view centre (constrained inside the FIR); both
   *  the centre and the radius are draggable (`WI nnNM OF PSN …`, 0–99). */
  circle(): void {
    this.adapter.setOverlay("guide", EMPTY);
    this.adapter.setOverlay("other", EMPTY);
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    let c: LatLng = {
      lat: clamp(this.center().lat, minLat, maxLat),
      lon: clamp(this.center().lon, minLon, maxLon),
    };
    if (!this.inFir(c)) c = this.interiorPoint();
    const midLat = (minLat + maxLat) / 2;
    const halfWidthNM = haversineNM([minLon, midLat], [maxLon, midLat]) / 2;
    const { unit, value: radius } = radiusFor(Math.max(20, halfWidthNM * 0.5), 99, this.nmOnly);
    this.circleBearing = 90;
    this.active = { kind: "circle", center: c, radius, unit };
    this.renderActive();
  }

  /**
   * Drop a tropical-cyclone circle at the **TC centre** (required — pass the real
   * position from the TC SIGMET's `PSN` element). The centre is fixed (not
   * draggable); only the radius is edited, up to 999 (`WI nnnNM OF TC CENTRE`).
   */
  tropicalCyclone(center: LatLng): void {
    this.adapter.setOverlay("guide", EMPTY);
    this.adapter.setOverlay("other", EMPTY);
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const midLat = (minLat + maxLat) / 2;
    const halfWidthNM = haversineNM([minLon, midLat], [maxLon, midLat]) / 2;
    const { unit, value: radius } = radiusFor(Math.max(50, halfWidthNM * 0.6), 999, this.nmOnly);
    this.circleBearing = 90;
    this.active = { kind: "tropicalCyclone", center, radius, unit };
    this.renderActive();
  }

  meridian(): void {
    this.adapter.setOverlay("handles", EMPTY);
    const [minLon, , maxLon] = this.firBbox;
    const lon = clamp(this.center().lon, minLon, maxLon);
    this.active = { kind: "meridian", lon, side: "E" };
    this.renderActive();
  }

  parallel(): void {
    this.adapter.setOverlay("handles", EMPTY);
    const [, minLat, , maxLat] = this.firBbox;
    const lat = clamp(this.center().lat, minLat, maxLat);
    this.active = { kind: "parallel", lat, side: "N" };
    this.renderActive();
  }

  latBand(): void {
    this.adapter.setOverlay("handles", EMPTY);
    const [, minLat, , maxLat] = this.firBbox;
    const mid = (minLat + maxLat) / 2;
    const q = (maxLat - minLat) * 0.2;
    this.active = {
      kind: "latBand",
      north: clamp(mid + q, minLat, maxLat),
      south: clamp(mid - q, minLat, maxLat),
    };
    this.renderActive();
  }

  lonBand(): void {
    this.adapter.setOverlay("handles", EMPTY);
    const [minLon, , maxLon] = this.firBbox;
    const mid = (minLon + maxLon) / 2;
    const q = (maxLon - minLon) * 0.2;
    this.active = {
      kind: "lonBand",
      west: clamp(mid - q, minLon, maxLon),
      east: clamp(mid + q, minLon, maxLon),
    };
    this.renderActive();
  }

  quadrant(): void {
    this.adapter.setOverlay("handles", EMPTY);
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const lat = clamp(this.center().lat, minLat, maxLat);
    const lon = clamp(this.center().lon, minLon, maxLon);
    this.active = { kind: "quadrant", lat, lon, latSide: "N", lonSide: "E" };
    this.renderActive();
  }

  /**
   * A 4-point line along the FIR's SW→NE diagonal (45°-ish), offset perpendicular
   * by `perpOffset`. Endpoints snap to the border; oblique on purpose so a line /
   * corridor reads differently from the horizontal/vertical lat- and lon-bands.
   */
  private diagLine(perpOffset: number): LatLng[] {
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const dx = maxLon - minLon || 1;
    const dy = maxLat - minLat || 1;
    const len = Math.hypot(dx, dy);
    const d = { lon: dx / len, lat: dy / len }; // SW→NE diagonal
    const perp = { lon: -d.lat, lat: d.lon };
    const cx = (minLon + maxLon) / 2 + perp.lon * perpOffset;
    const cy = (minLat + maxLat) / 2 + perp.lat * perpOffset;
    // Clip the *offset* diagonal to the bbox so each leg gets distinct entry/exit
    // points — casting far points would snap both legs to the same FIR extremum.
    const sx = [(minLon - cx) / d.lon, (maxLon - cx) / d.lon];
    const sy = [(minLat - cy) / d.lat, (maxLat - cy) / d.lat];
    const sEnter = Math.max(Math.min(...sx), Math.min(...sy));
    const sExit = Math.min(Math.max(...sx), Math.max(...sy));
    const a0 = this.nearestOnFir({ lon: cx + d.lon * sEnter, lat: cy + d.lat * sEnter });
    const a3 = this.nearestOnFir({ lon: cx + d.lon * sExit, lat: cy + d.lat * sExit });
    const lerp = (k: number): LatLng => ({
      lat: a0.lat + (a3.lat - a0.lat) * k,
      lon: a0.lon + (a3.lon - a0.lon) * k,
    });
    return [a0, lerp(1 / 3), lerp(2 / 3), a3];
  }

  lineSide(): void {
    this.active = { kind: "lineSide", points: this.diagLine(0), side: "N" };
    this.renderActive();
  }

  corridor(): void {
    const [, minLat, , maxLat] = this.firBbox;
    const off = (maxLat - minLat) * 0.18;
    this.active = {
      kind: "corridor",
      lineA: { points: this.diagLine(-off), side: "N" },
      lineB: { points: this.diagLine(off), side: "S" },
    };
    this.renderActive();
  }

  point(): void {
    this.active = { kind: "point", position: this.viewInteriorPoint() };
    this.renderActive();
  }

  entireFir(): void {
    // `region` is hard-coded to "FIR" by design: choosing UIR / CTA / FIR/UIR is
    // the host's responsibility (it knows the FIR's airspace type), so the drawing
    // tool stays type-agnostic. The core still round-trips the other regions via
    // load(fromTAC(...)). Intentional — not an oversight.
    this.active = { kind: "entireFir", region: "FIR" };
    this.renderActive();
  }

  polygon(): void {
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const c = this.viewInteriorPoint();
    const rx = (maxLon - minLon) * 0.18;
    const ry = (maxLat - minLat) * 0.18;
    // 7 vertices — the WMO max for a SIGMET `WI` polygon; the user prunes
    // redundant corners (collinear ones are auto-dropped from the TAC/area).
    const n = 7;
    const points = Array.from({ length: n }, (_, i) => {
      const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
      return { lat: c.lat + ry * Math.sin(ang), lon: c.lon + rx * Math.cos(ang) };
    });
    this.active = { kind: "polygon", points };
    this.renderActive();
  }

  wideLine(): void {
    const [minLon, , maxLon] = this.firBbox;
    const c = this.viewInteriorPoint();
    const w = maxLon - minLon;
    // 4 points (the WID LINE max: P1 – P2 [– P3] [– P4]), initially straight;
    // the user bends/aligns them. Default ~50 km width (or 30 NM in NM-only mode).
    this.widthT = 0;
    this.widthAngle = 90;
    const x0 = c.lon - w * 0.3;
    const x1 = c.lon + w * 0.3;
    this.active = {
      kind: "wideLine",
      points: [0, 1, 2, 3].map((i) => ({ lat: c.lat, lon: x0 + (x1 - x0) * (i / 3) })),
      width: this.nmOnly ? 30 : 50,
      unit: this.nmOnly ? "NM" : "KM",
    };
    this.renderActive();
  }

  /** Map centre clamped to the FIR bbox, falling back to a guaranteed interior point. */
  private viewInteriorPoint(): LatLng {
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const c: LatLng = {
      lat: clamp(this.center().lat, minLat, maxLat),
      lon: clamp(this.center().lon, minLon, maxLon),
    };
    return this.inFir(c) ? c : this.interiorPoint();
  }

  clear(): void {
    this.active = null;
    this.lastResult = null;
    this.adapter.setTooltip(null, { lat: 0, lon: 0 });
    for (const id of ["area", "other", "guide", "handles", "label"] as const) {
      this.adapter.setOverlay(id, EMPTY);
    }
  }

  /** Detach from the host map: clears listeners and tells the adapter to remove
   *  its overlays/listeners/toolbar. Idempotent; the host's map is left intact. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.tacListeners.clear();
    this.active = null;
    this.dragTarget = null;
    this.adapter.destroy();
  }

  private onPointer(ev: PointerEvent): void {
    if (this.destroyed || this.readOnly) return; // read-only: ignore all editing
    const a = this.active;
    switch (ev.type) {
      case "down": {
        if (!a) return;
        // Any handle/guide carries a `role` identifying what is being dragged.
        if (ev.hit?.overlay === "handles" || ev.hit?.overlay === "guide") {
          const role = ev.hit.props["role"];
          if (typeof role === "string") {
            this.dragTarget = role;
            this.dragLast = this.uw(ev.lngLat); // anchor for whole-line translation
            this.adapter.setPanEnabled(false);
          }
        }
        return;
      }
      case "move": {
        this.updateTooltip(ev); // hover tooltip (independent of dragging)
        if (!this.dragTarget || !a) return;
        const [minLon, minLat, maxLon, maxLat] = this.firBbox;
        const { lat, lon } = this.uw(ev.lngLat);
        const t = this.dragTarget;
        switch (a.kind) {
          case "circle":
            if (t === "center") {
              if (this.inFir({ lat, lon })) a.center = { lat, lon };
            } else if (t === "radius") {
              // Plain circle: KM up to 99, then NM, capped at 99 (`WI nnKM/nnNM`).
              const rNM = haversineNM([a.center.lon, a.center.lat], [lon, lat]);
              const { unit, value } = radiusFor(rNM, 99, this.nmOnly);
              a.unit = unit;
              a.radius = value;
              this.circleBearing = bearingDeg(a.center, { lat, lon });
            }
            break;
          case "tropicalCyclone":
            if (t === "radius") {
              // TC circle: same rule, but capped at 999 (`WI nnnKM/nnnNM OF TC CENTRE`).
              const rNM = haversineNM([a.center.lon, a.center.lat], [lon, lat]);
              const { unit, value } = radiusFor(rNM, 999, this.nmOnly);
              a.unit = unit;
              a.radius = value;
              this.circleBearing = bearingDeg(a.center, { lat, lon });
            }
            break;
          case "meridian":
            if (t === "lon") a.lon = clamp(lon, minLon, maxLon);
            break;
          case "parallel":
            if (t === "lat") a.lat = clamp(lat, minLat, maxLat);
            break;
          case "latBand":
            if (t === "north") a.north = clamp(lat, a.south, maxLat);
            else if (t === "south") a.south = clamp(lat, minLat, a.north);
            break;
          case "lonBand": {
            // A `west > east` band legitimately wraps the antimeridian; don't
            // cross-couple the bounds then (that would force west ≤ east and
            // collapse the wrap) — clamp each only to the FIR bbox.
            const wraps = a.west > a.east;
            if (t === "west") a.west = clamp(lon, minLon, wraps ? maxLon : a.east);
            else if (t === "east") a.east = clamp(lon, wraps ? minLon : a.west, maxLon);
            break;
          }
          case "quadrant":
            if (t === "lat") a.lat = clamp(lat, minLat, maxLat);
            else if (t === "lon") a.lon = clamp(lon, minLon, maxLon);
            break;
          case "lineSide": {
            const span = Math.max(maxLon - minLon, maxLat - minLat);
            if (t === "line") {
              // Drag the whole line (translate); endpoints stay pinned to the
              // border. Reject if the end re-snap left it degenerate/self-crossing.
              const cand = this.snapEnds(this.translateLine(a.points, lon, lat));
              if (lineUsable(cand, span * 0.05)) a.points = cand;
              break;
            }
            if (t === "size") {
              // Corner handle: scale + rotate the whole line about its centroid.
              if (!this.sizeAnchor) this.sizeAnchor = this.transformRest(a.points, 0.18);
              const next = this.applyTransform(a.points, lon, lat, span);
              const cand = this.snapEnds(next.points);
              if (lineUsable(cand, span * 0.05)) {
                a.points = cand;
                this.sizeAnchor = next.anchor;
              }
              break;
            }
            const i = vertexIndex(t);
            const cur = a.points[i];
            if (cur) {
              const isEnd = i === 0 || i === a.points.length - 1;
              const cand = isEnd
                ? this.nearestOnFir({ lat, lon }, cur, span * 0.25)
                : this.snapCollinear(a.points, i, { lat, lon }, false);
              // Same self-crossing / merge guard as the polygon, on an open line.
              if (lineMoveValid(a.points, i, cand, span * 0.015, span * 0.005)) a.points[i] = cand;
            }
            break;
          }
          case "corridor": {
            const span = Math.max(maxLon - minLon, maxLat - minLat);
            if (t === "lineA" || t === "lineB") {
              // Drag one whole leg (translate); endpoints stay pinned to the border.
              const line = t === "lineA" ? a.lineA : a.lineB;
              const cand = this.snapEnds(this.translateLine(line.points, lon, lat));
              if (lineUsable(cand, span * 0.05)) line.points = cand;
              break;
            }
            if (t === "size") {
              // Corner handle: scale + rotate both legs about their joint centroid.
              const nA = a.lineA.points.length;
              const all = [...a.lineA.points, ...a.lineB.points];
              if (!this.sizeAnchor) this.sizeAnchor = this.transformRest(all, 0.18);
              const next = this.applyTransform(all, lon, lat, span);
              const ca = this.snapEnds(next.points.slice(0, nA));
              const cb = this.snapEnds(next.points.slice(nA));
              if (lineUsable(ca, span * 0.05) && lineUsable(cb, span * 0.05)) {
                a.lineA.points = ca;
                a.lineB.points = cb;
                this.sizeAnchor = next.anchor;
              }
              break;
            }
            const line = t[0] === "a" ? a.lineA : a.lineB;
            const i = vertexIndex(t);
            const cur = line.points[i];
            if (cur) {
              const isEnd = i === 0 || i === line.points.length - 1;
              const cand = isEnd
                ? this.nearestOnFir({ lat, lon }, cur, span * 0.25)
                : this.snapCollinear(line.points, i, { lat, lon }, false);
              if (lineMoveValid(line.points, i, cand, span * 0.015, span * 0.005))
                line.points[i] = cand;
            }
            break;
          }
          case "point":
            // Constrained to stay inside the FIR.
            if (this.inFir({ lat, lon })) a.position = { lat, lon };
            break;
          case "polygon": {
            if (t === "move") {
              // Translate the ring so its centroid follows the cursor. Allowed as
              // long as at least one vertex stays in the FIR (the handle itself may
              // leave it).
              const cen = pointsMean(a.points);
              const dLon = lon - cen.lon;
              const dLat = lat - cen.lat;
              const moved = a.points.map((p) => ({ lon: p.lon + dLon, lat: p.lat + dLat }));
              if (this.someInFir(moved)) a.points = moved;
              break;
            }
            if (t === "size") {
              // Transform handle: scale + rotate the ring about its centroid —
              // drag in/out scales, drag around rotates. Committed only while at
              // least one vertex stays in the FIR (so it can't be flung fully out).
              const span = Math.max(maxLon - minLon, maxLat - minLat);
              if (!this.sizeAnchor) this.sizeAnchor = this.transformRest(a.points);
              const next = this.applyTransform(a.points, lon, lat, span);
              if (this.someInFir(next.points)) {
                a.points = next.points;
                this.sizeAnchor = next.anchor;
              }
              break;
            }
            const i = vertexIndex(t);
            if (a.points[i]) {
              // Tolerances scale with the polygon's own size, not the FIR span —
              // otherwise a small polygon's vertices all fall within the (huge)
              // FIR-relative thresholds and get fused / dropped.
              const pspan = pointsSpan(a.points);
              const cand = this.snapCollinear(a.points, i, { lat, lon }, true, pspan * 0.01);
              // A vertex moves only on its two adjacent edges: it can't merge with
              // another point, land on a segment, or cross the ring. The vertex
              // gap (~collapse tol) keeps two points from ever grouping; the edge
              // gap is finer so corners can still sit close to a far edge.
              const keepsAnchor =
                this.inFir(cand) || a.points.some((p, j) => j !== i && this.inFir(p));
              if (keepsAnchor && ringMoveValid(a.points, i, cand, pspan * 0.015, pspan * 0.005))
                a.points[i] = cand;
            }
            break;
          }
          case "wideLine": {
            if (t === "move") {
              // Translate the centreline so its midpoint follows the cursor.
              // Allowed while at least one point stays in the FIR.
              const cen = pointsMean(a.points);
              const dLon = lon - cen.lon;
              const dLat = lat - cen.lat;
              const moved = a.points.map((p) => ({ lon: p.lon + dLon, lat: p.lat + dLat }));
              if (this.someInFir(moved)) a.points = moved;
            } else if (t === "size") {
              // Zoom+rotate handle in a corner of the line's envelope — exactly
              // like the polygon (scale + rotate the centreline about its centroid).
              const span = Math.max(maxLon - minLon, maxLat - minLat);
              if (!this.sizeAnchor) this.sizeAnchor = this.transformRest(a.points, 0.18);
              const next = this.applyTransform(a.points, lon, lat, span);
              if (this.someInFir(next.points)) {
                a.points = next.points;
                this.sizeAnchor = next.anchor;
              }
            } else if (t === "w") {
              // Width handle rides the *whole* buffer border (like the circle
              // radius rides its edge): it slides along the centreline (widthT) and
              // the offset bearing (`widthAngle`) follows the cursor. When the
              // cursor passes an end, `projectFraction` clamps the foot to the tip,
              // so the offset becomes radial — the handle rides the rounded cap.
              const cursor = { lat, lon };
              const { point: foot, t: ft } = projectFraction(cursor, a.points);
              const halfNM = haversineNM([foot.lon, foot.lat], [lon, lat]);
              const { unit, width } = widthFor(halfNM, this.nmOnly);
              a.unit = unit;
              a.width = width;
              this.widthT = ft;
              const lineBrg = bearingDeg(a.points[0]!, a.points[a.points.length - 1]!);
              this.widthAngle = bearingDeg(foot, cursor) - lineBrg;
            } else {
              const i = vertexIndex(t);
              if (a.points[i]) {
                const span = Math.max(maxLon - minLon, maxLat - minLat);
                const cand = this.snapCollinear(a.points, i, { lat, lon }, false);
                const keepsAnchor =
                  this.inFir(cand) || a.points.some((p, j) => j !== i && this.inFir(p));
                if (keepsAnchor && lineMoveValid(a.points, i, cand, span * 0.015, span * 0.005))
                  a.points[i] = cand;
              }
            }
            break;
          }
        }
        this.scheduleRender();
        return;
      }
      case "up": {
        if (this.dragTarget) {
          this.dragTarget = null;
          this.sizeAnchor = null;
          this.dragLast = null;
          this.adapter.setPanEnabled(true);
        }
        return;
      }
      case "click": {
        if (ev.hit?.overlay === "other" && a) {
          const ll = this.uw(ev.lngLat);
          if (a.kind === "meridian") a.side = a.side === "E" ? "W" : "E";
          else if (a.kind === "parallel") a.side = a.side === "N" ? "S" : "N";
          else if (a.kind === "quadrant") {
            // Pick the quadrant you clicked in.
            a.latSide = ll.lat >= a.lat ? "N" : "S";
            a.lonSide = ll.lon >= a.lon ? "E" : "W";
          } else if (a.kind === "lineSide") {
            const m = midpoint(a.points);
            a.side = snapSide(ll.lon - m.lon, ll.lat - m.lat);
          } else return;
          this.renderActive();
        }
        return;
      }
    }
  }

  /** Re-render at most once per animation frame (coalesces rapid drag moves). */
  private scheduleRender(): void {
    if (this.renderScheduled) return;
    this.renderScheduled = true;
    const raf =
      typeof requestAnimationFrame !== "undefined"
        ? requestAnimationFrame
        : (cb: FrameRequestCallback) => {
            cb(0);
            return 0;
          };
    raf(() => {
      this.renderScheduled = false;
      if (!this.destroyed) this.renderActive();
    });
  }

  private renderActive(): void {
    this.renderShape();
    // Disabled (read-only) mode: keep the area + label, drop every grab handle
    // and guide so nothing looks (or is) editable. Toggling re-renders them.
    if (this.readOnly) {
      this.adapter.setOverlay("handles", EMPTY);
      this.adapter.setOverlay("guide", EMPTY);
    }
  }

  private renderShape(): void {
    const a = this.active;
    if (!a) return;

    if (a.kind === "meridian") {
      const opts = { fir: this.firFeature, lonBounds: this.lonBounds };
      const selected = this.areaOrNull(a, opts);
      const opposite = this.areaOrNull(
        { kind: "meridian", lon: a.lon, side: a.side === "E" ? "W" : "E" },
        opts,
      );
      const [, minLat, , maxLat] = this.firBbox;
      this.adapter.setOverlay("area", selected ? fc([selected]) : EMPTY);
      this.adapter.setOverlay("other", opposite ? fc([opposite]) : EMPTY);
      this.adapter.setOverlay("handles", EMPTY);
      this.adapter.setOverlay("guide", fc([vLine(minLat, maxLat, a.lon, "lon")]));
      this.emit(a, selected ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "parallel") {
      const opts = { fir: this.firFeature, lonBounds: this.lonBounds };
      const selected = this.areaOrNull(a, opts);
      const opposite = this.areaOrNull(
        { kind: "parallel", lat: a.lat, side: a.side === "N" ? "S" : "N" },
        opts,
      );
      const [minLon, , maxLon] = this.firBbox;
      this.adapter.setOverlay("area", selected ? fc([selected]) : EMPTY);
      this.adapter.setOverlay("other", opposite ? fc([opposite]) : EMPTY);
      this.adapter.setOverlay("handles", EMPTY);
      this.adapter.setOverlay("guide", fc([hLine(minLon, maxLon, a.lat, "lat")]));
      this.emit(a, selected ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "latBand") {
      const area = this.areaOrNull(a, { fir: this.firFeature, lonBounds: this.lonBounds });
      const [minLon, , maxLon] = this.firBbox;
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("handles", EMPTY);
      this.adapter.setOverlay(
        "guide",
        fc([
          hLine(minLon, maxLon, a.north, "north"),
          hLine(minLon, maxLon, a.south, "south"),
        ]),
      );
      this.emit(a, area ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "lonBand") {
      const area = this.areaOrNull(a, { fir: this.firFeature, lonBounds: this.lonBounds });
      const [, minLat, , maxLat] = this.firBbox;
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("handles", EMPTY);
      this.adapter.setOverlay(
        "guide",
        fc([
          vLine(minLat, maxLat, a.west, "west"),
          vLine(minLat, maxLat, a.east, "east"),
        ]),
      );
      this.emit(a, area ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "quadrant") {
      const selected = this.areaOrNull(a, { fir: this.firFeature, lonBounds: this.lonBounds });
      const [minLon, minLat, maxLon, maxLat] = this.firBbox;
      this.adapter.setOverlay("area", selected ? fc([selected]) : EMPTY);
      // The whole FIR is the clickable surface to pick which corner.
      this.adapter.setOverlay("other", fc([this.firFeature as Feature]));
      this.adapter.setOverlay("handles", EMPTY);
      this.adapter.setOverlay(
        "guide",
        fc([vLine(minLat, maxLat, a.lon, "lon"), hLine(minLon, maxLon, a.lat, "lat")]),
      );
      this.emit(a, selected ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "lineSide") {
      const [minLon, minLat, maxLon, maxLat] = this.firBbox;
      const span = Math.max(maxLon - minLon, maxLat - minLat);
      // Collinear interior points are redundant → excluded from the TAC/area,
      // and greyed out as handles.
      const { points: eff, collinear } = collapseCollinear(a.points, span * 0.015);
      const geom = { kind: "lineSide" as const, points: eff, side: a.side };
      const opts = { fir: this.firFeature, lonBounds: this.lonBounds };
      const selected = this.areaOrNull(geom, opts);
      const opposite = this.areaOrNull({ ...geom, side: oppositeSide(a.side) }, opts);
      // Clear on no-overlap (and clear a previous shape's fill on tool switch).
      this.adapter.setOverlay("area", selected ? fc([selected]) : EMPTY);
      this.adapter.setOverlay("other", opposite ? fc([opposite]) : EMPTY);
      // The line carries a role → it's grabbable: drag the body to translate it.
      this.adapter.setOverlay("guide", fc([lineFeature(extendLine(a.points, span * 0.06), "line")]));
      // Scale+rotate handle in a corner of the line's envelope (like the polygon).
      const sizeAt =
        this.dragTarget === "size" && this.sizeAnchor
          ? this.sizeAnchor
          : this.transformRest(a.points, 0.18);
      const cen = pointsMean(a.points);
      const sizeRot = (Math.atan2(sizeAt.lon - cen.lon, sizeAt.lat - cen.lat) * 180) / Math.PI;
      this.adapter.setOverlay(
        "handles",
        fc([
          ...a.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `v${i}`, { collinear: collinear[i] === true }),
          ),
          pointFeature(sizeAt.lon, sizeAt.lat, "size", { transform: true, iconRotate: sizeRot }),
        ]),
      );
      this.emit(geom, selected ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "corridor") {
      const [minLon, minLat, maxLon, maxLat] = this.firBbox;
      const span = Math.max(maxLon - minLon, maxLat - minLat);
      const tol = span * 0.015;
      const A = collapseCollinear(a.lineA.points, tol);
      const B = collapseCollinear(a.lineB.points, tol);
      const mA = midpoint(A.points);
      const mB = midpoint(B.points);
      // Each line faces the other → the area is the band between them.
      const geom = {
        kind: "corridor" as const,
        lineA: { points: A.points, side: snapSide(mB.lon - mA.lon, mB.lat - mA.lat) },
        lineB: { points: B.points, side: snapSide(mA.lon - mB.lon, mA.lat - mB.lat) },
      };
      const area = this.areaOrNull(geom, { fir: this.firFeature, lonBounds: this.lonBounds });
      // Clear the band when there's genuinely no overlap (also clears any
      // previous shape's fill when this tool is freshly selected).
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay(
        "guide",
        fc([
          lineFeature(extendLine(a.lineA.points, span * 0.06), "lineA"),
          lineFeature(extendLine(a.lineB.points, span * 0.06), "lineB"),
        ]),
      );
      // Scale+rotate handle over the joint envelope of both legs (like the polygon).
      const all = [...a.lineA.points, ...a.lineB.points];
      const sizeAt =
        this.dragTarget === "size" && this.sizeAnchor
          ? this.sizeAnchor
          : this.transformRest(all, 0.18);
      const cen = pointsMean(all);
      const sizeRot = (Math.atan2(sizeAt.lon - cen.lon, sizeAt.lat - cen.lat) * 180) / Math.PI;
      this.adapter.setOverlay(
        "handles",
        fc([
          ...a.lineA.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `a${i}`, { collinear: A.collinear[i] === true }),
          ),
          ...a.lineB.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `b${i}`, { collinear: B.collinear[i] === true }),
          ),
          pointFeature(sizeAt.lon, sizeAt.lat, "size", { transform: true, iconRotate: sizeRot }),
        ]),
      );
      this.emit(geom, area ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "point") {
      const area = toArea(a) as Feature<Point>;
      this.adapter.setOverlay("area", EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("guide", EMPTY);
      this.adapter.setOverlay("handles", fc([pointFeature(a.position.lon, a.position.lat, "p")]));
      this.emit(a, area);
      return;
    }

    if (a.kind === "entireFir") {
      const area = this.areaOrNull(a, { fir: this.firFeature, lonBounds: this.lonBounds });
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("guide", EMPTY);
      this.adapter.setOverlay("handles", EMPTY);
      this.emit(a, area ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "polygon") {
      // Collinear vertices are redundant → dropped from the TAC/area, greyed out.
      // Tolerance scales with the polygon (not the FIR span) so a small polygon
      // doesn't see all its vertices as collinear and ignored.
      const tol = pointsSpan(a.points) * 0.015;
      const { points: eff, collinear } = collapseRing(a.points, tol);
      const geom = { kind: "polygon" as const, points: eff };
      // Handles may be dragged outside the FIR, but the filled area is clipped to it.
      const area = this.areaOrNull(geom, {
        fir: this.firFeature,
        lonBounds: this.lonBounds,
        clipBounded: true,
      });
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("guide", EMPTY);
      // Move handle (centroid) + uniform-scale handle (top-right bbox corner) so
      // the whole shape can be dragged / resized without touching all 7 vertices.
      const cen = pointsMean(a.points);
      // While spinning/scaling, the handle rides its remembered material spot;
      // otherwise it sits at the top-right bbox corner.
      const [, , bxMaxLon, bxMaxLat] = pointsBbox(a.points);
      const sizeAt =
        this.dragTarget === "size" && this.sizeAnchor
          ? this.sizeAnchor
          : { lon: bxMaxLon, lat: bxMaxLat };
      this.adapter.setOverlay(
        "handles",
        fc([
          ...a.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `v${i}`, { collinear: collinear[i] === true }),
          ),
          pointFeature(cen.lon, cen.lat, "move", { move: true }),
          pointFeature(sizeAt.lon, sizeAt.lat, "size", {
            control: true,
            transform: true,
            // Icon spins with the handle's orbit angle (centroid → handle).
            iconRotate:
              (Math.atan2(sizeAt.lon - cen.lon, sizeAt.lat - cen.lat) * 180) / Math.PI,
          }),
        ]),
      );
      this.emit(geom, area ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "wideLine") {
      const [minLon, minLat, maxLon, maxLat] = this.firBbox;
      const tol = Math.max(maxLon - minLon, maxLat - minLat) * 0.015;
      const { points: eff, collinear } = collapseCollinear(a.points, tol);
      const geom = { kind: "wideLine" as const, points: eff, width: a.width, unit: a.unit };
      const area = this.areaOrNull(geom, {
        fir: this.firFeature,
        lonBounds: this.lonBounds,
        clipBounded: true,
      });
      // Width handle: at fraction `widthT` along the line, on the remembered side
      // — follows the cursor while dragging, and survives vertex edits.
      const ends = eff.length >= 2 ? eff : a.points;
      const halfNM = a.unit === "KM" ? a.width / 2 / KM_PER_NM : a.width / 2;
      const foot = pointAtFraction(ends, this.widthT);
      const brg = bearingDeg(ends[0]!, ends[ends.length - 1]!) + this.widthAngle;
      const wh = destinationPoint(foot, halfNM, brg);
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("guide", EMPTY); // no centreline — the filled buffer says it all
      const cen = pointsMean(a.points);
      // Zoom+rotate handle in a corner of the line's envelope (pushed out so it
      // never overlaps the move/vertex handles), exactly like the polygon.
      const sizeAt =
        this.dragTarget === "size" && this.sizeAnchor
          ? this.sizeAnchor
          : this.transformRest(a.points, 0.18);
      const sizeRot = (Math.atan2(sizeAt.lon - cen.lon, sizeAt.lat - cen.lat) * 180) / Math.PI;
      this.adapter.setOverlay(
        "handles",
        fc([
          ...a.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `v${i}`, { collinear: collinear[i] === true }),
          ),
          // Width handle = same resize glyph as the circle radius (chevrons along
          // the perpendicular width direction, small dot).
          pointFeature(wh[0], wh[1], "w", { resize: true, iconRotate: brg }),
          pointFeature(sizeAt.lon, sizeAt.lat, "size", { transform: true, iconRotate: sizeRot }),
          pointFeature(cen.lon, cen.lat, "move", { move: true }),
        ]),
      );
      this.emit(geom, area ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "circle") {
      const area = this.areaOrNull(a, {
        fir: this.firFeature,
        lonBounds: this.lonBounds,
        clipBounded: true,
      });
      const radiusNM = a.unit === "KM" ? a.radius / KM_PER_NM : a.radius;
      const edge = destinationPoint(a.center, radiusNM, this.circleBearing);
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("guide", EMPTY);
      this.adapter.setOverlay(
        "handles",
        fc([
          pointFeature(a.center.lon, a.center.lat, "center", { move: true }),
          pointFeature(edge[0], edge[1], "radius", {
            resize: true,
            iconRotate: this.circleBearing,
          }),
        ]),
      );
      this.emit(a, area ?? EMPTY_AREA);
      return;
    }

    if (a.kind === "tropicalCyclone") {
      // The centre is fixed at the FIR centroid (e.g. after fromTAC, which can't
      // carry it); only the radius is editable.
      if (!this.inFir(a.center)) a.center = this.firCenter();
      const area = this.areaOrNull(a, {
        fir: this.firFeature,
        lonBounds: this.lonBounds,
        clipBounded: true,
      });
      const radiusNM = a.unit === "KM" ? a.radius / KM_PER_NM : a.radius;
      const edge = destinationPoint(a.center, radiusNM, this.circleBearing);
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("guide", EMPTY);
      // No centre handle — the centre is fixed and not part of the TAC; only the
      // radius is editable.
      this.adapter.setOverlay(
        "handles",
        fc([pointFeature(edge[0], edge[1], "radius", { control: true })]),
      );
      this.emit(a, area ?? EMPTY_AREA);
      return;
    }
  }

  /**
   * `toArea` but never throws: returns `null` when the shape momentarily doesn't
   * intersect the FIR during a drag, so the pointer handler can't die (which would
   * leave pan disabled and the drag wedged).
   */
  private areaOrNull(
    geometry: SigmetGeometry,
    options?: Parameters<typeof toArea>[1],
  ): Feature<Polygon | MultiPolygon> | null {
    try {
      return toArea(geometry, options) as Feature<Polygon | MultiPolygon>;
    } catch {
      return null;
    }
  }

  private emit(
    geometry: SigmetGeometry,
    area: Feature<Polygon | MultiPolygon | Point>,
  ): void {
    const tac = toTAC(geometry);
    const result: SigmetResult = { geometry, tac, area };
    this.lastResult = result;
    for (const cb of this.listeners) cb(result);
    for (const cb of this.tacListeners) cb(tac);
    this.renderLabel(result);
  }

  /** Hover tooltip: show the configured text while the cursor is over the area. */
  private updateTooltip(ev: PointerEvent): void {
    const r = this.lastResult;
    // Bail unless there is a fillable area: a Point, an EMPTY_AREA (no rings) or
    // an empty MultiPolygon would crash booleanPointInPolygon.
    if (!this.tooltipFn || this.dragTarget || !r || !hasFill(r.area)) {
      this.adapter.setTooltip(null, ev.lngLat);
      return;
    }
    const c = this.uw(ev.lngLat);
    const inside = booleanPointInPolygon(
      [c.lon, c.lat],
      r.area as Feature<Polygon | MultiPolygon>,
    );
    const text = inside ? this.tooltipFn(r) : "";
    this.adapter.setTooltip(text || null, ev.lngLat);
  }

  /** Place the dynamic text (if configured) at the shape's anchor point. */
  private renderLabel(result: SigmetResult): void {
    const text = this.labelFn ? this.labelFn(result) : "";
    const anchor = text ? labelAnchor(result.area) : null;
    if (!anchor) {
      this.adapter.setOverlay("label", EMPTY);
      return;
    }
    this.adapter.setOverlay("label", fc([pointFeature(anchor[0], anchor[1], "label", { text })]));
  }

  /** Unwrap a pointer/centre position into the FIR's longitude frame. */
  private uw(p: LatLng): LatLng {
    return { lat: p.lat, lon: this.unwrapLon(p.lon) };
  }

  /** Map centre, in the FIR's longitude frame. */
  private center(): LatLng {
    return this.uw(this.adapter.getCenter());
  }

  private inFir(p: LatLng): boolean {
    return booleanPointInPolygon([p.lon, p.lat], this.firFeature);
  }

  /**
   * Resting position of a transform handle: the top-right corner of the point
   * set's envelope, pushed out by `marginFrac · span` so it sits clearly outside
   * the geometry (and away from the move/vertex handles). 0 = on the corner.
   */
  private transformRest(points: LatLng[], marginFrac = 0): LatLng {
    const [, , maxLon, maxLat] = pointsBbox(points);
    if (marginFrac === 0) return { lon: maxLon, lat: maxLat };
    const m = pointsSpan(points) * marginFrac;
    return { lon: maxLon + m, lat: maxLat + m };
  }

  /** At least one point of the shape is inside the FIR (the edit-validity rule). */
  private someInFir(points: LatLng[]): boolean {
    return points.some((p) => this.inFir(p));
  }

  /** Pin a line's two endpoints back onto the FIR border (line-side / corridor). */
  private snapEnds(points: LatLng[]): LatLng[] {
    if (points.length < 2) return points;
    const out = points.slice();
    out[0] = this.nearestOnFir(out[0]!);
    out[out.length - 1] = this.nearestOnFir(out[out.length - 1]!);
    return out;
  }

  /**
   * Translate a whole line by the cursor's *incremental* delta (no grab jump),
   * committed only while a point stays in the FIR. `this.dragLast` tracks the
   * previous cursor; it's always advanced so the line resumes smoothly after a
   * blocked step.
   */
  private translateLine(points: LatLng[], lon: number, lat: number): LatLng[] {
    const last = this.dragLast ?? { lat, lon };
    const dLon = lon - last.lon;
    const dLat = lat - last.lat;
    this.dragLast = { lat, lon };
    const moved = points.map((p) => ({ lon: p.lon + dLon, lat: p.lat + dLat }));
    return this.someInFir(moved) ? moved : points;
  }

  /**
   * Scale + rotate `points` about their centroid so the transform handle (whose
   * live position is `this.sizeAnchor`) tracks the cursor: drag in/out scales,
   * drag around rotates. `span` floors the scale so the shape can't collapse.
   * Pure — returns the new points and the new handle anchor; the caller commits
   * both only if the result is allowed (so a rejected move doesn't drift).
   */
  private applyTransform(
    points: LatLng[],
    lon: number,
    lat: number,
    span: number,
  ): { points: LatLng[]; anchor: LatLng } {
    const cen = pointsMean(points);
    const prev = this.sizeAnchor ?? cen;
    // Floor r0 at the same span fraction as `dist` so the per-frame scale can't
    // blow up when the previous anchor happens to sit near the centroid.
    const r0 = Math.max(Math.hypot(prev.lon - cen.lon, prev.lat - cen.lat), span * 0.02);
    const a0 = Math.atan2(prev.lat - cen.lat, prev.lon - cen.lon);
    const ang = Math.atan2(lat - cen.lat, lon - cen.lon);
    const dist = Math.max(Math.hypot(lon - cen.lon, lat - cen.lat), span * 0.02);
    const sc = dist / r0;
    const cosA = Math.cos(ang - a0);
    const sinA = Math.sin(ang - a0);
    const anchor = { lon: cen.lon + dist * Math.cos(ang), lat: cen.lat + dist * Math.sin(ang) };
    const out = points.map((p) => {
      const dx = (p.lon - cen.lon) * sc;
      const dy = (p.lat - cen.lat) * sc;
      return { lon: cen.lon + dx * cosA - dy * sinA, lat: cen.lat + dx * sinA + dy * cosA };
    });
    return { points: out, anchor };
  }

  /**
   * Magnetically snap a dragged interior vertex onto the line through its two
   * neighbours once within tolerance — aligning a vertex "clicks" into
   * collinearity (then it's greyed out / dropped from the result).
   */
  private snapCollinear(
    points: LatLng[],
    i: number,
    p: LatLng,
    cyclic: boolean,
    tolOverride?: number,
  ): LatLng {
    const n = points.length;
    const prev = cyclic ? points[(i - 1 + n) % n] : points[i - 1];
    const next = cyclic ? points[(i + 1) % n] : points[i + 1];
    if (!prev || !next) return p; // open-line endpoints don't snap
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    // Strictly below the collapse tolerance so a snapped vertex is always then
    // detected collinear & dropped — no "snapped but kept" gap. `tolOverride`
    // lets a small polygon use its own size instead of the FIR span (otherwise
    // a FIR-relative tol dwarfs a tiny shape and snaps/ignores everything).
    const tol = tolOverride ?? Math.max(maxLon - minLon, maxLat - minLat) * 0.01;
    if (perpDist(prev, p, next) >= tol) return p;
    // Project onto the prev–next SEGMENT (clamped) so the snap can't push the
    // vertex past a neighbour and self-intersect a polygon ring.
    return projectOnSegment(p, [prev.lon, prev.lat], [next.lon, next.lat]);
  }

  /**
   * Nearest point on the FIR boundary. When `near`/`maxDist` are given the search
   * is *local* — only segments within `maxDist` of `near` are considered — so a
   * dragged endpoint glides along the border instead of teleporting to whatever
   * edge happens to be globally closest to the cursor.
   */
  private nearestOnFir(p: LatLng, near?: LatLng, maxDist?: number): LatLng {
    let best = p;
    let bestD = Infinity;
    const r2 = maxDist != null ? maxDist * maxDist : Infinity;
    for (const ring of this.firRingList) {
      for (let i = 0; i + 1 < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[i + 1]!;
        if (near) {
          const da = (near.lon - a[0]) ** 2 + (near.lat - a[1]) ** 2;
          const db = (near.lon - b[0]) ** 2 + (near.lat - b[1]) ** 2;
          if (Math.min(da, db) > r2) continue;
        }
        const q = projectOnSegment(p, a, b);
        const d = (q.lon - p.lon) ** 2 + (q.lat - p.lat) ** 2;
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
    if (bestD === Infinity && near) return this.nearestOnFir(p); // nothing local → global
    return best;
  }

  private interiorPoint(): LatLng {
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const bboxCenter: LatLng = {
      lat: (minLat + maxLat) / 2,
      lon: (minLon + maxLon) / 2,
    };
    if (this.inFir(bboxCenter)) return bboxCenter;
    const ring = (
      this.firFeature.geometry.type === "Polygon"
        ? this.firFeature.geometry.coordinates[0]
        : this.firFeature.geometry.coordinates[0]?.[0]
    ) as [number, number][] | undefined;
    if (ring && ring.length) {
      const lon = ring.reduce((s, c) => s + c[0], 0) / ring.length;
      const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
      const avg = { lat, lon };
      if (this.inFir(avg)) return avg;
    }
    return bboxCenter;
  }
}
