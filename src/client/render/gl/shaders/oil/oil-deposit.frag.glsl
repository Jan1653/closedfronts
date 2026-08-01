#version 300 es
precision highp float;
precision highp usampler2D;

uniform usampler2D uDeposit; // R8UI, 0 = none, 1..5 = deposit grade
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

  // Dark, oily sheen so deposit blobs read as underground oil fields. The
  // deposit GRADE (1 = thin rim … 5 = black core) drives both how dark and how
  // opaque the tint is, so a field reads as a heat map: nearly black in the
  // middle, fading out toward the edge where the oil peters out.
  float g = (float(d) - 1.0) / 4.0;                 // 0 at grade 1, 1 at grade 5
  vec3 rim  = vec3(0.16, 0.34, 0.26);               // pale, washed-out edge
  vec3 core = vec3(0.01, 0.03, 0.02);               // near-black heart
  fragColor = vec4(mix(rim, core, g), uOpacity * mix(0.45, 1.0, g));
}
