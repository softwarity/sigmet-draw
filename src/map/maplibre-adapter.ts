/**
 * MapLibre GL v5 adapter — grafts onto a host-owned `maplibregl.Map`.
 * `createMapLibreMap` is a convenience for the web-component wrapper / quick start;
 * headless users pass their own map to `new MapLibreAdapter({ map })`.
 */
import type { FeatureCollection } from "geojson";
import { Map as MapLibreMap } from "maplibre-gl";

import type { LatLng } from "../core/index.js";
import type {
  MapAdapter,
  OverlayId,
  PointerEvent,
  Projection,
  ToolbarItem,
  ToolbarOptions,
} from "./adapter.js";
import { DEFAULT_STYLE } from "./style.js";
import type { SigmetStyle } from "./style.js";
import { populateToolbar } from "./toolbar.js";
import { applyTooltipStyle } from "./tooltip.js";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

/** Overlay layers this adapter owns, in draw order. */
const LAYER_IDS = ["other-fill", "area-fill", "area-line", "guide", "handles", "label"];
/** Overlay sources this adapter owns. */
const SOURCE_IDS: OverlayId[] = ["other", "area", "guide", "handles", "label"];
type MlHandler = (e: { lngLat: { lng: number; lat: number }; point: { x: number; y: number } }) => void;
type PointerHandlers = {
  mousedown: MlHandler;
  mousemove: MlHandler;
  mouseup: MlHandler;
  click: MlHandler;
};

/** Data-driven pick of a handle property: control handle / collinear / plain vertex. */
function handleCase(s: SigmetStyle, key: keyof SigmetStyle["vertex"]): unknown {
  return [
    "case",
    ["==", ["get", "control"], true], s.controlHandle[key],
    ["==", ["get", "collinear"], true], s.collinearVertex[key],
    s.vertex[key],
  ];
}

const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: "raster" as const,
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster" as const, source: "osm" }],
};

const HIT_LAYERS: Record<string, OverlayId> = {
  handles: "handles",
  guide: "guide",
  "other-fill": "other",
};

/** Create a default MapLibre map (OSM basemap) for the batteries-included path. */
export function createMapLibreMap(opts: {
  container: HTMLElement | string;
  center: [number, number];
  zoom: number;
  projection?: Projection;
}): MapLibreMap {
  const map = new MapLibreMap({
    container: opts.container,
    style: OSM_STYLE,
    center: opts.center,
    zoom: opts.zoom,
  });
  if (opts.projection === "globe") {
    map.on("load", () => map.setProjection({ type: "globe" }));
  }
  return map;
}

export class MapLibreAdapter implements MapAdapter {
  private readonly map: MapLibreMap;
  private readyPromise: Promise<void> | undefined;
  private style: SigmetStyle = DEFAULT_STYLE;
  /** Captured pointer handlers, kept so `destroy()` can detach them. */
  private pointerHandlers: PointerHandlers | undefined;
  private windowUp: ((e: MouseEvent) => void) | undefined;
  private toolbarEl: HTMLElement | undefined;
  private tooltipEl: HTMLElement | undefined;
  /** True between pointer down and up — used to skip hit-testing during a drag. */
  private dragging = false;

  constructor(opts: { map: MapLibreMap; style?: SigmetStyle }) {
    this.map = opts.map;
    if (opts.style) this.style = opts.style;
  }

