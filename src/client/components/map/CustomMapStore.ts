import { PaintTile } from "../../../core/game/CustomMapBuilder";

/**
 * Editor/thumbnail colours per paint tile, matching the mid-band colour the
 * WebGL renderer draws for each type's elevation (see render/gl/utils/
 * ColorUtils) so a drawing previews close to how it plays.
 */
export const PAINT_TILE_RGB: Record<PaintTile, [number, number, number]> = {
  [PaintTile.Water]: [71, 133, 181],
  [PaintTile.DeepWater]: [61, 123, 171],
  [PaintTile.Plains]: [190, 210, 138],
  [PaintTile.Highland]: [230, 213, 168],
  [PaintTile.Mountain]: [242, 242, 242],
  [PaintTile.Peak]: [60, 60, 60],
};

export function paintTileCss(p: PaintTile): string {
  const [r, g, b] = PAINT_TILE_RGB[p] ?? PAINT_TILE_RGB[PaintTile.Water];
  return `rgb(${r},${g},${b})`;
}

/**
 * Local (per-device) storage for hand-drawn custom maps. Stores the raw PAINT
 * grid (re-editable) rather than the compiled terrain, so a map can be reopened
 * in the editor. Publishing to the account/community backend is a later step.
 */
export interface CustomMap {
  id: string;
  name: string;
  width: number;
  height: number;
  /** base64 of the width*height PaintTile grid. */
  paint: string;
  createdAt: number;
  updatedAt: number;
}

const KEY = "closedfronts_custom_maps";

function u8ToBase64(u8: Uint8Array): string {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode(...u8.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function base64ToU8(b64: string): Uint8Array {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}

/** Base64-encode a paint grid (same encoding used for stored maps). */
export function encodePaintBase64(paint: Uint8Array): string {
  return u8ToBase64(paint);
}

/** Decode a stored/shared base64 paint grid back into bytes. */
export function decodePaintBase64(b64: string): Uint8Array {
  return base64ToU8(b64);
}

// ---- Share as a file (.cfmap) ----

const FILE_VERSION = 1;
export const CUSTOM_MAP_FILE_EXT = "cfmap";

export interface ParsedCustomMap {
  name: string;
  width: number;
  height: number;
  paint: string;
}

/** Serialize a map to a portable JSON string for download. */
export function serializeCustomMap(m: CustomMap): string {
  return JSON.stringify({
    v: FILE_VERSION,
    name: m.name,
    width: m.width,
    height: m.height,
    paint: m.paint,
  });
}

/**
 * Parse and validate a shared map file. Throws on anything malformed so the
 * importer can show a clean error rather than storing garbage.
 */
export function parseCustomMapFile(text: string): ParsedCustomMap {
  let obj: unknown;
  try {
    obj = JSON.parse(text);
  } catch {
    throw new Error("not a valid map file");
  }
  const o = obj as Record<string, unknown>;
  const { name, width, height, paint } = o ?? {};
  if (
    typeof name !== "string" ||
    typeof width !== "number" ||
    typeof height !== "number" ||
    typeof paint !== "string"
  ) {
    throw new Error("missing map fields");
  }
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 8 ||
    height < 8 ||
    width > 512 ||
    height > 512
  ) {
    throw new Error("invalid map dimensions");
  }
  let bytes: Uint8Array;
  try {
    bytes = base64ToU8(paint);
  } catch {
    throw new Error("corrupt paint data");
  }
  if (bytes.length !== width * height) {
    throw new Error("paint size does not match dimensions");
  }
  return { name: name.slice(0, 64) || "Imported", width, height, paint };
}

export function listCustomMaps(): CustomMap[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function getCustomMap(id: string): CustomMap | null {
  return listCustomMaps().find((m) => m.id === id) ?? null;
}

export function decodePaint(m: CustomMap): Uint8Array {
  return base64ToU8(m.paint);
}

/** Save (insert or update by id). Returns the stored record. */
export function saveCustomMap(input: {
  id?: string;
  name: string;
  width: number;
  height: number;
  paint: Uint8Array | number[];
}): CustomMap {
  const maps = listCustomMaps();
  const now = Date.now();
  const paintB64 = u8ToBase64(
    input.paint instanceof Uint8Array
      ? input.paint
      : Uint8Array.from(input.paint),
  );
  const existing = input.id ? maps.find((m) => m.id === input.id) : undefined;
  const record: CustomMap = {
    id: input.id ?? `map_${now}_${Math.floor(Math.random() * 1e6)}`,
    name: input.name,
    width: input.width,
    height: input.height,
    paint: paintB64,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  const next = existing
    ? maps.map((m) => (m.id === record.id ? record : m))
    : [record, ...maps];
  localStorage.setItem(KEY, JSON.stringify(next));
  return record;
}

export function deleteCustomMap(id: string): void {
  localStorage.setItem(
    KEY,
    JSON.stringify(listCustomMaps().filter((m) => m.id !== id)),
  );
}

/** Blank grid helper (all water). */
export function blankPaint(width: number, height: number): Uint8Array {
  return new Uint8Array(width * height).fill(PaintTile.Water);
}
