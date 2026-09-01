import crypto from "node:crypto";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const DEFAULT_SCOPE = "repo read:user user:email";
const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_PENDING_AUTH = 128;
const MAX_SESSIONS = 256;
const STATE_TTL_MS = 10 * 60 * 1000;

function fail(message, code, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function required(value, name) {
  if (typeof value !== "string" || value.trim() === "") throw fail(`${name} is required`, `MISSING_${name.toUpperCase()}`, 503);
  return value.trim();
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function makeVerifier() {
  return base64Url(crypto.randomBytes(32));
}

function makeChallenge(verifier) {
  return base64Url(crypto.createHash("sha256").update(verifier).digest());
}

function parseCookies(header) {
  const cookies = new Map();
  if (typeof header !== "string") return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (key) cookies.set(key, decodeURIComponent(value));
  }
  return cookies;
}

function cookieHeader(name, value, { maxAgeSeconds, secure = false } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "HttpOnly", "SameSite=Lax"];
  if (Number.isInteger(maxAgeSeconds)) parts.push(`Max-Age=${maxAgeSeconds}`);
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

async function requestJson(fetchImpl, url, init) {
  const response = await fetchImpl(url, init);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = typeof payload?.message === "string" ? payload.message : `GitHub request failed (${response.status})`;
    throw fail(message, response.status === 401 ? "GITHUB_UNAUTHORIZED" : "GITHUB_AUTH_FAILED", response.status >= 500 ? 502 : 502);
  }
  return payload;
}

export class GitHubAuthService {
  #clientId;
  #clientSecret;
  #redirectUri;
  #scope;
  #sessionTtlMs;
  #cookieName;
  #secureCookies;
  #fetch;
  #now;
  #pending = new Map();
  #sessions = new Map();

  constructor({
    clientId = process.env.GITHUB_CLIENT_ID || "",
    clientSecret = process.env.GITHUB_CLIENT_SECRET || "",
    redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI || "",
    scope = process.env.GITHUB_OAUTH_SCOPE || DEFAULT_SCOPE,
    sessionTtlMs = Number(process.env.PINAKA_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS),
    cookieName = process.env.PINAKA_SESSION_COOKIE || "pinaka_session",
    secureCookies = process.env.PINAKA_COOKIE_SECURE === "1" || process.env.NODE_ENV === "production",
    fetchImpl = globalThis.fetch,
    now = () => Date.now()
  } = {}) {
    this.#clientId = typeof clientId === "string" ? clientId.trim() : "";
    this.#clientSecret = typeof clientSecret === "string" ? clientSecret.trim() : "";
    this.#redirectUri = typeof redirectUri === "string" ? redirectUri.trim() : "";
    this.#scope = typeof scope === "string" && scope.trim() ? scope.trim() : DEFAULT_SCOPE;
    this.#sessionTtlMs = Number.isInteger(sessionTtlMs) && sessionTtlMs >= 5 * 60 * 1000 && sessionTtlMs <= 7 * 24 * 60 * 60 * 1000 ? sessionTtlMs : DEFAULT_SESSION_TTL_MS;
    this.#cookieName = typeof cookieName === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(cookieName) ? cookieName : "pinaka_session";
    this.#secureCookies = secureCookies === true;
    this.#fetch = typeof fetchImpl === "function" ? fetchImpl : null;
    this.#now = typeof now === "function" ? now : () => Date.now();
  }

