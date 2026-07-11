#version 300 es
precision highp float;

layout(location = 0) in vec2 aPos;   // unit quad 0..1
layout(location = 1) in vec4 aInst;  // x, y, ownerID, underConstruction
layout(location = 2) in float aMask; // neighbour mask (1=up 2=right 4=down 8=left)
layout(location = 3) in float aHealth; // 0..1 health fraction (< 1 draws a bar)

uniform mat3  uCamera;
uniform float uSizeTiles;            // block size in world tiles

flat out float vOwnerID;
flat out float vUnderConstruction;
flat out float vMask;
flat out float vHealth;
out vec2 vUv;                        // 0..1 position within the block

void main() {
  vOwnerID = aInst.z;
  vUnderConstruction = aInst.w;
  vMask = aMask;
  vHealth = aHealth;
  vUv = aPos;

  // World-anchored solid block centred on the tile. Sizing slightly above one
  // tile makes orthogonally- and diagonally-adjacent walls fuse into a
  // continuous bold line, like the railroad overlay.
  vec2 center = vec2(aInst.x + 0.5, aInst.y + 0.5);
  vec2 worldPos = center + (aPos - 0.5) * uSizeTiles;

  vec3 clip = uCamera * vec3(worldPos, 1.0);
  gl_Position = vec4(clip.xy, 0.0, 1.0);
}
