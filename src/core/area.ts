/**
 * Derive the concrete area (GeoJSON) shown on the map from a parametric
 * {@link SigmetGeometry}.
 *
 * Unbounded forms (half-planes, bands, quadrants, line-sides, corridors) are
 * only meaningful once clipped to a FIR, so a FIR polygon is required for them.
 * Bounded forms (polygon, circle, wide line, point) need no FIR, but can
 * optionally be clipped to one via `clipBounded`.
 */
import buffer from "@turf/buffer";
import circle from "@turf/circle";
import { featureCollection, lineString, point, polygon } from "@turf/helpers";
import intersect from "@turf/intersect";
import type {
  Feature,
  MultiPolygon,
  Point,
  Polygon,
  Position,
} from "geojson";

import type { LatLng } from "./coord.js";
import { UNBOUNDED_KINDS } from "./types.js";
import type { LineSide, SigmetGeometry } from "./types.js";

export type FirInput =
  | Feature<Polygon | MultiPolygon>
  | Polygon
  | MultiPolygon;

export interface AreaOptions {
  /** FIR to clip against. Mandatory for unbounded geometries. */
  fir?: FirInput;
  /** Also clip bounded shapes (polygon/circle/wide line) to the FIR. */
  clipBounded?: boolean;
  /** Arc resolution for circles/buffers (turf `steps`). */
  steps?: number;
  /**
   * Longitude bounds for the unbounded half-plane rectangles. Defaults to
   * [-180, 180]; pass a shifted frame (e.g. [0, 360]) for a FIR that crosses the
   * antimeridian, with all input coordinates expressed in that same frame.
   */
  lonBounds?: [number, number];
}

type AreaFeature = Feature<Polygon | MultiPolygon>;

const LON_MIN = -180;
const LON_MAX = 180;
const LAT_MIN = -89.9;
const LAT_MAX = 89.9;
/** Offset distance (degrees) used to build half-planes from oblique lines. */
const FAR = 120;

const pos = (p: LatLng): Position => [p.lon, p.lat];
const clampLat = (v: number): number => Math.min(LAT_MAX, Math.max(LAT_MIN, v));

function rect(
  lonMin: number,
  latMin: number,
  lonMax: number,
  latMax: number,
): Feature<Polygon> {
  return polygon([
    [
      [lonMin, latMin],
      [lonMax, latMin],
      [lonMax, latMax],
      [lonMin, latMax],
      [lonMin, latMin],
    ],
  ]);
}

const SIDE_VEC: Record<LineSide, [number, number]> = {
  N: [0, 1],
  S: [0, -1],
  E: [1, 0],
  W: [-1, 0],
  NE: [1, 1],
  NW: [-1, 1],
  SE: [1, -1],
  SW: [-1, -1],
};

/**
 * Prolong the first and last segments of a polyline by `deg` degrees so it
 * behaves like an infinite *line* (the SIGMET sense) rather than a finite
 * segment — its ends must run past the FIR for the half-plane to divide cleanly.
 */
function extendPolyline(points: LatLng[], deg: number): LatLng[] {
  if (points.length < 2) return points;
  const ext = (a: LatLng, b: LatLng): LatLng => {
    const dx = a.lon - b.lon;
    const dy = a.lat - b.lat;
    const len = Math.hypot(dx, dy) || 1;
    return { lon: a.lon + (dx / len) * deg, lat: a.lat + (dy / len) * deg };
  };
  const p0 = points[0]!;
  const p1 = points[1]!;
  const pn = points[points.length - 1]!;
  const pm = points[points.length - 2]!;
  return [ext(p0, p1), ...points, ext(pn, pm)];
}

/** Build a large polygon covering the chosen side of an oblique (infinite) line. */
function lineHalfPlane(
  points: LatLng[],
  side: LineSide,
  lonBounds: [number, number] = [LON_MIN, LON_MAX],
): Feature<Polygon> {
  const [dLon, dLat] = SIDE_VEC[side];
  const [lon0, lon1] = lonBounds;
  const line = extendPolyline(points, FAR);
  const base = line.map(pos);
  const offset = line
    .map((p) => [
      Math.min(lon1, Math.max(lon0, p.lon + dLon * FAR)),
      clampLat(p.lat + dLat * FAR),
    ])
    .reverse();
  const ring = [...base, ...offset, base[0]!] as Position[];
  return polygon([ring]);
}

