/**
 * ResourceDepositPass — toggleable overlay marking mineable tiles.
 *
 * Sister to OilDepositPass, with one difference that shapes the whole class:
 * copper and diamond fields keep SURFACING as the game runs (see
 * ResourceDeposits), so the baked mask goes stale. It is therefore re-baked
 * whenever the resource epoch advances — and only while the overlay is
 * actually switched on, since a full-map bake is not free.
 *
 * Off by default; toggled via MapRenderer.setResourceDepositView (keybind +
 * HUD button). Nothing draws, and nothing re-bakes, while disabled.
 */

import {
  resourceEpoch,
  resourceOverlayCode,
} from "../../../../core/game/ResourceDeposits";
import {
  createMapQuad,
  createProgram,
  createTexture2D,
} from "../utils/GlUtils";

import overlayVertSrc from "../shaders/map-overlay/overlay.vert.glsl?raw";
import resourceFragSrc from "../shaders/resource/resource-deposit.frag.glsl?raw";

const OPACITY = 0.6;

export class ResourceDepositPass {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private resourceTex: WebGLTexture;

  private uCamera: WebGLUniformLocation;
  private uMapSize: WebGLUniformLocation;
  private uOpacity: WebGLUniformLocation;

  private mapW: number;
  private mapH: number;
  private enabled = false;
  /** Epoch the current texture was baked for; -1 = never baked. */
  private bakedEpoch = -1;
  private mask: Uint8Array;

  constructor(
    gl: WebGL2RenderingContext,
    mapW: number,
    mapH: number,
    private terrainSource: () => Uint8Array,
    private enabledForGame: boolean,
  ) {
    this.gl = gl;
    this.mapW = mapW;
    this.mapH = mapH;
    this.mask = new Uint8Array(mapW * mapH);

    // Allocated empty; the first bake happens the first time the overlay is
    // switched on, so a game played without ever opening it pays nothing.
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.resourceTex = createTexture2D(gl, {
      width: mapW,
      height: mapH,
      internalFormat: gl.R8UI,
      format: gl.RED_INTEGER,
      type: gl.UNSIGNED_BYTE,
      data: this.mask,
      filter: gl.NEAREST,
    });
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    this.program = createProgram(gl, overlayVertSrc, resourceFragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uMapSize = gl.getUniformLocation(this.program, "uMapSize")!;
    this.uOpacity = gl.getUniformLocation(this.program, "uOpacity")!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uResource"), 0);

    this.vao = createMapQuad(gl, mapW, mapH);
  }

  setEnabled(active: boolean): void {
    this.enabled = active && this.enabledForGame;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Re-bake if the epoch has moved on. Cheap to call every frame: it compares
   * two integers and returns.
   */
  private refresh(ticks: number): void {
    const epoch = resourceEpoch(ticks);
    if (epoch === this.bakedEpoch) return;
    this.bakedEpoch = epoch;

    const gl = this.gl;
    const terrain = this.terrainSource();
    // Evaluate at the START of the epoch, not at the live tick: the code is a
    // step function of the epoch, so any tick inside it gives the same answer,
    // and pinning it makes the bake reproducible.
    const ticksForEpoch = epoch * 1200;
    for (let y = 0; y < this.mapH; y++) {
      const row = y * this.mapW;
      for (let x = 0; x < this.mapW; x++) {
        this.mask[row + x] = resourceOverlayCode(
          terrain[row + x],
          x,
          y,
          ticksForEpoch,
        );
      }
    }

    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.resourceTex);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      this.mapW,
      this.mapH,
      gl.RED_INTEGER,
      gl.UNSIGNED_BYTE,
      this.mask,
    );
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  /** Draw the overlay. Must be called with alpha blending enabled. */
  draw(cameraMatrix: Float32Array, ticks: number): void {
    if (!this.enabled) return;
    this.refresh(ticks);
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform2f(this.uMapSize, this.mapW, this.mapH);
    gl.uniform1f(this.uOpacity, OPACITY);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.resourceTex);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    gl.deleteVertexArray(this.vao);
    gl.deleteTexture(this.resourceTex);
  }
}
