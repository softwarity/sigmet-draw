// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";

import { applyToolbarLayout, populateToolbar } from "@softwarity/draw-adapter";
import type { MapAdapter, ToolbarItem, ToolbarOptions } from "../src/map/adapter";
import { SigmetToolbar } from "../src/map/toolbar-controller";
import type { ToolbarHost } from "../src/map/toolbar-controller";

describe("applyToolbarLayout — 12 positions", () => {
  const layout = (position: ToolbarOptions["position"]): CSSStyleDeclaration => {
    const el = document.createElement("div");
    applyToolbarLayout(el, { position });
    return el.style;
  };

  it("top: centred row, anchored to the top edge", () => {
    const s = layout("top");
    expect(s.top).toBe("10px");
    expect(s.left).toBe("50%");
    expect(s.transform).toBe("translateX(-50%)");
    expect(s.flexDirection).toBe("row");
  });

  it("top-left / top-right: cornered rows", () => {
    expect(layout("top-left").left).toBe("10px");
    expect(layout("top-left").transform).toBe("none");
    expect(layout("top-right").right).toBe("10px");
  });

  it("bottom: centred row anchored to the bottom edge", () => {
    const s = layout("bottom");
    expect(s.bottom).toBe("10px");
    expect(s.left).toBe("50%");
    expect(s.transform).toBe("translateX(-50%)");
  });

  it("left / right: centred vertical columns", () => {
    const l = layout("left");
    expect(l.left).toBe("10px");
    expect(l.top).toBe("50%");
    expect(l.transform).toBe("translateY(-50%)");
    expect(l.flexDirection).toBe("column");
    const r = layout("right");
    expect(r.right).toBe("10px");
    expect(r.top).toBe("50%");
    expect(r.flexDirection).toBe("column");
  });

  it("left-top / left-bottom / right-top / right-bottom: cornered columns", () => {
    expect(layout("left-top").top).toBe("10px");
    expect(layout("left-top").left).toBe("10px");
    expect(layout("left-bottom").bottom).toBe("10px");
    expect(layout("right-top").top).toBe("10px");
    expect(layout("right-bottom").right).toBe("10px");
    expect(layout("right-bottom").bottom).toBe("10px");
  });

  it("clears every stale inset when switching positions", () => {
    const el = document.createElement("div");
    applyToolbarLayout(el, { position: "bottom-right" });
    applyToolbarLayout(el, { position: "top-left" });
    expect(el.style.bottom).toBe("auto");
    expect(el.style.right).toBe("auto");
    expect(el.style.top).toBe("10px");
    expect(el.style.left).toBe("10px");
  });

  it("honours a per-side padding object", () => {
    const el = document.createElement("div");
    applyToolbarLayout(el, { position: "top-left", padding: { top: "4px", left: "20px" } });
    expect(el.style.top).toBe("4px");
    expect(el.style.left).toBe("20px");
  });

  it("orientation override beats the edge default", () => {
    const el = document.createElement("div");
    applyToolbarLayout(el, { position: "top", orientation: "vertical" });
    expect(el.style.flexDirection).toBe("column");
  });
});

describe("SigmetToolbar controller", () => {
  let host: ToolbarHost & Record<string, ReturnType<typeof vi.fn>>;
  let lastItems: ToolbarItem[];
  let lastOptions: ToolbarOptions | undefined;

  const makeAdapter = (): MapAdapter =>
    ({
      addToolbar(items: ToolbarItem[], options?: ToolbarOptions): HTMLElement {
        lastItems = items;
        lastOptions = options;
        const el = document.createElement("div");
        populateToolbar(el, items, options);
        document.body.appendChild(el);
        return el;
      },
    }) as unknown as MapAdapter;

  beforeEach(() => {
    document.body.innerHTML = "";
    const methods = [
      "circle", "tropicalCyclone", "meridian", "parallel", "latBand", "lonBand",
      "quadrant", "lineSide", "corridor", "wideLine", "polygon", "point",
      "entireFir", "clear",
    ];
    host = Object.fromEntries(methods.map((m) => [m, vi.fn()])) as never;
  });

  it("builds items in the requested order, plus a clear button", () => {
    const tb = new SigmetToolbar(host, makeAdapter(), { tools: ["circle", "polygon"] });
    tb.attach();
    expect(lastItems.map((i) => i.id)).toEqual(["circle", "polygon", "clear"]);
  });

  it("omits the clear button when clear:false", () => {
    const tb = new SigmetToolbar(host, makeAdapter(), { tools: ["circle"], clear: false });
    tb.attach();
    expect(lastItems.map((i) => i.id)).toEqual(["circle"]);
  });

  it("forwards the snapshot preset to the adapter's toolbar options", () => {
    new SigmetToolbar(host, makeAdapter(), { snapshot: "high" }).attach();
    expect(lastOptions?.snapshot).toBe("high");
    // …and omits it when unset (lib default `native` applies).
    new SigmetToolbar(host, makeAdapter(), {}).attach();
    expect(lastOptions?.snapshot).toBeUndefined();
  });

  it("greys out the TC button until tcCenter is set, then enables it", () => {
    const tb = new SigmetToolbar(host, makeAdapter(), {});
    tb.attach();
    const btn = document.querySelector<HTMLButtonElement>('button[data-tool="tropicalCyclone"]')!;
    expect(btn.disabled).toBe(true);
    tb.tcCenter = { lat: 14.6, lon: 120.9 };
    expect(btn.disabled).toBe(false);
    tb.tcCenter = null;
    expect(btn.disabled).toBe(true);
  });

  it("TC click is a no-op until a centre is set, then calls the host with it", () => {
    const tb = new SigmetToolbar(host, makeAdapter(), {});
    tb.attach();
    const btn = document.querySelector<HTMLButtonElement>('button[data-tool="tropicalCyclone"]')!;
    btn.click();
    expect(host["tropicalCyclone"]).not.toHaveBeenCalled();
    tb.tcCenter = { lat: 14.6, lon: 120.9 };
    btn.click();
    expect(host["tropicalCyclone"]).toHaveBeenCalledWith({ lat: 14.6, lon: 120.9 });
  });

  it("a regular tool button calls its host method", () => {
    const tb = new SigmetToolbar(host, makeAdapter(), { tools: ["polygon"] });
    tb.attach();
    document.querySelector<HTMLButtonElement>('button[data-tool="polygon"]')!.click();
    expect(host["polygon"]).toHaveBeenCalledOnce();
  });

  it("live position setter re-applies the layout", () => {
    const tb = new SigmetToolbar(host, makeAdapter(), { position: "top" });
    tb.attach();
    const el = document.querySelector<HTMLElement>(".sigmet-toolbar")!;
    expect(el.style.top).toBe("10px");
    tb.position = "bottom-right";
    expect(el.style.bottom).toBe("10px");
    expect(el.style.right).toBe("10px");
    expect(el.style.top).toBe("auto");
  });
});
