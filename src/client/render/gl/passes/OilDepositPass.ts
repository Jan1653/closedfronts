/**
 * OilDepositPass — toggleable overlay marking oil-deposit tiles.
 *
 * Oil deposits are a deterministic function of coordinates (shared with the
 * simulation via core/game/OilDeposits). This pass bakes the whole-map deposit
 * mask into an R8UI texture once, then tints those tiles with a dark oily sheen
 * when the "oil map" overlay is toggled on — so the player can find the
 * irregular deposit blobs to place oil pumps on.
 *
 * Off by default; toggled via MapRenderer.setOilDepositView (keybind + HUD
 * button). Nothing draws while disabled.
 */

import { isOilDepositAt } from "../../../../core/game/OilDeposits";
import { createMapQuad, createProgram, createTexture2D } from "../utils/GlUtils";

import oilFragSrc from "../shaders/oil/oil-deposit.frag.glsl?raw";
import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";

const OPACITY = 0.55;

export class OilDepositPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private depositTex: WebGLTexture;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;
  private enabled = false;

  constructor(gl: WebGL2RenderingContext, mapW: number, mapH: number) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;

    // Bake the deposit mask once (1 = deposit). Same integer function the
    // simulation uses, so the overlay is pixel-accurate to where pumps build.
    const mask = new Uint8Array(mapW * mapH);
    for (let y = 0; y < mapH; y++) {
      const row = y * mapW;
      for (let x = 0; x < mapW; x++) {
        if (isOilDepositAt(x, y)) mask[row + x] = 1;
      }
    }
    // 1 byte per texel (R8UI): rows aren't 4-byte aligned when mapW isn't a
    // multiple of 4, so drop UNPACK_ALIGNMENT to 1 for this upload, then restore.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.depositTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: mask,
      filter: gl.NEAREST,
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    this.program = createProgram(gl, overlayVertSrc, oilFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uOpacity = gl.getUniformLocation(this.program, "uOpacity")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uDeposit"), 0);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  setEnabled(active: boolean): void {
    this.enabled = active;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /** Draw the overlay. Must be called with alpha blending enabled. */
  draw(cameraMatrix: Float32Array): void {
    if (!this.enabled) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uOpacity, OPACITY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.depositTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.depositTex);
  }
}
