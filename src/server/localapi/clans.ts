import fs from "fs";
import path from "path";

// Minimal file-backed clan store for the self-hosted localapi. Mirrors the
// account store: in-memory state + write-through to a JSON file. Enough for a
// small self-hosted instance; migrate to SQLite if a clan grows huge.

export type ClanRole = "leader" | "officer" | "member";

interface ClanMemberRec {
  publicId: string;
  role: ClanRole;
  joinedAt: string;
}
interface ClanRequestRec {
  publicId: string;
  createdAt: string;
}
interface ClanBanRec {
  publicId: string;
  bannedBy: string;
  reason: string | null;
  createdAt: string;
}

export interface ClanRecord {
  tag: string; // canonical UPPERCASE
  name: string;
  description: string;
  discordUrl: string | null;
  isOpen: boolean;
  members: ClanMemberRec[];
  requests: ClanRequestRec[];
  bans: ClanBanRec[];
  createdAt: string;
}

interface StoreData {
  version: 1;
  clans: ClanRecord[];
}

// Clan tags: 2–5 chars, letters/digits, stored uppercased (matches the
// client's ClanTagSchema shape closely enough for a self-hosted instance).
const CLAN_TAG_RE = /^[A-Za-z0-9]{2,5}$/;

export function isValidClanTag(tag: string): boolean {
  return CLAN_TAG_RE.test(tag.trim());
}
export function canonicalTag(tag: string): string {
  return tag.trim().toUpperCase();
}

/** ClanInfo wire shape (matches ClanInfoSchema). */
export interface ClanInfoWire {
  name: string;
  tag: string;
  description: string;
  discordUrl: string | null;
  isOpen: boolean;
  createdAt: string;
  memberCount: number;
}