/** Shift every longitude of a polygon feature by `delta` (in place). */
function shiftFeatureLon(f: Feature<Polygon | MultiPolygon>, delta: number): void {
  const ring = (r: Position[]) => {
    for (const c of r) c[0] = c[0]! + delta;
  };
  if (f.geometry.type === "Polygon") f.geometry.coordinates.forEach(ring);
  else f.geometry.coordinates.forEach((poly) => poly.forEach(ring));
}

function toFirFeature(fir: FirInput): Feature<Polygon | MultiPolygon> {
  if (fir.type === "Feature") return fir;
  return { type: "Feature", properties: {}, geometry: fir };
}

/**
 * Round all coordinates to `precision` decimals (~1 cm at 7). JSTS — turf's
 * intersection backend — throws "Unable to complete output ring" on certain
 * near-degenerate vertex configurations; snapping coordinate precision is the
 * standard, visually-imperceptible cure.
 */
function truncateFeature(f: AreaFeature, precision = 7): AreaFeature {
  const m = 10 ** precision;
  const r = (ring: Position[]): Position[] =>
    ring.map(([x, y]) => [Math.round(x! * m) / m, Math.round(y! * m) / m] as Position);
  const g = f.geometry;
  const geometry: Polygon | MultiPolygon =
    g.type === "Polygon"
      ? { type: "Polygon", coordinates: g.coordinates.map(r) }
      : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(r)) };
  return { type: "Feature", properties: f.properties ?? {}, geometry };
}

/** JSTS can return a valid-but-empty geometry (no rings) instead of null. */
function isEmptyArea(f: AreaFeature | null): boolean {
  if (!f) return true;
  const g = f.geometry;
  if (g.type === "Polygon") return g.coordinates.length === 0;
  if (g.type === "MultiPolygon") return g.coordinates.length === 0;
  return false;
}

function clip(area: AreaFeature, fir: Feature<Polygon | MultiPolygon>): AreaFeature {
  const run = (a: AreaFeature, b: AreaFeature): AreaFeature | null => {
    const out = intersect(featureCollection([a, b]) as never) as AreaFeature | null;
    // Normalise an empty result to null so it's treated as a genuine no-overlap.
    return isEmptyArea(out) ? null : out;
  };
  // 1) Direct. A clean `null` here is a genuine no-overlap — don't retry.
  try {
    const direct = run(area, fir);
    if (direct) return direct;
    throw new Error("Geometry does not intersect the FIR");
  } catch (err) {
    if (err instanceof Error && err.message.includes("does not intersect")) throw err;
    // JSTS threw (robustness). 2) snap precision, then 3) buffer(0) repair — so a
    // truncation artefact can't masquerade as a (false) no-intersection.
    const repair = (f: AreaFeature): AreaFeature => {
      const b = buffer(f, 0) as AreaFeature | undefined;
      return b ?? f;
    };
    let result: AreaFeature | null = null;
    try {
      result = run(truncateFeature(area), truncateFeature(fir));
    } catch {
      result = null;
    }
    if (!result) {
      try {
        result = run(repair(area), repair(fir));
      } catch {
        result = null;
      }
    }
    if (!result) throw new Error("Geometry does not intersect the FIR");
    return result;
  }
}

/**
 * Compute the displayable area for a geometry. Points return a Point feature.
 *
 * Note: a `tropicalCyclone` geometry decoded from TAC carries a placeholder
 * `center` of `{ lat: 0, lon: 0 }` (the centre is not encoded in the text). The
 * caller MUST set a real `center` before calling `toArea`, otherwise the circle
 * is drawn off the coast of West Africa. The map controller resolves this from
 * the FIR automatically; pure-core callers are responsible for it themselves.
 */
