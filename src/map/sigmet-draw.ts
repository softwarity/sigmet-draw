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
import type { FirInput, LatLng, LineSide, SigmetGeometry } from "../core/index.js";
import type { MapAdapter, PointerEvent } from "./adapter.js";
import { collapseCollinear, collapseRing, perpDist, widthFor } from "./geometry.js";
import { DEFAULT_STYLE, mergeStyle } from "./style.js";
import type { SigmetStyle, SigmetStyleInput } from "./style.js";

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
  /**
   * Dynamic text rendered on the shape — e.g. `(r) => r.tac`. Omit for no label;
   * return `""` from the function to hide it for a given geometry.
   */
  label?: LabelFn;
}

export interface SigmetResult {
  geometry: SigmetGeometry;
  tac: string;
  area: Feature<Polygon | MultiPolygon | Point>;
}

type Bbox = [number, number, number, number];
/** The `role` of the handle/guide currently being dragged (e.g. "center", "lon", "north"). */
type DragTarget = string;

const EARTH_NM = 3440.065;
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
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
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
  private readonly readyPromise: Promise<void>;

  private active: SigmetGeometry | null = null;
  private dragTarget: DragTarget | null = null;
  private destroyed = false;
  /** Coalesces drag re-renders to one per animation frame (turf work is costly). */
  private renderScheduled = false;
  /** UI-only: bearing of the circle's radius handle so it follows the cursor. */
  private circleBearing = 90;
  /** UI-only: width handle placement, relative to the line so it survives edits:
   * fraction along the line (0..1) and which side (+1 / -1). */
  private widthT = 0.5;
  private widthSide = 1;
  /** Longitude frame: identity normally; shifts negatives by +360 for a FIR that
   * crosses the antimeridian, so all geometry is contiguous. */
  private unwrapLon!: (lon: number) => number;
  private lonBounds!: [number, number];
  private style: SigmetStyle;
  private labelFn: LabelFn | null;

  constructor(opts: SigmetDrawOptions) {
    this.adapter = opts.adapter;
    this.style = mergeStyle(DEFAULT_STYLE, opts.style);
    this.labelFn = opts.label ?? null;
    // Hand the resolved style to the adapter before it builds its overlays.
    this.adapter.setStyle(this.style);
    this.applyFir(opts.fir);

    this.readyPromise = this.adapter.ready().then(() => {
      // The FIR is drawn by the host on its own map — not by this module.
      this.adapter.onPointer((ev) => this.onPointer(ev));
    });
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

  private applyFir(fir: FirInput): void {
    const raw: Feature<Polygon | MultiPolygon> =
      fir.type === "Feature" ? fir : { type: "Feature", properties: {}, geometry: fir };
    // Crossing FIRs are stored split at ±180 (GeoJSON convention), so their bbox
    // spans the full −180..180 — a lon extent > 180° is the reliable signal here.
    const rawBbox = bboxOf(raw);
    const crosses = rawBbox[2] - rawBbox[0] > 180;
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

  /** Subscribe to geometry changes (placement or edit). */
  on(event: "change", cb: (r: SigmetResult) => void): void {
    if (event === "change") this.listeners.add(cb);
  }

  /** Unsubscribe a `change` listener previously added with {@link on}. */
  off(event: "change", cb: (r: SigmetResult) => void): void {
    if (event === "change") this.listeners.delete(cb);
  }

  /** Load an existing geometry (e.g. from `fromTAC`) and render it for editing. */
  load(geometry: SigmetGeometry): void {
    this.circleBearing = 90;
    this.widthT = 0.5;
    this.widthSide = 1;
    this.active = geometry;
    this.renderActive();
  }

  circle(): void {
    this.adapter.setOverlay("guide", EMPTY);
    this.adapter.setOverlay("other", EMPTY);
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    let center: LatLng = {
      lat: clamp(this.center().lat, minLat, maxLat),
      lon: clamp(this.center().lon, minLon, maxLon),
    };
    if (!this.inFir(center)) center = this.interiorPoint();
    const midLat = (minLat + maxLat) / 2;
    const halfWidthNM = haversineNM([minLon, midLat], [maxLon, midLat]) / 2;
    const radius = Math.max(20, Math.round(halfWidthNM * 0.5));
    this.circleBearing = 90;
    this.active = { kind: "circle", center, radius, unit: "NM" };
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

  lineSide(): void {
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const midLat = (minLat + maxLat) / 2;
    // 4 points (the LINE max): endpoints snapped to the border, 2 inner points
    // interpolated so the line starts straight — the user bends them if needed.
    const a0 = this.nearestOnFir({ lat: midLat, lon: minLon });
    const a3 = this.nearestOnFir({ lat: midLat, lon: maxLon });
    const lerp = (k: number): LatLng => ({
      lat: a0.lat + (a3.lat - a0.lat) * k,
      lon: a0.lon + (a3.lon - a0.lon) * k,
    });
    this.active = { kind: "lineSide", points: [a0, lerp(1 / 3), lerp(2 / 3), a3], side: "N" };
    this.renderActive();
  }

  corridor(): void {
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const mid = (minLat + maxLat) / 2;
    const off = (maxLat - minLat) * 0.18;
    const mkLine = (lat: number): LatLng[] => {
      const a0 = this.nearestOnFir({ lat, lon: minLon });
      const a3 = this.nearestOnFir({ lat, lon: maxLon });
      const lerp = (k: number): LatLng => ({
        lat: a0.lat + (a3.lat - a0.lat) * k,
        lon: a0.lon + (a3.lon - a0.lon) * k,
      });
      return [a0, lerp(1 / 3), lerp(2 / 3), a3];
    };
    this.active = {
      kind: "corridor",
      lineA: { points: mkLine(mid - off), side: "N" },
      lineB: { points: mkLine(mid + off), side: "S" },
    };
    this.renderActive();
  }

  point(): void {
    this.active = { kind: "point", position: this.viewInteriorPoint() };
    this.renderActive();
  }

  entireFir(): void {
    this.active = { kind: "entireFir", region: "FIR" };
    this.renderActive();
  }

  polygon(): void {
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    const c = this.viewInteriorPoint();
    const rx = (maxLon - minLon) * 0.18;
    const ry = (maxLat - minLat) * 0.18;
    const n = 5;
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
    // the user bends/aligns them. Default 50 KM width.
    this.widthT = 0.5;
    this.widthSide = 1;
    const x0 = c.lon - w * 0.3;
    const x1 = c.lon + w * 0.3;
    this.active = {
      kind: "wideLine",
      points: [0, 1, 2, 3].map((i) => ({ lat: c.lat, lon: x0 + (x1 - x0) * (i / 3) })),
      width: 50,
      unit: "KM",
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
    for (const id of ["area", "other", "guide", "handles"] as const) {
      this.adapter.setOverlay(id, EMPTY);
    }
  }

  /** Detach from the host map: clears listeners and tells the adapter to remove
   *  its overlays/listeners/toolbar. Idempotent; the host's map is left intact. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.listeners.clear();
    this.active = null;
    this.dragTarget = null;
    this.adapter.destroy();
  }

  private onPointer(ev: PointerEvent): void {
    if (this.destroyed) return;
    const a = this.active;
    switch (ev.type) {
      case "down": {
        if (!a) return;
        // Any handle/guide carries a `role` identifying what is being dragged.
        if (ev.hit?.overlay === "handles" || ev.hit?.overlay === "guide") {
          const role = ev.hit.props["role"];
          if (typeof role === "string") {
            this.dragTarget = role;
            this.adapter.setPanEnabled(false);
          }
        }
        return;
      }
      case "move": {
        if (!this.dragTarget || !a) return;
        const [minLon, minLat, maxLon, maxLat] = this.firBbox;
        const { lat, lon } = this.uw(ev.lngLat);
        const t = this.dragTarget;
        switch (a.kind) {
          case "circle":
            if (t === "center") {
              if (this.inFir({ lat, lon })) a.center = { lat, lon };
            } else if (t === "radius") {
              // Cap at the FIR's diagonal so the circle can't span the globe and
              // break the clip; the unit follows the geometry (NM/KM).
              const diagNM = haversineNM([minLon, minLat], [maxLon, maxLat]);
              const rNM = haversineNM([a.center.lon, a.center.lat], [lon, lat]);
              const toUnit = a.unit === "KM" ? 1.852 : 1;
              a.radius = Math.max(
                1,
                Math.min(Math.round(diagNM * toUnit), Math.round(rNM * toUnit)),
              );
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
          case "lonBand":
            if (t === "west") a.west = clamp(lon, minLon, a.east);
            else if (t === "east") a.east = clamp(lon, a.west, maxLon);
            break;
          case "quadrant":
            if (t === "lat") a.lat = clamp(lat, minLat, maxLat);
            else if (t === "lon") a.lon = clamp(lon, minLon, maxLon);
            break;
          case "lineSide": {
            const r = Math.max(maxLon - minLon, maxLat - minLat) * 0.25;
            const i = Number(t.slice(1));
            const cur = a.points[i];
            if (cur) {
              const isEnd = i === 0 || i === a.points.length - 1;
              a.points[i] = isEnd
                ? this.nearestOnFir({ lat, lon }, cur, r)
                : this.snapCollinear(a.points, i, { lat, lon }, false);
            }
            break;
          }
          case "corridor": {
            const r = Math.max(maxLon - minLon, maxLat - minLat) * 0.25;
            const line = t[0] === "a" ? a.lineA : a.lineB;
            const i = Number(t.slice(1));
            const cur = line.points[i];
            if (cur) {
              const isEnd = i === 0 || i === line.points.length - 1;
              line.points[i] = isEnd
                ? this.nearestOnFir({ lat, lon }, cur, r)
                : this.snapCollinear(line.points, i, { lat, lon }, false);
            }
            break;
          }
          case "point":
            // Constrained to stay inside the FIR.
            if (this.inFir({ lat, lon })) a.position = { lat, lon };
            break;
          case "polygon": {
            const i = Number(t.slice(1));
            if (a.points[i]) a.points[i] = this.snapCollinear(a.points, i, { lat, lon }, true);
            break;
          }
          case "wideLine": {
            if (t === "w") {
              const cursor = { lat, lon };
              const { point: foot, t: ft } = projectFraction(cursor, a.points);
              const halfNM = haversineNM([foot.lon, foot.lat], [lon, lat]);
              const { unit, width } = widthFor(halfNM);
              a.unit = unit;
              a.width = width;
              // Follows the cursor: position along the line + side (both kept on edits).
              this.widthT = ft;
              const lineBrg = bearingDeg(a.points[0]!, a.points[a.points.length - 1]!);
              const toCursor = bearingDeg(foot, cursor);
              this.widthSide =
                angleDiff(toCursor, lineBrg + 90) <= angleDiff(toCursor, lineBrg - 90) ? 1 : -1;
            } else {
              const i = Number(t.slice(1));
              if (a.points[i]) a.points[i] = this.snapCollinear(a.points, i, { lat, lon }, false);
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
      // Endpoints sit on the border; the line only pokes slightly past it.
      // No role → the line itself isn't grabbable; you drag the point handles.
      this.adapter.setOverlay(
        "guide",
        fc([lineFeature(extendLine(a.points, span * 0.06))]),
      );
      this.adapter.setOverlay(
        "handles",
        fc(
          a.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `v${i}`, { collinear: collinear[i] === true }),
          ),
        ),
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
          lineFeature(extendLine(a.lineA.points, span * 0.06)),
          lineFeature(extendLine(a.lineB.points, span * 0.06)),
        ]),
      );
      this.adapter.setOverlay(
        "handles",
        fc([
          ...a.lineA.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `a${i}`, { collinear: A.collinear[i] === true }),
          ),
          ...a.lineB.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `b${i}`, { collinear: B.collinear[i] === true }),
          ),
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
      const [minLon, minLat, maxLon, maxLat] = this.firBbox;
      const tol = Math.max(maxLon - minLon, maxLat - minLat) * 0.015;
      // Collinear vertices are redundant → dropped from the TAC/area, greyed out.
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
      this.adapter.setOverlay(
        "handles",
        fc(
          a.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `v${i}`, { collinear: collinear[i] === true }),
          ),
        ),
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
      const halfNM = a.unit === "KM" ? a.width / 2 / 1.852 : a.width / 2;
      const foot = pointAtFraction(ends, this.widthT);
      const brg = bearingDeg(ends[0]!, ends[ends.length - 1]!) + 90 * this.widthSide;
      const wh = destinationPoint(foot, halfNM, brg);
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay(
        "guide",
        fc([lineFeature(a.points.map((p) => [p.lon, p.lat] as [number, number]))]),
      );
      this.adapter.setOverlay(
        "handles",
        fc([
          ...a.points.map((p, i) =>
            pointFeature(p.lon, p.lat, `v${i}`, { collinear: collinear[i] === true }),
          ),
          pointFeature(wh[0], wh[1], "w", { control: true }),
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
      const edge = destinationPoint(a.center, a.radius, this.circleBearing);
      this.adapter.setOverlay("area", area ? fc([area]) : EMPTY);
      this.adapter.setOverlay("other", EMPTY);
      this.adapter.setOverlay("guide", EMPTY);
      this.adapter.setOverlay(
        "handles",
        fc([
          pointFeature(a.center.lon, a.center.lat, "center"),
          pointFeature(edge[0], edge[1], "radius", { control: true }),
        ]),
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
    for (const cb of this.listeners) cb(result);
    this.renderLabel(result);
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
   * Magnetically snap a dragged interior vertex onto the line through its two
   * neighbours once within tolerance — aligning a vertex "clicks" into
   * collinearity (then it's greyed out / dropped from the result).
   */
  private snapCollinear(points: LatLng[], i: number, p: LatLng, cyclic: boolean): LatLng {
    const n = points.length;
    const prev = cyclic ? points[(i - 1 + n) % n] : points[i - 1];
    const next = cyclic ? points[(i + 1) % n] : points[i + 1];
    if (!prev || !next) return p; // open-line endpoints don't snap
    const [minLon, minLat, maxLon, maxLat] = this.firBbox;
    // Strictly below the collapse tolerance (0.015·span) so a snapped vertex is
    // always then detected collinear & dropped — no "snapped but kept" gap, and
    // no silently-dropped deliberate bend just above the threshold.
    const tol = Math.max(maxLon - minLon, maxLat - minLat) * 0.01;
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

function haversineNM(a: Position, b: Position): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1]! - a[1]!);
  const dLon = toRad(b[0]! - a[0]!);
  const la1 = toRad(a[1]!);
  const la2 = toRad(b[1]!);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.sqrt(h));
}

const DIRS: LineSide[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Snap a (dLon, dLat) direction to the nearest of the 8 compass `LineSide`s. */
function snapSide(dLon: number, dLat: number): LineSide {
  let ang = (Math.atan2(dLon, dLat) * 180) / Math.PI; // 0 = N, 90 = E
  ang = ((ang % 360) + 360) % 360;
  return DIRS[Math.round(ang / 45) % 8]!;
}

function oppositeSide(side: LineSide): LineSide {
  return DIRS[(DIRS.indexOf(side) + 4) % 8]!;
}

function midpoint(points: LatLng[]): LatLng {
  const n = points.length || 1;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lon: points.reduce((s, p) => s + p.lon, 0) / n,
  };
}

/** Polyline prolonged at both ends by `deg` degrees, as [lon,lat] coords — so a
 * `lineSide` is drawn as a line overshooting the FIR, not a bounded segment. */
function extendLine(points: LatLng[], deg: number): [number, number][] {
  const coords = points.map((p) => [p.lon, p.lat] as [number, number]);
  if (points.length < 2) return coords;
  const ext = (a: LatLng, b: LatLng): [number, number] => {
    const dx = a.lon - b.lon;
    const dy = a.lat - b.lat;
    const len = Math.hypot(dx, dy) || 1;
    return [a.lon + (dx / len) * deg, a.lat + (dy / len) * deg];
  };
  const p0 = points[0]!;
  const p1 = points[1]!;
  const pn = points[points.length - 1]!;
  const pm = points[points.length - 2]!;
  return [ext(p0, p1), ...coords, ext(pn, pm)];
}

/** Smallest absolute difference between two bearings, in degrees [0,180]. */
function angleDiff(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 360) % 360);
  return d > 180 ? 360 - d : d;
}

