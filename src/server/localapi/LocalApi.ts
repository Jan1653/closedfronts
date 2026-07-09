import express, { type Request, type Response } from "express";
import { importJWK, jwtVerify } from "jose";
import cosmeticsRaw from "resources/cosmetics/cosmetics.json";
import {
  CosmeticsSchema,
  isUnlockComplete,
  type CosmeticStats,
} from "../../core/CosmeticSchemas";
import { ClansStore, isValidClanTag } from "./clans";
import { GamesStore } from "./games";
import { createSigner } from "./keys";
import { AccountStore, type Account } from "./store";

// The cosmetics catalog is bundled from the repo (single source of truth for
// both the served /cosmetics.json and the flare computation below). Parse once
// at startup so a malformed catalog fails loudly rather than silently granting
// nothing. Free items (no `unlock`) are granted to everyone; task-locked items
// are granted once the player's stats satisfy the task.
const cosmetics = CosmeticsSchema.parse(cosmeticsRaw);

function computeFlares(stats: CosmeticStats): string[] {
  const flares: string[] = [];
  for (const [name, p] of Object.entries(cosmetics.patterns)) {
    if (!p.unlock || isUnlockComplete(p.unlock, stats)) {
      flares.push(`pattern:${name}`);
    }
  }
  for (const byName of Object.values(cosmetics.effects ?? {})) {
    for (const [name, e] of Object.entries(byName ?? {})) {
      if (!e.unlock || isUnlockComplete(e.unlock, stats)) {
        flares.push(`effect:${name}`);
      }
    }
  }
  return flares;
}

// Self-hosted replacement for the closed-source auth API. Serves email/password
// accounts, JWT issuance/refresh (cookie-based) and JWKS, all under /localapi so
// nginx can route it same-origin. Deliberately dependency-free (JSON store +
// crypto.scrypt + jose). Leaderboard/clans endpoints come in later stages.

const PORT = parseInt(process.env.LOCALAPI_PORT ?? "8090", 10);
const DOMAIN = process.env.DOMAIN ?? "localhost";
// All persistent localapi state lives under LOCALAPI_DATA_DIR (default /data).
// This directory MUST be backed by a persistent volume in production: accounts
// AND the JWT signing key live here, so a fresh dir on every redeploy wipes all
// accounts ("account not found") and invalidates every session (logs everyone
// out). See `VOLUME /data` in the Dockerfile. For a local run outside Docker,
// set LOCALAPI_DATA_DIR=./data.
const DATA_DIR = process.env.LOCALAPI_DATA_DIR ?? "/data";
const DB_PATH = process.env.LOCALAPI_DB_PATH ?? `${DATA_DIR}/accounts.json`;
const GAMES_PATH = process.env.LOCALAPI_GAMES_PATH ?? `${DATA_DIR}/games.json`;
const KEY_PATH =
  process.env.LOCALAPI_KEY_PATH ?? `${DATA_DIR}/jwt-ed25519.json`;
const CLANS_PATH = process.env.LOCALAPI_CLANS_PATH ?? `${DATA_DIR}/clans.json`;
// Shared secret the game server sends when archiving finished games. Matches
// ServerEnv.apiKey() (process.env.API_KEY). When unset ("") the check is a
// no-op, matching the game server which also sends "".
const API_KEY = process.env.API_KEY ?? "";
const ISSUER =
  process.env.LOCALAPI_ISSUER ??
  (DOMAIN === "localhost"
    ? `http://localhost:${PORT}/localapi`
    : `https://${DOMAIN}/localapi`);
const AUDIENCE = process.env.LOCALAPI_AUDIENCE ?? DOMAIN;
const JWT_TTL_SECONDS = 60 * 60; // 1h; client refreshes ~3min before expiry
const SESSION_MAX_AGE = 60 * 60 * 24 * 30; // 30d
const COOKIE_NAME = "cf_session";
const COOKIE_PATH = "/localapi";

function getCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

