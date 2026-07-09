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

// Per-instance: x, y, ownerID, underConstruction
const FLOATS_PER_INSTANCE = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

export class WallPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;
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

    // --- Instance buffer ---
    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      1024,
      FLOATS_PER_INSTANCE,
    );

    // --- VAO ---
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);

    // Attribute 0: unit quad [0,0]→[1,1]
    const quadBuf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Attribute 1: per-instance vec4 (x, y, ownerID, underConstruction)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  updateStructures(units: Map<number, UnitState>): void {
    let count = 0;
    for (const unit of units.values()) {
      if (!unit.isActive) continue;
      if (unit.unitType !== UT_WALL) continue;

      this.instanceBuf.ensureCapacity(count + 1);
      const off = count * FLOATS_PER_INSTANCE;
      const x = unit.pos % this.mapW;
      const y = (unit.pos - x) / this.mapW;
      this.instanceBuf.float32[off + 0] = x;
      this.instanceBuf.float32[off + 1] = y;
      this.instanceBuf.float32[off + 2] = unit.ownerID;
      this.instanceBuf.float32[off + 3] = unit.underConstruction ? 1 : 0;
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

  draw(cameraMatrix: Float32Array): void {
    if (this.instanceCount === 0) return;
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

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
