/**
 * @tac-sigmet/core — framework- and map-agnostic core.
 *
 * The 12 SIGMET/AIRMET geometry templates (WMO-No.49 Vol II, App. 6) plus the
 * tropical-cyclone circle variant, TAC (de)serialization, and area computation.
 * No DOM, no map engine.
 */
export type { LatLng } from "./coord.js";
export {
  formatLat,
  formatLon,
  formatLatLng,
  parseLat,
  parseLon,
  parseLatLng,
  parseAllLatLng,
} from "./coord.js";

export type {
  GeometryKind,
  LineSide,
  DistanceUnit,
  SigmetGeometry,
  PointGeometry,
  ParallelGeometry,
  MeridianGeometry,
  QuadrantGeometry,
  LatBandGeometry,
  LonBandGeometry,
  LineSideGeometry,
  CorridorGeometry,
  PolygonGeometry,
  CircleGeometry,
  TropicalCycloneGeometry,
  WideLineGeometry,
  EntireFirGeometry,
} from "./types.js";
export { UNBOUNDED_KINDS } from "./types.js";

export { toTAC } from "./format.js";
export type { FormatOptions } from "./format.js";
export { fromTAC } from "./parse.js";
export { toArea } from "./area.js";
export type { AreaOptions, FirInput } from "./area.js";
