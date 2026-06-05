/**
 * Pure, DOM-free geometry helpers used by the drawing controller — extracted so
 * they can be unit-tested without a map.
 */
import type { LatLng } from "../core/index.js";

/** Kilometres per nautical mile — the SIGMET width/radius KM↔NM conversion. */
export const KM_PER_NM = 1.852;

/** Perpendicular distance from `b` to the line through `a` and `c` (planar). */
export function perpDist(a: LatLng, b: LatLng, c: LatLng): number {
  const dx = c.lon - a.lon;
  const dy = c.lat - a.lat;
  const len = Math.hypot(dx, dy) || 1;
  return Math.abs((b.lon - a.lon) * dy - (b.lat - a.lat) * dx) / len;
}

/**
 * Drop interior points that are collinear with their neighbours (within `tol`):
 * an aligned middle point is redundant and must not appear in the result. Returns
 * the effective points + a per-original-index `collinear` flag (for styling).
 */
export function collapseCollinear(
  points: LatLng[],
  tol: number,
): { points: LatLng[]; collinear: boolean[] } {
  const n = points.length;
  const collinear = new Array<boolean>(n).fill(false);
  if (n <= 2) return { points: [...points], collinear };
  const kept: LatLng[] = [points[0]!];
  for (let i = 1; i < n - 1; i++) {
    if (perpDist(points[i - 1]!, points[i]!, points[i + 1]!) < tol) collinear[i] = true;
    else kept.push(points[i]!);
  }
  kept.push(points[n - 1]!);
  return { points: kept, collinear };
}

/** Signed area ×2 of triangle a-b-c — >0 if c is left of a→b (planar lon/lat). */
function orient(a: LatLng, b: LatLng, c: LatLng): number {
  return (b.lon - a.lon) * (c.lat - a.lat) - (b.lat - a.lat) * (c.lon - a.lon);
}

/**
 * Do segments p1–p2 and p3–p4 *properly* cross (interiors intersect)? Shared
 * endpoints and collinear touching count as NOT crossing — we only want to flag
 * a real X-shaped overlap. Planar; fine at FIR scale.
 */
export function segmentsCross(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/** Distance from point `p` to segment a–b (planar lon/lat). */
function distToSegment(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const l2 = dx * dx + dy * dy;
  if (l2 === 0) return Math.hypot(p.lon - a.lon, p.lat - a.lat);
  let t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.lon - (a.lon + t * dx), p.lat - (a.lat + t * dy));
}

/**
 * Is an open polyline usable as a line-side / corridor leg: endpoints at least
 * `minEndGap` apart (not collapsed onto the same border point) and no two
 * non-adjacent edges crossing (not folded into a self-intersection). Used to
 * reject a whole-line translate/transform whose endpoint re-snap degenerated it.
 */
export function lineUsable(points: LatLng[], minEndGap: number): boolean {
  const n = points.length;
  if (n < 2) return false;
  const a = points[0]!;
  const b = points[n - 1]!;
  if (Math.hypot(b.lon - a.lon, b.lat - a.lat) < minEndGap) return false;
  for (let i = 0; i + 1 < n; i++) {
    for (let j = i + 2; j + 1 < n; j++) {
      if (segmentsCross(points[i]!, points[i + 1]!, points[j]!, points[j + 1]!)) return false;
    }
  }
  return true;
}

/** Shortest distance between segments p1–p2 and p3–p4 (0 if they cross). */
export function segmentDistance(p1: LatLng, p2: LatLng, p3: LatLng, p4: LatLng): number {
  if (segmentsCross(p1, p2, p3, p4)) return 0;
  return Math.min(
    distToSegment(p1, p3, p4),
    distToSegment(p2, p3, p4),
    distToSegment(p3, p1, p2),
    distToSegment(p4, p1, p2),
  );
}

