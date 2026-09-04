#version 300 es
precision highp float;
precision highp usampler2D;

// R8UI. 0 = nothing, otherwise type * 8 + grade:
//   type 1 = coal, 2 = ore, 3 = diamond;  grade 1 (thin) .. 5 (rich)
uniform usampler2D uResource;
uniform vec2  uMapSize;
uniform float uOpacity;

in vec2 vWorldPos;
out vec4 fragColor;

void main() {
  ivec2 t = ivec2(floor(vWorldPos));
  if (t.x < 0 || t.y < 0 || t.x >= int(uMapSize.x) || t.y >= int(uMapSize.y)) {
    discard;
  }
  uint code = texelFetch(uResource, t, 0).r;
  if (code == 0u) discard;

  uint kind = code >> 3u;
  uint grade = code & 7u;
  if (grade == 0u) discard;

  // Grade drives depth of colour and opacity, so each seam reads as a heat map
  // the way the oil overlay does: pale at the rim, saturated at the heart.
  float g = (float(grade) - 1.0) / 4.0;

  vec3 rim;
  vec3 core;
  if (kind == 1u) {
    // Coal — sooty grey to true black.
    rim  = vec3(0.42, 0.42, 0.45);
    core = vec3(0.03, 0.03, 0.04);
  } else if (kind == 2u) {
    // Ore — warm brass to deep gold, so it stands out against the coal.
    rim  = vec3(0.85, 0.72, 0.32);
    core = vec3(0.72, 0.48, 0.03);
  } else {
    // Diamond — icy white-blue, the loudest of the three because it is the
    // rarest and the player is hunting for it.
    rim  = vec3(0.82, 0.96, 1.00);
    core = vec3(0.35, 0.80, 1.00);
  }

  // The rare two stay bright even at grade 1: a single diamond tile must not
  // vanish into the map the way a thin coal seam reasonably can.
  float minAlpha = kind == 1u ? 0.45 : 0.85;
  fragColor = vec4(mix(rim, core, g), uOpacity * mix(minAlpha, 1.0, g));
}
