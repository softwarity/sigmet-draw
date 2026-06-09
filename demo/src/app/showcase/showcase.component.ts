import {
  AfterViewInit,
  Component,
  computed,
  CUSTOM_ELEMENTS_SCHEMA,
  ElementRef,
  inject,
  OnDestroy,
  signal,
  viewChild,
} from "@angular/core";
import { DomSanitizer, SafeHtml } from "@angular/platform-browser";
import { registerInteractiveCode } from "@softwarity/interactive-code";
import {
  DEFAULT_STYLE,
  fromTAC,
  LeafletAdapter,
  MapLibreAdapter,
  OpenLayersAdapter,
  SigmetDraw,
} from "@softwarity/sigmet-draw";
import type {
  FirInput,
  SigmetGeometry,
  SigmetStyleInput,
  SnapshotDelivery,
  SnapshotQuality,
  ToolbarPosition,
} from "@softwarity/sigmet-draw";
import * as L from "leaflet";
import { Map as MapLibreMap, NavigationControl } from "maplibre-gl";
import GeoJSON from "ol/format/GeoJSON";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OlMap from "ol/Map";
import { fromLonLat, transformExtent } from "ol/proj";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { Fill, Stroke, Style } from "ol/style";
import View from "ol/View";

import { ICONS } from "./icons";

registerInteractiveCode();

type Engine = "maplibre" | "openlayers" | "leaflet";

/**
 * Each engine keeps its OWN idiomatic basemap — so the three are instantly
 * distinguishable and you see what ships with each one, no forced common tiles:
 *  - MapLibre   → its built-in demo vector style (demotiles, no API key)
 *  - OpenLayers → its canonical OSM raster source (`new OSM()`)
 *  - Leaflet    → a clean light raster in the same vein (CARTO Positron)
 * All light, so the orange SIGMET area + blue handles stay legible.
 */
const MAPLIBRE_DEMO_STYLE = "https://demotiles.maplibre.org/style.json";
const LEAFLET_POSITRON = "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png";
const CARTO_ATTR = "© OpenStreetMap contributors © CARTO";
type ToolMethod =
  | "circle" | "tropicalCyclone" | "meridian" | "parallel" | "latBand" | "lonBand" | "quadrant"
  | "lineSide" | "corridor" | "wideLine" | "polygon" | "point" | "entireFir";

interface Tool {
  method: ToolMethod;
  label: string;
  desc: string;
  /** Override the displayed call signature (e.g. the TC tool takes a centre). */
  call?: string;
}

const TOOLS: Tool[] = [
  { method: "circle", label: "Circle", desc: "Circle — WI nnNM OF PSN (drag centre & radius)" },
  { method: "tropicalCyclone", label: "Cyclone", call: "s.tropicalCyclone(center)", desc: "Tropical cyclone — WI nnnNM OF TC CENTRE (centre required; fixed, drag radius)" },
  { method: "meridian", label: "Meridian", desc: "Meridian half-plane — E OF / W OF a longitude" },
  { method: "parallel", label: "Parallel", desc: "Parallel half-plane — N OF / S OF a latitude" },
  { method: "latBand", label: "Lat band", desc: "Latitude band — between two parallels" },
  { method: "lonBand", label: "Lon band", desc: "Longitude band — between two meridians" },
  { method: "quadrant", label: "Quadrant", desc: "Quadrant — combine a parallel & a meridian" },
  { method: "lineSide", label: "Line", desc: "Side of a line — N/S/E/W OF LINE (2–4 points)" },
  { method: "corridor", label: "Corridor", desc: "Corridor — band between two lines (2–4 points)" },
  { method: "wideLine", label: "Wide line", desc: "Wide line — APRX nnKM WID LINE BTN (2–4 points)" },
  { method: "polygon", label: "Polygon", desc: "Polygon — WI a closed boundary (drag vertices)" },
  { method: "point", label: "Point", desc: "Point — a single position" },
  { method: "entireFir", label: "Entire FIR", desc: "Entire FIR — ENTIRE FIR" },
];


