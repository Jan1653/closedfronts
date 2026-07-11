import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { GeoBBox } from "../../../core/game/OsmRaster";
import { translateText } from "../../Utils";
import {
  latToTileY,
  lonToTileX,
  TILE_SIZE,
  tilesForViewport,
  tileXToLon,
  tileYToLat,
  viewportBBox,
  wrapTileX,
} from "./SlippyMath";

const OSM_TILE = "https://tile.openstreetmap.org";
const MIN_ZOOM = 2;
const MAX_ZOOM = 16;

/**
 * Interactive OSM slippy map for the map importer: pan (drag) and zoom (+/−) to
 * frame a real place, then the caller converts the *current view* into a game
 * map ("what you see is what you get"). Tiles come straight from the public OSM
 * tile server. Light editor use only (OSM tile usage policy).
 */
@customElement("osm-map-picker")
export class OsmMapPicker extends LitElement {
  @state() private centerLon = 0;
  @state() private centerLat = 20;
  @state() private zoom = 4;
  @state() private viewW = 0;
  @state() private viewH = 0;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private resizeObs?: ResizeObserver;

  createRenderRoot() {
    return this; // light DOM so parent Tailwind applies
  }

  firstUpdated() {
    const el = this.querySelector<HTMLElement>(".osm-map-view");
    if (el) {
      this.resizeObs = new ResizeObserver(() => {
        this.viewW = el.clientWidth;
        this.viewH = el.clientHeight;
      });
      this.resizeObs.observe(el);
      this.viewW = el.clientWidth;
      this.viewH = el.clientHeight;
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.resizeObs?.disconnect();
  }

  /** Center the map on a place (used after a geocode search). */
  setView(lat: number, lon: number, zoom: number): void {
    this.centerLat = lat;
    this.centerLon = lon;
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(zoom)));
  }

  /** Center + zoom so `bbox` fits inside the current view (after a search). */
  fitBBox(bbox: GeoBBox): void {
    this.centerLon = (bbox.minLon + bbox.maxLon) / 2;
    this.centerLat = (bbox.minLat + bbox.maxLat) / 2;
    const w = this.viewW || 320;
    const h = this.viewH || 224;
    let best = MIN_ZOOM;
    for (let z = MAX_ZOOM; z >= MIN_ZOOM; z--) {
      const tw =
        Math.abs(lonToTileX(bbox.maxLon, z) - lonToTileX(bbox.minLon, z)) *
        TILE_SIZE;
      const th =
        Math.abs(latToTileY(bbox.minLat, z) - latToTileY(bbox.maxLat, z)) *
        TILE_SIZE;
      if (tw <= w && th <= h) {
        best = z;
        break;
      }
    }
    this.zoom = best;
  }

  /** Lon/lat bbox of what's currently framed — the area to convert. */
  getViewportBBox(): GeoBBox {
    return viewportBBox(
      this.centerLon,
      this.centerLat,
      this.zoom,
      this.viewW || 1,
      this.viewH || 1,
    );
  }

  private zoomBy(delta: number): void {
    this.zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, this.zoom + delta));
  }

  private onPointerDown = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    e.preventDefault();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastX;
    const dy = e.clientY - this.lastY;
    this.lastX = e.clientX;
    this.lastY = e.clientY;
    // Dragging the map right moves the view left → center longitude decreases.
    const cx = lonToTileX(this.centerLon, this.zoom) - dx / TILE_SIZE;
    const cy = latToTileY(this.centerLat, this.zoom) - dy / TILE_SIZE;
    this.centerLon = tileXToLon(cx, this.zoom);
    this.centerLat = tileYToLat(cy, this.zoom);
  };

  private onPointerUp = (e: PointerEvent) => {
    this.dragging = false;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(e.deltaY < 0 ? 1 : -1);
  };

  private renderTiles(): TemplateResult[] {
    if (this.viewW === 0 || this.viewH === 0) return [];
    const z = this.zoom;
    const { x0, y0, x1, y1, offsetX, offsetY } = tilesForViewport(
      this.centerLon,
      this.centerLat,
      z,
      this.viewW,
      this.viewH,
    );
    const n = Math.pow(2, z);
    const tiles: TemplateResult[] = [];
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= n) continue; // no tiles past the poles
      for (let tx = x0; tx <= x1; tx++) {
        const px = offsetX + (tx - x0) * TILE_SIZE;
        const py = offsetY + (ty - y0) * TILE_SIZE;
        const url = `${OSM_TILE}/${z}/${wrapTileX(tx, z)}/${ty}.png`;
        tiles.push(html`
          <img
            src=${url}
            width=${TILE_SIZE}
            height=${TILE_SIZE}
            draggable="false"
            loading="lazy"
            style="position:absolute; left:${px}px; top:${py}px; pointer-events:none; user-select:none;"
          />
        `);
      }
    }
    return tiles;
  }

  render(): TemplateResult {
    return html`
      <div class="flex flex-col gap-2">
        <div
          class="osm-map-view relative w-full h-56 overflow-hidden rounded-md bg-slate-800 border border-white/10 cursor-grab active:cursor-grabbing touch-none"
          @pointerdown=${this.onPointerDown}
          @pointermove=${this.onPointerMove}
          @pointerup=${this.onPointerUp}
          @pointercancel=${this.onPointerUp}
          @wheel=${this.onWheel}
        >
          ${this.renderTiles()}
          <!-- Selection frame: the whole view is what gets converted. -->
          <div
            class="pointer-events-none absolute inset-2 border-2 border-sky-400/80 rounded"
          ></div>
          <div
            class="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 border-2 border-sky-400/80 rounded-full"
          ></div>
          <div class="absolute right-1 bottom-1 flex flex-col gap-1">
            <button
              class="w-7 h-7 rounded bg-black/60 text-white text-lg leading-none hover:bg-black/80"
              @click=${() => this.zoomBy(1)}
              title="+"
            >
              +
            </button>
            <button
              class="w-7 h-7 rounded bg-black/60 text-white text-lg leading-none hover:bg-black/80"
              @click=${() => this.zoomBy(-1)}
              title="−"
            >
              −
            </button>
          </div>
        </div>
        <p class="text-[10px] text-white/40 leading-tight">
          ${translateText("map_editor.osm_map_hint")}
        </p>
      </div>
    `;
  }
}
