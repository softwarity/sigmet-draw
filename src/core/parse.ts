/**
 * Parse an ICAO/WMO TAC *location* expression back into a {@link SigmetGeometry}.
 *
 * The input is the location portion of a SIGMET/AIRMET (e.g. the substring
 * `S OF N54 AND E OF W012` or `WI 250NM OF PSN N2706 W07306`), not a whole
 * message — extracting that portion is the job of the message layer. Both the
 * spec's en-dash (`–`) and the hyphen used in real bulletins are accepted.
 */
import { parseAllLatLng, parseLat, parseLatLng, parseLon } from "./coord.js";
import type { LatLng } from "./coord.js";
import type {
  DistanceUnit,
  EntireFirGeometry,
  LineSide,
  SigmetGeometry,
} from "./types.js";

const LAT_TOKEN = /^[NS]\d{2}(?:\d{2})?$/;
const LON_TOKEN = /^[EW]\d{3}(?:\d{2})?$/;

/** Normalize whitespace, dashes and case for robust matching. */
function normalize(text: string): string {
  return text
    .replace(/[–—]/g, "-") // en/em dash → hyphen
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

interface HalfPlane {
  dir: "N" | "S" | "E" | "W";
  isLat: boolean;
  value: number;
}

function parseHalfPlane(clause: string): HalfPlane {
  const m = clause.match(/^(N|S|E|W) OF (\S+)$/);
  if (!m) throw new Error(`Not a half-plane clause: "${clause}"`);
  const dir = m[1] as HalfPlane["dir"];
  const token = m[2]!;
  if (LAT_TOKEN.test(token)) {
    return { dir, isLat: true, value: parseLat(token) };
  }
  if (LON_TOKEN.test(token)) {
    return { dir, isLat: false, value: parseLon(token) };
  }
  throw new Error(`Unrecognized coordinate token: "${token}"`);
}

function parseLineClause(clause: string): { points: LatLng[]; side: LineSide } {
  const m = clause.match(/^(N|NE|E|SE|S|SW|W|NW) OF LINE (.+)$/);
  if (!m) throw new Error(`Not a "... OF LINE ..." clause: "${clause}"`);
  const side = m[1] as LineSide;
  const points = parseAllLatLng(m[2]!);
  if (points.length < 2) {
    throw new Error(`A LINE needs at least 2 points: "${clause}"`);
  }
  return { points, side };
}

/** Decode a TAC location expression into a geometry. */
export function fromTAC(input: string): SigmetGeometry {
  const text = normalize(input);

  // 11 — ENTIRE FIR/UIR/CTA
  const entire = text.match(/^ENTIRE (FIR\/UIR|FIR|UIR|CTA)$/);
  if (entire) {
    return { kind: "entireFir", region: entire[1] as NonNullable<EntireFirGeometry["region"]> };
  }

  // 10 — APRX <w><unit> WID[E] LINE BTN <points>
  const wide = text.match(
    /^APRX (\d+(?:\.\d+)?)(KM|NM) WIDE? LINE BTN (.+)$/,
  );
  if (wide) {
    const points = parseAllLatLng(wide[3]!);
    if (points.length < 2) throw new Error("Wide line needs at least 2 points");
    return {
      kind: "wideLine",
      width: Number(wide[1]),
      unit: wide[2] as DistanceUnit,
      points,
    };
  }

  // 09b — WI <radius><unit> OF TC CENTRE  (tropical cyclone; centre not encoded)
  const tc = text.match(/^WI (\d+(?:\.\d+)?)(KM|NM) OF TC CENTRE$/);
  if (tc) {
    return {
      kind: "tropicalCyclone",
      radius: Number(tc[1]),
      unit: tc[2] as DistanceUnit,
      center: { lat: 0, lon: 0 }, // placeholder — the host supplies the real centre
    };
  }

  // 09 — WI <radius><unit> OF [PSN] <coord>  (circle)
  const circle = text.match(/^WI (\d+(?:\.\d+)?)(KM|NM) OF (?:PSN )?(.+)$/);
  if (circle) {
    const centers = parseAllLatLng(circle[3]!);
    if (centers.length === 0) {
      throw new Error(
        `Circle centre is not an explicit position (e.g. "TC CENTRE"): "${input}"`,
      );
    }
    return {
      kind: "circle",
      radius: Number(circle[1]),
      unit: circle[2] as DistanceUnit,
      center: centers[0]!,
    };
  }

  // 08 — WI <points>  (polygon)
  if (/^WI /.test(text)) {
    const points = parseAllLatLng(text.slice(3));
    if (points.length < 3) throw new Error("Polygon needs at least 3 points");
    return { kind: "polygon", points };
  }

  // 03 / 06b — "... OF LINE ..." (one line) or "... AND ... OF LINE ..." (corridor)
  if (text.includes(" OF LINE ")) {
    const parts = text.split(" AND ");
    if (parts.length === 2) {
      return {
        kind: "corridor",
        lineA: parseLineClause(parts[0]!),
        lineB: parseLineClause(parts[1]!),
      };
    }
    const { points, side } = parseLineClause(text);
    return { kind: "lineSide", points, side };
  }

  // 05 / 06 / 07 — two half-planes joined by AND
  if (text.includes(" AND ")) {
    const [a, b] = text.split(" AND ").map(parseHalfPlane);
    if (!a || !b) throw new Error(`Malformed AND clause: "${input}"`);

    if (a.isLat && b.isLat) {
      // Latitude band: "N OF <south>" gives the southern bound, "S OF <north>"
      // gives the northern bound — order-independent. Sort so a reversed-but-legal
      // encoding can't yield south > north (which builds a degenerate rectangle).
      const nOf = a.dir === "N" ? a : b;
      const sOf = a.dir === "S" ? a : b;
      return {
        kind: "latBand",
        south: Math.min(nOf.value, sOf.value),
        north: Math.max(nOf.value, sOf.value),
      };
    }
    if (!a.isLat && !b.isLat) {
      // Longitude band: NOT sorted — west > east is a legitimate antimeridian-crossing
      // band (longitude wraps), indistinguishable from a "reversed" encoding.
      const eOf = a.dir === "E" ? a : b;
      const wOf = a.dir === "W" ? a : b;
      return { kind: "lonBand", west: eOf.value, east: wOf.value };
    }
    // Quadrant: one parallel + one meridian.
    const lat = a.isLat ? a : b;
    const lon = a.isLat ? b : a;
    return {
      kind: "quadrant",
      lat: lat.value,
      latSide: lat.dir as "N" | "S",
      lon: lon.value,
      lonSide: lon.dir as "E" | "W",
    };
  }

  // 01 / 02 — single half-plane
  if (text.includes(" OF ")) {
    const hp = parseHalfPlane(text);
    return hp.isLat
      ? { kind: "parallel", lat: hp.value, side: hp.dir as "N" | "S" }
      : { kind: "meridian", lon: hp.value, side: hp.dir as "E" | "W" };
  }

  // 12 — bare coordinate pair (point)
  return { kind: "point", position: parseLatLng(text) };
}
