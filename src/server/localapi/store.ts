import {
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "crypto";
import fs from "fs";
import path from "path";

// Minimal file-backed account store for the self-hosted localapi. Single
// process (one supervisord program), so in-memory state + write-through to a
// JSON file is enough; no external DB / native dependency. Stage 2/3 (games,
// leaderboard, clans) can migrate this to SQLite if data volume grows.

export interface Account {
  id: string; // uuid -> JWT sub (base64url-encoded)
  publicId: string; // stable public identifier (clans/leaderboard)
  email: string; // lowercased, unique
  passwordHash: string; // scrypt$salt$key
  role: string | null;
  createdAt: string; // ISO
  // Opaque session tokens (httpOnly cookie) that can be exchanged for a JWT.
  sessions: string[];
}

interface StoreData {
  version: 1;
  accounts: Account[];
}

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const key = Buffer.from(parts[2], "hex");
  const test = scryptSync(password, salt, key.length);
  return key.length === test.length && timingSafeEqual(key, test);
}

// Short public id: 12 url-safe chars, collision-checked against the store.
function generatePublicId(existing: Set<string>): string {
  const alphabet =
    "123456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ";
  for (let attempt = 0; attempt < 1000; attempt++) {
    let id = "";
    const bytes = randomBytes(12);
    for (let i = 0; i < 12; i++) id += alphabet[bytes[i] % alphabet.length];
    if (!existing.has(id)) return id;
  }
  throw new Error("could not allocate public id");
}

export class AccountStore {
  private data: StoreData = { version: 1, accounts: [] };
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.filePath, "utf-8");
      const parsed = JSON.parse(raw) as StoreData;
      if (parsed && Array.isArray(parsed.accounts)) {
        this.data = { version: 1, accounts: parsed.accounts };
      }
    } catch {
      // No file yet (first run) or unreadable — start empty and create on save.
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), "utf-8");
    fs.renameSync(tmp, this.filePath); // atomic replace
  }

  findByEmail(email: string): Account | undefined {
    const key = email.trim().toLowerCase();
    return this.data.accounts.find((a) => a.email === key);
  }

  findById(id: string): Account | undefined {
    return this.data.accounts.find((a) => a.id === id);
  }

  findByPublicId(publicId: string): Account | undefined {
    return this.data.accounts.find((a) => a.publicId === publicId);
  }

  findBySession(session: string): Account | undefined {
    return this.data.accounts.find((a) => a.sessions.includes(session));
  }

  // Creates an account. Throws "email_taken" if the email already exists.
  register(email: string, password: string): Account {
    const key = email.trim().toLowerCase();
    if (this.findByEmail(key)) {
      throw new Error("email_taken");
    }
    const publicIds = new Set(this.data.accounts.map((a) => a.publicId));
    const account: Account = {
      id: randomUUID(),
      publicId: generatePublicId(publicIds),
      email: key,
      passwordHash: hashPassword(password),
      role: null,
      createdAt: new Date().toISOString(),
      sessions: [],
    };
    this.data.accounts.push(account);
    this.save();
    return account;
  }

  // Returns the account on correct credentials, otherwise null.
  verifyLogin(email: string, password: string): Account | null {
    const account = this.findByEmail(email);
    if (!account) return null;
    return verifyPassword(password, account.passwordHash) ? account : null;
  }

  // Issues a new opaque session token and stores it on the account.
  createSession(account: Account): string {
    const token = randomBytes(32).toString("hex");
    account.sessions.push(token);
    // Cap stored sessions so the list can't grow unbounded across logins.
    if (account.sessions.length > 20) {
      account.sessions = account.sessions.slice(-20);
    }
    this.save();
    return token;
  }

  removeSession(session: string): void {
    const account = this.findBySession(session);
    if (!account) return;
    account.sessions = account.sessions.filter((s) => s !== session);
    this.save();
  }
}
