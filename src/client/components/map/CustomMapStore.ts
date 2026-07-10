import { PaintTile } from "../../../core/game/CustomMapBuilder";

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
