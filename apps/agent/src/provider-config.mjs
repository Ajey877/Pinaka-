import { resolveProviderConfig, listProviders, freeProviderCatalog } from "@pinaka/model";

export function publicProviderConfig() {
  return {
    providers: listProviders().map(({ id, name, mode, baseUrl, docsUrl, envVar, models }) => ({ id, name, mode, baseUrl, docsUrl, envVar, models })),
    freeProviders: freeProviderCatalog()
  };
}

export function resolveTaskModelConfig(body = {}) {
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";
  const model = typeof body.model === "string" ? body.model.trim() : "";
  const provider = typeof body.provider === "string" ? body.provider.trim() : "";
  if (apiKey.length > 16_384) throw Object.assign(new Error("AI API key is too long"), { statusCode: 400, code: "MODEL_API_KEY_TOO_LARGE" });
  return resolveProviderConfig({ provider, model, apiKey, baseUrl });
}
