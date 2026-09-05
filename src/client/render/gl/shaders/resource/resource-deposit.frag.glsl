#version 300 es
precision highp float;
precision highp usampler2D;

// R8UI. 0 = nothing, otherwise type * 8 + grade:
//   type 1 = coal, 2 = copper, 3 = diamond;  grade 1 (thin) .. 5 (rich)
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
    // Copper — bright orange metal to deep oxidised red. Deliberately far
    // from yellow: gold is the currency, so nothing on the map may read as it.
    rim  = vec3(1.00, 0.58, 0.30);
    core = vec3(0.60, 0.18, 0.04);
  } else {
    // Diamond — sky blue to deep sapphire. Blue all the way through, even at
    // the rim: a pocket is only a few tiles wide, so most of what the player
    // ever sees IS the rim, and a near-white rim made diamond unrecognisable.
    rim  = vec3(0.34, 0.66, 1.00);
    core = vec3(0.02, 0.20, 0.92);
  }

  // Coal is a backdrop and stays translucent. Copper and diamond are what the
  // player is actually hunting, and a pocket can be two tiles across, so they
  // ignore the overlay's global opacity and paint near-solid — otherwise the
  // terrain underneath washes the colour out to nothing.
  float alpha = kind == 1u
    ? uOpacity * mix(0.45, 1.0, g)
    : mix(0.90, 1.0, g);
  fragColor = vec4(mix(rim, core, g), alpha);
}
