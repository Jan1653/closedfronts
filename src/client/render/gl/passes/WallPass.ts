/**
 * WallPass — GPU-rendered walls as bold, solid, own-colour blocks.
 *
 * Walls used to render as circular structure icons (StructurePass). Instead
 * they now draw like the railroad overlay: a thick line of fat pixels in a
 * strong version of the owner's colour. Each wall tile is one instanced quad,
 * sized slightly above a tile so a chain of walls fuses into a continuous line.
 *
 * Data flow:
 *   FrameSnapshot.units → filter Wall → instance VBO → GPU
 *   RGBA32F paletteTex  → owner-colour lookup (shared with other passes)
 */

import type { RendererConfig, UnitState } from "../../types";
import { UT_WALL } from "../../types";
import { DynamicInstanceBuffer } from "../DynamicBuffer";
import type { RenderSettings } from "../RenderSettings";
import { getPaletteSize } from "../utils/ColorUtils";
import { createProgram, shaderSrc } from "../utils/GlUtils";

import wallFragSrc from "../shaders/wall/wall.frag.glsl?raw";
import wallVertSrc from "../shaders/wall/wall.vert.glsl?raw";

// Per-instance: x, y, ownerID, underConstruction, neighbourMask
// neighbourMask bits: 1=up(-y) 2=right(+x) 4=down(+y) 8=left(-x) for the four
// orthogonal sides, plus 16=up-left 32=up-right 64=down-right 128=down-left for
// the diagonals. A side with no neighbouring wall gets a black outline; a corner
// with a diagonal neighbour drops its outline so a diagonal wall run (the auto-
// connect Bresenham line steps diagonally) fuses seamlessly.
const FLOATS_PER_INSTANCE = 5;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

export class WallPass {
  private program: WebGLProgram;
  private quadBuf: WebGLBuffer;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;
  // Translucent drag-build preview: the wall line the player is about to place.
  private previewVao: WebGLVertexArrayObject;
  private previewBuf: DynamicInstanceBuffer;
  private previewCount = 0;
  private mapW: number;

  private uCamera: WebGLUniformLocation;
  private uSizeTiles: WebGLUniformLocation;
  private uSatBoost: WebGLUniformLocation;
  private uValBoost: WebGLUniformLocation;
  private uUnderConstructionAlpha: WebGLUniformLocation;

  constructor(
    private gl: WebGL2RenderingContext,
    header: RendererConfig,
    private paletteTex: WebGLTexture,
    private settings: RenderSettings,
  ) {
    this.mapW = header.mapWidth;

    this.program = createProgram(
      gl,
      wallVertSrc,
      shaderSrc(wallFragSrc, { PALETTE_SIZE: getPaletteSize() }),
    );

    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uSizeTiles = gl.getUniformLocation(this.program, "uSizeTiles")!;
    this.uSatBoost = gl.getUniformLocation(this.program, "uSatBoost")!;
    this.uValBoost = gl.getUniformLocation(this.program, "uValBoost")!;
    this.uUnderConstructionAlpha = gl.getUniformLocation(
      this.program,
      "uUnderConstructionAlpha",
    )!;

    gl.useProgram(this.program);
    gl.uniform1i(gl.getUniformLocation(this.program, "uPalette"), 0);

    // Shared unit quad [0,0]→[1,1] (attribute 0).
    this.quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );

