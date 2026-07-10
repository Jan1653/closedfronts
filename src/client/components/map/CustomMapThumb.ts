import { html, LitElement, TemplateResult } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import { PaintTile } from "../../../core/game/CustomMapBuilder";
import { CustomMap, decodePaint } from "./CustomMapStore";

// Same palette the editor paints with, so a thumbnail matches the canvas.
const TILE_RGB: Record<PaintTile, [number, number, number]> = {
  [PaintTile.Water]: [40, 92, 160],
  [PaintTile.Land]: [74, 124, 60],
  [PaintTile.Mountain]: [116, 116, 122],
};

/**
 * Renders a hand-drawn map's paint grid to a 1px-per-tile canvas (pixelated
 * upscale). Self-contained so lists of custom maps can each draw independently.
 */
@customElement("custom-map-thumb")
export class CustomMapThumb extends LitElement {
  @property({ attribute: false }) map?: CustomMap;
  @query("canvas") private canvasEl?: HTMLCanvasElement;

  createRenderRoot() {
    return this;
  }

  protected updated() {
    this.draw();
  }

  private draw() {
    const canvas = this.canvasEl;
    const map = this.map;
    if (!canvas || !map) return;
    if (canvas.width !== map.width || canvas.height !== map.height) {
      canvas.width = map.width;
      canvas.height = map.height;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let paint: Uint8Array;
    try {
      paint = decodePaint(map);
    } catch {
      return;
    }
    const img = ctx.createImageData(map.width, map.height);
    const data = img.data;
    for (let i = 0; i < paint.length; i++) {
      const [r, g, b] = TILE_RGB[(paint[i] as PaintTile) ?? PaintTile.Water];
      const o = i * 4;
      data[o] = r;
      data[o + 1] = g;
      data[o + 2] = b;
      data[o + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
  }

  render(): TemplateResult {
    const ar = this.map ? `${this.map.width} / ${this.map.height}` : "2 / 1";
    return html`<canvas
      class="block w-full h-full"
      style="image-rendering: pixelated; aspect-ratio: ${ar};"
    ></canvas>`;
  }
}
