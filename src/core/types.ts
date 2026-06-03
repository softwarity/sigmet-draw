/**
 * The 12 SIGMET/AIRMET geometry templates (WMO-No.49 Vol II, App. 6 — the
 * "Location" element). Each is a *parametric* shape, not a free polygon: it is
 * fully described by a handful of parameters plus, for half-plane forms, which
 * side is selected. The concrete area shown on the map is *derived* from these
 * parameters (see `area.ts`), and the TAC string is *serialized* from them
 * (see `format.ts`).
 */
import type { LatLng } from "./coord.js";

/** The 8 compass directions usable with `... OF LINE`. */
export type LineSide = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

/** Distance unit as written in TAC. */
export type DistanceUnit = "KM" | "NM";

/** Discriminator for the 12 templates. */
export type GeometryKind =
  | "point"
  | "parallel"
  | "meridian"
  | "quadrant"
  | "latBand"
  | "lonBand"
  | "lineSide"
  | "corridor"
  | "polygon"
  | "circle"
  | "wideLine"
  | "entireFir";

/** 12 — A single position, e.g. `N48 E010` (point observation). */
export interface PointGeometry {
  kind: "point";
  position: LatLng;
}

/** 02 — Half-plane bounded by a parallel: `N OF N54` / `S OF N54`. */
export interface ParallelGeometry {
  kind: "parallel";
  /** Latitude of the bounding parallel, decimal degrees. */
  lat: number;
  /** Which side of the parallel is the SIGMET area. */
  side: "N" | "S";
}

/** 01 — Half-plane bounded by a meridian: `E OF W012` / `W OF W012`. */
export interface MeridianGeometry {
  kind: "meridian";
  /** Longitude of the bounding meridian, decimal degrees. */
  lon: number;
  /** Which side of the meridian is the SIGMET area. */
  side: "E" | "W";
}

/** 07 — Quadrant: parallel ∧ meridian, e.g. `N OF N54 AND E OF W012`. */
export interface QuadrantGeometry {
  kind: "quadrant";
  lat: number;
  lon: number;
  latSide: "N" | "S";
  lonSide: "E" | "W";
}

/** 05 — Band between two parallels: `N OF S50 AND S OF N54`. */
export interface LatBandGeometry {
  kind: "latBand";
  /** Northern bounding parallel (decimal degrees, > south). */
  north: number;
  /** Southern bounding parallel (decimal degrees, < north). */
  south: number;
}

/** 06 — Band between two meridians: `E OF W012 AND W OF E005`. */
export interface LonBandGeometry {
  kind: "lonBand";
  /** Western bounding meridian (decimal degrees, < east). */
  west: number;
  /** Eastern bounding meridian (decimal degrees, > west). */
  east: number;
}

/** 03 — One side of an oblique polyline (2–4 points): `SW OF LINE p1 - p2`. */
export interface LineSideGeometry {
  kind: "lineSide";
  points: LatLng[];
  side: LineSide;
}

/** 06b — Corridor between two oblique polylines (`... AND ... OF LINE ...`). */
export interface CorridorGeometry {
  kind: "corridor";
  lineA: { points: LatLng[]; side: LineSide };
  lineB: { points: LatLng[]; side: LineSide };
}

/** 08 — Closed polygon: `WI p1 - p2 - ... - pn`. */
export interface PolygonGeometry {
  kind: "polygon";
  points: LatLng[];
}

/** 09 — Circle around a point: `WI 250NM OF PSN N2706 W07306`. */
export interface CircleGeometry {
  kind: "circle";
  center: LatLng;
  radius: number;
  unit: DistanceUnit;
}

/** 10 — Wide line / buffer (max 3 points): `APRX 50KM WID LINE BTN p1 - p2`. */
export interface WideLineGeometry {
  kind: "wideLine";
  /** 2 or 3 points (the spec examples never exceed 3). */
  points: LatLng[];
  /** Half-width is `width / 2` on each side of the line. */
  width: number;
  unit: DistanceUnit;
}

/** 11 — Whole flight information region: `ENTIRE FIR` / `ENTIRE UIR`. */
export interface EntireFirGeometry {
  kind: "entireFir";
  /** Label written after ENTIRE; defaults to "FIR". */
  region?: "FIR" | "UIR" | "FIR/UIR" | "CTA";
}

/** Discriminated union of every supported SIGMET geometry. */
export type SigmetGeometry =
  | PointGeometry
  | ParallelGeometry
  | MeridianGeometry
  | QuadrantGeometry
  | LatBandGeometry
  | LonBandGeometry
  | LineSideGeometry
  | CorridorGeometry
  | PolygonGeometry
  | CircleGeometry
  | WideLineGeometry
  | EntireFirGeometry;

/** Geometries that are unbounded and therefore require a FIR to be clipped. */
export const UNBOUNDED_KINDS: ReadonlySet<GeometryKind> = new Set([
  "parallel",
  "meridian",
  "quadrant",
  "latBand",
  "lonBand",
  "lineSide",
  "corridor",
]);
