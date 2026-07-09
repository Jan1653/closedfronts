#version 300 es
precision highp float;

uniform vec4 uColor;

in vec2 vUv;
out vec4 fragColor;

void main() {
  // Soft edges across the width so the connection reads as a rope/road line.
  float across = abs(vUv.y - 0.5) * 2.0; // 0 centre → 1 edge
  float alpha = uColor.a * smoothstep(1.0, 0.7, across);
  fragColor = vec4(uColor.rgb, alpha);
}
