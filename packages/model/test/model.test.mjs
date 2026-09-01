import test from "node:test";
import assert from "node:assert/strict";
import { ModelError, ModelRouter, OpenAICompatibleProvider } from "../src/index.mjs";

function jsonResponse(payload, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify(payload);
    }
  };
}

test("OpenAICompatibleProvider sends a normalized chat request", async () => {
  let request;
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://example.com/v1",
    apiKey: "test-key",
    model: "test-model",
    fetchImpl: async (url, options) => {
      request = { url, options };
      return jsonResponse({
        id: "resp-1",
        model: "test-model",
        choices: [{ message: { content: "hello" } }],
        usage: { total_tokens: 3 }
      });
    }
  });

  const result = await provider.chat({
    messages: [{ role: "system", content: "You code safely." }, { role: "user", content: "Say hello" }],
    temperature: 0,
    maxOutputTokens: 100
  });

  assert.equal(result.content, "hello");
  assert.equal(request.url, "https://example.com/v1/chat/completions");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.headers.authorization, "Bearer test-key");
  assert.deepEqual(JSON.parse(request.options.body), {
    model: "test-model",
    messages: [
      { role: "system", content: "You code safely." },
      { role: "user", content: "Say hello" }
    ],
    max_tokens: 100,
    temperature: 0
  });
});

test("provider never requires an API key for local or public endpoints", async () => {
  let authorization = null;
  const provider = new OpenAICompatibleProvider({
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local-model",
    fetchImpl: async (_url, options) => {
      authorization = options.headers.authorization || null;
      return jsonResponse({ choices: [{ message: { content: "local" } }] });
    }
  });

  const result = await provider.chat({ messages: [{ role: "user", content: "test" }] });
  assert.equal(result.content, "local");
  assert.equal(authorization, null);
});

test("provider validates bad input and provider errors", async () => {
  const provider = new OpenAICompatibleProvider({
    baseUrl: "https://example.com/v1",
    model: "test-model",
    fetchImpl: async () => jsonResponse({ error: { message: "rate limited" } }, { status: 429 })
  });

  await assert.rejects(
    () => provider.chat({ messages: [] }),
    (error) => error instanceof ModelError && error.code === "INVALID_MESSAGES"
  );
  await assert.rejects(
    () => provider.chat({ messages: [{ role: "user", content: "test" }] }),
    (error) => error instanceof ModelError && error.code === "MODEL_PROVIDER_ERROR" && error.details.status === 429
  );
});

test("router registers, selects, and rejects providers safely", async () => {
  const router = new ModelRouter();
  const provider = { chat: async () => ({ content: "ok" }) };
  router.register("free", provider);
  assert.deepEqual(router.list(), ["free"]);
  assert.equal((await router.chat({ messages: [{ role: "user", content: "x" }] })).content, "ok");
  assert.throws(() => router.register("free", provider), (error) => error instanceof ModelError && error.code === "PROVIDER_EXISTS");
  assert.throws(() => router.setDefault("missing"), (error) => error instanceof ModelError && error.code === "PROVIDER_NOT_FOUND");
});
