import { describe, expect, it } from "vitest";

import { DEFAULT_STYLE, mergeStyle, rgba } from "../src/map/style";

describe("rgba", () => {
  it("converts #rrggbb + opacity", () => {
    expect(rgba("#58a6ff", 0.35)).toBe("rgba(88, 166, 255, 0.35)");
  });

  it("expands #rgb shorthand", () => {
    expect(rgba("#f0a", 0.5)).toBe("rgba(255, 0, 170, 0.5)");
  });

  it("passes non-hex colours through unchanged (never emits NaN)", () => {
    expect(rgba("red", 0.5)).toBe("red");
    expect(rgba("rgb(1, 2, 3)", 0.5)).toBe("rgb(1, 2, 3)");
    expect(rgba("#1234", 0.5)).toBe("#1234"); // not a 3/6-digit hex
  });
});

describe("mergeStyle", () => {
  it("returns the base unchanged when no override is given", () => {
    expect(mergeStyle(DEFAULT_STYLE)).toEqual(DEFAULT_STYLE);
  });

  it("merges a partial area override, keeping siblings", () => {
    const s = mergeStyle(DEFAULT_STYLE, { area: { fill: "#e11d48" } });
    expect(s.area.fill).toBe("#e11d48");
    expect(s.area.opacity).toBe(DEFAULT_STYLE.area.opacity);
    expect(s.area.stroke).toBe(DEFAULT_STYLE.area.stroke);
    expect(s.lineHandle).toEqual(DEFAULT_STYLE.lineHandle);
  });

  it("overrides flat tokens partially", () => {
    const s = mergeStyle(DEFAULT_STYLE, {
      lineHandle: { width: 9 },
      iconHandle: { fill: "#000000" },
    });
    expect(s.lineHandle.width).toBe(9);
    expect(s.lineHandle.stroke).toBe(DEFAULT_STYLE.lineHandle.stroke);
    expect(s.iconHandle.fill).toBe("#000000");
    expect(s.iconHandle.radius).toBe(DEFAULT_STYLE.iconHandle.radius);
  });

  it("does not mutate the base style", () => {
    const before = JSON.stringify(DEFAULT_STYLE);
    mergeStyle(DEFAULT_STYLE, { label: { size: 99 }, area: { opacity: 0.9 } });
    expect(JSON.stringify(DEFAULT_STYLE)).toBe(before);
  });

  it("merges a partial tooltip override, keeping siblings", () => {
    const s = mergeStyle(DEFAULT_STYLE, { tooltip: { size: 20 } });
    expect(s.tooltip.size).toBe(20);
    expect(s.tooltip.background).toBe(DEFAULT_STYLE.tooltip.background);
    expect(s.tooltip.color).toBe(DEFAULT_STYLE.tooltip.color);
  });

  it("keeps the default tooltip when no override is given", () => {
    expect(mergeStyle(DEFAULT_STYLE).tooltip).toEqual(DEFAULT_STYLE.tooltip);
  });
});
