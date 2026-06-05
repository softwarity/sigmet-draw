/**
 * Pure lon/lat math helpers for the drawing controller — sphere distance/bearing,
 * planar projection, polyline sampling, bbox, and antimeridian (un)wrapping. No
 * `this`, no DOM, no map engine: extracted from `sigmet-draw.ts` so the controller
 * stays orchestration and these stay unit-testable.
 */
import type { Feature, MultiPolygon, Polygon, Position } from "geojson";

import type { LatLng, LineSide, SigmetGeometry } from "../core/index.js";

/** Axis-aligned bounds `[minLon, minLat, maxLon, maxLat]`. */
export type Bbox = [number, number, number, number];

/** Earth radius in nautical miles. */
export const EARTH_NM = 3440.065;

export const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Index of a `<letter><int>` vertex role (e.g. "v3"→3, "a0"→0); -1 if malformed
 *  — strict so an empty/odd suffix can't silently resolve to vertex 0. */
export const vertexIndex = (role: string): number => {
  const m = /^[a-z](\d+)$/.exec(role);
  return m ? Number(m[1]) : -1;
};

/** Great-circle distance between two `[lon, lat]` points, in nautical miles. */
export function haversineNM(a: Position, b: Position): number {
  const toRad = (d: number): number => (d * Math.PI) / 180;
  const dLat = toRad(b[1]! - a[1]!);
  const dLon = toRad(b[0]! - a[0]!);
  const la1 = toRad(a[1]!);
  const la2 = toRad(b[1]!);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_NM * Math.asin(Math.sqrt(h));
}

const DIRS: LineSide[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

/** Snap a (dLon, dLat) direction to the nearest of the 8 compass `LineSide`s. */
export function snapSide(dLon: number, dLat: number): LineSide {
  let ang = (Math.atan2(dLon, dLat) * 180) / Math.PI; // 0 = N, 90 = E
  ang = ((ang % 360) + 360) % 360;
  return DIRS[Math.round(ang / 45) % 8]!;
}

export function oppositeSide(side: LineSide): LineSide {
  return DIRS[(DIRS.indexOf(side) + 4) % 8]!;
}

export function midpoint(points: LatLng[]): LatLng {
  const n = points.length || 1;
  return {
    lat: points.reduce((s, p) => s + p.lat, 0) / n,
    lon: points.reduce((s, p) => s + p.lon, 0) / n,
  };
}

/** Polyline prolonged at both ends by `deg` degrees, as [lon,lat] coords — so a
 * `lineSide` is drawn as a line overshooting the FIR, not a bounded segment. */
export function extendLine(points: LatLng[], deg: number): [number, number][] {
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

export function bearingDeg(from: LatLng, to: LatLng): number {
  const rad = Math.PI / 180;
  const phi1 = from.lat * rad;
  const phi2 = to.lat * rad;
  const dLambda = (to.lon - from.lon) * rad;
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return Math.atan2(y, x) / rad;
}

export function destinationPoint(
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
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta),
  );
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2),
    );
  return [lambda2 / rad, phi2 / rad];
}

/** Rewrite a geometry's longitudes through `uw` (for an unwrapped AM frame). */
export function unwrapGeometry(
  g: Polygon | MultiPolygon,
  uw: (lon: number) => number,
): Polygon | MultiPolygon {
  const ring = (r: Position[]): Position[] => r.map(([lon, lat]) => [uw(lon!), lat!] as Position);
  return g.type === "Polygon"
    ? { type: "Polygon", coordinates: g.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(ring)) };
}

/**
 * Re-express every longitude of a parametric geometry in the FIR working frame
 * (identity for a non-crossing FIR; 0..360 for an antimeridian-crossing one), so
 * a geometry from `fromTAC()` lines up with the FIR, overlays and pointer input.
 */
