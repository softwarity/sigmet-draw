/**
 * Turnkey toolbar configured via `new SigmetDraw({ toolbar })` and tweaked live
 * through `sigmet.toolbar`. The buttons live in the host engine's native control
 * group (set up by the adapter); this controller wires them to the draw instance
 * and exposes live-mutable placement + the tropical-cyclone centre.
 */
import type { LatLng } from "../core/index.js";
import type {
  MapAdapter,
  ToolbarItem,
  ToolbarOptions,
  ToolbarPadding,
  ToolbarPosition,
} from "./adapter.js";
import { applyToolbarLayout } from "./toolbar.js";
import { DEFAULT_TOOLS, TOOL_ICONS } from "./tools.js";
import type { ToolName } from "./tools.js";

/** The `SigmetDraw` methods a toolbar drives (a structural view, avoids a cycle). */
export interface ToolbarHost {
  circle(): void;
  tropicalCyclone(center: LatLng): void;
  meridian(): void;
  parallel(): void;
  latBand(): void;
  lonBand(): void;
  quadrant(): void;
  lineSide(): void;
  corridor(): void;
  wideLine(): void;
  polygon(): void;
  point(): void;
  entireFir(): void;
  clear(): void;
}

export interface ToolbarConfig extends ToolbarOptions {
  /** Which tools to show, in order (default: all). Config-time only. */
  tools?: ToolName[];
  /** Include the clear button (default: true). Config-time only. */
  clear?: boolean;
  /**
   * Centre for the tropical-cyclone tool (the real TC position). The TC button is
   * **disabled** until this is set; clearing it (`null`) greys it out again.
   */
  tcCenter?: LatLng | null;
}

/** Assign or delete an optional key (keeps `exactOptionalPropertyTypes` happy). */
function setOpt<K extends keyof ToolbarOptions>(
  o: ToolbarOptions,
  k: K,
  v: ToolbarOptions[K] | undefined,
): void {
  if (v === undefined) delete o[k];
  else o[k] = v;
}

export class SigmetToolbar {
  private el?: HTMLElement;
  private readonly tools: ToolName[];
  private readonly clearBtn: boolean;
  private readonly layout: ToolbarOptions = {};
  private _tcCenter: LatLng | null;

  constructor(
    private readonly host: ToolbarHost,
    private readonly adapter: MapAdapter,
    cfg: ToolbarConfig,
  ) {
    this.tools = cfg.tools ?? DEFAULT_TOOLS.map((t) => t.method);
    this.clearBtn = cfg.clear !== false;
    this._tcCenter = cfg.tcCenter ?? null;
    setOpt(this.layout, "position", cfg.position);
    setOpt(this.layout, "orientation", cfg.orientation);
    setOpt(this.layout, "padding", cfg.padding);
    setOpt(this.layout, "gap", cfg.gap);
    setOpt(this.layout, "className", cfg.className);
  }

  /** @internal — rendered by `SigmetDraw` once the adapter is ready. */
  attach(): void {
    if (this.el) return;
    this.el = this.adapter.addToolbar(this.buildItems(), this.layout);
    this.syncTc();
  }

  private buildItems(): ToolbarItem[] {
    const items: ToolbarItem[] = [];
    for (const method of this.tools) {
      const spec = DEFAULT_TOOLS.find((t) => t.method === method);
      if (!spec) continue;
      items.push({
        id: method,
        title: spec.title,
        label: spec.label,
        svg: TOOL_ICONS[method],
        toggle: true,
        onClick:
          method === "tropicalCyclone"
            ? () => {
                if (this._tcCenter) this.host.tropicalCyclone(this._tcCenter);
              }
            : () => {
                (this.host[method] as () => void)();
              },
      });
    }
    if (this.clearBtn) {
      items.push({
        id: "clear",
        title: "Clear",
        label: "⌫",
        svg: TOOL_ICONS.clear,
        onClick: () => this.host.clear(),
      });
    }
    return items;
  }

  /** Show or hide the whole toolbar (used by `SigmetDraw`'s disabled mode). */
  setVisible(visible: boolean): void {
    if (!this.el) return;
    // Re-apply the layout on show: it restores `display:flex` + placement, which
    // a plain `display:none`/`""` toggle would drop (losing the bar's position).
    if (visible) applyToolbarLayout(this.el, this.layout);
    else this.el.style.display = "none";
  }

  /** Enable/disable (grey out) the tropical-cyclone button. */
  private syncTc(): void {
    const b = this.el?.querySelector<HTMLButtonElement>('button[data-tool="tropicalCyclone"]');
    if (b) b.disabled = this._tcCenter == null;
  }

  private reapply(): void {
    if (this.el) applyToolbarLayout(this.el, this.layout);
  }

  /** The tropical-cyclone centre; `null` greys out the TC button. */
  get tcCenter(): LatLng | null {
    return this._tcCenter;
  }
  set tcCenter(v: LatLng | null | undefined) {
    this._tcCenter = v ?? null;
    this.syncTc();
  }

  get position(): ToolbarPosition | undefined {
    return this.layout.position;
  }
  set position(v: ToolbarPosition | undefined) {
    setOpt(this.layout, "position", v);
    this.reapply();
  }

  get orientation(): "horizontal" | "vertical" | undefined {
    return this.layout.orientation;
  }
  set orientation(v: "horizontal" | "vertical" | undefined) {
    setOpt(this.layout, "orientation", v);
    this.reapply();
  }

  get padding(): ToolbarPadding | undefined {
    return this.layout.padding;
  }
  set padding(v: ToolbarPadding | undefined) {
    setOpt(this.layout, "padding", v);
    this.reapply();
  }

  get gap(): string | undefined {
    return this.layout.gap;
  }
  set gap(v: string | undefined) {
    setOpt(this.layout, "gap", v);
    this.reapply();
  }
}
