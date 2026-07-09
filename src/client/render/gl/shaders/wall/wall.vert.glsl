#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;   // unit quad 0..1
layout(location = 1) in vec4 aInst;  // x, y, ownerID, underConstruction

uniform mat3  uCamera;
uniform float uSizeTiles;            // block size in world tiles

flat out float vOwnerID;
flat out float vUnderConstruction;

void main() {
  vOwnerID = aInst.z;
  vUnderConstruction = aInst.w;

  // World-anchored solid block centred on the tile. Sizing slightly above one
  // tile makes orthogonally- and diagonally-adjacent walls fuse into a
  // continuous bold line, like the railroad overlay.
  vec2 center = vec2(aInst.x + 0.5, aInst.y + 0.5);
  vec2 worldPos = center + (aPos - 0.5) * uSizeTiles;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