export function unwrapSigmetGeometry(g: SigmetGeometry, uw: (lon: number) => number): SigmetGeometry {
  const p = (pt: LatLng): LatLng => ({ lat: pt.lat, lon: uw(pt.lon) });
  switch (g.kind) {
    case "point":
      return { ...g, position: p(g.position) };
    case "meridian":
    case "quadrant":
      return { ...g, lon: uw(g.lon) };
    case "lonBand":
      return { ...g, west: uw(g.west), east: uw(g.east) };
    case "lineSide":
    case "polygon":
    case "wideLine":
      return { ...g, points: g.points.map(p) };
    case "corridor":
      return {
        ...g,
        lineA: { ...g.lineA, points: g.lineA.points.map(p) },
        lineB: { ...g.lineB, points: g.lineB.points.map(p) },
      };
    case "circle":
    case "tropicalCyclone":
      return { ...g, center: p(g.center) };
    default:
      return g; // parallel, latBand, entireFir — no longitude to unwrap
  }
}

export function ringsOf(feature: Feature<Polygon | MultiPolygon>): [number, number][][] {
  const polys =
    feature.geometry.type === "Polygon"
      ? [feature.geometry.coordinates]
      : feature.geometry.coordinates;
  return polys.flatMap((poly) => poly.map((ring) => ring as [number, number][]));
}

/**
 * Does the FIR cross the antimeridian? Structural test, not a bbox-width heuristic
 * (a genuinely wide non-crossing FIR can span > 180° of longitude without crossing):
 *  - split form (GeoJSON convention): the geometry touches BOTH ±180 edges;
 *  - jump form: a ring has consecutive vertices more than 180° apart in longitude.
 */
export function crossesAntimeridian(feature: Feature<Polygon | MultiPolygon>): boolean {
  const rings = ringsOf(feature);
  let touchesEast = false;
  let touchesWest = false;
  for (const ring of rings) {
    for (let i = 0; i < ring.length; i++) {
      const lon = ring[i]![0];
      if (lon >= 179.5) touchesEast = true;
      if (lon <= -179.5) touchesWest = true;
      if (i > 0 && Math.abs(lon - ring[i - 1]![0]) > 180) return true; // jump form
    }
  }
  return touchesEast && touchesWest; // split form
}

export function segLengths(points: LatLng[]): { len: number[]; total: number } {
  const len: number[] = [];
  let total = 0;
  for (let i = 0; i + 1 < points.length; i++) {
    const l = Math.hypot(points[i + 1]!.lon - points[i]!.lon, points[i + 1]!.lat - points[i]!.lat);
    len.push(l);
    total += l;
  }
  return { len, total };
}

/** Closest point on a polyline to p, plus its fraction (0..1) along the line. */
export function projectFraction(p: LatLng, points: LatLng[]): { point: LatLng; t: number } {
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
export function pointAtFraction(points: LatLng[], t: number): LatLng {
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

/** Mean of a point set — anchor for the polygon move handle / scale centre. */
export function pointsMean(points: LatLng[]): LatLng {
  let lon = 0;
  let lat = 0;
  for (const p of points) {
    lon += p.lon;
    lat += p.lat;
  }
  const n = points.length || 1;
  return { lon: lon / n, lat: lat / n };
}

/**
 * Characteristic size (largest bbox side) of a point set. Used for tolerances
 * that must scale with the shape itself — a small polygon needs proportionally
 * small snap/merge/collapse thresholds, not the FIR-span ones (which would dwarf
 * it and fuse or drop its vertices).
 */
export function pointsSpan(points: LatLng[]): number {
  const [minLon, minLat, maxLon, maxLat] = pointsBbox(points);
  return Math.max(maxLon - minLon, maxLat - minLat);
}

/** Axis-aligned bounds [minLon, minLat, maxLon, maxLat] of a point set. */
export function pointsBbox(points: LatLng[]): Bbox {
  let minLon = Infinity;
  let minLat = Infinity;
  let maxLon = -Infinity;
  let maxLat = -Infinity;
  for (const p of points) {
    if (p.lon < minLon) minLon = p.lon;
    if (p.lon > maxLon) maxLon = p.lon;
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
  }
  return [minLon, minLat, maxLon, maxLat];
}

/** Closest point on segment a–b to p (planar lon/lat, fine at FIR scale). */
export function projectOnSegment(p: LatLng, a: [number, number], b: [number, number]): LatLng {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy || 1;
  let t = ((p.lon - a[0]) * dx + (p.lat - a[1]) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return { lon: a[0] + t * dx, lat: a[1] + t * dy };
}

export function bboxOf(feature: Feature<Polygon | MultiPolygon>): Bbox {
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
