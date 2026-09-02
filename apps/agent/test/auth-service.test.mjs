import test from "node:test";
import assert from "node:assert/strict";
import { GitHubAuthService, __test } from "../src/auth-service.mjs";

function jsonResponse(payload, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }); }
function makeService() {
  return new GitHubAuthService({ clientId: "client-id", clientSecret: "client-secret", redirectUri: "https://pinaka.example/auth/github/callback", fetchImpl: async (url) => url === "https://github.com/login/oauth/access_token" ? jsonResponse({ access_token: "gho_test_token" }) : jsonResponse({ id: 123, login: "ajay", name: "Ajay", avatar_url: "https://avatars.example/a.png" }) });
}

test("PKCE challenge is deterministic and produces a URL-safe value", () => {
  const verifier = "A".repeat(43); const challenge = __test.makeChallenge(verifier);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/); assert.equal(challenge, __test.makeChallenge(verifier));
});

test("begin creates a stateful PKCE authorization URL with public-repository scope", () => {
  const service = makeService(); const parsed = new URL(service.begin());
  assert.equal(parsed.origin, "https://github.com"); assert.equal(parsed.pathname, "/login/oauth/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "client-id"); assert.equal(parsed.searchParams.get("redirect_uri"), "https://pinaka.example/auth/github/callback");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256"); assert.match(parsed.searchParams.get("state"), /^[A-Za-z0-9_-]+$/); assert.match(parsed.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]+$/);
  assert.equal(parsed.searchParams.get("scope"), "public_repo read:user");
});

test("callback creates HttpOnly session and readable CSRF cookie", async () => {
  const service = makeService(); const authUrl = new URL(service.begin());
  const result = await service.callback({ code: "temporary-code", state: authUrl.searchParams.get("state") });
  assert.equal(result.session.user.login, "ajay"); assert.equal(result.session.githubToken, "gho_test_token");
  assert.equal(Array.isArray(result.setCookies), true); assert.equal(result.setCookies.length, 2);
  const sessionCookie = result.setCookies[0]; const csrfCookie = result.setCookies[1];
  assert.match(sessionCookie, /^pinaka_session=/); assert.match(sessionCookie, /HttpOnly/); assert.match(sessionCookie, /SameSite=Lax/);
  assert.match(csrfCookie, /^pinaka_csrf=/); assert.doesNotMatch(csrfCookie, /HttpOnly/); assert.match(csrfCookie, /SameSite=Lax/);
  const session = service.getSession({ cookie: sessionCookie.split(";")[0] });
  assert.equal(session.user.login, "ajay"); assert.equal(session.githubToken, "gho_test_token");
  assert.doesNotThrow(() => service.assertCsrf({ cookie: `${sessionCookie.split(";")[0]}; ${csrfCookie.split(";")[0]}`, "x-csrf-token": csrfCookie.split(";")[0].slice("pinaka_csrf=".length) }));
});

test("CSRF rejects missing, forged, and malformed tokens", async () => {
  const service = makeService(); const authUrl = new URL(service.begin()); const result = await service.callback({ code: "code", state: authUrl.searchParams.get("state") });
  const sessionCookie = result.setCookies[0].split(";")[0];
  const csrf = result.setCookies[1].split(";")[0].split("=")[1];
  assert.throws(() => service.assertCsrf({ cookie: sessionCookie }), (error) => error.code === "CSRF_REQUIRED");
  assert.throws(() => service.assertCsrf({ cookie: sessionCookie, "x-csrf-token": "forged" }), (error) => error.code === "CSRF_REQUIRED");
  assert.throws(() => service.assertCsrf({ cookie: sessionCookie, "x-csrf-token": csrf.slice(0, 10) }), (error) => error.code === "CSRF_REQUIRED");
});

test("callback rejects a reused or forged OAuth state", async () => {
  const service = makeService(); const authUrl = new URL(service.begin()); const state = authUrl.searchParams.get("state");
  await assert.rejects(() => service.callback({ code: "code", state: "forged" }), (error) => error.code === "GITHUB_STATE_INVALID");
  await service.callback({ code: "code", state });
  await assert.rejects(() => service.callback({ code: "code", state }), (error) => error.code === "GITHUB_STATE_INVALID");
});

test("logout revokes the session and clears both cookies", async () => {
  const service = makeService(); const authUrl = new URL(service.begin()); const result = await service.callback({ code: "code", state: authUrl.searchParams.get("state") });
  const sessionCookie = result.setCookies[0].split(";")[0]; const clearCookies = service.logout({ cookie: sessionCookie });
  assert.equal(Array.isArray(clearCookies), true); assert.equal(clearCookies.length, 2); assert.ok(clearCookies.every((cookie) => /Max-Age=0/.test(cookie))); assert.equal(service.getSession({ cookie: sessionCookie }), null);
});
