#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uDeposit; // R8UI, 1 = oil deposit
uniform vec2  uMapSize;
uniform float uOpacity;

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  ivec2 t = ivec2(floor(vWorldPos));
  if (t.x < 0 || t.y < 0 || t.x >= int(uMapSize.x) || t.y >= int(uMapSize.y)) {
    discard;
  }
  uint d = texelFetch(uDeposit, t, 0).r;
  if (d == 0u) discard;

  // Dark, oily sheen so deposit blobs read as underground oil fields.
  fragColor = vec4(0.02, 0.07, 0.05, uOpacity);
}
