import { html, TemplateResult } from "lit";
import { customElement, query, state } from "lit/decorators.js";
import {
  buildCustomTerrain,
  isLandPaint,
  PaintTile,
} from "../../../core/game/CustomMapBuilder";
import type { GeoBBox } from "../../../core/game/OsmRaster";
import {
  applyCoastlineSea,
  applyElevation,
  denoisePaint,
  gridSizeForBBox,
  rasterizeLinesInto,
  rasterizePolygonsInto,
} from "../../../core/game/OsmRaster";
import { publishCommunityMap } from "../../Api";
import { getAuthHeader } from "../../Auth";
import { translateText } from "../../Utils";
import { BaseModal } from "../BaseModal";
import { modalHeader } from "../ui/ModalHeader";
import {
  blankPaint,
  CUSTOM_MAP_FILE_EXT,
  CustomMap,
  decodePaint,
  decodePaintBase64,
  deleteCustomMap,
  encodePaintBase64,
  listCustomMaps,
  PAINT_TILE_RGB,
  paintTileCss,
  parseCustomMapFile,
  saveCustomMap,
  serializeCustomMap,
} from "./CustomMapStore";
import "./CustomMapThumb";
import { fetchElevationGrid } from "./DemSource";
import "./OsmMapPicker";
import type { OsmMapPicker } from "./OsmMapPicker";
import { fetchOsmAll, geocodePlace } from "./OsmSource";
import { playCustomMapSolo } from "./playCustomMap";

const MIN_SIZE = 40;
const MAX_SIZE = 240;
const DEFAULT_W = 120;
const DEFAULT_H = 80;

// Largest area the OSM import will convert (degrees). Very generous — you can
// grab a whole country. Beyond this the grid is hopelessly coarse (and Overpass
// would time out), so it's refused with a zoom-in hint.
const MAX_IMPORT_LON_SPAN = 16;
const MAX_IMPORT_LAT_SPAN = 12;

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

@customElement("map-editor-modal")
export class MapEditorModal extends BaseModal {
  @state() private gridW = DEFAULT_W;
  @state() private gridH = DEFAULT_H;
  @state() private tool: PaintTile = PaintTile.Plains;
  @state() private brush = 3;
  @state() private bucket = false;
  @state() private name = "";
  @state() private savedMaps: CustomMap[] = [];
  @state() private notice: string | null = null;
  @state() private noticeError = false;
  @state() private osmQuery = "";
  @state() private osmBusy = false;

  // Not @state: painting mutates these directly and blits imperatively so
  // continuous strokes don't thrash Lit's render loop.
  private paint: Uint8Array = blankPaint(DEFAULT_W, DEFAULT_H);
  private editingId: string | null = null;
  private painting = false;
  private imageData: ImageData | null = null;
  private noticeTimer: number | null = null;

  @query("#map-editor-canvas") private canvasEl?: HTMLCanvasElement;
  @query("#map-import-input") private importInput?: HTMLInputElement;
  @query("osm-map-picker") private mapPicker?: OsmMapPicker;

  constructor() {
    super();
    this.id = "page-map-editor";
  }

  protected modalConfig() {
    return { maxWidth: "900px" };
  }

  protected override onOpen(): void {
    this.savedMaps = listCustomMaps();
    // Re-blit once the body is in the DOM.
    this.updateComplete.then(() => this.rebuildImage());
  }

  protected renderHeaderSlot(): TemplateResult {
    return modalHeader({
      title: translateText("map_editor.title"),
      onBack: () => this.close(),
      ariaLabel: translateText("common.back"),
    });
  }

  // ---- Canvas drawing ----

  private rebuildImage() {
    const canvas = this.canvasEl;
    if (!canvas) return;
    canvas.width = this.gridW;
    canvas.height = this.gridH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    this.imageData = ctx.createImageData(this.gridW, this.gridH);
    this.blit();
  }