  setStyle(style: SigmetStyle): void {
    this.style = style;
    if (this.map.getLayer("area-fill")) this.applyStyle();
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
      this.map.getContainer().appendChild(this.tooltipEl);
    }
    const p = this.map.project([at.lon, at.lat]);
    this.tooltipEl.textContent = text;
    this.tooltipEl.style.display = "block";
    this.tooltipEl.style.left = `${p.x}px`;
    this.tooltipEl.style.top = `${p.y}px`;
  }

  ready(): Promise<void> {
    if (!this.readyPromise) {
      this.readyPromise = new Promise<void>((resolve) => {
        if (this.map.isStyleLoaded()) {
          this.addOverlays();
          resolve();
        } else {
          this.map.once("load", () => {
            this.addOverlays();
            resolve();
          });
        }
      });
    }
    return this.readyPromise;
  }

  setOverlay(id: OverlayId, data: FeatureCollection): void {
    (this.map.getSource(id) as { setData?: (d: FeatureCollection) => void })
      ?.setData?.(data);
  }

  addToolbar(items: ToolbarItem[], options?: ToolbarOptions): HTMLElement {
    if (this.toolbarEl) return this.toolbarEl; // idempotent
    // Use MapLibre's native control-group classes so the buttons inherit the
    // engine's native look; placement is set by populateToolbar from `options`.
    const el = document.createElement("div");
    el.className = "maplibregl-ctrl maplibregl-ctrl-group sigmet-toolbar";
    populateToolbar(el, items, options);
    this.map.getContainer().appendChild(el);
    this.toolbarEl = el;
    return el;
  }

  getCenter(): LatLng {
    const c = this.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  }

  setPanEnabled(enabled: boolean): void {
    if (enabled) this.map.dragPan.enable();
    else this.map.dragPan.disable();
  }

  setCursor(cursor: string): void {
    this.map.getCanvas().style.cursor = cursor;
  }

  onPointer(cb: (ev: PointerEvent) => void): void {
    if (this.pointerHandlers) return; // idempotent
    const emit =
      (type: PointerEvent["type"]): MlHandler =>
      (e) => {
        if (type === "down") this.dragging = true;
        else if (type === "up") this.dragging = false;
        // Skip the (costly) hit-test on drag-moves and on up — only down/click and
        // hover-moves need it.
        const needHit = type !== "up" && !(type === "move" && this.dragging);
        const hit = needHit ? this.hitAt(e.point) : undefined;
        if (type === "move" && !this.dragging) {
          this.setCursor(
            hit?.overlay === "handles" ? "grab" : hit?.overlay === "guide" ? "move" : "",
          );
        }
        cb({
          type,
          lngLat: { lat: e.lngLat.lat, lon: e.lngLat.lng },
          ...(hit ? { hit } : {}),
        });
      };
    // Capture each handler reference so destroy() can detach exactly these.
    const handlers = {
      mousedown: emit("down"),
      mousemove: emit("move"),
      mouseup: emit("up"),
      click: emit("click"),
    };
    this.map.on("mousedown", handlers.mousedown);
    this.map.on("mousemove", handlers.mousemove);
    this.map.on("mouseup", handlers.mouseup);
    this.map.on("click", handlers.click);
    this.pointerHandlers = handlers;
    // A mouseup outside the canvas (drag released past the map edge) never reaches
    // the map's "mouseup" — finish the drag here so pan isn't left disabled.
    if (typeof window !== "undefined") {
      const windowUp = (): void => {
        if (!this.dragging) return; // the in-canvas mouseup already handled it
        this.dragging = false;
        cb({ type: "up", lngLat: { lat: 0, lon: 0 } });
      };
      window.addEventListener("mouseup", windowUp);
      this.windowUp = windowUp;
    }
  }

  /** Detach everything this adapter added; never destroys the host map. */
  destroy(): void {
    const h = this.pointerHandlers;
    if (h) {
      this.map.off("mousedown", h.mousedown);
      this.map.off("mousemove", h.mousemove);
      this.map.off("mouseup", h.mouseup);
      this.map.off("click", h.click);
      this.pointerHandlers = undefined;
    }
    if (this.windowUp && typeof window !== "undefined") {
      window.removeEventListener("mouseup", this.windowUp);
      this.windowUp = undefined;
    }
    for (const id of LAYER_IDS) if (this.map.getLayer(id)) this.map.removeLayer(id);
    for (const id of SOURCE_IDS) if (this.map.getSource(id)) this.map.removeSource(id);
    this.toolbarEl?.remove();
    this.toolbarEl = undefined;
    this.tooltipEl?.remove();
    this.tooltipEl = undefined;
    this.readyPromise = undefined;
    this.setCursor("");
    this.map.dragPan.enable();
  }

  private hitAt(point: { x: number; y: number }):
    | { overlay: OverlayId; props: Record<string, unknown> }
    | undefined {
    const layers = Object.keys(HIT_LAYERS).filter((id) => this.map.getLayer(id));
    const found = this.map.queryRenderedFeatures([point.x, point.y], { layers })[0];
    if (!found) return undefined;
    const overlay = HIT_LAYERS[found.layer.id];
    if (!overlay) return undefined;
    return { overlay, props: (found.properties ?? {}) as Record<string, unknown> };
  }

  private addOverlays(): void {
    for (const id of ["other", "area", "guide", "handles", "label"] as OverlayId[]) {
      if (!this.map.getSource(id)) {
        this.map.addSource(id, { type: "geojson", data: EMPTY });
      }
    }
    const s = this.style;
    this.map.addLayer({
      id: "other-fill",
      type: "fill",
      source: "other",
      paint: { "fill-color": s.other.fill.color, "fill-opacity": s.other.fill.opacity },
    });
    this.map.addLayer({
      id: "area-fill",
      type: "fill",
      source: "area",
      paint: { "fill-color": s.area.fill.color, "fill-opacity": s.area.fill.opacity },
    });
    this.map.addLayer({
      id: "area-line",
      type: "line",
      source: "area",
      paint: {
        "line-color": s.area.line.color,
        "line-width": s.area.line.width,
        ...(s.area.line.dash ? { "line-dasharray": s.area.line.dash } : {}),
      },
    });
    this.map.addLayer({
      id: "guide",
      type: "line",
      source: "guide",
      paint: {
        "line-color": s.guide.color,
        "line-width": s.guide.width,
        ...(s.guide.dash ? { "line-dasharray": s.guide.dash } : {}),
      },
    });
    this.map.addLayer({
      id: "handles",
      type: "circle",
      source: "handles",
      paint: {
        // Control handle (radius/width), collinear (greyed, ignored), or plain vertex.
        "circle-radius": handleCase(s, "radius") as number,
        "circle-color": handleCase(s, "color") as string,
        "circle-stroke-color": handleCase(s, "strokeColor") as string,
        "circle-stroke-width": handleCase(s, "strokeWidth") as number,
      },
    });
    this.map.addLayer({
      id: "label",
      type: "symbol",
      source: "label",
      layout: {
        "text-field": ["get", "text"],
        "text-size": s.label.size,
        "text-offset": [0, s.label.offsetY / s.label.size],
        "text-anchor": "bottom",
        "text-allow-overlap": true,
      },
      paint: {
        "text-color": s.label.color,
        "text-halo-color": s.label.haloColor,
        "text-halo-width": s.label.haloWidth,
      },
    });
  }

  /** Re-apply the current style to already-built layers (live restyle). */
  private applyStyle(): void {
    const s = this.style;
    const map = this.map;
    map.setPaintProperty("other-fill", "fill-color", s.other.fill.color);
    map.setPaintProperty("other-fill", "fill-opacity", s.other.fill.opacity);
    map.setPaintProperty("area-fill", "fill-color", s.area.fill.color);
    map.setPaintProperty("area-fill", "fill-opacity", s.area.fill.opacity);
    map.setPaintProperty("area-line", "line-color", s.area.line.color);
    map.setPaintProperty("area-line", "line-width", s.area.line.width);
    map.setPaintProperty("area-line", "line-dasharray", s.area.line.dash ?? null);
    map.setPaintProperty("guide", "line-color", s.guide.color);
    map.setPaintProperty("guide", "line-width", s.guide.width);
    map.setPaintProperty("guide", "line-dasharray", s.guide.dash ?? null);
    map.setPaintProperty("handles", "circle-radius", handleCase(s, "radius") as number);
    map.setPaintProperty("handles", "circle-color", handleCase(s, "color") as string);
    map.setPaintProperty("handles", "circle-stroke-color", handleCase(s, "strokeColor") as string);
    map.setPaintProperty("handles", "circle-stroke-width", handleCase(s, "strokeWidth") as number);
    map.setLayoutProperty("label", "text-size", s.label.size);
    map.setLayoutProperty("label", "text-offset", [0, s.label.offsetY / s.label.size]);
    map.setPaintProperty("label", "text-color", s.label.color);
    map.setPaintProperty("label", "text-halo-color", s.label.haloColor);
    map.setPaintProperty("label", "text-halo-width", s.label.haloWidth);
  }
}
