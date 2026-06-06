import { describe, expect, it } from "vitest";
import type { Feature, FeatureCollection } from "geojson";

import { decorate, toGenericTooltip, SIGMET_LAYERS, SIGMET_HIT } from "../src/map/style-features.js";
import { DEFAULT_STYLE } from "../src/map/style.js";

const S = DEFAULT_STYLE;

const point = (props: Record<string, unknown>): Feature => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [0, 0] },
  properties: props,
});
const fc = (...features: Feature[]): FeatureCollection => ({ type: "FeatureCollection", features });

/** Baked props for the (single) feature of `decorate(id, fc(feature), S)`. */
const baked = (id: string, props: Record<string, unknown>): Record<string, unknown> =>
  decorate(id, fc(point(props)), S).features[0]!.properties as Record<string, unknown>;

describe("manifest", () => {
  it("lists the five overlays bottom→top with the hit set", () => {
    expect(SIGMET_LAYERS.map((l) => l.id)).toEqual(["area", "other", "guide", "handles", "label"]);
    expect([...SIGMET_HIT].sort()).toEqual(["area", "guide", "handles", "other"]);
  });
  it("decorate leaves an empty collection untouched", () => {
    const empty = fc();
    expect(decorate("handles", empty, S)).toBe(empty);
  });
});

describe("decorate — fill overlays", () => {
  it("area bakes fill + outline from the style", () => {
    const p = baked("area", {});
    expect(p["fillColor"]).toBe(S.area.fill);
    expect(p["fillOpacity"]).toBe(S.area.opacity);
    expect(p["stroke"]).toBe(S.area.stroke);
    expect(p["strokeWidth"]).toBe(S.area.width);
  });
  it("other is the faint flip-side fill, with NO stroke", () => {
    const p = baked("other", {});
    expect(p["fillColor"]).toBe("#58a6ff");
    expect(p["fillOpacity"]).toBe(0.08);
    expect(p["stroke"]).toBeUndefined();
  });
});

describe("decorate — guide cursors by role", () => {
  const cur = (role: string) => baked("guide", { role })["cursor"];
  it("meridian-like (lon/west/east) ⇒ ew-resize", () => {
    expect(cur("lon")).toBe("ew-resize");
    expect(cur("west")).toBe("ew-resize");
    expect(cur("east")).toBe("ew-resize");
  });
  it("parallel-like (lat/north/south) ⇒ ns-resize", () => {
    expect(cur("lat")).toBe("ns-resize");
    expect(cur("north")).toBe("ns-resize");
    expect(cur("south")).toBe("ns-resize");
  });
  it("a whole-line guide (e.g. line-side) ⇒ move", () => {
    expect(cur("line")).toBe("move");
  });
  it("guide also bakes the lineHandle stroke", () => {
    const p = baked("guide", { role: "lon" });
    expect(p["stroke"]).toBe(S.lineHandle.stroke);
    expect(p["strokeWidth"]).toBe(S.lineHandle.width);
  });
});

describe("decorate — handle classes & cursors", () => {
  it("plain vertex ⇒ full dot + grab", () => {
    const p = baked("handles", { role: "v0" });
    expect(p["radius"]).toBe(S.iconHandle.radius);
    expect(p["icon"]).toBeUndefined();
    expect(p["cursor"]).toBe("grab");
  });
  it("collinear ⇒ grey, stroke-less, smaller, grab", () => {
    const p = baked("handles", { role: "v1", collinear: true });
    expect(p["fill"]).toBe("#8b949e");
    expect(p["strokeWidth"]).toBe(0);
    expect(p["cursor"]).toBe("grab");
  });
  it("move ⇒ glyph + move cursor (smaller dot)", () => {
    const p = baked("handles", { role: "center", move: true });
    expect(p["icon"]).toMatch(/^data:image\/svg/);
    expect(p["cursor"]).toBe("move");
    expect(p["radius"]).toBeLessThan(S.iconHandle.radius);
  });
  it("transform (rot+scale) ⇒ glyph only (radius 0) + move cursor", () => {
    const p = baked("handles", { role: "size", transform: true, iconRotate: 30 });
    expect(p["radius"]).toBe(0);
    expect(p["icon"]).toMatch(/^data:image\/svg/);
    expect(p["cursor"]).toBe("move");
  });
});

describe("decorate — scale/resize directional cursor from iconRotate", () => {
  const cur = (deg: number, extra: Record<string, unknown> = { resize: true }) =>
    baked("handles", { role: "w", iconRotate: deg, ...extra })["cursor"];
  it("0/180° (N–S) ⇒ ns-resize", () => { expect(cur(0)).toBe("ns-resize"); expect(cur(180)).toBe("ns-resize"); });
  it("90° (E–W) ⇒ ew-resize", () => expect(cur(90)).toBe("ew-resize"));
  it("45° (NE–SW) ⇒ nesw-resize", () => expect(cur(45)).toBe("nesw-resize"));
  it("135° (NW–SE) ⇒ nwse-resize", () => expect(cur(135)).toBe("nwse-resize"));
  it("wraps past 180° (270° ≡ 90°) ⇒ ew-resize", () => expect(cur(270)).toBe("ew-resize"));
  it("a control handle WITHOUT an angle ⇒ move (no axis to align to)", () =>
    expect(baked("handles", { role: "radius", control: true })["cursor"]).toBe("move"));
  it("a control handle WITH an angle ⇒ directional", () =>
    expect(baked("handles", { role: "radius", control: true, iconRotate: 0 })["cursor"]).toBe("ns-resize"));
});

describe("decorate — label", () => {
  it("bakes text + colour/halo/size/maxWidth from the style", () => {
    const p = baked("label", { text: "EMBD TS FCST" });
    expect(p["text"]).toBe("EMBD TS FCST");
    expect(p["textColor"]).toBe(S.label.color);
    expect(p["textHalo"]).toBe(S.label.halo);
    expect(p["textSize"]).toBe(S.label.size);
    expect(p["maxWidth"]).toBe(S.label.width);
  });
});

describe("toGenericTooltip", () => {
  it("maps the domain tooltip onto the generic shape", () => {
    const g = toGenericTooltip(S.tooltip);
    expect(g.background).toBe(S.tooltip.background);
    expect(g.color).toBe(S.tooltip.color);
    expect(g.fontSize).toBe(S.tooltip.size);
    expect(typeof g.padding).toBe("string");
    expect(typeof g.maxWidth).toBe("string");
  });
});
