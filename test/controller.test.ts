import type { Feature, FeatureCollection, Polygon } from "geojson";
import { beforeEach, describe, expect, it } from "vitest";

import type { LatLng, SigmetGeometry } from "../src/core/index";
import type { MapAdapter, OverlayId, PointerEvent, ToolbarItem } from "../src/map/adapter";
import { SigmetDraw } from "../src/map/sigmet-draw";

/** Minimal in-memory MapAdapter: captures overlays + the pointer callback. */
class FakeAdapter implements MapAdapter {
  overlays: Partial<Record<OverlayId, FeatureCollection>> = {};
  cb?: (ev: PointerEvent) => void;
  constructor(private readonly centre: LatLng) {}
  ready(): Promise<void> {
    return Promise.resolve();
  }
  setOverlay(id: OverlayId, data: FeatureCollection): void {
    this.overlays[id] = data;
  }
  setStyle(): void {}
  setTooltip(): void {}
  addToolbar(_items: ToolbarItem[]): HTMLElement {
    return {} as HTMLElement;
  }
  getCenter(): LatLng {
    return this.centre;
  }
  setPanEnabled(): void {}
  onPointer(cb: (ev: PointerEvent) => void): void {
    this.cb = cb;
  }
  destroy(): void {}

  // --- test helpers ---
  send(type: PointerEvent["type"], lat: number, lon: number, role?: string): void {
    const hit = role ? { overlay: "handles" as OverlayId, props: { role } } : undefined;
    this.cb?.({ type, lngLat: { lat, lon }, ...(hit ? { hit } : {}) });
  }
  guideDown(role: string, lat: number, lon: number): void {
    this.cb?.({ type: "down", lngLat: { lat, lon }, hit: { overlay: "guide", props: { role } } });
  }
  handleAt(role: string): LatLng | undefined {
    const f = (this.overlays.handles?.features ?? []).find((x) => x.properties?.["role"] === role);
    if (!f || f.geometry.type !== "Point") return undefined;
    const [lon, lat] = f.geometry.coordinates as [number, number];
    return { lat, lon };
  }
}

const squareFir = (minLon: number, minLat: number, maxLon: number, maxLat: number): Feature<Polygon> => ({
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ],
    ],
  },
});

describe("SigmetDraw controller", () => {
  let adapter: FakeAdapter;
  let sigmet: SigmetDraw;
  let last: SigmetGeometry | undefined;

  beforeEach(() => {
    adapter = new FakeAdapter({ lat: 5, lon: 5 });
    sigmet = new SigmetDraw({ adapter, fir: squareFir(0, 0, 10, 10) });
    last = undefined;
    sigmet.on("change", (r) => {
      last = r.geometry;
    });
  });

  it("translates a polygon by its move handle (centroid follows the cursor)", async () => {
    await sigmet.ready();
    sigmet.polygon();
    adapter.send("down", 7, 7, "move");
    adapter.send("move", 7, 7, "move");
    adapter.send("up", 7, 7);
    const g = last as Extract<SigmetGeometry, { kind: "polygon" }>;
    const mean = g.points.reduce((s, p) => ({ lat: s.lat + p.lat, lon: s.lon + p.lon }), { lat: 0, lon: 0 });
    expect(mean.lat / g.points.length).toBeCloseTo(7, 5);
    expect(mean.lon / g.points.length).toBeCloseTo(7, 5);
  });

  it("rejects merging a polygon vertex onto its neighbour", async () => {
    await sigmet.ready();
    sigmet.polygon();
    const v0 = adapter.handleAt("v0")!;
    const v1 = adapter.handleAt("v1")!;
    // Drag v0 right onto v1 — the merge guard must reject it.
    adapter.send("down", v0.lat, v0.lon, "v0");
    adapter.send("move", v1.lat, v1.lon, "v0");
    adapter.send("up", v1.lat, v1.lon);
    const moved = adapter.handleAt("v0")!;
    expect(Math.hypot(moved.lon - v1.lon, moved.lat - v1.lat)).toBeGreaterThan(0.1);
  });

  it("keeps a west>east lonBand wrapping when dragging the west edge", () => {
    // Loaded wrapping band (west 8 > east 2). Dragging west must not collapse it.
    sigmet.load({ kind: "lonBand", west: 8, east: 2 });
    adapter.guideDown("west", 5, 9);
    adapter.send("move", 5, 9, "west");
    adapter.send("up", 5, 9);
    const g = last as Extract<SigmetGeometry, { kind: "lonBand" }>;
    expect(g.west).toBeCloseTo(9, 5);
    expect(g.west).toBeGreaterThan(g.east); // still wrapping
  });

  it("disabled mode removes handles and ignores editing, then restores", async () => {
    await sigmet.ready();
    sigmet.polygon();
    const v0 = adapter.handleAt("v0")!;
    expect((adapter.overlays.handles?.features ?? []).length).toBeGreaterThan(0);

    sigmet.setReadonly(true);
    expect(sigmet.isReadonly).toBe(true);
    expect(adapter.overlays.handles?.features ?? []).toHaveLength(0); // no handles
    expect(adapter.overlays.guide?.features ?? []).toHaveLength(0);
    // A drag on a former handle role does nothing.
    adapter.send("down", v0.lat, v0.lon, "v0");
    adapter.send("move", 8, 8, "v0");
    adapter.send("up", 8, 8);
    const stillV0 = (last as Extract<SigmetGeometry, { kind: "polygon" }>).points[0]!;
    expect(Math.hypot(stillV0.lon - v0.lon, stillV0.lat - v0.lat)).toBeLessThan(1e-9);

    sigmet.setReadonly(false);
    expect((adapter.overlays.handles?.features ?? []).length).toBeGreaterThan(0); // back
  });

  it("unwraps a loaded geometry into an antimeridian FIR's 0..360 frame", () => {
    const amFir = squareFir(179.6, 0, 180, 10); // touches +180…
    amFir.geometry.coordinates[0]!.push([-179.6, 5]); // …and -180 → crosses AM
    const amAdapter = new FakeAdapter({ lat: 5, lon: 180 });
    const amSigmet = new SigmetDraw({ adapter: amAdapter, fir: amFir });
    let amLast: SigmetGeometry | undefined;
    amSigmet.on("change", (r) => {
      amLast = r.geometry;
    });
    amSigmet.load({ kind: "circle", center: { lat: 2, lon: -175 }, radius: 50, unit: "KM" });
    const g = amLast as Extract<SigmetGeometry, { kind: "circle" }>;
    expect(g.center.lon).toBeCloseTo(185, 5); // -175 unwrapped to 185
  });
});
