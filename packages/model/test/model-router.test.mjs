import test from "node:test";
import assert from "node:assert/strict";
import { ModelError, ModelRouter } from "../src/index.mjs";

function provider(label) {
  return {
    async chat(request) {
      return { content: `${label}:${request.messages.at(-1).content}`, model: label, id: null, usage: null };
    }
  };
}

test("router selects the first registered provider by default", async () => {
  const router = new ModelRouter();
  router.register("free", provider("free"));
  router.register("second", provider("second"));

  const result = await router.chat({ messages: [{ role: "user", content: "hello" }] });
  assert.equal(result.content, "free:hello");
});

test("router can select an explicit provider", async () => {
  const router = new ModelRouter();
  router.register("free", provider("free"));
  router.register("second", provider("second"));

  const result = await router.chat(
    { messages: [{ role: "user", content: "hello" }] },
    { provider: "second" }
  );
  assert.equal(result.content, "second:hello");
});

test("router refuses duplicate providers and unknown providers", async () => {
  const router = new ModelRouter();
  router.register("free", provider("free"));
  assert.throws(() => router.register("free", provider("again")), (error) =>
    error instanceof ModelError && error.code === "PROVIDER_EXISTS"
  );
  assert.throws(() => router.setDefault("missing"), (error) =>
    error instanceof ModelError && error.code === "PROVIDER_NOT_FOUND"
  );
});
