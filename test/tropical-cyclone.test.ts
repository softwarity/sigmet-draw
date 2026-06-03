import { describe, expect, it } from "vitest";

import { fromTAC, toTAC } from "../src/core/index";
import type { TropicalCycloneGeometry } from "../src/core/index";

describe("tropical cyclone (WI … OF TC CENTRE)", () => {
  it("serialises without a coordinate", () => {
    const g: TropicalCycloneGeometry = {
      kind: "tropicalCyclone",
      center: { lat: 12, lon: 130 },
      radius: 250,
      unit: "NM",
    };
    expect(toTAC(g)).toBe("WI 250NM OF TC CENTRE");
  });

  it("parses to a tropicalCyclone with a placeholder centre", () => {
    const g = fromTAC("WI 300KM OF TC CENTRE");
    expect(g.kind).toBe("tropicalCyclone");
    expect(g).toMatchObject({ radius: 300, unit: "KM" });
  });

  it("round-trips the radius/unit (centre is not carried by the TAC)", () => {
    const tac = "WI 999NM OF TC CENTRE";
    expect(toTAC(fromTAC(tac))).toBe(tac);
  });

  it("a plain circle still parses with its PSN coordinate", () => {
    expect(fromTAC("WI 50NM OF PSN N2706 W07306").kind).toBe("circle");
  });
});
