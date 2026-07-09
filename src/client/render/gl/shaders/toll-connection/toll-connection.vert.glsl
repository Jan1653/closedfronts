#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;   // unit quad 0..1
layout(location = 1) in vec4 aSeg;   // x0, y0, x1, y1 (tile-centre world coords)

uniform mat3  uCamera;
uniform float uWidth;                // line width in world tiles

out vec2 vUv;                        // x = along the segment, y = across (0..1)

void main() {
  vec2 a = aSeg.xy;
  vec2 b = aSeg.zw;
  vec2 dir = b - a;
  float len = length(dir);
  vec2 d = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 perp = vec2(-d.y, d.x);

  // aPos.x: 0 → a, 1 → b along the segment. aPos.y: 0 → -w/2, 1 → +w/2 across.
  vec2 worldPos = mix(a, b, aPos.x) + perp * (aPos.y - 0.5) * uWidth;
  vUv = aPos;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
