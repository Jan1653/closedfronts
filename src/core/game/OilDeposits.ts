/**
 * Shared, deterministic oil-deposit map.
 *
 * Deposits are a fixed, seed-independent property of map coordinates (an
 * integer hash — no accumulated floating point) so the simulation and the
 * client's overlay always agree on exactly which tiles are deposits.
 *
 * Instead of scattered single pixels, deposits form irregular BLOBS, like real
 * underground oil fields: the map is diced into coarse cells, a sparse subset
 * of which anchor a field whose ragged radius covers the tiles around its
 * (jittered) centre. Scanning the 3×3 block of neighbouring cells lets a field
 * spill across cell boundaries and merge with its neighbours.
 */
export function isOilDepositAt(x: number, y: number): boolean {
  const CELL = 40;
  const cx0 = Math.floor(x / CELL);
  const cy0 = Math.floor(y / CELL);
  for (let gy = cy0 - 1; gy <= cy0 + 1; gy++) {
    for (let gx = cx0 - 1; gx <= cx0 + 1; gx++) {
      let h = (Math.imul(gx, 73856093) ^ Math.imul(gy, 19349663)) >>> 0;
      h = (h ^ (h >>> 13)) >>> 0;
      h = Math.imul(h, 0x5bd1e995) >>> 0;
      // Only ~1 in 3 cells actually anchor a field → sparse scattering.
      if (h % 3 !== 0) continue;
      // Field centre, jittered inside its cell.
      const centerX = gx * CELL + (h % CELL);
      const centerY = gy * CELL + ((h >>> 8) % CELL);
      const dx = x - centerX;
      const dy = y - centerY;
      const dist2 = dx * dx + dy * dy;
      // Base radius 3–9 varies per field. A lumpy edge (shared across 3×3 tile
      // blocks so it isn't grainy) makes the outline ragged, not circular.
      const baseR = 3 + ((h >>> 16) % 7);
      let e =
        (Math.imul(Math.floor(x / 3), 668265263) ^
          Math.imul(Math.floor(y / 3), 2246822519)) >>>
        0;
      e = (e ^ (e >>> 15)) >>> 0;
      const wobble = (e % 5) - 2; // −2..+2
      const r = baseR + wobble;
      if (r > 0 && dist2 <= r * r) return true;
    }
  }
  return false;
}