  isConfigured() {
    return Boolean(this.#clientId && this.#clientSecret && this.#redirectUri && this.#fetch);
  }

  getCookieName() {
    return this.#cookieName;
  }

  begin() {
    if (!this.isConfigured()) throw fail("GitHub OAuth is not configured", "GITHUB_OAUTH_NOT_CONFIGURED", 503);
    this.#cleanup();
    if (this.#pending.size >= MAX_PENDING_AUTH) throw fail("too many pending GitHub sign-in attempts", "GITHUB_AUTH_CAPACITY", 429);
    const state = base64Url(crypto.randomBytes(32));
    const verifier = makeVerifier();
    this.#pending.set(state, { verifier, createdAt: this.#now() });
    const params = new URLSearchParams({
      client_id: this.#clientId,
      redirect_uri: this.#redirectUri,
      state,
      scope: this.#scope,
      code_challenge: makeChallenge(verifier),
      code_challenge_method: "S256",
      allow_signup: "true"
    });
    return `${GITHUB_AUTHORIZE_URL}?${params.toString()}`;
  }

  async callback({ code, state } = {}) {
    if (!this.isConfigured()) throw fail("GitHub OAuth is not configured", "GITHUB_OAUTH_NOT_CONFIGURED", 503);
    if (typeof code !== "string" || code.trim() === "" || typeof state !== "string" || state.trim() === "") throw fail("GitHub callback is missing code or state", "GITHUB_CALLBACK_INVALID");
    this.#cleanup();
    const pending = this.#pending.get(state);
    this.#pending.delete(state);
    if (!pending || this.#now() - pending.createdAt > STATE_TTL_MS) throw fail("GitHub OAuth state is invalid or expired", "GITHUB_STATE_INVALID", 403);

    const tokenPayload = await requestJson(this.#fetch, GITHUB_TOKEN_URL, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify({ client_id: this.#clientId, client_secret: this.#clientSecret, code: code.trim(), redirect_uri: this.#redirectUri, code_verifier: pending.verifier })
    });
    if (typeof tokenPayload.access_token !== "string" || tokenPayload.access_token.trim() === "") throw fail("GitHub did not return an access token", "GITHUB_TOKEN_MISSING", 502);

    const user = await requestJson(this.#fetch, GITHUB_USER_URL, {
      headers: { accept: "application/vnd.github+json", authorization: `Bearer ${tokenPayload.access_token}`, "x-github-api-version": "2022-11-28" }
    });
    if (!Number.isInteger(user.id) || typeof user.login !== "string" || user.login.trim() === "") throw fail("GitHub returned an invalid user identity", "GITHUB_USER_INVALID", 502);

    if (this.#sessions.size >= MAX_SESSIONS) this.#cleanup(true);
    if (this.#sessions.size >= MAX_SESSIONS) throw fail("too many active Pinaka sessions", "SESSION_CAPACITY", 429);

    const sessionId = base64Url(crypto.randomBytes(32));
    const session = {
      id: sessionId,
      githubToken: tokenPayload.access_token.trim(),
      user: {
        id: user.id,
        login: user.login.trim(),
        name: typeof user.name === "string" ? user.name.trim() : null,
        avatarUrl: typeof user.avatar_url === "string" ? user.avatar_url : null
      },
      createdAt: this.#now(),
      expiresAt: this.#now() + this.#sessionTtlMs
    };
    this.#sessions.set(sessionId, session);
    return { session, setCookie: cookieHeader(this.#cookieName, sessionId, { maxAgeSeconds: Math.floor(this.#sessionTtlMs / 1000), secure: this.#secureCookies }) };
  }

  getSession(requestHeaders) {
    this.#cleanup();
    const sessionId = parseCookies(requestHeaders?.cookie).get(this.#cookieName);
    if (!sessionId) return null;
    const session = this.#sessions.get(sessionId);
    if (!session) return null;
    if (session.expiresAt <= this.#now()) {
      this.#sessions.delete(sessionId);
      return null;
    }
    return { id: session.id, user: { ...session.user }, githubToken: session.githubToken };
  }

  logout(requestHeaders) {
    const cookies = parseCookies(requestHeaders?.cookie);
    const sessionId = cookies.get(this.#cookieName);
    if (sessionId) this.#sessions.delete(sessionId);
    return cookieHeader(this.#cookieName, "", { maxAgeSeconds: 0, secure: this.#secureCookies });
  }

  #cleanup(force = false) {
    const now = this.#now();
    for (const [key, value] of this.#pending) if (force || now - value.createdAt > STATE_TTL_MS) this.#pending.delete(key);
    for (const [key, value] of this.#sessions) if (force || value.expiresAt <= now) this.#sessions.delete(key);
  }
}

export const __test = Object.freeze({ makeVerifier, makeChallenge, parseCookies, cookieHeader });
