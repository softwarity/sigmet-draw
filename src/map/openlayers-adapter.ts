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
import { Circle as CircleStyle, Fill, Icon, Stroke, Style, Text } from "ol/style";
import type { StyleLike } from "ol/style/Style";
import View from "ol/View";

import type { LatLng } from "../core/index.js";
import { cursorForHit } from "./adapter.js";
import type {
  MapAdapter,
  OverlayId,
  PointerEvent,
  ToolbarItem,
  ToolbarOptions,
} from "./adapter.js";
import { DEFAULT_STYLE, moveIconDataUri, resizeIconDataUri, rgba, transformIconDataUri } from "./style.js";
import type { SigmetStyle } from "./style.js";
import { populateToolbar } from "./toolbar.js";
import { applyTooltipStyle } from "./tooltip.js";

const OVERLAY_IDS: OverlayId[] = ["other", "area", "guide", "handles", "label"];

/** A circular handle style (dot). */
function pointStyle(fill: string, stroke: string, strokeWidth: number, radius: number): Style {
  return new Style({
    image: new CircleStyle({
      radius,
      fill: new Fill({ color: fill }),
      stroke: new Stroke({ color: stroke, width: strokeWidth }),
    }),
  });
}

/** Smaller dot for the move/resize handles (the glyph carries the meaning). */
const SMALL_DOT = 0.7;
/** Vertical offset (px) lifting the label above its anchor. */
const LABEL_OFFSET_Y = -14;
/** Collinear (TAC-redundant) vertices are always greyed — not configurable. */
const COLLINEAR_GREY = "#8b949e";
/** The `other` overlay is an invisible click surface (flip side / pick quadrant)
 *  — a faint, non-styleable fill. */
const OTHER_FILL = "#58a6ff";
const OTHER_OPACITY = 0.08;

/** Word-wrap `text` so each line fits `maxPx` at `fontPx` (OL has no native
 *  max-width). Inserts `\n` between lines. */
let wrapCtx: CanvasRenderingContext2D | null | undefined;
function wrapLabel(text: string, maxPx: number, fontPx: number): string {
  if (!text || maxPx <= 0) return text;
  if (wrapCtx === undefined) wrapCtx = document.createElement("canvas").getContext("2d");
  if (!wrapCtx) return text;
  wrapCtx.font = `${fontPx}px sans-serif`;
  const lines: string[] = [];
  let cur = "";
  for (const word of text.split(/\s+/)) {
    const trial = cur ? `${cur} ${word}` : word;
    if (cur && wrapCtx.measureText(trial).width > maxPx) {
      lines.push(cur);
      cur = word;
    } else {
      cur = trial;
    }
  }
  if (cur) lines.push(cur);
  return lines.join("\n");
}

/** Translate the engine-agnostic style into an OL style (function for handles/label). */
function olStyleFor(id: OverlayId, s: SigmetStyle): StyleLike {
  switch (id) {
    case "other":
      return new Style({ fill: new Fill({ color: rgba(OTHER_FILL, OTHER_OPACITY) }) });
    case "area":
      return new Style({
        fill: new Fill({ color: rgba(s.area.fill, s.area.opacity) }),
        stroke: new Stroke({ color: s.area.stroke, width: s.area.width }),
      });
    case "guide":
      return new Style({ stroke: new Stroke({ color: s.lineHandle.stroke, width: s.lineHandle.width }) });
    case "handles": {
      const ih = s.iconHandle;
      const base = pointStyle(ih.fill, ih.stroke, ih.width, ih.radius); // vertex + control
      // Collinear dot: grey, no stroke, a touch smaller.
      const coll = pointStyle(COLLINEAR_GREY, COLLINEAR_GREY, 0, ih.radius * SMALL_DOT);
      const smallDot = pointStyle(ih.fill, ih.stroke, ih.width, ih.radius * SMALL_DOT);
      const move = [smallDot, new Style({ image: new Icon({ src: moveIconDataUri(ih.stroke) }) })];
      const transformSrc = transformIconDataUri(ih.stroke);
      const resizeSrc = resizeIconDataUri(ih.stroke);
      const rot = (f: FeatureLike): number => (((f.get("iconRotate") as number) ?? 0) * Math.PI) / 180;
      return (f: FeatureLike): Style | Style[] => {
        if (f.get("move")) return move;
        if (f.get("transform")) {
          return new Style({ image: new Icon({ src: transformSrc, rotation: rot(f) }) });
        }
        if (f.get("resize")) {
          return [smallDot, new Style({ image: new Icon({ src: resizeSrc, rotation: rot(f) }) })];
        }
        if (f.get("collinear")) return coll;
        return base;
      };
    }
    case "label":
      return (f: FeatureLike): Style =>
        new Style({
          text: new Text({
            text: wrapLabel(String(f.get("text") ?? ""), s.label.width, s.label.size),
            font: `${s.label.size}px sans-serif`,
            offsetY: LABEL_OFFSET_Y,
            textBaseline: "bottom",
            fill: new Fill({ color: s.label.color }),
            stroke: new Stroke({ color: s.label.halo, width: Math.ceil(s.label.size / 10) }),
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
  private tooltipEl: HTMLElement | undefined;
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
    if (this.tooltipEl) applyTooltipStyle(this.tooltipEl, style.tooltip);
  }

  setTooltip(text: string | null, at: LatLng): void {
    if (text == null) {
      if (this.tooltipEl) this.tooltipEl.style.display = "none";
      return;
    }
    if (!this.tooltipEl) {
      this.tooltipEl = document.createElement("div");
      this.tooltipEl.className = "sigmet-tooltip";
      applyTooltipStyle(this.tooltipEl, this.style.tooltip);
      this.map.getTargetElement()?.appendChild(this.tooltipEl);
    }
    const px = this.map.getPixelFromCoordinate(fromLonLat([at.lon, at.lat]));
    if (!px) return;
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.display = "block";
    this.tooltipEl.style.left = `${px[0]}px`;
    this.tooltipEl.style.top = `${px[1]}px`;
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

  addToolbar(items: ToolbarItem[], options?: ToolbarOptions): HTMLElement {
    if (this.toolbarEl) return this.toolbarEl; // idempotent
    // Use OpenLayers' native control class so the buttons inherit the engine's
    // native look; placement is set by populateToolbar from `options`.
    const el = document.createElement("div");
    el.className = "ol-control sigmet-toolbar";
    populateToolbar(el, items, options);
    this.map.getTargetElement()?.appendChild(el);
    this.toolbarEl = el;
    return el;
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

  private setCursor(cursor: string): void {
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
        this.setCursor(cursorForHit(hit));
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
    this.tooltipEl?.remove();
    this.tooltipEl = undefined;
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
          // Mirror MapLibre: expose the full feature property bag, not just role.
          const props = { ...feature.getProperties() };
          delete props["geometry"];
          result = { overlay, props };
          return true;
        }
        return false;
      },
      { hitTolerance: 5 },
    );
    return result;
  }
}
