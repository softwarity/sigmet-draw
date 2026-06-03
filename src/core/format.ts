/**
 * Serialize a {@link SigmetGeometry} to its ICAO/WMO TAC representation
 * (WMO-No.49 Vol II, App. 6). The output matches the worked examples in the
 * spec (A6-1 parallels/bands, A6-2 circle, A6-3 wide line).
 */
import { formatLat, formatLatLng, formatLon } from "./coord.js";
import type { LatLng } from "./coord.js";
import type { SigmetGeometry } from "./types.js";

export interface FormatOptions {
  /**
   * Minute emission policy:
   *  - `"auto"` (default): omit `00` minutes on whole degrees (e.g. `N54`).
   *  - `"always"`: always write the padded minute form (e.g. `N5400`),
   *    matching producers that use fixed-width coordinates (spec A6-3).
   */
  minutes?: "auto" | "always";
}

/** Coordinate-list separator used by SIGMET (`p1 - p2 - p3`). */
const SEP = " - ";

/** Encode a geometry as a TAC location string. */
export function toTAC(
  geometry: SigmetGeometry,
  options: FormatOptions = {},
): string {
  const force = options.minutes === "always";
  const lat = (v: number) => formatLat(v, force);
  const lon = (v: number) => formatLon(v, force);
  const pt = (p: LatLng) => formatLatLng(p, force);
  const joinPoints = (points: LatLng[]) => points.map(pt).join(SEP);

  switch (geometry.kind) {
    case "point":
      return pt(geometry.position);

    case "parallel":
      return `${geometry.side} OF ${lat(geometry.lat)}`;

    case "meridian":
      return `${geometry.side} OF ${lon(geometry.lon)}`;

    case "quadrant":
      return (
        `${geometry.latSide} OF ${lat(geometry.lat)} AND ` +
        `${geometry.lonSide} OF ${lon(geometry.lon)}`
      );

    case "latBand":
      // North of the southern bound AND south of the northern bound.
      return `N OF ${lat(geometry.south)} AND S OF ${lat(geometry.north)}`;

    case "lonBand":
      // East of the western bound AND west of the eastern bound.
      return `E OF ${lon(geometry.west)} AND W OF ${lon(geometry.east)}`;

    case "lineSide":
      return `${geometry.side} OF LINE ${joinPoints(geometry.points)}`;

    case "corridor":
      return (
        `${geometry.lineA.side} OF LINE ${joinPoints(geometry.lineA.points)} AND ` +
        `${geometry.lineB.side} OF LINE ${joinPoints(geometry.lineB.points)}`
      );

    case "polygon":
      return `WI ${joinPoints(geometry.points)}`;

    case "circle":
      return `WI ${geometry.radius}${geometry.unit} OF PSN ${pt(geometry.center)}`;

    case "tropicalCyclone":
      // The centre is not encoded — it's the TC SIGMET's separate PSN element.
      return `WI ${geometry.radius}${geometry.unit} OF TC CENTRE`;

    case "wideLine":
      return `APRX ${geometry.width}${geometry.unit} WID LINE BTN ${joinPoints(geometry.points)}`;

    case "entireFir":
      return `ENTIRE ${geometry.region ?? "FIR"}`;
  }
}