  private blit() {
    const canvas = this.canvasEl;
    const img = this.imageData;
    if (!canvas || !img) return;
    const data = img.data;
    for (let i = 0; i < this.paint.length; i++) {
      const [r, g, b] =
        PAINT_TILE_RGB[this.paint[i] as PaintTile] ??
        PAINT_TILE_RGB[PaintTile.Water];
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    canvas.getContext("2d")?.putImageData(img, 0, 0);
  }

  // ---- Painting ----

  private tileFromEvent(e: PointerEvent): { x: number; y: number } | null {
    const canvas = this.canvasEl;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * this.gridW);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * this.gridH);
    if (x < 0 || y < 0 || x >= this.gridW || y >= this.gridH) return null;
    return { x, y };
  }

  private paintBrush(cx: number, cy: number) {
    const r = this.brush - 1;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= this.gridW || y >= this.gridH) continue;
        this.paint[y * this.gridW + x] = this.tool;
      }
    }
  }

  private floodFill(sx: number, sy: number) {
    const target = this.paint[sy * this.gridW + sx];
    if (target === this.tool) return;
    const stack: number[] = [sy * this.gridW + sx];
    while (stack.length) {
      const i = stack.pop()!;
      if (this.paint[i] !== target) continue;
      this.paint[i] = this.tool;
      const x = i % this.gridW;
      const y = (i / this.gridW) | 0;
      if (x > 0) stack.push(i - 1);
      if (x < this.gridW - 1) stack.push(i + 1);
      if (y > 0) stack.push(i - this.gridW);
      if (y < this.gridH - 1) stack.push(i + this.gridW);
    }
  }

  private onPointerDown = (e: PointerEvent) => {
    const t = this.tileFromEvent(e);
    if (!t) return;
    e.preventDefault();
    this.canvasEl?.setPointerCapture(e.pointerId);
    this.markDirty();
    if (this.bucket) {
      this.floodFill(t.x, t.y);
    } else {
      this.painting = true;
      this.paintBrush(t.x, t.y);
    }
    this.blit();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.painting) return;
    const t = this.tileFromEvent(e);
    if (!t) return;
    this.paintBrush(t.x, t.y);
    this.blit();
  };

  private onPointerUp = (e: PointerEvent) => {
    this.painting = false;
    try {
      this.canvasEl?.releasePointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  // A stroke invalidates the "saved" state.
  private markDirty() {
    if (this.notice && !this.noticeError) this.notice = null;
  }

  // ---- Toolbar actions ----

  private setSize(w: number, h: number) {
    const nw = clamp(Math.round(w), MIN_SIZE, MAX_SIZE);
    const nh = clamp(Math.round(h), MIN_SIZE, MAX_SIZE);
    if (nw === this.gridW && nh === this.gridH) return;
    const next = blankPaint(nw, nh);
    // Preserve the overlapping top-left region.
    const cw = Math.min(nw, this.gridW);
    const ch = Math.min(nh, this.gridH);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        next[y * nw + x] = this.paint[y * this.gridW + x];
      }
    }
    this.paint = next;
    this.gridW = nw;
    this.gridH = nh;
    this.updateComplete.then(() => this.rebuildImage());
  }

  private clearAll() {
    this.paint = blankPaint(this.gridW, this.gridH);
    this.blit();
  }

  private showNotice(msg: string, isError: boolean) {
    if (this.noticeTimer) window.clearTimeout(this.noticeTimer);
    this.notice = msg;
    this.noticeError = isError;
    this.noticeTimer = window.setTimeout(() => {
      this.notice = null;
      this.noticeTimer = null;
    }, 3000);
  }

  private save() {
    const name = this.name.trim();
    if (!name) {
      this.showNotice(translateText("map_editor.name_required"), true);
      return;
    }
    // Compile once to validate and to reject unplayable (land-less) maps.
    const terrain = buildCustomTerrain(this.paint, this.gridW, this.gridH);
    if (terrain.numLandTiles === 0) {
      this.showNotice(translateText("map_editor.needs_land"), true);
      return;
    }
    const rec = saveCustomMap({
      id: this.editingId ?? undefined,
      name,
      width: this.gridW,
      height: this.gridH,
      paint: this.paint,
    });
    this.editingId = rec.id;
    this.savedMaps = listCustomMaps();
    this.showNotice(translateText("map_editor.saved"), false);
  }

  private playCurrent() {
    let land = 0;
    for (let i = 0; i < this.paint.length; i++) {
      if (isLandPaint(this.paint[i])) land++;
    }
    if (land === 0) {
      this.showNotice(translateText("map_editor.needs_land"), true);
      return;
    }
    void playCustomMapSolo({
      name: this.name.trim() || "Custom",
      width: this.gridW,
      height: this.gridH,
      // Re-encode the live grid so an unsaved drawing is playable too.
      paint: encodePaintBase64(this.paint),
    });
    this.close();
  }

  private playSaved(m: CustomMap) {
    void playCustomMapSolo({
      name: m.name,
      width: m.width,
      height: m.height,
      paint: m.paint,
    });
    this.close();
  }

  private loadMap(m: CustomMap) {
    this.editingId = m.id;
    this.name = m.name;
    this.gridW = m.width;
    this.gridH = m.height;
    this.paint = decodePaint(m);
    this.updateComplete.then(() => this.rebuildImage());
  }

  private removeMap(m: CustomMap) {
    deleteCustomMap(m.id);
    if (this.editingId === m.id) this.editingId = null;
    this.savedMaps = listCustomMaps();
  }

  // ---- Share as a file (.cfmap) ----

  private exportMap(m: CustomMap) {
    const blob = new Blob([serializeCustomMap(m)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const safe = m.name.replace(/[^\w.-]+/g, "_") || "map";
    a.download = `${safe}.${CUSTOM_MAP_FILE_EXT}`;
    a.click();
    URL.revokeObjectURL(url);
    this.showNotice(translateText("map_editor.exported"), false);
  }

  private triggerImport() {
    this.importInput?.click();
  }

  private async onImportFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // let the same file be re-imported later
    if (!file) return;
    try {
      const parsed = parseCustomMapFile(await file.text());
      const rec = saveCustomMap({
        name: parsed.name,
        width: parsed.width,
        height: parsed.height,
        paint: decodePaintBase64(parsed.paint),
      });
      this.savedMaps = listCustomMaps();
      this.loadMap(rec);
      this.showNotice(translateText("map_editor.imported"), false);
    } catch {
      this.showNotice(translateText("map_editor.import_failed"), true);
    }
  }

  // ---- Publish to the community (localapi) ----

  private async publishMap(m: CustomMap) {
    if ((await getAuthHeader()) === "") {
      this.showNotice(translateText("map_editor.publish_login"), true);
      return;
    }
    const rec = await publishCommunityMap({
      name: m.name,
      width: m.width,
      height: m.height,
      paint: m.paint,
    });
    this.showNotice(
      translateText(rec ? "map_editor.published" : "map_editor.publish_failed"),
      !rec,
    );
  }

  // ---- Import from a real map (OSM, Phase A: land + inland water) ----

  // Search box → move the map to the place (no import yet; the user frames it
  // on the map and then hits Convert).
  private async searchPlace() {
    const query = this.osmQuery.trim();
    if (!query) {
      this.showNotice(translateText("map_editor.osm_enter_place"), true);
      return;
    }
    this.osmBusy = true;
    try {
      const found = await geocodePlace(query);
      if (!found) {
        this.showNotice(translateText("map_editor.osm_not_found"), true);
        return;
      }
      await this.updateComplete;
      this.mapPicker?.fitBBox(found);
    } catch (e) {
      console.error("Geocode failed", e);
      this.showNotice(translateText("map_editor.osm_failed"), true);
    } finally {
      this.osmBusy = false;
    }
  }

  // Convert exactly what the map frames into a game map ("what you see is what
  // you get"). Refuse an over-wide view: at continental scale the grid is far too
  // coarse and coastlines get gaps the sea-fill leaks through — ask to zoom in.
  private async convertCurrentView() {
    const bbox = this.mapPicker?.getViewportBBox();
    if (!bbox) return;
    if (
      bbox.maxLon - bbox.minLon > MAX_IMPORT_LON_SPAN ||
      bbox.maxLat - bbox.minLat > MAX_IMPORT_LAT_SPAN
    ) {
      this.showNotice(translateText("map_editor.osm_zoom_in"), true);
      return;
    }
    this.osmBusy = true;
    try {
      await this.runOsmImport(bbox);
    } catch (e) {
      console.error("OSM import failed", e);
      this.showNotice(translateText("map_editor.osm_failed"), true);
    } finally {
      this.osmBusy = false;
    }
  }

  // Fetch + rasterise the OSM layers for the framed bbox into the editor grid.
  private async runOsmImport(bbox: GeoBBox) {
    const { width, height } = gridSizeForBBox(bbox, MAX_SIZE);
    // Real elevation (open DEM tiles) + the OSM layers (one Overpass request —
    // the public endpoint rate-limits, so we must not fire a query per layer).
    const [dem, layers] = await Promise.all([
      fetchElevationGrid(bbox, width, height),
      fetchOsmAll(bbox),
    ]);
    const paint = new Uint8Array(width * height).fill(PaintTile.Plains);
    if (dem) {
      // Genuine height variation from the terrain: Plains→Highland→Mountain by
      // locally-normalised elevation (+ Peak on real alpine ground).
      applyElevation(paint, dem);
    } else {
      // No DEM available → fall back to land-cover as a rough height proxy
      // (forest → Highland, bare rock/glacier → Mountain).
      rasterizePolygonsInto(
        paint,
        bbox,
        width,
        height,
        layers.terrain.forest,
        PaintTile.Highland,
      );
      rasterizePolygonsInto(
        paint,
        bbox,
        width,
        height,
        layers.terrain.rock,
        PaintTile.Mountain,
      );
    }
    // Beaches / dunes → tan sand (before water, so the shore reads as a sandy
    // strip between land and sea).
    rasterizePolygonsInto(
      paint,
      bbox,
      width,
      height,
      layers.sand,
      PaintTile.Highland,
    );
    // OSM water areas (lakes, wide rivers) cut out; the editor still flood-fills
    // ocean/shoreline at compile time.
    rasterizePolygonsInto(
      paint,
      bbox,
      width,
      height,
      layers.water,
      PaintTile.Water,
    );
    // Coastline → sea (guarded: leaves the map as land if the coast doesn't
    // cleanly separate the area, so a coastal bbox never floods to all-water). On
    // a coarser (larger-area) grid, use a thicker coast barrier so gaps between
    // coastline ways don't let the fill leak inland.
    const lonSpan = bbox.maxLon - bbox.minLon;
    // Thicken only slightly on large (coarse) grids — a too-thick barrier seals
    // off narrow straits/bays (e.g. Gibraltar) and leaves no sea to fill.
    const coastBarrier = lonSpan > 2 ? 1 : 0;
    applyCoastlineSea(
      paint,
      bbox,
      width,
      height,
      layers.coastlines,
      PaintTile.Water,
      coastBarrier,
    );
    // Clean speckles into solid areas before drawing thin rivers on top.
    const clean = denoisePaint(paint, width, height);
    // Waterway centre-lines (rivers/streams) as continuous 1-cell strokes — thin
    // so they read as rivers, not fat bands (wide rivers already come through as
    // riverbank water areas).
    rasterizeLinesInto(
      clean,
      bbox,
      width,
      height,
      layers.waterways,
      PaintTile.Water,
      0,
    );
    this.editingId = null;
    this.name = this.osmQuery.trim().slice(0, 40) || this.name;
    this.gridW = width;
    this.gridH = height;
    this.paint = clean;
    await this.updateComplete;
    this.rebuildImage();
    this.showNotice(translateText("map_editor.osm_done"), false);
  }

  private newMap() {
    this.editingId = null;
    this.name = "";
    this.paint = blankPaint(this.gridW, this.gridH);
    this.blit();
  }

  // ---- Render ----

  protected renderBody(): TemplateResult {
    return html`
      <div class="custom-scrollbar p-4 lg:p-6 flex flex-col gap-4 text-white">
        <div class="flex flex-col lg:flex-row gap-4">
          <!-- Canvas -->
          <div class="flex-1 min-w-0">
            <div
              class="rounded-lg overflow-hidden bg-black/40 border border-white/10"
            >
              <canvas
                id="map-editor-canvas"
                class="block w-full h-auto"
                style="image-rendering: pixelated; touch-action: none; aspect-ratio: ${this
                  .gridW} / ${this.gridH};"
                @pointerdown=${this.onPointerDown}
                @pointermove=${this.onPointerMove}
                @pointerup=${this.onPointerUp}
                @pointercancel=${this.onPointerUp}
              ></canvas>
            </div>
            <p class="mt-2 text-xs text-white/50">
              ${translateText("map_editor.canvas_hint")}
            </p>
          </div>

          <!-- Controls -->
          <div class="w-full lg:w-64 shrink-0 flex flex-col gap-4">
            ${this.renderPalette()} ${this.renderBrushControls()}
            ${this.renderSizeControls()} ${this.renderOsmImport()}
            ${this.renderNameAndSave()}
          </div>
        </div>

        ${this.renderSavedMaps()}
      </div>
    `;
  }

  private renderPalette(): TemplateResult {
    // Ordered low → high elevation so the palette reads like a terrain legend.
    const tools: Array<{ t: PaintTile; label: string }> = [
      { t: PaintTile.Water, label: translateText("map_editor.tool_water") },
      {
        t: PaintTile.DeepWater,
        label: translateText("map_editor.tool_deep_water"),
      },
      { t: PaintTile.Plains, label: translateText("map_editor.tool_plains") },
      {
        t: PaintTile.Highland,
        label: translateText("map_editor.tool_highland"),
      },
      {
        t: PaintTile.Mountain,
        label: translateText("map_editor.tool_mountain"),
      },
      { t: PaintTile.Peak, label: translateText("map_editor.tool_peak") },
    ];
    return html`
      <div class="grid grid-cols-3 gap-2">
        ${tools.map(
          ({ t, label }) => html`
            <button
              @click=${() => (this.tool = t)}
              class="flex flex-col items-center gap-1 rounded-lg p-2 border transition-colors ${this
                .tool === t
                ? "border-malibu-blue bg-white/10"
                : "border-white/10 bg-white/5 hover:bg-white/10"}"
            >
              <span
                class="w-6 h-6 rounded border border-black/20"
                style="background:${paintTileCss(t)}"
              ></span>
              <span class="text-xs">${label}</span>
            </button>
          `,
        )}
      </div>
    `;
  }

  private renderBrushControls(): TemplateResult {
    return html`
      <div class="flex flex-col gap-2">
        <label class="text-xs text-white/70 flex justify-between">
          <span>${translateText("map_editor.brush_size")}</span>
          <span>${this.brush}</span>
        </label>
        <input
          type="range"
          min="1"
          max="12"
          .value=${String(this.brush)}
          @input=${(e: Event) =>
            (this.brush = Number((e.target as HTMLInputElement).value))}
          class="w-full accent-malibu-blue"
        />
        <div class="grid grid-cols-2 gap-2">
          <button
            @click=${() => (this.bucket = !this.bucket)}
            class="rounded-lg px-3 py-2 text-sm border transition-colors ${this
              .bucket
              ? "border-malibu-blue bg-white/10"
              : "border-white/10 bg-white/5 hover:bg-white/10"}"
          >
            ${translateText("map_editor.fill")}
          </button>
          <button
            @click=${() => this.clearAll()}
            class="rounded-lg px-3 py-2 text-sm border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
          >
            ${translateText("map_editor.clear")}
          </button>
        </div>
      </div>
    `;
  }

  private renderSizeControls(): TemplateResult {
    const sizeInput = (
      value: number,
      onChange: (v: number) => void,
      label: string,
    ) => html`
      <label class="flex-1 flex flex-col gap-1 text-xs text-white/70">
        <span>${label}</span>
        <input
          type="number"
          min=${MIN_SIZE}
          max=${MAX_SIZE}
          .value=${String(value)}
          @change=${(e: Event) =>
            onChange(Number((e.target as HTMLInputElement).value))}
          class="w-full rounded-md bg-black/40 border border-white/10 px-2 py-1 text-white text-sm"
        />
      </label>
    `;
    return html`
      <div class="flex gap-2">
        ${sizeInput(
          this.gridW,
          (v) => this.setSize(v, this.gridH),
          translateText("map_editor.width"),
        )}
        ${sizeInput(
          this.gridH,
          (v) => this.setSize(this.gridW, v),
          translateText("map_editor.height"),
        )}
      </div>
    `;
  }

  private renderOsmImport(): TemplateResult {
    return html`
      <div class="flex flex-col gap-2 rounded-lg border border-white/10 p-2">
        <label class="text-xs text-white/70">
          ${translateText("map_editor.osm_title")}
        </label>
        <div class="flex gap-2">
          <input
            type="text"
            .value=${this.osmQuery}
            @input=${(e: Event) =>
              (this.osmQuery = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" && !this.osmBusy) void this.searchPlace();
            }}
            placeholder=${translateText("map_editor.osm_placeholder")}
            maxlength="80"
            ?disabled=${this.osmBusy}
            class="flex-1 min-w-0 rounded-md bg-black/40 border border-white/10 px-3 py-2 text-white text-sm"
          />
          <button
            @click=${() => this.searchPlace()}
            ?disabled=${this.osmBusy}
            title=${translateText("map_editor.osm_search")}
            class="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold bg-white/10 hover:bg-white/20 transition-colors disabled:opacity-50"
          >
            ${translateText("map_editor.osm_search")}
          </button>
        </div>
        <osm-map-picker></osm-map-picker>
        <button
          @click=${() => this.convertCurrentView()}
          ?disabled=${this.osmBusy}
          class="rounded-lg px-3 py-2 text-sm font-semibold bg-malibu-blue hover:bg-aquarius transition-colors disabled:opacity-50"
        >
          ${this.osmBusy
            ? translateText("map_editor.osm_loading")
            : translateText("map_editor.osm_convert")}
        </button>
        <p class="text-[10px] text-white/40 leading-tight">
          ${translateText("map_editor.osm_attribution")}
        </p>
      </div>
    `;
  }

  private renderNameAndSave(): TemplateResult {
    return html`
      <div class="flex flex-col gap-2">
        <input
          type="text"
          .value=${this.name}
          @input=${(e: Event) =>
            (this.name = (e.target as HTMLInputElement).value)}
          placeholder=${translateText("map_editor.name_placeholder")}
          maxlength="40"
          class="w-full rounded-md bg-black/40 border border-white/10 px-3 py-2 text-white text-sm"
        />
        <div class="grid grid-cols-2 gap-2">
          <button
            @click=${() => this.newMap()}
            class="rounded-lg px-3 py-2 text-sm border border-white/10 bg-white/5 hover:bg-white/10 transition-colors"
          >
            ${translateText("map_editor.new")}
          </button>
          <button
            @click=${() => this.save()}
            class="rounded-lg px-3 py-2 text-sm font-semibold bg-malibu-blue hover:bg-aquarius transition-colors"
          >
            ${translateText("map_editor.save")}
          </button>
        </div>
        <button
          @click=${() => this.playCurrent()}
          class="w-full rounded-lg px-3 py-2 text-sm font-semibold bg-green-600 hover:bg-green-500 transition-colors"
        >
          ${translateText("map_editor.play")}
        </button>
        ${this.notice
          ? html`<p
              class="text-xs ${this.noticeError
                ? "text-red-400"
                : "text-green-400"}"
            >
              ${this.notice}
            </p>`
          : null}
      </div>
    `;
  }

  private renderSavedMaps(): TemplateResult {
    return html`
      <div class="flex flex-col gap-2">
        <div class="flex items-center justify-between gap-2">
          <h3 class="text-sm font-bold uppercase tracking-wider text-white/70">
            ${translateText("map_editor.your_maps")}
          </h3>
          <button
            @click=${() => this.triggerImport()}
            class="text-xs rounded px-2 py-1 bg-white/10 hover:bg-white/20"
          >
            ${translateText("map_editor.import")}
          </button>
          <input
            id="map-import-input"
            type="file"
            accept=".${CUSTOM_MAP_FILE_EXT},application/json"
            class="hidden"
            @change=${(e: Event) => this.onImportFile(e)}
          />
        </div>
        ${this.savedMaps.length === 0
          ? html`<p class="text-xs text-white/40">
              ${translateText("map_editor.empty")}
            </p>`
          : html`<div class="flex flex-col gap-1">
              ${this.savedMaps.map(
                (m) => html`
                  <div
                    class="flex flex-wrap items-center gap-2 rounded-md bg-white/5 px-3 py-2 ${this
                      .editingId === m.id
                      ? "ring-1 ring-malibu-blue"
                      : ""}"
                  >
                    <div
                      class="w-12 h-8 shrink-0 overflow-hidden rounded bg-black/30"
                    >
                      <custom-map-thumb .map=${m}></custom-map-thumb>
                    </div>
                    <span class="flex-1 min-w-0 truncate text-sm">
                      ${m.name}
                    </span>
                    <span class="text-xs text-white/40 hidden sm:inline"
                      >${m.width}×${m.height}</span
                    >
                    <button
                      @click=${() => this.playSaved(m)}
                      class="text-xs rounded px-2 py-1 bg-green-600 hover:bg-green-500 font-semibold"
                    >
                      ${translateText("map_editor.play")}
                    </button>
                    <button
                      @click=${() => this.loadMap(m)}
                      class="text-xs rounded px-2 py-1 bg-white/10 hover:bg-white/20"
                    >
                      ${translateText("map_editor.load")}
                    </button>
                    <button
                      @click=${() => this.exportMap(m)}
                      class="text-xs rounded px-2 py-1 bg-white/10 hover:bg-white/20"
                    >
                      ${translateText("map_editor.export")}
                    </button>
                    <button
                      @click=${() => this.publishMap(m)}
                      class="text-xs rounded px-2 py-1 bg-malibu-blue/80 hover:bg-malibu-blue font-semibold"
                    >
                      ${translateText("map_editor.publish")}
                    </button>
                    <button
                      @click=${() => this.removeMap(m)}
                      class="text-xs rounded px-2 py-1 bg-red-500/20 hover:bg-red-500/40 text-red-200"
                    >
                      ${translateText("map_editor.delete")}
                    </button>
                  </div>
                `,
              )}
            </div>`}
      </div>
    `;
  }
}