/**
 * Is moving vertex `i` of a path to `cand` a legal edit? Shared by closed rings
 * (`cyclic`) and open polylines. The two clearances (lon/lat units) reject the
 * move as soon as the vertex gets *near* a degeneracy, not only once it produces
 * one — a vertex moves and acts only on its adjacent edge(s); it can never merge
 * with another point or touch the rest of the path. Rejects:
 *  - **merge**: `cand` within `vertexMin` of *any* other vertex — two points
 *    can't be grouped (and a corner can't be dropped, stranding the handles).
 *  - **edge-on-edge**: an edge incident to `i` coming within `edgeMin` of (or
 *    crossing) a non-adjacent edge — a point landing on a segment, or a bow-tie.
 *  - **edge-on-vertex**: an incident edge sweeping over another *point*.
 * On a rejected move the caller keeps the previous vertex position; the vertex
 * then "sticks" just shy of the obstacle until the cursor leads it elsewhere.
 */
function pathMoveValid(
  points: LatLng[],
  i: number,
  cand: LatLng,
  vertexMin: number,
  edgeMin: number,
  cyclic: boolean,
): boolean {
  const n = points.length;
  // Merge guard — applies to any path with another vertex.
  for (let j = 0; j < n; j++) {
    if (j === i) continue;
    if (Math.hypot(points[j]!.lon - cand.lon, points[j]!.lat - cand.lat) < vertexMin) return false;
  }
  // Below this there is no non-incident edge to clear (ring triangle / 2-pt line).
  if (n < (cyclic ? 4 : 3)) return true;
  const at = (k: number): LatLng => (k === i ? cand : points[k]!);
  // Edge list: n edges (with wrap) for a ring, n-1 for an open path.
  const edges: [number, number][] = [];
  for (let j = 0; j < (cyclic ? n : n - 1); j++) edges.push([j, (j + 1) % n]);
  const incident = edges.filter(([a, b]) => a === i || b === i);
  // The move's "own" vertices (skipped by the edge-vs-vertex test).
  const own = new Set<number>([i]);
  if (cyclic || i > 0) own.add((i - 1 + n) % n);
  if (cyclic || i < n - 1) own.add((i + 1) % n);
  for (const [a, b] of incident) {
    for (const [c, d] of edges) {
      if (c === a || c === b || d === a || d === b) continue;
      if (segmentDistance(at(a), at(b), at(c), at(d)) < edgeMin) return false;
    }
    for (let k = 0; k < n; k++) {
      if (own.has(k)) continue;
      if (distToSegment(at(k), at(a), at(b)) < edgeMin) return false;
    }
  }
  return true;
}

/** {@link pathMoveValid} for a closed ring (polygon). */
export function ringMoveValid(
  points: LatLng[],
  i: number,
  cand: LatLng,
  vertexMin: number,
  edgeMin: number,
): boolean {
  return pathMoveValid(points, i, cand, vertexMin, edgeMin, true);
}

/** {@link pathMoveValid} for an open polyline (line side, corridor leg, wide line). */
export function lineMoveValid(
  points: LatLng[],
  i: number,
  cand: LatLng,
  vertexMin: number,
  edgeMin: number,
): boolean {
  return pathMoveValid(points, i, cand, vertexMin, edgeMin, false);
}

/** Douglas-Peucker on an index `chain` (its two ends are already kept). */
function dpKeep(points: LatLng[], chain: number[], tol: number, keep: boolean[]): void {
  if (chain.length < 3) return;
  const a = points[chain[0]!]!;
  const b = points[chain[chain.length - 1]!]!;
  let maxD = -1;
  let maxAt = -1;
  for (let m = 1; m < chain.length - 1; m++) {
    // Distance to the *segment* a–b, not its infinite line: a point that doubles
    // back past an endpoint stays far from the outline even if near the line.
    const d = distToSegment(points[chain[m]!]!, a, b);
    if (d > maxD) {
      maxD = d;
      maxAt = m;
    }
  }
  if (maxD < tol) return; // every interior point is within tol of a–b → drop them
  keep[chain[maxAt]!] = true;
  dpKeep(points, chain.slice(0, maxAt + 1), tol, keep);
  dpKeep(points, chain.slice(maxAt), tol, keep);
}

