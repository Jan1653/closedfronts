import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";

// File-backed store for published community maps (hand-drawn in the editor).
// Mirrors the clan/account stores: in-memory state + write-through JSON. Each
// map carries its paint grid (base64) so it can be played without any CDN
// files. Fine for a small self-hosted instance; migrate to SQLite if it grows.

export interface MapRecord {
  id: string;
  name: string;
  width: number;
  height: number;
  paint: string; // base64 of a width*height PaintTile grid
  authorPublicId: string;
  createdAt: string;
  updatedAt: string;
  likes: string[]; // publicIds who liked (dedupes to a count)
}

interface StoreData {
  version: 1;
  maps: MapRecord[];
}

// Bounds mirror the client's GameConfig.customMap schema.
const MIN_DIM = 8;
const MAX_DIM = 512;
const MAX_NAME = 64;
const MAX_MAPS_PER_AUTHOR = 100;

export interface MapSummaryWire {
  id: string;
  name: string;
  width: number;
  height: number;
  authorPublicId: string;
  createdAt: string;
  updatedAt: string;
  likeCount: number;
  likedByMe: boolean;
}

export interface MapDetailWire extends MapSummaryWire {
  paint: string;
}

export type MapSort = "likes" | "new";

function nowIso(): string {
  return new Date().toISOString();
}

export class MapsStore {
  private data: StoreData = { version: 1, maps: [] };
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const parsed = JSON.parse(
        fs.readFileSync(this.filePath, "utf-8"),
      ) as StoreData;
      if (parsed && Array.isArray(parsed.maps)) {
        this.data = { version: 1, maps: parsed.maps };
      }
    } catch {
      // No file yet / unreadable — start empty.
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });
    fs.renameSync(tmp, this.filePath);
  }

  get(id: string): MapRecord | undefined {
    return this.data.maps.find((m) => m.id === id);
  }

  summary(m: MapRecord, viewerPublicId?: string): MapSummaryWire {
    return {
      id: m.id,
      name: m.name,
      width: m.width,
      height: m.height,
      authorPublicId: m.authorPublicId,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      likeCount: m.likes.length,
      likedByMe: viewerPublicId ? m.likes.includes(viewerPublicId) : false,
    };
  }

  detail(m: MapRecord, viewerPublicId?: string): MapDetailWire {
    return { ...this.summary(m, viewerPublicId), paint: m.paint };
  }

  /**
   * Publish a new map. Validates dimensions and that the paint decodes to
   * exactly width*height bytes. Throws "invalid" / "too_many" so the caller can
   * map to a clean HTTP status.
   */
  publish(
    authorPublicId: string,
    input: { name: unknown; width: unknown; height: unknown; paint: unknown },
  ): MapRecord {
    const { name, width, height, paint } = input;
    if (
      typeof width !== "number" ||
      typeof height !== "number" ||
      typeof paint !== "string" ||
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < MIN_DIM ||
      height < MIN_DIM ||
      width > MAX_DIM ||
      height > MAX_DIM
    ) {
      throw new Error("invalid");
    }
    let bytes: Buffer;
    try {
      bytes = Buffer.from(paint, "base64");
    } catch {
      throw new Error("invalid");
    }
    if (bytes.length !== width * height) {
      throw new Error("invalid");
    }
    const owned = this.data.maps.filter(
      (m) => m.authorPublicId === authorPublicId,
    ).length;
    if (owned >= MAX_MAPS_PER_AUTHOR) {
      throw new Error("too_many");
    }
    const cleanName =
      (typeof name === "string" ? name.trim().slice(0, MAX_NAME) : "") ||
      "Untitled";
    const rec: MapRecord = {
      id: randomUUID(),
      name: cleanName,
      width,
      height,
      paint,
      authorPublicId,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      likes: [],
    };
    this.data.maps.push(rec);
    this.save();
    return rec;
  }

  /** Delete a map. Returns false if not found or not owned by the caller. */
  remove(id: string, authorPublicId: string): boolean {
    const idx = this.data.maps.findIndex(
      (m) => m.id === id && m.authorPublicId === authorPublicId,
    );
    if (idx === -1) return false;
    this.data.maps.splice(idx, 1);
    this.save();
    return true;
  }

  /** Toggle a like. Returns the updated record, or undefined if not found. */
  setLike(id: string, publicId: string, liked: boolean): MapRecord | undefined {
    const m = this.get(id);
    if (!m) return undefined;
    const has = m.likes.includes(publicId);
    if (liked && !has) m.likes.push(publicId);
    else if (!liked && has) m.likes = m.likes.filter((p) => p !== publicId);
    else return m; // no change
    this.save();
    return m;
  }

  browse(opts: {
    sort?: MapSort;
    search?: string;
    page: number;
    limit: number;
    viewerPublicId?: string;
  }): {
    results: MapSummaryWire[];
    total: number;
    page: number;
    limit: number;
  } {
    const q = (opts.search ?? "").trim().toLowerCase();
    let matches = this.data.maps;
    if (q.length > 0) {
      matches = matches.filter((m) => m.name.toLowerCase().includes(q));
    }
    const sorted = [...matches].sort((a, b) =>
      opts.sort === "new"
        ? b.createdAt.localeCompare(a.createdAt)
        : b.likes.length - a.likes.length ||
          b.createdAt.localeCompare(a.createdAt),
    );
    const start = (opts.page - 1) * opts.limit;
    return {
      results: sorted
        .slice(start, start + opts.limit)
        .map((m) => this.summary(m, opts.viewerPublicId)),
      total: sorted.length,
      page: opts.page,
      limit: opts.limit,
    };
  }

  /** A player's own published maps (newest first). */
  mapsForAuthor(
    authorPublicId: string,
    viewerPublicId?: string,
  ): MapSummaryWire[] {
    return this.data.maps
      .filter((m) => m.authorPublicId === authorPublicId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => this.summary(m, viewerPublicId));
  }
}
