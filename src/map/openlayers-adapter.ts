/**
 * OpenLayers adapter for SIGMET — a thin wrapper over the shared
 * `@softwarity/draw-adapter` OpenLayers adapter that pre-binds the SIGMET layer
 * manifest + hit set. Construction is unchanged: `new OpenLayersAdapter({ map })`.
 * Styling is data-driven (baked by the controller via `decorate`).
 */
import type OlMap from "ol/Map";

import { OpenLayersAdapter as BaseOpenLayersAdapter, createOpenLayersMap } from "@softwarity/draw-adapter/openlayers";

import { SIGMET_HIT, SIGMET_LAYERS } from "./style-features.js";

export { createOpenLayersMap };

export class OpenLayersAdapter extends BaseOpenLayersAdapter {
  constructor(opts: { map: OlMap }) {
    super({ map: opts.map, layers: SIGMET_LAYERS, hitOverlays: SIGMET_HIT });
  }
}