    // Real walls and the drag preview each get their own instance buffer + VAO
    // (identical layout), so they draw independently in one pass.
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      gl.createBuffer()!,
      1024,
      FLOATS_PER_INSTANCE,
    );
    this.vao = this.createInstanceVao(this.instanceBuf);

    this.previewBuf = new DynamicInstanceBuffer(
      gl,
      gl.createBuffer()!,
      256,
      FLOATS_PER_INSTANCE,
    );
    this.previewVao = this.createInstanceVao(this.previewBuf);
  }

  // Build a VAO wiring the shared quad (attr 0) plus the per-instance attributes
  // (attr 1 = x,y,ownerID,underConstruction; attr 2 = neighbour mask) sourced
  // from `buf`.
  private createInstanceVao(
    buf: DynamicInstanceBuffer,
  ): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buf.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, BYTES_PER_INSTANCE, 16);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(null);
    return vao;
  }

  // Neighbour bitmask for the wall at `pos`: bits 1/2/4/8 = orthogonal
  // up/right/down/left, 16/32/64/128 = the four diagonals. A set bit means a
  // wall is present there, so that side/corner drops its black outline.
  private neighbourMask(pos: number, wallSet: Set<number>): number {
    const mapW = this.mapW;
    const x = pos % mapW;
    const y = (pos - x) / mapW;
    const up = pos - mapW;
    const down = pos + mapW;
    const hasLeft = x > 0;
    const hasRight = x < mapW - 1;
    let mask = 0;
    if (y > 0 && wallSet.has(up)) mask |= 1; // up
    if (hasRight && wallSet.has(pos + 1)) mask |= 2; // right
    if (wallSet.has(down)) mask |= 4; // down
    if (hasLeft && wallSet.has(pos - 1)) mask |= 8; // left
    if (y > 0 && hasLeft && wallSet.has(up - 1)) mask |= 16; // up-left
    if (y > 0 && hasRight && wallSet.has(up + 1)) mask |= 32; // up-right
    if (hasRight && wallSet.has(down + 1)) mask |= 64; // down-right
    if (hasLeft && wallSet.has(down - 1)) mask |= 128; // down-left
    return mask;
  }

  updateStructures(units: Map<number, UnitState>): void {
    const mapW = this.mapW;
    // First pass: all active wall tiles, so each wall can tell which sides have
    // a neighbouring wall (a side without one gets the black outline).
    const wallSet = new Set<number>();
    for (const unit of units.values()) {
      if (!unit.isActive || unit.unitType !== UT_WALL) continue;
      wallSet.add(unit.pos);
    }

    let count = 0;
    for (const unit of units.values()) {
      if (!unit.isActive) continue;
      if (unit.unitType !== UT_WALL) continue;

      this.instanceBuf.ensureCapacity(count + 1);
      const off = count * FLOATS_PER_INSTANCE;
      const x = unit.pos % mapW;
      const y = (unit.pos - x) / mapW;
      this.instanceBuf.float32[off + 0] = x;
      this.instanceBuf.float32[off + 1] = y;
      this.instanceBuf.float32[off + 2] = unit.ownerID;
      this.instanceBuf.float32[off + 3] = unit.underConstruction ? 1 : 0;
      this.instanceBuf.float32[off + 4] = this.neighbourMask(unit.pos, wallSet);
      count++;
    }

    this.instanceCount = count;
    if (count > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        0,
        this.instanceBuf.float32,
        0,
        count * FLOATS_PER_INSTANCE,
      );
    }
  }

  /**
   * Drag-build preview: the wall line the player is about to place, drawn
   * translucent (reuses the under-construction alpha) in the owner's colour with
   * the same fused outline. null/empty clears it.
   */
  updatePreview(
    data: { tiles: readonly number[]; ownerID: number } | null,
  ): void {
    if (data === null || data.tiles.length === 0) {
      this.previewCount = 0;
      return;
    }
    const mapW = this.mapW;
    const wallSet = new Set<number>(data.tiles);
    let count = 0;
    for (const pos of data.tiles) {
      this.previewBuf.ensureCapacity(count + 1);
      const off = count * FLOATS_PER_INSTANCE;
      const x = pos % mapW;
      const y = (pos - x) / mapW;
      this.previewBuf.float32[off + 0] = x;
      this.previewBuf.float32[off + 1] = y;
      this.previewBuf.float32[off + 2] = data.ownerID;
      this.previewBuf.float32[off + 3] = 1; // translucent, like under construction
      this.previewBuf.float32[off + 4] = this.neighbourMask(pos, wallSet);
      count++;
    }
    this.previewCount = count;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.previewBuf.buffer);
    gl.bufferSubData(
      gl.ARRAY_BUFFER,
      0,
      this.previewBuf.float32,
      0,
      count * FLOATS_PER_INSTANCE,
    );
  }

  draw(cameraMatrix: Float32Array): void {
    if (this.instanceCount === 0 && this.previewCount === 0) return;
    const gl = this.gl;
    const ws = this.settings.wall;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uSizeTiles, ws.sizeTiles);
    gl.uniform1f(this.uSatBoost, ws.satBoost);
    gl.uniform1f(this.uValBoost, ws.valBoost);
    gl.uniform1f(this.uUnderConstructionAlpha, ws.underConstructionAlpha);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paletteTex);

    // Blend so the translucent preview (and under-construction walls) show
    // through.
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    if (this.instanceCount > 0) {
      gl.bindVertexArray(this.vao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    }
    if (this.previewCount > 0) {
      gl.bindVertexArray(this.previewVao);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.previewCount);
    }
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    this.previewBuf.dispose();
    gl.deleteVertexArray(this.vao);
    gl.deleteVertexArray(this.previewVao);
    gl.deleteBuffer(this.quadBuf);
  }
}
