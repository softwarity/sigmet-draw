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

  it("deep-merges a partial area override, keeping siblings", () => {
    const s = mergeStyle(DEFAULT_STYLE, { area: { fill: { color: "#e11d48" } } });
    expect(s.area.fill.color).toBe("#e11d48");
    expect(s.area.fill.opacity).toBe(DEFAULT_STYLE.area.fill.opacity);
    expect(s.area.line).toEqual(DEFAULT_STYLE.area.line);
    expect(s.guide).toEqual(DEFAULT_STYLE.guide);
  });

  it("overrides flat tokens partially", () => {
    const s = mergeStyle(DEFAULT_STYLE, { guide: { width: 9 }, vertex: { color: "#000000" } });
    expect(s.guide.width).toBe(9);
    expect(s.guide.color).toBe(DEFAULT_STYLE.guide.color);
    expect(s.vertex.color).toBe("#000000");
    expect(s.vertex.radius).toBe(DEFAULT_STYLE.vertex.radius);
  });

  it("does not mutate the base style", () => {
    const before = JSON.stringify(DEFAULT_STYLE);
    mergeStyle(DEFAULT_STYLE, { label: { size: 99 }, area: { fill: { opacity: 0.9 } } });
    expect(JSON.stringify(DEFAULT_STYLE)).toBe(before);
  });
});
