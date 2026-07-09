/**
 * TollConnectionPass — draws each water toll station's two "connections" as
 * rope/road lines over the sea to its anchors (the landmasses / other toll
 * stations it bridges), so a station visibly links to what it connects, like a
 * wall line. Segments are computed on the client (WebGLFrameBuilder) and pushed
 * here as instanced line quads.
 */

import { DynamicInstanceBuffer } from "../DynamicBuffer";
import { createProgram } from "../utils/GlUtils";

import fragSrc from "../shaders/toll-connection/toll-connection.frag.glsl?raw";
import vertSrc from "../shaders/toll-connection/toll-connection.vert.glsl?raw";

// Per-instance: x0, y0, x1, y1 (tile-centre world coords of the two endpoints).
const FLOATS_PER_INSTANCE = 4;
const BYTES_PER_INSTANCE = FLOATS_PER_INSTANCE * 4;

// Line width (world tiles) and colour (amber "toll road", translucent).
const LINE_WIDTH = 0.45;
const COLOR: readonly [number, number, number, number] = [
  0.96, 0.78, 0.32, 0.7,
];

export class TollConnectionPass {
  private program: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private instanceBuf: DynamicInstanceBuffer;
  private instanceCount = 0;

  private uCamera: WebGLUniformLocation;
  private uWidth: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;

  constructor(private gl: WebGL2RenderingContext) {
    this.program = createProgram(gl, vertSrc, fragSrc);
    this.uCamera = gl.getUniformLocation(this.program, "uCamera")!;
    this.uWidth = gl.getUniformLocation(this.program, "uWidth")!;
    this.uColor = gl.getUniformLocation(this.program, "uColor")!;

    const instanceGlBuf = gl.createBuffer()!;
    this.instanceBuf = new DynamicInstanceBuffer(
      gl,
      instanceGlBuf,
      256,
      FLOATS_PER_INSTANCE,
    );

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

    // Attribute 1: per-instance segment (x0, y0, x1, y1)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuf.buffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, BYTES_PER_INSTANCE, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(null);
  }

  /** `segments` is a flat [x0, y0, x1, y1, …] array of endpoint pairs. */
  update(segments: Float32Array): void {
    const count = Math.floor(segments.length / FLOATS_PER_INSTANCE);
    this.instanceCount = count;
    if (count === 0) return;
    this.instanceBuf.ensureCapacity(count);
    this.instanceBuf.float32.set(
      segments.subarray(0, count * FLOATS_PER_INSTANCE),
      0,
    );
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

  draw(cameraMatrix: Float32Array): void {
    if (this.instanceCount === 0) return;
    const gl = this.gl;

    gl.useProgram(this.program);
    gl.uniformMatrix3fv(this.uCamera, false, cameraMatrix);
    gl.uniform1f(this.uWidth, LINE_WIDTH);
    gl.uniform4f(this.uColor, COLOR[0], COLOR[1], COLOR[2], COLOR[3]);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    gl.bindVertexArray(this.vao);
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, this.instanceCount);
    gl.bindVertexArray(null);
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteProgram(this.program);
    this.instanceBuf.dispose();
    gl.deleteVertexArray(this.vao);
  }
}
