/**
 * OpenLayers adapter — grafts onto a host-owned `ol/Map`. Proof that the SIGMET
 * drawing is map-library-agnostic. `createOpenLayersMap` is the convenience for
 * the web-component wrapper; headless users pass their own map.
 *
 * No 3D globe in OpenLayers — projection is left entirely to the host map.
 */
import type { FeatureCollection } from "geojson";
import type { FeatureLike } from "ol/Feature";
import type { EventsKey } from "ol/events";
import GeoJSON from "ol/format/GeoJSON";
import DragPan from "ol/interaction/DragPan";
import { unByKey } from "ol/Observable";
import type BaseLayer from "ol/layer/Base";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OlMap from "ol/Map";
import { fromLonLat, toLonLat } from "ol/proj";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from "ol/style";
import type { StyleLike } from "ol/style/Style";
import View from "ol/View";

import type { LatLng } from "../core/index.js";
import type {
  MapAdapter,
  OverlayId,
  PointerEvent,
  ToolbarItem,
} from "./adapter.js";
import { DEFAULT_STYLE, rgba } from "./style.js";
import type { PointStyle, SigmetStyle } from "./style.js";
import { populateToolbar } from "./toolbar.js";

const OVERLAY_IDS: OverlayId[] = ["other", "area", "guide", "handles", "label"];

/** A circular handle style from a {@link PointStyle} token. */
function pointStyle(p: PointStyle): Style {
  return new Style({
    image: new CircleStyle({
      radius: p.radius,
      fill: new Fill({ color: p.color }),
      stroke: new Stroke({ color: p.strokeColor, width: p.strokeWidth }),
    }),
  });
}

/** Translate the engine-agnostic style into an OL style (function for handles/label). */
function olStyleFor(id: OverlayId, s: SigmetStyle): StyleLike {
  switch (id) {
    case "other":
      return new Style({ fill: new Fill({ color: rgba(s.other.fill.color, s.other.fill.opacity) }) });
    case "area":
      return new Style({
        fill: new Fill({ color: rgba(s.area.fill.color, s.area.fill.opacity) }),
        stroke: new Stroke({ color: s.area.line.color, width: s.area.line.width, lineDash: s.area.line.dash }),
      });
    case "guide":
      return new Style({ stroke: new Stroke({ color: s.guide.color, width: s.guide.width, lineDash: s.guide.dash }) });
    case "handles": {
      const vtx = pointStyle(s.vertex);
      const coll = pointStyle(s.collinearVertex);
      const ctrl = pointStyle(s.controlHandle);
      return (f: FeatureLike): Style =>
        f.get("control") ? ctrl : f.get("collinear") ? coll : vtx;
    }
    case "label":
      return (f: FeatureLike): Style =>
        new Style({
          text: new Text({
            text: String(f.get("text") ?? ""),
            font: `${s.label.size}px sans-serif`,
            offsetY: s.label.offsetY,
            textBaseline: "bottom",
            fill: new Fill({ color: s.label.color }),
            stroke: new Stroke({ color: s.label.haloColor, width: s.label.haloWidth }),
          }),
        });
  }
}

/** Create a default OpenLayers map (OSM basemap) for the batteries-included path. */
export function createOpenLayersMap(opts: {
  container: HTMLElement | string;
  center: [number, number];
  zoom: number;
}): OlMap {
  return new OlMap({
    target: opts.container,
    layers: [new TileLayer({ source: new OSM() })],
    view: new View({ center: fromLonLat(opts.center), zoom: opts.zoom }),
  });
}

export class OpenLayersAdapter implements MapAdapter {
  private readonly map: OlMap;
  private readonly sources = {} as Record<OverlayId, VectorSource>;
  private readonly layers = {} as Record<OverlayId, VectorLayer>;
  private readonly layerOverlay = new Map<unknown, OverlayId>();
  private readonly format = new GeoJSON();
  private dragPan: DragPan | undefined;
  private readyPromise: Promise<void> | undefined;
  private style: SigmetStyle = DEFAULT_STYLE;
  /** Captured listeners/keys/DOM, kept so `destroy()` can detach them. */
  private olKeys: EventsKey[] = [];
  private domPointerUp: ((e: globalThis.PointerEvent) => void) | undefined;
  private viewportPointerDown: ((e: globalThis.PointerEvent) => void) | undefined;
  private toolbarEl: HTMLElement | undefined;
  /** True between pointer down and up — used to skip hit-testing during a drag. */
  private dragging = false;

  constructor(opts: { map: OlMap; style?: SigmetStyle }) {
    this.map = opts.map;
    if (opts.style) this.style = opts.style;
  }

  setStyle(style: SigmetStyle): void {
    this.style = style;
    for (const id of OVERLAY_IDS) {
      this.layers[id]?.setStyle(olStyleFor(id, style));
    }
  }

