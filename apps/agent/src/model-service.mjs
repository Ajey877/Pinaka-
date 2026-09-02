import { OpenAICompatibleProvider, resolveProviderConfig, listProviders } from "@pinaka/model";

function maskKey(value) {
  if (typeof value !== "string" || value.length < 8) return "••••";
  return `${value.slice(0, 3)}••••${value.slice(-4)}`;
}

function safeProviderView(provider) {
  return {
    id: provider.id,
    name: provider.name,
    mode: provider.mode,
    freeTier: provider.freeTier === true,
    baseUrl: provider.baseUrl,
    docsUrl: provider.docsUrl,
    envVar: provider.envVar,
    models: provider.models.map(({ id, name, free }) => ({ id, name, free: free === true }))
  };
}

export function providerCatalog() {
  return listProviders().map(safeProviderView);
}

export async function testModelConnection({ provider, model, apiKey, baseUrl } = {}) {
  const config = resolveProviderConfig({ provider, model, apiKey, baseUrl });
  const instance = new OpenAICompatibleProvider({
    baseUrl: config.baseUrl,
    apiKey: config.apiKey,
    model: config.model,
    timeoutMs: 30_000
  });
  const started = Date.now();
  const response = await instance.chat({
    messages: [{ role: "user", content: "Reply with exactly: PINAKA_OK" }],
    maxOutputTokens: 16,
    temperature: 0
  });
  const normalized = String(response.content || "").trim();
  return {
    ok: true,
    provider: config.providerName,
    model: response.model || config.model,
    latencyMs: Date.now() - started,
    response: normalized.slice(0, 64),
    keyPreview: maskKey(config.apiKey)
  };
}