function bearingDeg(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const phi1 = from.lat * rad;
  const phi2 = to.lat * rad;
  const dLambda = (to.lon - from.lon) * rad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return Math.atan2(y, x) / rad;
}

function destinationPoint(
  from: LatLng,
  distanceNM: number,
  bearingDegrees: number,
): [number, number] {
  const rad = Math.PI / 180;
  const delta = distanceNM / EARTH_NM;
  const theta = bearingDegrees * rad;
  const phi1 = from.lat * rad;
  const lambda1 = from.lon * rad;
  const phi2 = Math.asin(
    Math.sin(phi1) * Math.cos(delta) +
      Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );
  return [lambda2 / rad, phi2 / rad];
}

/** Perpendicular distance (deg) of b from the line a–c. */
/** Rewrite a geometry's longitudes through `uw` (for an unwrapped AM frame). */
function unwrapGeometry(
  g: Polygon | MultiPolygon,
  uw: (lon: number) => number,
): Polygon | MultiPolygon {
  const ring = (r: Position[]): Position[] =>
    r.map(([lon, lat]) => [uw(lon!), lat!] as Position);
  return g.type === "Polygon"
    ? { type: "Polygon", coordinates: g.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(ring)) };
}

function ringsOf(feature: Feature<Polygon | MultiPolygon>): [number, number][][] {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polys.flatMap((poly) => poly.map((ring) => ring as [number, number][]));
}

