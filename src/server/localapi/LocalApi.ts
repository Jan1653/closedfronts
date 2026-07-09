import express, { type Request, type Response } from "express";
import { importJWK, jwtVerify } from "jose";
import { GamesStore } from "./games";
import { createSigner } from "./keys";
import { AccountStore, type Account } from "./store";

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
const KEY_PATH = process.env.LOCALAPI_KEY_PATH ?? `${DATA_DIR}/jwt-ed25519.json`;
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

  const userMe = (account: Account) => ({
    user: { email: account.email },
    player: {
      publicId: account.publicId,
      adfree: false,
      achievements: { singleplayerMap: [] as never[] },
      friends: [] as string[],
      subscription: null,
    },
  });

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