export function toArea(
  geometry: SigmetGeometry,
  options: AreaOptions = {},
): Feature<Polygon | MultiPolygon | Point> {
  const { fir, clipBounded = false, steps = 64 } = options;
  const [LON0, LON1] = options.lonBounds ?? [LON_MIN, LON_MAX];

  if (UNBOUNDED_KINDS.has(geometry.kind) && !fir) {
    throw new Error(`"${geometry.kind}" is unbounded and requires a FIR`);
  }
  const firFeat = fir ? toFirFeature(fir) : undefined;

  switch (geometry.kind) {
    case "point":
      return point(pos(geometry.position));

    case "entireFir":
      if (!firFeat) throw new Error('"entireFir" requires a FIR');
      return firFeat;

    case "parallel": {
      const r =
        geometry.side === "N"
          ? rect(LON0, geometry.lat, LON1, LAT_MAX)
          : rect(LON0, LAT_MIN, LON1, geometry.lat);
      return clip(r, firFeat!);
    }

    case "meridian": {
      const r =
        geometry.side === "E"
          ? rect(geometry.lon, LAT_MIN, LON1, LAT_MAX)
          : rect(LON0, LAT_MIN, geometry.lon, LAT_MAX);
      return clip(r, firFeat!);
    }

    case "quadrant": {
      const lonMin = geometry.lonSide === "E" ? geometry.lon : LON0;
      const lonMax = geometry.lonSide === "E" ? LON1 : geometry.lon;
      const latMin = geometry.latSide === "N" ? geometry.lat : LAT_MIN;
      const latMax = geometry.latSide === "N" ? LAT_MAX : geometry.lat;
      return clip(rect(lonMin, latMin, lonMax, latMax), firFeat!);
    }

    case "latBand":
      return clip(rect(LON0, geometry.south, LON1, geometry.north), firFeat!);

    case "lonBand":
      return clip(rect(geometry.west, LAT_MIN, geometry.east, LAT_MAX), firFeat!);

    case "lineSide":
      return clip(
        lineHalfPlane(geometry.points, geometry.side, [LON0, LON1]),
        firFeat!,
      );

    case "corridor": {
      const a = lineHalfPlane(geometry.lineA.points, geometry.lineA.side, [LON0, LON1]);
      const b = lineHalfPlane(geometry.lineB.points, geometry.lineB.side, [LON0, LON1]);
      const band = intersect(featureCollection([a, b]) as never) as
        | AreaFeature
        | null;
      if (!band) throw new Error("Corridor half-planes do not overlap");
      return clip(band, firFeat!);
    }

    case "polygon": {
      const ring = geometry.points.map(pos);
      ring.push(ring[0]!);
      const poly = polygon([ring]);
      return clipBounded && firFeat ? clip(poly, firFeat) : poly;
    }

    case "circle":
    case "tropicalCyclone": {
      const units =
        geometry.unit === "NM" ? "nauticalmiles" : "kilometers";
      const c = circle(pos(geometry.center), geometry.radius, {
        units,
        steps,
      }) as Feature<Polygon>;
      return clipBounded && firFeat ? clip(c, firFeat) : c;
    }

    case "wideLine": {
      const units = geometry.unit === "NM" ? "nauticalmiles" : "kilometers";
      // turf's (JSTS) buffer mishandles longitudes outside [-180,180] (the
      // unwrapped antimeridian frame), so shift near 0, buffer, then shift back.
      // Unwrap EACH vertex relative to the reference so a line whose own vertices
      // straddle ±180 stays contiguous (not a ~358°-wide degenerate input).
      const lonRef = geometry.points[0]?.lon ?? 0;
      const rel = (lon: number): number => {
        let d = lon - lonRef;
        while (d > 180) d -= 360;
        while (d < -180) d += 360;
        return d;
      };
      const line = lineString(
        geometry.points.map((p) => [rel(p.lon), p.lat] as Position),
      );
      const buffered = buffer(line, geometry.width / 2, {
        units,
        steps,
      }) as Feature<Polygon | MultiPolygon> | undefined;
      if (!buffered) throw new Error("Failed to buffer wide line");
      shiftFeatureLon(buffered, lonRef);
      return clipBounded && firFeat ? clip(buffered, firFeat) : buffered;
    }
  }
}