function segLengths(points: LatLng[]): { len: number[]; total: number } {
  const len: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const l = Math.hypot(
      points[i + 1]!.lon - points[i]!.lon,
      points[i + 1]!.lat - points[i]!.lat,
    );
    len.push(l);
    total += l;
  }
  return { len, total };
}

/** Closest point on a polyline to p, plus its fraction (0..1) along the line. */
function projectFraction(p: LatLng, points: LatLng[]): { point: LatLng; t: number } {
  const { len, total } = segLengths(points);
  let best = points[0]!;
  let bestD = Infinity;
  let bestT = 0;
  let acc = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i]!;
    const q = projectOnSegment(p, [a.lon, a.lat], [points[i + 1]!.lon, points[i + 1]!.lat]);
    const d = (q.lon - p.lon) ** 2 + (q.lat - p.lat) ** 2;
    if (d < bestD) {
      bestD = d;
      best = q;
      const along = Math.hypot(q.lon - a.lon, q.lat - a.lat);
      bestT = total > 0 ? (acc + along) / total : 0;
    }
    acc += len[i]!;
  }
  return { point: best, t: bestT };
}

/** Point at fraction `t` (0..1) along a polyline. */
function pointAtFraction(points: LatLng[], t: number): LatLng {
  if (points.length < 2) return points[0]!;
  const { len, total } = segLengths(points);
  const target = t * total;
  let acc = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const l = len[i]!;
    if (acc + l >= target || i === points.length - 2) {
      const f = l > 0 ? (target - acc) / l : 0;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { lat: a.lat + (b.lat - a.lat) * f, lon: a.lon + (b.lon - a.lon) * f };
    }
    acc += l;
  }
  return points[points.length - 1]!;
}

/** Closest point on segment a–b to p (planar lon/lat, fine at FIR scale). */
function projectOnSegment(p: LatLng, a: [number, number], b: [number, number]): LatLng {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  let t = ((p.lon - a[0]) * dx + (p.lat - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { lon: a[0] + t * dx, lat: a[1] + t * dy };
}

function bboxOf(feature: Feature<Polygon | MultiPolygon>): Bbox {
  let minLon = 180;
  let minLat = 90;
  let maxLon = -180;
  let maxLat = -90;
  const rings =
    feature.geometry.type === "Polygon"
      ? feature.geometry.coordinates
      : feature.geometry.coordinates.flat();
  for (const ring of rings) {
    for (const [lon, lat] of ring as [number, number][]) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  }
  return [minLon, minLat, maxLon, maxLat];
}
