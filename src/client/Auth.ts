import { decodeJwt } from "jose";
import { UserSettings } from "src/core/game/UserSettings";
import { z } from "zod";
import { TokenPayload, TokenPayloadSchema } from "../core/ApiSchemas";
import { base64urlToUuid } from "../core/Base64";
import { getApiBase, getAudience, invalidateUserMe } from "./Api";
import { generateCryptoRandomUUID } from "./Utils";

export type UserAuth = { jwt: string; claims: TokenPayload } | false;

const PERSISTENT_ID_KEY = "player_persistent_id";

let __jwt: string | null = null;
let __refreshPromise: Promise<void> | null = null;
let __expiresAt: number = 0;
// Guests have no session cookie, so /auth/refresh answers 401 every single
// time. Remember that for a while: without it every auth check (each socket
// (re)connect does one) fires another pointless request and another console
// error, which buried the real errors during a reconnect storm.
let __refreshBlockedUntil: number = 0;
const REFRESH_BACKOFF_MS = 60 * 1000;

// Called whenever a login may have created a session cookie, so the next auth
// check actually asks the server again instead of waiting out the backoff.
function clearRefreshBackoff() {
  __refreshBlockedUntil = 0;
}

export function discordLogin() {
  const redirectUri = encodeURIComponent(window.location.href);
  window.location.href = `${getApiBase()}/auth/login/discord?redirect_uri=${redirectUri}`;
}

export function googleLogin() {
  const redirectUri = encodeURIComponent(window.location.href);
  window.location.href = `${getApiBase()}/auth/login/google?redirect_uri=${redirectUri}`;
}

// Link a Google account to the currently logged-in player. Unlike login this is
// an authenticated request, so we fetch the Google authorize URL with the
// Bearer token (a top-level navigation can't carry it) and then navigate to it.
// Returns false if the user isn't logged in or the request fails.
export async function linkGoogle(): Promise<boolean> {
  const authHeader = await getAuthHeader();
  if (authHeader === "") return false;
  const redirectUri = encodeURIComponent(window.location.href);
  try {
    const response = await fetch(
      `${getApiBase()}/auth/link/google?redirect_uri=${redirectUri}`,
      {
        headers: { Authorization: authHeader },
        credentials: "include",
      },
    );
    if (!response.ok) {
      console.error("Failed to start Google link", response);
      return false;
    }
    const { url } = await response.json();
    if (typeof url !== "string") return false;
    window.location.href = url;
    return true;
  } catch (e) {
    console.error("Failed to start Google link", e);
    return false;
  }
}

export async function tempTokenLogin(token: string): Promise<string | null> {
  const response = await fetch(
    `${getApiBase()}/auth/login/token?login-token=${token}`,
    {
      credentials: "include",
    },
  );
  if (response.status !== 200) {
    console.error("Token login failed", response);
    return null;
  }
  const json = await response.json();
  const { email } = json;
  clearRefreshBackoff(); // a session cookie exists now
  return email;
}

export async function getAuthHeader(): Promise<string> {
  const userAuthResult = await userAuth();
  if (!userAuthResult) return "";
  const { jwt } = userAuthResult;
  return `Bearer ${jwt}`;
}

export async function logOut(allSessions: boolean = false): Promise<boolean> {
  try {
    const response = await fetch(
      getApiBase() + (allSessions ? "/auth/revoke" : "/auth/logout"),
      {
        method: "POST",
        credentials: "include",
      },
    );

    if (response.ok === false) {
      console.error("Logout failed", response);
      return false;
    }

    return true;
  } catch (e) {
    console.error("Logout failed", e);
    return false;
  } finally {
    __jwt = null;
    clearRefreshBackoff(); // a later login must not wait out the backoff
    localStorage.removeItem(PERSISTENT_ID_KEY);
    new UserSettings().clearFlag();
    new UserSettings().setSelectedPatternName(undefined);
  }
}

export async function isLoggedIn(): Promise<boolean> {
  const userAuthResult = await userAuth();
  return userAuthResult !== false;
}

export async function userAuth(
  shouldRefresh: boolean = true,
): Promise<UserAuth> {
  try {
    const jwt = __jwt;
    if (!jwt) {
      if (!shouldRefresh) {
        // Normal state for a guest — nothing to warn about.
        console.debug("No JWT found and shouldRefresh is false");
        return false;
      }
      console.debug("No JWT found");
      await refreshJwt();
      return userAuth(false);
    }

    // Verify the JWT (requires browser support)
    // const jwks = createRemoteJWKSet(
    //   new URL(getApiBase() + "/.well-known/jwks.json"),
    // );
    // const { payload, protectedHeader } = await jwtVerify(token, jwks, {
    //   issuer: getApiBase(),
    //   audience: getAudience(),
    // });

    const payload = decodeJwt(jwt);
    const { iss, aud } = payload;

    if (iss !== getApiBase()) {
      // JWT was not issued by the correct server
      console.error('unexpected "iss" claim value');
      logOut();
      return false;
    }
    const myAud = getAudience();
    if (myAud !== "localhost" && aud !== myAud) {
      // JWT was not issued for this website
      console.error('unexpected "aud" claim value');
      logOut();
      return false;
    }
    if (Date.now() >= __expiresAt - 3 * 60 * 1000) {
      console.log("jwt expired or about to expire");
      if (!shouldRefresh) {
        console.error("jwt expired and shouldRefresh is false");
        return false;
      }
      await refreshJwt();

      // Try to get login info again after refreshing
      return userAuth(false);
    }

    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      const error = z.prettifyError(result.error);
      console.error("Invalid payload", error);
      return false;
    }

    const claims = result.data;
    return { jwt, claims };
  } catch (e) {
    console.error("isLoggedIn failed", e);
    return false;
  }
}