function isSecure(req: Request): boolean {
  return (
    req.secure ||
    (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ===
      "https"
  );
}

function setSessionCookie(res: Response, token: string, secure: boolean): void {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    "HttpOnly",
    `Path=${COOKIE_PATH}`,
    "SameSite=Lax",
    `Max-Age=${SESSION_MAX_AGE}`,
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

function clearSessionCookie(res: Response, secure: boolean): void {
  const attrs = [
    `${COOKIE_NAME}=`,
    "HttpOnly",
    `Path=${COOKIE_PATH}`,
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) attrs.push("Secure");
  res.setHeader("Set-Cookie", attrs.join("; "));
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function main() {
  const store = new AccountStore(DB_PATH);
  const games = new GamesStore(GAMES_PATH, store);
  const clanStore = new ClansStore(CLANS_PATH);
  const signer = await createSigner(KEY_PATH);
  const verifyKey = await importJWK(signer.publicJwk, "EdDSA");

  const issueToken = (account: Account) =>
    signer.sign({
      userId: account.id,
      issuer: ISSUER,
      audience: AUDIENCE,
      ttlSeconds: JWT_TTL_SECONDS,
      role: account.role,
    });

  const userMe = (account: Account) => {
    const stats = games.statsFor(account.publicId);
    return {
      user: { email: account.email },
      player: {
        publicId: account.publicId,
        adfree: false,
        // Ownership flares derived from the cosmetics catalog: free items +
        // task-locked items the player's stats have unlocked.
        flares: computeFlares(stats),
        stats,
        achievements: { singleplayerMap: [] as never[] },
        friends: [] as string[],
        clans: clanStore.clansForPlayer(account.publicId),
        clanRequests: clanStore.requestsForPlayer(account.publicId),
        subscription: null,
      },
    };
  };

  const app = express();
  app.set("trust proxy", 3);
  // Auth bodies are tiny; game archive payloads (full turn logs) are large, so
  // parse per-route rather than globally.
  const jsonSmall = express.json({ limit: "16kb" });
  const jsonLarge = express.json({ limit: "64mb" });

  const r = express.Router();

  r.get("/.well-known/jwks.json", (_req, res) => {
    res.json({ keys: [signer.publicJwk] });
  });

  // Cosmetics catalog (patterns + effects). Static; served here so the client's
  // fetchCosmetics() (`${apiBase}/cosmetics.json`) resolves same-origin.
  r.get("/cosmetics.json", (_req, res) => {
    res.json(cosmeticsRaw);
  });

  r.post("/auth/register", jsonSmall, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "email_and_password_required" });
    }
    if (!EMAIL_RE.test(email.trim())) {
      return res.status(400).json({ error: "invalid_email" });
    }
    if (password.length < 6 || password.length > 200) {
      return res.status(400).json({ error: "invalid_password" });
    }
    let account: Account;
    try {
      account = store.register(email, password);
    } catch {
      return res.status(409).json({ error: "email_taken" });
    }
    const session = store.createSession(account);
    setSessionCookie(res, session, isSecure(req));
    res.json({ jwt: await issueToken(account), expiresIn: JWT_TTL_SECONDS });
  });

  r.post("/auth/login", jsonSmall, async (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== "string" || typeof password !== "string") {
      return res.status(400).json({ error: "email_and_password_required" });
    }
    const account = store.verifyLogin(email, password);
    if (!account) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const session = store.createSession(account);
    setSessionCookie(res, session, isSecure(req));
    res.json({ jwt: await issueToken(account), expiresIn: JWT_TTL_SECONDS });
  });

  r.post("/auth/refresh", async (req, res) => {
    const session = getCookie(req, COOKIE_NAME);
    const account = session ? store.findBySession(session) : undefined;
    if (!account) {
      return res.status(401).json({ error: "no_session" });
    }
    res.json({ jwt: await issueToken(account), expiresIn: JWT_TTL_SECONDS });
  });

  r.post("/auth/logout", (req, res) => {
    const session = getCookie(req, COOKIE_NAME);
    if (session) store.removeSession(session);
    clearSessionCookie(res, isSecure(req));
    res.json({ ok: true });
  });

  r.get("/users/@me", async (req, res) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      const { payload } = await jwtVerify(auth.slice(7), verifyKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      // sub is base64url(uuid); look up by decoding is unnecessary — we store
      // the account by its raw uuid, and the token was minted from it.
      const account = store.findById(uuidFromSub(payload.sub));
      if (!account) return res.status(401).json({ error: "unknown_user" });
      res.json(userMe(account));
    } catch {
      return res.status(401).json({ error: "invalid_token" });
    }
  });

  // Game-result ingestion from the game server's archive() call. Guarded by the
  // shared API_KEY (no-op when unset). Body includes full turn logs -> large
  // limit. GET is intentionally unsupported (we don't store replays here).
  r.post("/game/:id", jsonLarge, (req, res) => {
    if (API_KEY && req.headers["x-api-key"] !== API_KEY) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      games.ingest(req.body);
    } catch (e) {
      console.error("game ingest failed", e);
    }
    res.json({ ok: true });
  });

  r.get("/game/:id", (_req, res) => {
    res.status(404).json({ error: "not_found" });
  });

  r.get("/leaderboard/ranked", (req, res) => {
    const page = parseInt(String(req.query.page ?? "1"), 10) || 1;
    res.json(games.leaderboard(page));
  });

  r.get("/player/:id", (req, res) => {
    const profile = games.playerProfile(req.params.id);
    if (!profile) return res.status(404).json({ error: "not_found" });
    res.json(profile);
  });

  r.get("/public/player/:publicId/games", (req, res) => {
    const cursor =
      typeof req.query.cursor === "string" ? req.query.cursor : undefined;
    res.json(games.playerGames(req.params.publicId, cursor));
  });

  // ---- Clans ----------------------------------------------------------------

  // Resolve the caller's account from the Bearer JWT (null if unauthenticated).
  const authedAccount = async (req: Request): Promise<Account | null> => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) return null;
    try {
      const { payload } = await jwtVerify(auth.slice(7), verifyKey, {
        issuer: ISSUER,
        audience: AUDIENCE,
      });
      return store.findById(uuidFromSub(payload.sub)) ?? null;
    } catch {
      return null;
    }
  };

  const parsePage = (v: unknown) =>
    Math.max(1, parseInt(String(v ?? "1"), 10) || 1);
  const parseLimit = (v: unknown) =>
    Math.min(50, Math.max(1, parseInt(String(v ?? "20"), 10) || 20));

  // Public existence probe (uppercased tag in the route, per the client).
  r.get("/public/clan/:tag/exists", (req, res) => {
    if (clanStore.findByTag(req.params.tag))
      return res.status(200).json({ exists: true });
    return res.status(404).json({ exists: false });
  });

  // Clan leaderboard: not aggregated on this self-hosted instance yet.
  r.get("/public/clans/leaderboard", (_req, res) => {
    const now = new Date().toISOString();
    res.json({ start: now, end: now, clans: [], total: 0 });
  });

  // Browse clans.
  r.get("/clans", (req, res) => {
    const search =
      typeof req.query.search === "string" ? req.query.search : undefined;
    res.json(
      clanStore.browse(
        search,
        parsePage(req.query.page),
        parseLimit(req.query.limit),
      ),
    );
  });

  // Create a clan (auth). Body { tag, name }; the creator becomes leader.
  r.post("/clans", jsonSmall, async (req, res) => {
    const account = await authedAccount(req);
    if (!account) return res.status(401).json({ error: "unauthorized" });
    const { tag, name } = req.body ?? {};
    if (typeof tag !== "string" || !isValidClanTag(tag))
      return res.status(400).json({ error: "invalid_tag" });
    if (typeof name !== "string" || name.trim().length === 0)
      return res.status(400).json({ error: "invalid_name" });
    if (clanStore.findByTag(tag))
      return res.status(409).json({ error: "tag_taken", message: "tag taken" });
    const clan = clanStore.create(tag, name, account.publicId);
    res.json(clanStore.info(clan));
  });

  const membersResponse = (clan: ReturnType<typeof clanStore.findByTag>) => {
    if (!clan) return { results: [], total: 0, page: 1, limit: 0 };
    const rank = (role: string) =>
      role === "leader" ? 0 : role === "officer" ? 1 : 2;
    const results = [...clan.members]
      .sort(
        (a, b) =>
          rank(a.role) - rank(b.role) || a.joinedAt.localeCompare(b.joinedAt),
      )
      .map((m) => ({
        role: m.role,
        joinedAt: m.joinedAt,
        publicId: m.publicId,
      }));
    return {
      results,
      total: results.length,
      page: 1,
      limit: results.length,
      pendingRequests: clan.requests.length,
    };
  };

  // Clan detail / update / disband / members.
  r.get("/clans/:tag", (req, res) => {
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    res.json(clanStore.info(clan));
  });

  r.patch("/clans/:tag", jsonSmall, async (req, res) => {
    const account = await authedAccount(req);
    if (!account) return res.status(401).json({ error: "unauthorized" });
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    const role = clanStore.memberRole(clan, account.publicId);
    if (role !== "leader" && role !== "officer")
      return res.status(403).json({ error: "forbidden" });
    clanStore.update(clan, req.body ?? {});
    res.json(clanStore.info(clan));
  });

  r.delete("/clans/:tag", async (req, res) => {
    const account = await authedAccount(req);
    if (!account) return res.status(401).json({ error: "unauthorized" });
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    if (clanStore.memberRole(clan, account.publicId) !== "leader")
      return res.status(403).json({ error: "forbidden" });
    clanStore.disband(clan.tag);
    res.json({ ok: true });
  });

  r.get("/clans/:tag/members", (req, res) => {
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    res.json(membersResponse(clan));
  });

  // Join / leave.
  r.post("/clans/:tag/join", async (req, res) => {
    const account = await authedAccount(req);
    if (!account) return res.status(401).json({ error: "unauthorized" });
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    const result = clanStore.join(clan, account.publicId);
    if (result === "banned")
      return res.status(403).json({ code: "BANNED", reason: null });
    if (result === "already_member")
      return res.status(409).json({ message: "already a member" });
    if (result === "request_pending")
      return res.status(409).json({ message: "request pending" });
    res.json({ status: result });
  });

  r.post("/clans/:tag/leave", async (req, res) => {
    const account = await authedAccount(req);
    if (!account) return res.status(401).json({ error: "unauthorized" });
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    clanStore.leave(clan, account.publicId);
    res.json({ ok: true });
  });

  // Join-request management (leader/officer), plus self-withdraw.
  r.get("/clans/:tag/requests", async (req, res) => {
    const account = await authedAccount(req);
    if (!account) return res.status(401).json({ error: "unauthorized" });
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    const role = clanStore.memberRole(clan, account.publicId);
    if (role !== "leader" && role !== "officer")
      return res.status(403).json({ error: "forbidden" });
    const page = parsePage(req.query.page);
    const limit = parseLimit(req.query.limit);
    const start = (page - 1) * limit;
    res.json({
      results: clan.requests.slice(start, start + limit),
      total: clan.requests.length,
      page,
      limit,
    });
  });

  for (const kind of ["approve", "deny"] as const) {
    r.post(`/clans/:tag/requests/${kind}`, jsonSmall, async (req, res) => {
      const account = await authedAccount(req);
      if (!account) return res.status(401).json({ error: "unauthorized" });
      const clan = clanStore.findByTag(req.params.tag);
      if (!clan) return res.status(404).json({ error: "not_found" });
      const role = clanStore.memberRole(clan, account.publicId);
      if (role !== "leader" && role !== "officer")
        return res.status(403).json({ error: "forbidden" });
      const target = (req.body ?? {}).targetPublicId;
      if (typeof target !== "string")
        return res.status(400).json({ error: "invalid_target" });
      if (kind === "approve") clanStore.approveRequest(clan, target);
      else clanStore.denyRequest(clan, target);
      res.json({ ok: true });
    });
  }

  r.post("/clans/:tag/requests/withdraw", async (req, res) => {
    const account = await authedAccount(req);
    if (!account) return res.status(401).json({ error: "unauthorized" });
    const clan = clanStore.findByTag(req.params.tag);
    if (!clan) return res.status(404).json({ error: "not_found" });
    clanStore.denyRequest(clan, account.publicId);
    res.json({ ok: true });
  });

  // Member actions: kick / promote / demote / transfer.
  const memberAction =
    (kind: "kick" | "promote" | "demote" | "transfer") =>
    async (req: Request<{ tag: string }>, res: Response) => {
      const account = await authedAccount(req);
      if (!account) return res.status(401).json({ error: "unauthorized" });
      const clan = clanStore.findByTag(req.params.tag);
      if (!clan) return res.status(404).json({ error: "not_found" });
      const role = clanStore.memberRole(clan, account.publicId);
      // kick allowed for leader+officer; the rest are leader-only.
      const allowed =
        kind === "kick"
          ? role === "leader" || role === "officer"
          : role === "leader";
      if (!allowed) return res.status(403).json({ error: "forbidden" });
      const target = (req.body ?? {}).targetPublicId;
      if (typeof target !== "string")
        return res.status(400).json({ error: "invalid_target" });
      if (kind === "kick") clanStore.kick(clan, target);
      else if (kind === "promote") clanStore.setRole(clan, target, "officer");
      else if (kind === "demote") clanStore.setRole(clan, target, "member");
      else clanStore.transferLeadership(clan, target);
      res.json({ ok: true });
    };
  r.post("/clans/:tag/kick", jsonSmall, memberAction("kick"));
  r.post("/clans/:tag/promote", jsonSmall, memberAction("promote"));
  r.post("/clans/:tag/demote", jsonSmall, memberAction("demote"));
  r.post("/clans/:tag/transfer", jsonSmall, memberAction("transfer"));

  // Bans + game history: not implemented on this instance → empty responses.
  r.get("/clans/:tag/bans", (_req, res) =>
    res.json({ results: [], total: 0, page: 1, limit: 0 }),
  );
  r.get("/clans/:tag/games", (_req, res) =>
    res.json({ results: [], nextCursor: null }),
  );
  for (const kind of ["ban", "unban"] as const) {
    r.post(`/clans/:tag/${kind}`, jsonSmall, async (_req, res) =>
      res.json({ ok: true }),
    );
  }

  app.use("/localapi", r);

  app.listen(PORT, () => {
    console.log(`localapi listening on http://localhost:${PORT}`);
    console.log(`  issuer=${ISSUER} audience=${AUDIENCE}`);
    console.log(`  db=${DB_PATH} key=${KEY_PATH}`);
  });
}

// The JWT sub is a base64url-encoded UUID; decode back to the raw uuid used as
// the account id. Kept inline to avoid importing browser-oriented helpers here.
function uuidFromSub(sub: string | undefined): string {
  if (!sub) return "";
  const bytes = Buffer.from(sub, "base64url");
  if (bytes.length !== 16) return "";
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}

main().catch((err) => {
  console.error("localapi failed to start:", err);
  process.exit(1);
});
