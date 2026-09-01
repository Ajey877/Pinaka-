import test from "node:test";
import assert from "node:assert/strict";
import { GitHubAuthService, __test } from "../src/auth-service.mjs";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

test("PKCE challenge is deterministic and produces a URL-safe value", () => {
  const verifier = "A".repeat(43);
  const challenge = __test.makeChallenge(verifier);
  assert.match(challenge, /^[A-Za-z0-9_-]+$/);
  assert.equal(challenge, __test.makeChallenge(verifier));
});

test("begin creates a stateful PKCE authorization URL", () => {
  const service = new GitHubAuthService({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://pinaka.example/auth/github/callback",
    fetchImpl: async () => jsonResponse({})
  });
  const url = service.begin();
  const parsed = new URL(url);
  assert.equal(parsed.origin, "https://github.com");
  assert.equal(parsed.pathname, "/login/oauth/authorize");
  assert.equal(parsed.searchParams.get("client_id"), "client-id");
  assert.equal(parsed.searchParams.get("redirect_uri"), "https://pinaka.example/auth/github/callback");
  assert.equal(parsed.searchParams.get("code_challenge_method"), "S256");
  assert.match(parsed.searchParams.get("state"), /^[A-Za-z0-9_-]+$/);
  assert.match(parsed.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]+$/);
});

test("callback exchanges code with PKCE and creates a server-side session", async () => {
  const requests = [];
  const service = new GitHubAuthService({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://pinaka.example/auth/github/callback",
    fetchImpl: async (url, init) => {
      requests.push({ url, init });
      if (url === "https://github.com/login/oauth/access_token") return jsonResponse({ access_token: "gho_test_token" });
      return jsonResponse({ id: 123, login: "ajay", name: "Ajay", avatar_url: "https://avatars.example/a.png" });
    }
  });

  const authUrl = new URL(service.begin());
  const result = await service.callback({ code: "temporary-code", state: authUrl.searchParams.get("state") });

  assert.equal(result.session.user.login, "ajay");
  assert.equal(result.session.githubToken, "gho_test_token");
  assert.match(result.setCookie, /^pinaka_session=/);
  assert.match(result.setCookie, /HttpOnly/);
  assert.match(result.setCookie, /SameSite=Lax/);
  assert.equal(requests.length, 2);
  const tokenBody = JSON.parse(requests[0].init.body);
  assert.equal(tokenBody.client_id, "client-id");
  assert.equal(tokenBody.client_secret, "client-secret");
  assert.equal(tokenBody.code, "temporary-code");
  assert.equal(tokenBody.redirect_uri, "https://pinaka.example/auth/github/callback");
  assert.equal(typeof tokenBody.code_verifier, "string");
  assert.equal(requests[1].init.headers.authorization, "Bearer gho_test_token");

  const session = service.getSession({ cookie: result.setCookie.split(";")[0] });
  assert.equal(session.user.login, "ajay");
  assert.equal(session.githubToken, "gho_test_token");
});

test("callback rejects a reused or forged OAuth state", async () => {
  const service = new GitHubAuthService({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://pinaka.example/auth/github/callback",
    fetchImpl: async () => jsonResponse({ access_token: "unused" })
  });
  const authUrl = new URL(service.begin());
  const state = authUrl.searchParams.get("state");
  await assert.rejects(() => service.callback({ code: "code", state: "forged" }), (error) => error.code === "GITHUB_STATE_INVALID");
  await assert.rejects(() => service.callback({ code: "code", state }), (error) => error.code === "GITHUB_USER_INVALID" || error.code === "GITHUB_AUTH_FAILED");
  await assert.rejects(() => service.callback({ code: "code", state }), (error) => error.code === "GITHUB_STATE_INVALID");
});

test("logout revokes the in-memory session and clears the cookie", async () => {
  const service = new GitHubAuthService({
    clientId: "client-id",
    clientSecret: "client-secret",
    redirectUri: "https://pinaka.example/auth/github/callback",
    fetchImpl: async (url) => url.endsWith("access_token") ? jsonResponse({ access_token: "token" }) : jsonResponse({ id: 7, login: "user" })
  });
  const authUrl = new URL(service.begin());
  const result = await service.callback({ code: "code", state: authUrl.searchParams.get("state") });
  const cookie = result.setCookie.split(";")[0];
  assert.ok(service.getSession({ cookie }));
  const cleared = service.logout({ cookie });
  assert.match(cleared, /Max-Age=0/);
  assert.equal(service.getSession({ cookie }), null);
});
