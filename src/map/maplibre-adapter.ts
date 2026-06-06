/**
 * MapLibre adapter for SIGMET — a thin wrapper over the shared
 * `@softwarity/draw-adapter` MapLibre adapter that pre-binds the SIGMET layer
 * manifest + hit set. Construction is unchanged for hosts: `new MapLibreAdapter({ map })`.
 * Styling is data-driven (baked by the controller via `decorate`); there is no
 * `setStyle` on the adapter anymore.
 */
import type { Map as MapLibreMap } from "maplibre-gl";

import { MapLibreAdapter as BaseMapLibreAdapter, createMapLibreMap } from "@softwarity/draw-adapter/maplibre";

import { SIGMET_HIT, SIGMET_LAYERS } from "./style-features.js";

export { createMapLibreMap };

export class MapLibreAdapter extends BaseMapLibreAdapter {
  constructor(opts: { map: MapLibreMap }) {
    super({ map: opts.map, layers: SIGMET_LAYERS, hitOverlays: SIGMET_HIT });
  }
}