export class ClansStore {
  private data: StoreData = { version: 1, clans: [] };
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
      if (parsed && Array.isArray(parsed.clans)) {
        this.data = { version: 1, clans: parsed.clans };
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

  findByTag(tag: string): ClanRecord | undefined {
    const key = canonicalTag(tag);
    return this.data.clans.find((c) => c.tag === key);
  }

  info(clan: ClanRecord): ClanInfoWire {
    return {
      name: clan.name,
      tag: clan.tag,
      description: clan.description,
      discordUrl: clan.discordUrl,
      isOpen: clan.isOpen,
      createdAt: clan.createdAt,
      memberCount: clan.members.length,
    };
  }

  // Creates a clan with `leaderPublicId` as its leader. Throws "tag_taken".
  create(tag: string, name: string, leaderPublicId: string): ClanRecord {
    const key = canonicalTag(tag);
    if (this.findByTag(key)) throw new Error("tag_taken");
    const clan: ClanRecord = {
      tag: key,
      name: name.trim().slice(0, 35) || key,
      description: "",
      discordUrl: null,
      isOpen: true,
      members: [
        { publicId: leaderPublicId, role: "leader", joinedAt: nowIso() },
      ],
      requests: [],
      bans: [],
      createdAt: nowIso(),
    };
    this.data.clans.push(clan);
    this.save();
    return clan;
  }

  browse(
    search: string | undefined,
    page: number,
    limit: number,
  ): { results: ClanInfoWire[]; total: number; page: number; limit: number } {
    const q = (search ?? "").trim().toUpperCase();
    let matches = this.data.clans;
    if (q.length >= 2) {
      matches = matches.filter(
        (c) => c.tag.includes(q) || c.name.toUpperCase().includes(q),
      );
    }
    // Biggest clans first.
    const sorted = [...matches].sort(
      (a, b) => b.members.length - a.members.length,
    );
    const start = (page - 1) * limit;
    return {
      results: sorted.slice(start, start + limit).map((c) => this.info(c)),
      total: sorted.length,
      page,
      limit,
    };
  }

  // The clans a player belongs to (for userMe.player.clans).
  clansForPlayer(publicId: string): Array<{
    tag: string;
    name: string;
    role: ClanRole;
    joinedAt: string;
    memberCount: number;
  }> {
    const out: Array<{
      tag: string;
      name: string;
      role: ClanRole;
      joinedAt: string;
      memberCount: number;
    }> = [];
    for (const clan of this.data.clans) {
      const m = clan.members.find((x) => x.publicId === publicId);
      if (m) {
        out.push({
          tag: clan.tag,
          name: clan.name,
          role: m.role,
          joinedAt: m.joinedAt,
          memberCount: clan.members.length,
        });
      }
    }
    return out;
  }

  // The player's pending join requests (for userMe.player.clanRequests).
  requestsForPlayer(
    publicId: string,
  ): Array<{ tag: string; name: string; createdAt: string }> {
    const out: Array<{ tag: string; name: string; createdAt: string }> = [];
    for (const clan of this.data.clans) {
      const req = clan.requests.find((x) => x.publicId === publicId);
      if (req) {
        out.push({ tag: clan.tag, name: clan.name, createdAt: req.createdAt });
      }
    }
    return out;
  }

  isMember(clan: ClanRecord, publicId: string): boolean {
    return clan.members.some((m) => m.publicId === publicId);
  }
  memberRole(clan: ClanRecord, publicId: string): ClanRole | null {
    return clan.members.find((m) => m.publicId === publicId)?.role ?? null;
  }
  isBanned(clan: ClanRecord, publicId: string): boolean {
    return clan.bans.some((b) => b.publicId === publicId);
  }

  join(
    clan: ClanRecord,
    publicId: string,
  ): "joined" | "requested" | "already_member" | "request_pending" | "banned" {
    if (this.isBanned(clan, publicId)) return "banned";
    if (this.isMember(clan, publicId)) return "already_member";
    if (clan.requests.some((r) => r.publicId === publicId))
      return "request_pending";
    if (clan.isOpen) {
      clan.members.push({ publicId, role: "member", joinedAt: nowIso() });
      this.save();
      return "joined";
    }
    clan.requests.push({ publicId, createdAt: nowIso() });
    this.save();
    return "requested";
  }

  // Removes a member. If the leader leaves, leadership passes to the
  // longest-standing remaining member; an empty clan is disbanded.
  leave(clan: ClanRecord, publicId: string): boolean {
    const before = clan.members.length;
    const wasLeader = this.memberRole(clan, publicId) === "leader";
    clan.members = clan.members.filter((m) => m.publicId !== publicId);
    if (clan.members.length === before) return false;
    if (clan.members.length === 0) {
      this.disband(clan.tag);
      return true;
    }
    if (wasLeader && !clan.members.some((m) => m.role === "leader")) {
      clan.members.sort((a, b) => a.joinedAt.localeCompare(b.joinedAt));
      clan.members[0].role = "leader";
    }
    this.save();
    return true;
  }

  disband(tag: string): void {
    const key = canonicalTag(tag);
    this.data.clans = this.data.clans.filter((c) => c.tag !== key);
    this.save();
  }

  approveRequest(clan: ClanRecord, targetPublicId: string): boolean {
    const idx = clan.requests.findIndex((r) => r.publicId === targetPublicId);
    if (idx < 0) return false;
    clan.requests.splice(idx, 1);
    if (!this.isMember(clan, targetPublicId)) {
      clan.members.push({
        publicId: targetPublicId,
        role: "member",
        joinedAt: nowIso(),
      });
    }
    this.save();
    return true;
  }

  denyRequest(clan: ClanRecord, targetPublicId: string): boolean {
    const before = clan.requests.length;
    clan.requests = clan.requests.filter((r) => r.publicId !== targetPublicId);
    if (clan.requests.length === before) return false;
    this.save();
    return true;
  }

  setRole(clan: ClanRecord, targetPublicId: string, role: ClanRole): boolean {
    const m = clan.members.find((x) => x.publicId === targetPublicId);
    if (!m) return false;
    m.role = role;
    this.save();
    return true;
  }

  transferLeadership(clan: ClanRecord, targetPublicId: string): boolean {
    const target = clan.members.find((x) => x.publicId === targetPublicId);
    if (!target) return false;
    for (const m of clan.members) if (m.role === "leader") m.role = "member";
    target.role = "leader";
    this.save();
    return true;
  }

  kick(clan: ClanRecord, targetPublicId: string): boolean {
    const before = clan.members.length;
    clan.members = clan.members.filter((m) => m.publicId !== targetPublicId);
    if (clan.members.length === before) return false;
    this.save();
    return true;
  }

  update(
    clan: ClanRecord,
    patch: {
      name?: string;
      description?: string;
      discordUrl?: string | null;
      isOpen?: boolean;
    },
  ): void {
    if (typeof patch.name === "string")
      clan.name = patch.name.trim().slice(0, 35) || clan.name;
    if (typeof patch.description === "string")
      clan.description = patch.description.slice(0, 200);
    if (patch.discordUrl !== undefined)
      clan.discordUrl = patch.discordUrl || null;
    if (typeof patch.isOpen === "boolean") clan.isOpen = patch.isOpen;
    this.save();
  }
}

function nowIso(): string {
  return new Date().toISOString();
}
