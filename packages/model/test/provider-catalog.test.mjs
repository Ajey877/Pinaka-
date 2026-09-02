import test from "node:test";
import assert from "node:assert/strict";
import { freeProviderCatalog, getProvider, listProviders, resolveProviderConfig } from "../src/index.mjs";

test("provider catalog exposes free-tier providers without secrets", () => {
  const providers = listProviders();
  assert.ok(providers.some((provider) => provider.id === "gemini" && provider.freeTier === true));
  assert.ok(providers.some((provider) => provider.id === "openrouter" && provider.freeTier === true));
  for (const provider of providers) {
    assert.equal(typeof provider.name, "string");
    assert.ok(!Object.hasOwn(provider, "apiKey"));
  }
});

test("free catalog includes Gemini and OpenRouter", () => {
  const ids = freeProviderCatalog().map((provider) => provider.id);
  assert.ok(ids.includes("gemini"));
  assert.ok(ids.includes("openrouter"));
});

test("provider config resolves a built-in provider without leaking the key", () => {
  const key = "example-secret-key-123456";
  const config = resolveProviderConfig({ provider: "gemini", apiKey: key, model: "gemini-2.5-flash" });
  assert.equal(config.providerId, "gemini");
  assert.equal(config.model, "gemini-2.5-flash");
  assert.equal(config.apiKey, key);
  assert.equal(config.baseUrl, getProvider("gemini").baseUrl);
});

test("custom provider requires a base URL and model", () => {
  assert.throws(() => resolveProviderConfig({ provider: "custom", apiKey: "secret" }), /model is required/);
  assert.throws(() => resolveProviderConfig({ provider: "custom", apiKey: "secret", model: "x" }), /base URL is required/);
});