  ready(): Promise<void> {
    if (!this.readyPromise) {
      for (const id of OVERLAY_IDS) {
        const source = new VectorSource();
        this.sources[id] = source;
        const layer = new VectorLayer({ source, style: olStyleFor(id, this.style) });
        this.layers[id] = layer;
        this.layerOverlay.set(layer, id);
        this.map.addLayer(layer);
      }
      this.dragPan = this.map
        .getInteractions()
        .getArray()
        .find((i): i is DragPan => i instanceof DragPan);
      this.readyPromise = Promise.resolve();
    }
    return this.readyPromise;
  }

  setOverlay(id: OverlayId, data: FeatureCollection): void {
    const source = this.sources[id];
    source.clear();
    if (data.features.length) {
      source.addFeatures(
        this.format.readFeatures(data, {
          dataProjection: "EPSG:4326",
          featureProjection: "EPSG:3857",
        }),
      );
    }
  }

  addToolbar(items: ToolbarItem[]): void {
    if (this.toolbarEl) return; // idempotent
    // Attached to the map target (not via addControl) so the host positions it
    // freely (top-centre) without colliding with zoom/attribution controls.
    const el = document.createElement("div");
    el.className = "ol-control sigmet-toolbar";
    populateToolbar(el, items);
    this.map.getTargetElement()?.appendChild(el);
    this.toolbarEl = el;
  }

  getCenter(): LatLng {
    const c = this.map.getView().getCenter();
    if (!c) return { lat: 0, lon: 0 };
    const [lon, lat] = toLonLat(c);
    return { lat: lat!, lon: lon! };
  }

  setPanEnabled(enabled: boolean): void {
    this.dragPan?.setActive(enabled);
  }

  setCursor(cursor: string): void {
    const el = this.map.getTargetElement();
    if (el) el.style.cursor = cursor;
  }

  onPointer(cb: (ev: PointerEvent) => void): void {
    if (this.domPointerUp) return; // idempotent
    const fromDom = (type: "down" | "up") => (e: globalThis.PointerEvent) => {
      const coord = this.map.getEventCoordinate(e);
      if (!coord) return;
      this.dragging = type === "down";
      const [lon, lat] = toLonLat(coord);
      // "up" needs no hit (the controller just clears the drag target).
      const hit = type === "down" ? this.hitAt(this.map.getEventPixel(e)) : undefined;
      cb({ type, lngLat: { lat: lat!, lon: lon! }, ...(hit ? { hit } : {}) });
    };
    this.viewportPointerDown = fromDom("down");
    this.domPointerUp = fromDom("up");
    this.map.getViewport().addEventListener("pointerdown", this.viewportPointerDown);
    document.addEventListener("pointerup", this.domPointerUp);

    this.olKeys.push(
      this.map.on("pointermove", (evt) => {
        const [lon, lat] = toLonLat(evt.coordinate);
        if (this.dragging) {
          // During a drag the controller only needs the position — skip hit-testing.
          cb({ type: "move", lngLat: { lat: lat!, lon: lon! } });
          return;
        }
        const hit = this.hitAt(evt.pixel);
        this.setCursor(
          hit?.overlay === "handles" ? "grab" : hit?.overlay === "guide" ? "move" : "",
        );
        cb({ type: "move", lngLat: { lat: lat!, lon: lon! }, ...(hit ? { hit } : {}) });
      }),
      this.map.on("singleclick", (evt) => {
        const hit = this.hitAt(evt.pixel);
        const [lon, lat] = toLonLat(evt.coordinate);
        cb({ type: "click", lngLat: { lat: lat!, lon: lon! }, ...(hit ? { hit } : {}) });
      }),
    );
  }

  /** Detach everything this adapter added; never destroys the host map. */
  destroy(): void {
    this.layerOverlay.forEach((_, layer) => this.map.removeLayer(layer as BaseLayer));
    this.layerOverlay.clear();
    unByKey(this.olKeys);
    this.olKeys = [];
    if (this.viewportPointerDown) {
      this.map.getViewport().removeEventListener("pointerdown", this.viewportPointerDown);
      this.viewportPointerDown = undefined;
    }
    if (this.domPointerUp) {
      document.removeEventListener("pointerup", this.domPointerUp);
      this.domPointerUp = undefined;
    }
    this.toolbarEl?.remove();
    this.toolbarEl = undefined;
    this.readyPromise = undefined;
    this.dragPan?.setActive(true);
    this.setCursor("");
  }

  private hitAt(pixel: number[]):
    | { overlay: OverlayId; props: Record<string, unknown> }
    | undefined {
    let result: { overlay: OverlayId; props: Record<string, unknown> } | undefined;
    this.map.forEachFeatureAtPixel(
      pixel,
      (feature: FeatureLike, layer: unknown) => {
        const overlay = this.layerOverlay.get(layer);
        if (overlay === "handles" || overlay === "guide" || overlay === "other") {
          // Mirror MapLibre: expose the full feature property bag (role + control
          // + collinear + …), not just role.
          result = {
            overlay,
            props: {
              role: feature.get("role"),
              control: feature.get("control"),
              collinear: feature.get("collinear"),
            },
          };
          return true;
        }
        return false;
      },
      { hitTolerance: 5 },
    );
    return result;
  }
}
