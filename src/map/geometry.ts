/**
 * Pure, DOM-free geometry helpers used by the drawing controller — extracted so
 * they can be unit-tested without a map.
 */
import type { LatLng } from "../core/index.js";

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

/** Like {@link collapseCollinear} but cyclic (closed ring), keeping ≥ 3 vertices. */
export function collapseRing(
  points: LatLng[],
  tol: number,
): { points: LatLng[]; collinear: boolean[] } {
  const n = points.length;
  const collinear = new Array<boolean>(n).fill(false);
  if (n <= 3) return { points: [...points], collinear };
  const kept: LatLng[] = [];
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const next = points[(i + 1) % n]!;
    if (perpDist(prev, points[i]!, next) < tol) collinear[i] = true;
    else kept.push(points[i]!);
  }
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
    const fullKM = halfNM * 2 * 1.852;
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
    const km = radiusNM * 1.852;
    if (km <= cap) return { unit: "KM", value: Math.max(1, Math.round(km)) };
  }
  return { unit: "NM", value: Math.min(cap, Math.max(1, Math.round(radiusNM))) };
}
