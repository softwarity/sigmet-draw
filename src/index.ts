/**
 * @softwarity/sigmet-draw
 *
 * Two ways to consume:
 *  1. Headless (à la Terra Draw) — bring your own map, graft the drawing on it:
 *       const sigmet = new SigmetDraw({ adapter: new MapLibreAdapter({ map }), fir });
 *       sigmet.on("change", ({ tac }) => …); circleBtn.onclick = () => sigmet.circle();
 *  2. Web component `<sigmet-draw>` — batteries-included wrapper that creates a map.
 *
 * The pure logic (12 templates, TAC ↔ params, area) lives in `./core` and has no
 * map dependency.
 */
export * from "./core/index.js";

export { SigmetDraw } from "./map/sigmet-draw.js";
export type { SigmetDrawOptions, SigmetResult, LabelFn } from "./map/sigmet-draw.js";

export { DEFAULT_TOOLS, TOOL_ICONS } from "./map/tools.js";
export type { ToolName, ToolSpec } from "./map/tools.js";

export { SigmetToolbar } from "./map/toolbar-controller.js";
export type { ToolbarConfig } from "./map/toolbar-controller.js";

export { DEFAULT_STYLE, mergeStyle, rgba } from "./map/style.js";
export type {
  SigmetStyle,
  SigmetStyleInput,
  AreaStyle,
  IconHandleStyle,
  LineHandleStyle,
  LabelStyle,
  TooltipStyle,
} from "./map/style.js";

export type {
  MapAdapter,
  OverlayId,
  PointerEvent,
  Projection,
  ToolbarItem,
  ToolbarOptions,
  ToolbarPadding,
  ToolbarPosition,
} from "./map/adapter.js";

export { MapLibreAdapter, createMapLibreMap } from "./map/maplibre-adapter.js";
export { OpenLayersAdapter, createOpenLayersMap } from "./map/openlayers-adapter.js";
