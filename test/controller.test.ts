import type { Feature, Polygon } from "geojson";
import { beforeEach, describe, expect, it } from "vitest";

import { FakeAdapter as BaseFakeAdapter } from "@softwarity/draw-adapter/testing";
import type { LatLng, SigmetGeometry } from "../src/core/index";
import type { PointerEvent } from "../src/map/adapter";
import { SigmetDraw } from "../src/map/sigmet-draw";

/**
 * The shared in-memory {@link BaseFakeAdapter} (captures overlays, replays pointer
 * events) plus a few SIGMET-specific test helpers so the call sites stay terse.
 */
class FakeAdapter extends BaseFakeAdapter {
  /** Replay a pointer event over a `handles` feature carrying `role` (the common
   *  drag case); omit `role` for a plain background event. */
  send(type: PointerEvent["type"], lat: number, lon: number, role?: string): void {
    if (role) super.send(type, lat, lon, "handles", { role });
    else super.send(type, lat, lon);
  }
  /** A `down` on a draggable guide line carrying `role`. */
  guideDown(role: string, lat: number, lon: number): void {
    super.send("down", lat, lon, "guide", { role });
  }
  /** lon/lat of the pushed `handles` feature with `role` (undefined if none). */
  handleAt(role: string): LatLng | undefined {
    const f = this.feature("handles", role);
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

  it("greys a vertex that becomes collinear because *another* vertex was moved", async () => {
    await sigmet.ready();
    // v1 starts off the v0–v2 line. Dragging the endpoint v2 onto that line (so
    // v0–v1–v2 align) must drop v1 — the whole ring is re-evaluated, not just the
    // dragged vertex.
    sigmet.load({
      kind: "polygon",
      points: [
        { lat: 2, lon: 2 }, // v0
        { lat: 3, lon: 5 }, // v1 (will become collinear)
        { lat: 2, lon: 8 }, // v2 (endpoint we move)
        { lat: 8, lon: 5 }, // v3
      ],
    });
    const handle = (role: string): Feature | undefined =>
      (adapter.overlays.handles?.features ?? []).find((f) => f.properties?.["role"] === role);
    expect(handle("v1")?.properties?.["collinear"]).toBe(false); // not yet aligned
    // Move v2 to (lat 4, lon 8): now v0(2,2)–v1(3,5)–v2(4,8) are collinear.
    adapter.send("down", 2, 8, "v2");
    adapter.send("move", 4, 8, "v2");
    adapter.send("up", 4, 8);
    expect(handle("v1")?.properties?.["collinear"]).toBe(true); // greyed
    const g = last as Extract<SigmetGeometry, { kind: "polygon" }>;
    expect(g.points).toHaveLength(3); // v1 dropped from the TAC
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

  it("drops an out-of-FIR apex whose triangle can't touch the clip, keeps the boundary corners", () => {
    // v2 is a spike far north of the FIR (lat 18, FIR lat ≤ 10): the triangle
    // v1–v2–v3 lies entirely above the FIR, so removing v2 can't move the cut →
    // it's dropped & greyed. v1/v3 sit between an inside and an outside vertex —
    // their triangles dip into the FIR, so they stay (they shape the clip).
    sigmet.load({
      kind: "polygon",
      points: [
        { lat: 5, lon: 2 }, // v0 inside
        { lat: 13, lon: 2 }, // v1 outside (boundary corner)
        { lat: 18, lon: 5 }, // v2 outside (apex — clip-irrelevant)
        { lat: 13, lon: 8 }, // v3 outside (boundary corner)
        { lat: 5, lon: 8 }, // v4 inside
      ],
    });
    const handle = (role: string): Feature | undefined =>
      (adapter.overlays.handles?.features ?? []).find((f) => f.properties?.["role"] === role);
    expect(handle("v2")?.properties?.["collinear"]).toBe(true); // greyed (dropped)
    expect(handle("v1")?.properties?.["collinear"]).toBe(false);
    expect(handle("v3")?.properties?.["collinear"]).toBe(false);
    // v2 is dropped from the emitted geometry; the clip-relevant vertices remain.
    const g = last as Extract<SigmetGeometry, { kind: "polygon" }>;
    expect(g.points).toHaveLength(4);
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
