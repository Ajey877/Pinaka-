import crypto from "node:crypto";

const GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize";
const GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token";
const GITHUB_USER_URL = "https://api.github.com/user";
const DEFAULT_SCOPE = "public_repo read:user";
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

function base64Url(buffer) { return Buffer.from(buffer).toString("base64url"); }
function makeVerifier() { return base64Url(crypto.randomBytes(32)); }
function makeChallenge(verifier) { return base64Url(crypto.createHash("sha256").update(verifier).digest()); }
function parseCookies(header) { const cookies = new Map(); if (typeof header !== "string") return cookies; for (const part of header.split(";")) { const index = part.indexOf("="); if (index <= 0) continue; const key = part.slice(0, index).trim(); const value = part.slice(index + 1).trim(); if (key) { try { cookies.set(key, decodeURIComponent(value)); } catch {} } } return cookies; }
function cookieHeader(name, value, { maxAgeSeconds, secure = false, httpOnly = true } = {}) { const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"]; if (httpOnly) parts.push("HttpOnly"); if (Number.isInteger(maxAgeSeconds)) parts.push(`Max-Age=${maxAgeSeconds}`); if (secure) parts.push("Secure"); return parts.join("; "); }
async function requestJson(fetchImpl, url, init) { const response = await fetchImpl(url, init); const payload = await response.json().catch(() => ({})); if (!response.ok) throw fail(typeof payload?.message === "string" ? payload.message : `GitHub request failed (${response.status})`, response.status === 401 ? "GITHUB_UNAUTHORIZED" : "GITHUB_AUTH_FAILED", 502); return payload; }
function safeHeaderToken(value) { if (typeof value !== "string" || value.length < 32 || value.length > 256 || !/^[A-Za-z0-9_-]+$/.test(value)) throw fail("CSRF token is missing or invalid", "CSRF_REQUIRED", 403); return value; }
function constantTimeEqual(left, right) { try { const a = Buffer.from(safeHeaderToken(left)); const b = Buffer.from(safeHeaderToken(right)); return a.length === b.length && crypto.timingSafeEqual(a, b); } catch { return false; } }

export class GitHubAuthService {
  #clientId;
  #clientSecret;
  #redirectUri;
  #scope;
  #sessionTtlMs;
  #cookieSecure;
  #sessionCookie;
  #csrfCookie;
  #fetch;
  #pending = new Map();
  #sessions = new Map();

  constructor({ clientId = process.env.GITHUB_CLIENT_ID || "", clientSecret = process.env.GITHUB_CLIENT_SECRET || "", redirectUri = process.env.GITHUB_OAUTH_REDIRECT_URI || "http://localhost:3000/auth/github/callback", scope = process.env.GITHUB_OAUTH_SCOPE || DEFAULT_SCOPE, sessionTtlMs = Number(process.env.GITHUB_SESSION_TTL_MS || process.env.PINAKA_SESSION_TTL_MS || DEFAULT_SESSION_TTL_MS), cookieSecure = process.env.GITHUB_COOKIE_SECURE === "1" || process.env.PINAKA_COOKIE_SECURE === "1" || process.env.NODE_ENV === "production", sessionCookie = process.env.PINAKA_SESSION_COOKIE || "pinaka_session", csrfCookie = process.env.PINAKA_CSRF_COOKIE || "pinaka_csrf", fetchImpl = globalThis.fetch } = {}) {
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
    this.#redirectUri = redirectUri;
    this.#scope = scope;
    this.#sessionTtlMs = Number.isFinite(sessionTtlMs) && sessionTtlMs >= 15 * 60 * 1000 ? Math.floor(sessionTtlMs) : DEFAULT_SESSION_TTL_MS;
    this.#cookieSecure = Boolean(cookieSecure);
    this.#sessionCookie = sessionCookie;
    this.#csrfCookie = csrfCookie;
    this.#fetch = fetchImpl;
    if (typeof this.#fetch !== "function") throw new TypeError("fetch implementation is required");
  }

  begin() { if (!this.#clientId || !this.#clientSecret) throw fail("GitHub OAuth is not configured", "GITHUB_OAUTH_NOT_CONFIGURED", 503); const state = base64Url(crypto.randomBytes(24)); const verifier = makeVerifier(); const csrf = base64Url(crypto.randomBytes(32)); this.#pending.set(state, { verifier, csrf, expiresAt: Date.now() + STATE_TTL_MS }); while (this.#pending.size > MAX_PENDING_AUTH) this.#pending.delete(this.#pending.keys().next().value); const url = new URL(GITHUB_AUTHORIZE_URL); url.searchParams.set("client_id", this.#clientId); url.searchParams.set("redirect_uri", this.#redirectUri); url.searchParams.set("state", state); url.searchParams.set("scope", this.#scope); url.searchParams.set("code_challenge", makeChallenge(verifier)); url.searchParams.set("code_challenge_method", "S256"); return url.toString(); }

  async callback({ code, state } = {}) { if (typeof code !== "string" || code.length < 1 || typeof state !== "string" || state.length < 16) throw fail("GitHub OAuth callback is invalid", "GITHUB_CALLBACK_INVALID", 400); const pending = this.#pending.get(state); this.#pending.delete(state); if (!pending || pending.expiresAt < Date.now()) throw fail("GitHub OAuth state expired", "GITHUB_STATE_EXPIRED", 400); const tokenPayload = await requestJson(this.#fetch, GITHUB_TOKEN_URL, { method: "POST", headers: { accept: "application/json", "content-type": "application/json" }, body: JSON.stringify({ client_id: this.#clientId, client_secret: this.#clientSecret, code, redirect_uri: this.#redirectUri, code_verifier: pending.verifier }) }); const accessToken = typeof tokenPayload.access_token === "string" ? tokenPayload.access_token : ""; if (!accessToken) throw fail(tokenPayload.error_description || "GitHub did not return an access token", "GITHUB_TOKEN_MISSING", 502); const user = await requestJson(this.#fetch, GITHUB_USER_URL, { headers: { accept: "application/vnd.github+json", authorization: `Bearer ${accessToken}`, "user-agent": "Pinaka" } }); const sessionToken = base64Url(crypto.randomBytes(32)); const expiresAt = Date.now() + this.#sessionTtlMs; this.#sessions.set(sessionToken, { user, githubToken: accessToken, csrf: pending.csrf, expiresAt }); while (this.#sessions.size > MAX_SESSIONS) this.#sessions.delete(this.#sessions.keys().next().value); return { setCookies: [cookieHeader(this.#sessionCookie, sessionToken, { maxAgeSeconds: Math.floor(this.#sessionTtlMs / 1000), secure: this.#cookieSecure, httpOnly: true }), cookieHeader(this.#csrfCookie, pending.csrf, { maxAgeSeconds: Math.floor(this.#sessionTtlMs / 1000), secure: this.#cookieSecure, httpOnly: false })], user }; }

  getSession(headers) { const cookies = parseCookies(headers?.cookie); const token = cookies.get(this.#sessionCookie); if (!token) return null; const session = this.#sessions.get(token); if (!session || session.expiresAt <= Date.now()) { this.#sessions.delete(token); return null; } return { user: session.user, githubToken: session.githubToken, csrf: session.csrf, expiresAt: session.expiresAt }; }
  assertCsrf(headers) { const session = this.getSession(headers); if (!session) throw fail("GitHub sign-in is required", "AUTH_REQUIRED", 401); const headerToken = headers?.["x-csrf-token"] || headers?.["X-CSRF-Token"]; if (!constantTimeEqual(headerToken, session.csrf)) throw fail("CSRF token is invalid", "CSRF_INVALID", 403); }
  logout(headers) { const cookies = parseCookies(headers?.cookie); const token = cookies.get(this.#sessionCookie); if (token) this.#sessions.delete(token); return [cookieHeader(this.#sessionCookie, "", { maxAgeSeconds: 0, secure: this.#cookieSecure, httpOnly: true }), cookieHeader(this.#csrfCookie, "", { maxAgeSeconds: 0, secure: this.#cookieSecure, httpOnly: false })]; }
}