function bboxCenter(fir: FirInput): [number, number] {
  const g = "type" in fir && fir.type === "Feature" ? fir.geometry : fir;
  const rings: number[][][] = g.type === "Polygon" ? g.coordinates : g.coordinates.flat();
  let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
  for (const ring of rings)
    for (const [lon, lat] of ring as [number, number][]) {
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
    }
  return [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
}

@Component({
  selector: "app-showcase",
  imports: [],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  templateUrl: "./showcase.component.html",
  styleUrl: "./showcase.component.scss",
})
export class ShowcaseComponent implements AfterViewInit, OnDestroy {
  private readonly sanitizer = inject(DomSanitizer);
  private readonly mapEl = viewChild.required<ElementRef<HTMLDivElement>>("map");

  protected readonly tools = TOOLS;
  protected readonly icon = (m: string): SafeHtml =>
    this.sanitizer.bypassSecurityTrustHtml(ICONS[m] ?? "");

  protected readonly engine = signal<Engine>("maplibre");
  protected readonly firs = signal<{ designator: string; name: string; group?: string }[]>([]);
  /** Submenu order for the FIR picker (special cases first, then the rest). */
  private readonly GROUP_ORDER = [
    "Date line",
    "Multi-polygon",
    "With holes",
    "Complex",
    "Small",
    "North pole",
    "South pole",
    "Huge",
    "Equator",
    "Other",
  ];
  /** FIRs grouped into `<optgroup>`s by their geometry category. */
  protected readonly firGroups = computed(() => {
    const by = new Map<string, { designator: string; name: string }[]>();
    for (const f of this.firs()) {
      const g = f.group ?? "Other";
      const list = by.get(g) ?? [];
      list.push(f);
      by.set(g, list);
    }
    return this.GROUP_ORDER.filter((g) => by.has(g)).map((g) => ({
      label: g,
      firs: by.get(g)!,
    }));
  });
  protected readonly firId = signal("");
  protected readonly tac = signal("— pick a shape —");
  protected readonly tacInput = signal("");
  protected readonly tacError = signal("");
  protected readonly adapterName = signal("MapLibreAdapter");
  protected readonly readonly = signal(false);
  protected readonly mapImport = signal('import { Map } from "maplibre-gl";');

  /** Live style edits from the editor panel — re-applied across engine switches. */
  private styleOverride?: SigmetStyleInput;
  /** Whether the on-shape label (the live TAC) is enabled (toggled in the panel). */
  private labelEnabled = false;
  /** Whether the hover tooltip is enabled (toggled in the panel). */
  private tooltipOn = false;
  /** Force radii/widths to NM only (toggled in the panel; needs a rebuild). */
  private nmOnly = false;
  /** Whether the turnkey toolbar is rendered (toggled via the block comment). */
  private toolbarOn = true;
  /** Snapshot ("capture map" PNG button) config. The `snapshot: {}` block is always
   *  present; each field is individually commentable — when its line is commented the
   *  field is omitted and the lib default applies (native / download / shutter on). */
  private snapQOn = false;
  private snapQuality = "native";
  /** Plain-click delivery (⌘/Ctrl-click does the other). Off → default `download`. */
  private snapClickOn = false;
  private snapClickVal = "clipboard";
  /** Play the camera-flash (shutter) feedback on capture (default true). */
  private snapShutterVal = true;
  /** Show the "lock map" toggle button at the end of the toolbar (default true). */
  private lockVal = true;
  /** Whether the TC button has a centre (FIR centroid here) → enabled vs greyed. */
  private tcOn = true;
  /** Live toolbar layout edited in the panel (per-side padding by active edges). */
  private tbPos: ToolbarPosition = "top";
  private tbPad1 = 10;
  private tbPad2 = 10;
  /** Edge names + centred flag driving the conditional padding display. */
  protected readonly tbEdge1 = signal("top"); // primary (anchored) edge
  protected readonly tbEdge2 = signal(""); // cross-axis edge (corners only)
  protected readonly tbCentered = signal(true);
  private sigmet?: SigmetDraw;
  /** The current drawing, kept so it survives an engine/option switch (re-`load`ed
   *  onto the fresh instance). Cleared when the drawing is cleared or the FIR changes. */
  private lastGeometry?: SigmetGeometry;
  private mlMap?: MapLibreMap;
  private olMap?: OlMap;
  private lfMap?: L.Map;
  private lfFirLayer?: L.GeoJSON;
  private olFirSource?: VectorSource;
  private globeBtn?: HTMLButtonElement;
  private mlGlobe = true;

  async ngAfterViewInit(): Promise<void> {
    const index = (await fetch("assets/firs.index.json").then((r) => r.json())) as {
      designator: string;
      name: string;
      group?: string;
    }[];
    this.firs.set(index);
    // Pick a random FIR on each load so the demo showcases varied geometries.
    const pick = index.length ? index[Math.floor(Math.random() * index.length)] : undefined;
    this.firId.set(pick?.designator ?? "");
    await this.rebuild();
  }

  ngOnDestroy(): void {
    this.teardown();
  }

  protected setEngine(engine: Engine): void {
    if (engine === this.engine()) return;
    this.engine.set(engine);
    this.adapterName.set(
      engine === "maplibre" ? "MapLibreAdapter" : engine === "openlayers" ? "OpenLayersAdapter" : "LeafletAdapter",
    );
    this.mapImport.set(
      engine === "maplibre"
        ? 'import { Map } from "maplibre-gl";'
        : engine === "openlayers"
          ? 'import Map from "ol/Map";'
          : 'import * as L from "leaflet";',
    );
    void this.rebuild();
  }

  protected onFir(event: Event): void {
    void this.swapFir((event.target as HTMLSelectElement).value);
  }

  /** Jump to a random (different) FIR — handy to showcase varied geometries. */
  protected randomFir(): void {
    const list = this.firs();
    if (!list.length) return;
    const others = list.filter((f) => f.designator !== this.firId());
    const pool = others.length ? others : list;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    void this.swapFir(pick.designator);
  }

  /** Change FIR WITHOUT recreating the map: swap the FIR data + host outline. */
  private async swapFir(designator: string): Promise<void> {
    this.firId.set(designator);
    if (!this.sigmet) {
      await this.rebuild();
      return;
    }
    try {
      const fir = (await fetch(`assets/firs/${designator}.json`).then((r) => r.json())) as FirInput;
      if (this.firId() !== designator) return;
      this.sigmet.setFir(fir); // clears the current drawing
      this.lastGeometry = undefined; // new FIR ⇒ the old drawing is gone for good
      this.syncTcCenter(); // the centroid substitute moved with the FIR
      this.tac.set("— pick a shape —");
      // Deselect the active tool button too.
      this.mapEl()
        .nativeElement.querySelectorAll(".sigmet-toolbar button.active")
        .forEach((b) => b.classList.remove("active"));
      const firFeature =
        "type" in fir && fir.type === "Feature"
          ? fir
          : { type: "Feature" as const, properties: {}, geometry: fir };
      (this.mlMap?.getSource("host-fir") as { setData?: (d: never) => void } | undefined)
        ?.setData?.(firFeature as never);
      if (this.olFirSource) {
        this.olFirSource.clear();
        this.olFirSource.addFeatures(
          new GeoJSON().readFeatures(firFeature, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
          }),
        );
      }
      if (this.lfMap && this.lfFirLayer) {
        this.lfFirLayer.clearLayers();
        this.lfFirLayer.addData(firFeature as never);
      }
      const b = this.sigmet.firBounds();
      this.mlMap?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 28, animate: true });
      this.olMap
        ?.getView()
        .fit(transformExtent([b[0], b[1], b[2], b[3]], "EPSG:4326", "EPSG:3857"), {
          padding: [24, 24, 24, 24],
          duration: 300,
        });
      this.lfMap?.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [24, 24] });
    } catch (e) {
      console.error("[showcase] swapFir failed", e);
    }
  }

  protected runTool(method: ToolMethod): void {
    const s = this.sigmet;
    if (!s) return;
    // The TC tool needs a centre; the demo has no TC input, so use the FIR centroid.
    if (method === "tropicalCyclone") {
      s.tropicalCyclone(s.firCenter());
      return;
    }
    (s[method] as () => void)();
  }

  protected clear(): void {
    this.sigmet?.clear();
    this.lastGeometry = undefined;
    this.tac.set("— pick a shape —");
  }

  /** Enable/grey the TC button: give it the FIR centroid, or `null` to disable. */
  private syncTcCenter(): void {
    if (this.sigmet?.toolbar) {
      this.sigmet.toolbar.tcCenter = this.tcOn ? this.sigmet.firCenter() : null;
    }
  }

  /** The current per-side padding object (active edges from the position). */
  private tbPaddingObj(): { top?: string; bottom?: string; left?: string; right?: string } {
    const [edge, sec] = this.tbPos.split("-");
    const pad: Record<string, string> = { [edge!]: `${this.tbPad1}px` };
    if (sec) pad[sec] = `${this.tbPad2}px`;
    return pad;
  }

  private applyTbPadding(): void {
    if (this.sigmet?.toolbar) this.sigmet.toolbar.padding = this.tbPaddingObj();
  }

  /**
   * Single `change` handler for the right-hand code panel. Routes the adapter
   * `select` (→ switch engine, synced with the toggle above the map) and the
   * style bindings (→ live `setStyle`).
   */
  protected onPanelChange(ev: Event): void {
    const t = ev.target as { key?: string; value?: unknown } | null;
    if (t?.key === "adapter") {
      const v = String(t.value);
      this.setEngine(v === "OpenLayersAdapter" ? "openlayers" : v === "LeafletAdapter" ? "leaflet" : "maplibre");
      return;
    }
    if (t?.key === "labelFn") {
      this.labelEnabled = t.value === true || t.value === "true";
      this.sigmet?.setLabel(this.labelEnabled ? (r) => r.tac : null);
      return;
    }
    if (t?.key === "tooltipFn") {
      this.tooltipOn = t.value === true || t.value === "true";
      this.sigmet?.setTooltip(this.tooltipOn ? (r) => r.tac : null); // live, no rebuild
      return;
    }
    if (t?.key === "nmOnly") {
      this.nmOnly = t.value === true || t.value === "true";
      void this.rebuild(); // construction-time option
      return;
    }
    if (t?.key === "tbOff") {
      this.toolbarOn = t.value === true || t.value === "true";
      void this.rebuild(); // toolbar is a construction-time option
      return;
    }
    // Snapshot fields — each is a toolbar construction-time option → rebuild.
    if (t?.key === "snapQ") {
      this.snapQOn = t.value === true || t.value === "true";
      void this.rebuild();
      return;
    }
    if (t?.key === "snapQuality") {
      this.snapQuality = String(t.value);
      void this.rebuild();
      return;
    }
    if (t?.key === "snapClick") {
      this.snapClickOn = t.value === true || t.value === "true";
      void this.rebuild();
      return;
    }
    if (t?.key === "snapClickVal") {
      this.snapClickVal = String(t.value);
      void this.rebuild();
      return;
    }
    if (t?.key === "snapShutterVal") {
      this.snapShutterVal = t.value === true || t.value === "true";
      void this.rebuild();
      return;
    }
    if (t?.key === "lockVal") {
      this.lockVal = t.value === true || t.value === "true";
      void this.rebuild();
      return;
    }
    if (t?.key === "tcEnabled") {
      this.tcOn = t.value === true || t.value === "true";
      this.syncTcCenter(); // live — enables/greys the TC button
      return;
    }
    if (t?.key === "tbPosition") {
      this.tbPos = String(t.value) as ToolbarPosition;
      const [edge, sec] = this.tbPos.split("-");
      this.tbEdge1.set(edge!);
      this.tbEdge2.set(sec ?? "");
      this.tbCentered.set(!sec);
      if (this.sigmet?.toolbar) this.sigmet.toolbar.position = this.tbPos; // live re-place
      this.applyTbPadding();
      return;
    }
    if (t?.key === "tbPad1" || t?.key === "tbPad2") {
      if (t.key === "tbPad1") this.tbPad1 = Number(t.value);
      else this.tbPad2 = Number(t.value);
      this.applyTbPadding();
      return;
    }
    if (t?.key === "readonly") {
      this.readonly.set(t.value === true || t.value === "true");
      this.sigmet?.setReadonly(this.readonly()); // live freeze/unfreeze
      return;
    }
    if (t?.key === "mapImport") return; // readonly field, engine-driven
    this.onStyleChange(ev);
  }

  /**
   * Live style editor: read every `<code-binding>` in the editor panel and push
   * a full style to the map (commented-out groups revert to the defaults).
   */
  protected onStyleChange(ev: Event): void {
    const host = ev.currentTarget as HTMLElement;
    const val = (k: string): unknown =>
      (host.querySelector(`code-binding[key="${k}"]`) as { value?: unknown } | null)?.value;
    const on = (k: string): boolean => val(k) === true || val(k) === "true";
    const D = DEFAULT_STYLE;
    const style: SigmetStyleInput = {
      area: on("area")
        ? {
            fill: String(val("areaColor")),
            opacity: Number(val("areaOpacity")),
            stroke: String(val("areaLineColor")),
            width: Number(val("areaLineWidth")),
          }
        : D.area,
      lineHandle: on("guide")
        ? { stroke: String(val("guideColor")), width: Number(val("guideWidth")) }
        : D.lineHandle,
      iconHandle: on("vertex")
        ? { ...D.iconHandle, fill: String(val("vertexColor")), stroke: String(val("controlColor")) }
        : D.iconHandle,
      label: on("label")
        ? {
            ...D.label,
            color: String(val("labelColor")),
            halo: String(val("labelHalo")),
            size: Number(val("labelSize")),
            width: Number(val("labelWidth")),
          }
        : D.label,
      tooltip: on("tooltip")
        ? {
            ...D.tooltip,
            color: String(val("tipColor")),
            background: String(val("tipBg")),
            size: Number(val("tipSize")),
          }
        : D.tooltip,
    };
    this.styleOverride = style;
    this.sigmet?.setStyle(style);
  }

  protected toggleGlobe(): void {
    this.mlGlobe = !this.mlGlobe;
    this.mlMap?.setProjection({ type: this.mlGlobe ? "globe" : "mercator" });
    this.updateGlobeBtn();
  }

  /** Icon shows the *current* view mode (globe in globe, flat map in 2D — like a
   *  mute button); the tooltip carries the action. */
  private updateGlobeBtn(): void {
    const g = this.globeBtn;
    if (!g) return;
    g.innerHTML = this.mlGlobe ? ICONS["globe"] : ICONS["flat"];
    const t = this.mlGlobe ? "Switch to Mercator" : "Switch to globe";
    g.title = t;
    g.setAttribute("aria-label", t);
  }

  /** Parse the (editable) TAC and draw it on the live map. */
  protected applyTac(): void {
    try {
      this.sigmet?.load(fromTAC(this.tacInput()));
      this.tacError.set("");
    } catch (e) {
      this.tacError.set(e instanceof Error ? e.message : String(e));
    }
  }

  private teardown(): void {
    try { this.sigmet?.destroy(); } catch (e) { console.error("[showcase] destroy", e); }
    this.sigmet = undefined;
    try { this.mlMap?.remove(); } catch (e) { console.error("[showcase] ml remove", e); }
    try { this.olMap?.setTarget(undefined); } catch (e) { console.error("[showcase] ol detach", e); }
    try { this.lfMap?.remove(); } catch (e) { console.error("[showcase] lf remove", e); }
    this.mlMap = undefined;
    this.olMap = undefined;
    this.lfMap = undefined;
    this.lfFirLayer = undefined;
    this.olFirSource = undefined;
    this.globeBtn = undefined;
    const el = this.mapEl().nativeElement;
    el.innerHTML = "";
    el.className = "map";
  }

  private async rebuild(): Promise<void> {
    try {
      const el = this.mapEl().nativeElement;
      const id = this.firId();
      const eng = this.engine();
      const fir = (await fetch(`assets/firs/${id}.json`).then((r) => r.json())) as FirInput;
      if (this.firId() !== id || this.engine() !== eng) return;

      // Capture the current drawing before teardown so we can re-`load` it on the
      // new instance (preserves the shape when switching engine / toggling options).
      const keep = this.lastGeometry;
      this.teardown();
      this.tac.set("— pick a shape —");
      const center = bboxCenter(fir);
      const firFeature =
        "type" in fir && fir.type === "Feature"
          ? fir
          : { type: "Feature" as const, properties: {}, geometry: fir };

      let adapter: MapLibreAdapter | OpenLayersAdapter | LeafletAdapter;
      if (eng === "maplibre") {
        const map = new MapLibreMap({ container: el, style: MAPLIBRE_DEMO_STYLE, center, zoom: 4 });
        this.mlMap = map;
        map.addControl(new NavigationControl());
        // Globe toggle belongs with zoom/compass (not a SIGMET tool) → into that group.
        const navGroup = el.querySelector<HTMLElement>(
          ".maplibregl-ctrl-top-right .maplibregl-ctrl-group",
        );
        if (navGroup) {
          const g = document.createElement("button");
          g.type = "button";
          g.style.color = "#24292f"; // visible on the white native button
          g.addEventListener("click", () => this.toggleGlobe());
          navGroup.appendChild(g);
          this.globeBtn = g;
        }
        this.mlGlobe = true;
        this.updateGlobeBtn();
        map.on("load", () => {
          map.addSource("host-fir", { type: "geojson", data: firFeature as never });
          map.addLayer({
            id: "host-fir-fill", type: "fill", source: "host-fir",
            paint: { "fill-color": "#f5d90a", "fill-opacity": 0.12 },
          });
          map.addLayer({
            id: "host-fir-line", type: "line", source: "host-fir",
            paint: { "line-color": "#000000", "line-width": 2, "line-dasharray": [2, 2] },
          });
          map.setProjection({ type: "globe" });
        });
        adapter = new MapLibreAdapter({ map });
      } else if (eng === "openlayers") {
        const firSource = new VectorSource({
          features: new GeoJSON().readFeatures(firFeature, {
            dataProjection: "EPSG:4326",
            featureProjection: "EPSG:3857",
          }),
        });
        this.olFirSource = firSource;
        const map = new OlMap({
          target: el,
          layers: [
            new TileLayer({ source: new OSM() }),
            new VectorLayer({
              source: firSource,
              style: new Style({
                fill: new Fill({ color: "rgba(245,217,10,0.12)" }),
                stroke: new Stroke({ color: "#000000", width: 2, lineDash: [4, 4] }),
              }),
            }),
          ],
          view: new View({ center: fromLonLat(center), zoom: 4 }),
        });
        this.olMap = map;
        adapter = new OpenLayersAdapter({ map });
      } else {
        // Leaflet — lat/lng-native, a host-owned `L.Map`. Clean light basemap (Positron).
        const map = L.map(el, { zoomControl: true }).setView([center[1], center[0]], 4);
        L.tileLayer(LEAFLET_POSITRON, { attribution: CARTO_ATTR, subdomains: "abcd" }).addTo(map);
        // Host draws its own FIR outline (SigmetDraw never touches the basemap).
        this.lfFirLayer = L.geoJSON(firFeature as never, {
          style: { color: "#000000", weight: 2, dashArray: "4 4", fillColor: "#f5d90a", fillOpacity: 0.12 },
        }).addTo(map);
        this.lfMap = map;
        adapter = new LeafletAdapter({ map });
      }

      this.sigmet = new SigmetDraw({
        adapter,
        fir,
        // Dynamic on-shape text — here the live TAC (styleable via `style.label`).
        label: this.labelEnabled ? (r) => r.tac : undefined,
        tooltip: this.tooltipOn ? (r) => r.tac : undefined,
        nauticalMilesOnly: this.nmOnly,
        // Start frozen (no handles/toolbar) when the read-only toggle is on.
        readonly: this.readonly(),
        // Re-apply any live style edits so they survive an engine switch.
        style: this.styleOverride,
        // Turnkey native toolbar (built-in icons, all tools wired); omit → no toolbar.
        // `snapshot` adds the PNG "capture map" button; omit it → lib default (native,
        // onClick: download). The button always offers both deliveries (⌘/Ctrl-click
        // does the other one).
        toolbar: this.toolbarOn
          ? {
              position: this.tbPos,
              padding: this.tbPaddingObj(),
              // The snapshot block is always present; each field is opt-in (omitted →
              // lib default: native / download / shutter on).
              snapshot: {
                ...(this.snapQOn ? { quality: this.snapQuality as SnapshotQuality } : {}),
                ...(this.snapClickOn ? { onClick: this.snapClickVal as SnapshotDelivery } : {}),
                shutter: this.snapShutterVal,
              },
              lock: this.lockVal,
            }
          : undefined,
      });
      this.sigmet.on("change", (r) => {
        this.tac.set(r.tac);
        this.tacInput.set(r.tac);
        this.tacError.set("");
        this.lastGeometry = r.geometry; // remember the drawing across engine switches
      });
      await this.sigmet.ready();

      // Re-draw what was on screen before the rebuild (engine/option switch keeps
      // the same FIR, so the geometry is still valid).
      if (keep) this.sigmet.load(keep);

      // No real TC input here → enable the TC button with the FIR centroid.
      this.syncTcCenter();
      // (read-only is applied at construction via the `readonly` option above)

      const b = this.sigmet.firBounds();
      this.mlMap?.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 28, animate: false });
      this.olMap
        ?.getView()
        .fit(transformExtent([b[0], b[1], b[2], b[3]], "EPSG:4326", "EPSG:3857"), {
          padding: [24, 24, 24, 24],
        });
      this.lfMap?.fitBounds([[b[1], b[0]], [b[3], b[2]]], { padding: [24, 24] });
    } catch (e) {
      console.error("[showcase] rebuild failed", e);
    }
  }
}
