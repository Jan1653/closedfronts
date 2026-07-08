import fs from "fs";
import path from "path";
import {
  exportJWK,
  generateKeyPair,
  importJWK,
  type JWK,
  type CryptoKey,
  SignJWT,
} from "jose";
import { uuidToBase64url } from "../../core/Base64";

// EdDSA (Ed25519) signing key for the localapi. The private JWK is persisted
// to disk so restarts/deploys don't invalidate everyone's tokens; the public
// JWK is served at /localapi/.well-known/jwks.json and read by the game server
// to verify tokens (see ServerEnv.jwkPublicKey).

const ALG = "EdDSA";

export interface Signer {
  publicJwk: JWK; // includes alg/crv/kty/x — matches JwksSchema
  sign: (opts: {
    userId: string; // uuid -> sub (base64url)
    issuer: string;
    audience: string;
    ttlSeconds: number;
    role?: string | null;
  }) => Promise<string>;
}

async function loadOrCreatePrivateJwk(keyPath: string): Promise<JWK> {
  try {
    const raw = fs.readFileSync(keyPath, "utf-8");
    const jwk = JSON.parse(raw) as JWK;
    if (jwk.d && jwk.x && jwk.crv === "Ed25519") return jwk;
  } catch {
    // Missing/invalid — generate a fresh keypair below.
  }
  const { privateKey } = await generateKeyPair(ALG, {
    crv: "Ed25519",
    extractable: true,
  });
  const jwk = await exportJWK(privateKey);
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  const tmp = `${keyPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(jwk), { mode: 0o600 });
  fs.renameSync(tmp, keyPath);
  return jwk;
}

export async function createSigner(keyPath: string): Promise<Signer> {
  const privateJwk = await loadOrCreatePrivateJwk(keyPath);
  const privateKey = (await importJWK(privateJwk, ALG)) as CryptoKey;

  // Public JWK = private minus `d`, plus the alg the verifiers expect.
  const { d: _d, ...publicRest } = privateJwk;
  void _d;
  const publicJwk: JWK = { ...publicRest, alg: ALG };

  return {
    publicJwk,
    async sign({ userId, issuer, audience, ttlSeconds, role }) {
      const now = Math.floor(Date.now() / 1000);
      const jwt = new SignJWT({ role: role ?? undefined })
        .setProtectedHeader({ alg: ALG })
        .setSubject(uuidToBase64url(userId))
        .setJti(crypto.randomUUID())
        .setIssuedAt(now)
        .setIssuer(issuer)
        .setAudience(audience)
        .setExpirationTime(now + ttlSeconds);
      return jwt.sign(privateKey);
    },
  };
}