/**
 * Like {@link collapseCollinear} but cyclic (closed ring), keeping ≥ 3 vertices.
 *
 * Uses Douglas-Peucker so that **every dropped vertex is provably within `tol`
 * of the simplified outline**. A cheaper per-triple test (is this point straight
 * with its immediate neighbours?) wrongly drops an entire gently bowing run —
 * each triple is locally near-straight, yet the run as a whole departs from the
 * surviving chord by far more than `tol` — stranding the dropped handles off the
 * outline (orphan nodes) and letting the chord cut across a concavity. DP bounds
 * each dropped point's distance from the real outline, so neither can happen.
 */
export function collapseRing(
  points: LatLng[],
  tol: number,
): { points: LatLng[]; collinear: boolean[] } {
  const n = points.length;
  const collinear = new Array<boolean>(n).fill(false);
  if (n <= 3) return { points: [...points], collinear };
  // Two anchors that are definitely kept: the sharpest corner and the vertex
  // geometrically farthest from it. They split the ring into two DP chains.
  let s = 0;
  let sharpest = -1;
  for (let i = 0; i < n; i++) {
    const d = perpDist(points[(i - 1 + n) % n]!, points[i]!, points[(i + 1) % n]!);
    if (d > sharpest) {
      sharpest = d;
      s = i;
    }
  }
  if (sharpest < tol) return { points: [...points], collinear }; // ~degenerate: keep all
  let f = s;
  let far = -1;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(points[i]!.lon - points[s]!.lon, points[i]!.lat - points[s]!.lat);
    if (d > far) {
      far = d;
      f = i;
    }
  }
  const keep = new Array<boolean>(n).fill(false);
  keep[s] = true;
  keep[f] = true;
  const chain = (from: number, to: number): number[] => {
    const idx = [from];
    let k = from;
    while (k !== to) {
      k = (k + 1) % n;
      idx.push(k);
    }
    return idx;
  };
  dpKeep(points, chain(s, f), tol, keep);
  dpKeep(points, chain(f, s), tol, keep);
  for (let i = 0; i < n; i++) if (!keep[i]) collinear[i] = true;
  const kept: LatLng[] = points.filter((_, i) => keep[i]);
  if (kept.length < 3) return { points: [...points], collinear: new Array<boolean>(n).fill(false) };
  return { points: kept, collinear };
}

/**
 * Wide-line / corridor buffer width from a half-width in nautical miles.
 * The TAC width is a 2-digit number: stay in KM up to 99, then switch to NM
 * (physically wider) and cap at 99 NM — the widest "APRX nnNM/KM WID" allows.
 */
export function widthFor(halfNM: number, nmOnly = false): { unit: "KM" | "NM"; width: number } {
  if (!nmOnly) {
    const fullKM = halfNM * 2 * KM_PER_NM;
    if (fullKM <= 99) return { unit: "KM", width: Math.max(1, Math.round(fullKM)) };
  }
  return { unit: "NM", width: Math.min(99, Math.max(1, Math.round(halfNM * 2))) };
}

/**
 * Circle / tropical-cyclone radius from a distance in nautical miles, following
 * the same 2-digit/3-digit rule: stay in KM up to `cap`, then switch to NM
 * (physically larger) capped at `cap`. `cap` is 99 for a plain circle, 999 for a
 * tropical cyclone (`WI nn[n]KM (or nn[n]NM) OF …`).
 */
export function radiusFor(
  radiusNM: number,
  cap: number,
  nmOnly = false,
): { unit: "KM" | "NM"; value: number } {
  if (!nmOnly) {
    const km = radiusNM * KM_PER_NM;
    if (km <= cap) return { unit: "KM", value: Math.max(1, Math.round(km)) };
  }
  return { unit: "NM", value: Math.min(cap, Math.max(1, Math.round(radiusNM))) };
}
