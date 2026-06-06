/**
 * Leaflet adapter for SIGMET — a thin wrapper over the shared
 * `@softwarity/draw-adapter` Leaflet adapter that pre-binds the SIGMET layer
 * manifest + hit set. Construction: `new LeafletAdapter({ map })` (a host-owned
 * `L.Map`). Styling is data-driven (baked by the controller via `decorate`).
 *
 * Leaflet is an OPTIONAL peer: import this entry point only if you use Leaflet.
 */
import type { Map as LeafletMap } from "leaflet";

import { LeafletAdapter as BaseLeafletAdapter, createLeafletMap } from "@softwarity/draw-adapter/leaflet";

import { SIGMET_HIT, SIGMET_LAYERS } from "./style-features.js";

export { createLeafletMap };

export class LeafletAdapter extends BaseLeafletAdapter {
  constructor(opts: { map: LeafletMap }) {
    super({ map: opts.map, layers: SIGMET_LAYERS, hitOverlays: SIGMET_HIT });
  }
}
