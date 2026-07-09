#version 300 es
precision highp float;

uniform sampler2D uPalette;
uniform float uSatBoost;               // saturation multiplier (stronger own color)
uniform float uValBoost;               // value/brightness multiplier
uniform float uUnderConstructionAlpha; // alpha while a wall is still building

flat in float vOwnerID;
flat in float vUnderConstruction;

out vec4 fragColor;

vec3 rgb2hsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  float e = 1.0e-10;
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}

vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + vec3(1.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
  return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
}

void main() {
  // Owner's territory color, pushed to a strong, vivid version so the wall
  // reads as a bold line in the player's own colour.
  float u = (vOwnerID + 0.5) / float(PALETTE_SIZE);
  vec3 base = texture(uPalette, vec2(u, 0.25)).rgb;
  vec3 hsv = rgb2hsv(base);
  hsv.y = clamp(hsv.y * uSatBoost + 0.12, 0.0, 1.0);
  hsv.z = clamp(hsv.z * uValBoost, 0.0, 1.0);
  vec3 rgb = hsv2rgb(hsv);

  float a = vUnderConstruction > 0.5 ? uUnderConstructionAlpha : 1.0;
  fragColor = vec4(rgb, a);
}