async function refreshJwt(): Promise<void> {
  if (__refreshPromise) {
    return __refreshPromise;
  }
  if (Date.now() < __refreshBlockedUntil) {
    // Known to have no session; skip the round trip.
    return;
  }
  __refreshPromise = doRefreshJwt();
  try {
    await __refreshPromise;
  } finally {
    __refreshPromise = null;
  }
}

async function doRefreshJwt(): Promise<void> {
  try {
    console.debug("Refreshing jwt");
    const response = await fetch(getApiBase() + "/auth/refresh", {
      method: "POST",
      credentials: "include",
    });
    if (response.status === 401) {
      // Not logged in — the expected answer for a guest, not a failure.
      __jwt = null;
      __refreshBlockedUntil = Date.now() + REFRESH_BACKOFF_MS;
      console.debug("No session to refresh (guest)");
      return;
    }
    if (response.status !== 200) {
      // A failed refresh just means there is no valid session — a guest with no
      // session cookie (localapi returns 401 every time), or an expired one.
      // Only drop the in-memory JWT here; do NOT call logOut(), which deletes
      // the anonymous persistent ID from localStorage. Wiping it mints a brand
      // new guest identity on every auth check, so a guest who hosts a private
      // lobby creates it under one persistent ID and joins it under another —
      // the server then never recognises them as the lobby creator and the
      // Start button silently does nothing.
      console.error("Refresh failed", response);
      __jwt = null;
      return;
    }
    const json = await response.json();
    const { jwt, expiresIn } = json;
    __expiresAt = Date.now() + expiresIn * 1000;
    console.log("Refresh succeeded");
    __jwt = jwt;
  } catch (e) {
    console.error("Refresh failed", e);
    // if server unreachable, just clear jwt
    __jwt = null;
    return;
  }
}

export async function sendMagicLink(email: string): Promise<boolean> {
  try {
    const apiBase = getApiBase();
    const response = await fetch(`${apiBase}/auth/magic-link`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
      body: JSON.stringify({
        redirectDomain: window.location.origin,
        email: email,
      }),
    });

    if (response.ok) {
      return true;
    } else {
      console.error(
        "Failed to send recovery email:",
        response.status,
        response.statusText,
      );
      return false;
    }
  } catch (error) {
    console.error("Error sending recovery email:", error);
    return false;
  }
}

// WARNING: DO NOT EXPOSE THIS ID
export async function getPlayToken(): Promise<string> {
  const result = await userAuth();
  if (result !== false) return result.jwt;
  return getPersistentIDFromLocalStorage();
}

export type AuthResult = { ok: true } | { ok: false; error: string };

// Register a new email/password account (localapi). On success the server sets
// the session cookie and returns a short-lived JWT, which we cache in-memory so
// userAuth() works immediately without a round-trip.
export async function registerAccount(
  email: string,
  password: string,
): Promise<AuthResult> {
  return authRequest("/auth/register", email, password);
}

// Log in with an existing email/password account (localapi).
export async function loginAccount(
  email: string,
  password: string,
): Promise<AuthResult> {
  return authRequest("/auth/login", email, password);
}

async function authRequest(
  path: string,
  email: string,
  password: string,
): Promise<AuthResult> {
  try {
    const response = await fetch(`${getApiBase()}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email, password }),
    });
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      return { ok: false, error: body?.error ?? "failed" };
    }
    const jwt = body?.jwt;
    const expiresIn = body?.expiresIn;
    if (typeof jwt === "string") {
      __jwt = jwt;
      __expiresAt =
        Date.now() + (typeof expiresIn === "number" ? expiresIn : 3600) * 1000;
    }
    clearRefreshBackoff(); // a session cookie exists now
    invalidateUserMe();
    return { ok: true };
  } catch (e) {
    console.error("authRequest failed", e);
    return { ok: false, error: "network" };
  }
}

// WARNING: DO NOT EXPOSE THIS ID
export function getPersistentID(): string {
  const jwt = __jwt;
  if (!jwt) return getPersistentIDFromLocalStorage();
  const payload = decodeJwt(jwt);
  const sub = payload.sub;
  if (!sub) return getPersistentIDFromLocalStorage();
  return base64urlToUuid(sub);
}

// WARNING: DO NOT EXPOSE THIS ID
function getPersistentIDFromLocalStorage(): string {
  // Try to get existing localStorage
  const value = localStorage.getItem(PERSISTENT_ID_KEY);
  if (value) return value;

  // If no localStorage exists, create new ID and set localStorage
  const newID = generateCryptoRandomUUID();
  localStorage.setItem(PERSISTENT_ID_KEY, newID);

  return newID;
}
