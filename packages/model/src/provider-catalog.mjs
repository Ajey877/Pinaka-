const FREE_MODEL_TTL_MS = 10 * 60 * 1000;

export const PROVIDER_CATALOG = Object.freeze([
  Object.freeze({
    id: "gemini",
    name: "Google Gemini",
    mode: "free-or-key",
    freeTier: true,
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    envVar: "GEMINI_API_KEY",
    docsUrl: "https://aistudio.google.com/apikey",
    models: Object.freeze([
      Object.freeze({ id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", free: true }),
      Object.freeze({ id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash-Lite", free: true })
    ])
  }),
  Object.freeze({
    id: "openrouter",
    name: "OpenRouter",
    mode: "free-or-key",
    freeTier: true,
    baseUrl: "https://openrouter.ai/api/v1",
    envVar: "OPENROUTER_API_KEY",
    docsUrl: "https://openrouter.ai/keys",
    models: Object.freeze([
      Object.freeze({ id: "openrouter/free", name: "OpenRouter Free Router", free: true })
    ])
  }),
  Object.freeze({
    id: "groq",
    name: "Groq",
    mode: "free-tier-or-key",
    freeTier: true,
    baseUrl: "https://api.groq.com/openai/v1",
    envVar: "GROQ_API_KEY",
    docsUrl: "https://console.groq.com/keys",
    models: Object.freeze([
      Object.freeze({ id: "openai/gpt-oss-20b", name: "GPT-OSS 20B", free: false })
    ])
  }),
  Object.freeze({
    id: "openai",
    name: "OpenAI",
    mode: "key",
    freeTier: false,
    baseUrl: "https://api.openai.com/v1",
    envVar: "OPENAI_API_KEY",
    docsUrl: "https://platform.openai.com/api-keys",
    models: Object.freeze([
      Object.freeze({ id: "gpt-4o-mini", name: "GPT-4o mini", free: false })
    ])
  }),
  Object.freeze({
    id: "custom",
    name: "Custom OpenAI-compatible",
    mode: "key",
    freeTier: false,
    baseUrl: "",
    envVar: null,
    docsUrl: null,
    models: Object.freeze([])
  })
]);

export function listProviders() {
  return PROVIDER_CATALOG.map((provider) => ({
    ...provider,
    models: provider.models.map((model) => ({ ...model }))
  }));
}

export function getProvider(providerId) {
  return PROVIDER_CATALOG.find((provider) => provider.id === providerId) || null;
}

export function resolveProviderConfig({ provider = "", model = "", apiKey = "", baseUrl = "" } = {}, env = process.env) {
  const selected = getProvider(provider || "openrouter");
  if (!selected) throw Object.assign(new Error("unsupported model provider"), { statusCode: 400, code: "MODEL_PROVIDER_UNSUPPORTED" });

  const resolvedKey = apiKey || (selected.envVar ? env[selected.envVar] || "" : "");
  const resolvedBaseUrl = baseUrl || selected.baseUrl;
  const firstModel = selected.models[0]?.id || "";
  const resolvedModel = model || firstModel || env.PINAKA_MODEL || "";

  if (!resolvedModel) throw Object.assign(new Error("model is required for this provider"), { statusCode: 400, code: "MODEL_REQUIRED" });
  if (!resolvedKey) throw Object.assign(new Error("an AI API key is required for this provider"), { statusCode: 401, code: "MODEL_API_KEY_REQUIRED" });
  if (!resolvedBaseUrl) throw Object.assign(new Error("base URL is required for a custom provider"), { statusCode: 400, code: "MODEL_BASE_URL_REQUIRED" });

  return {
    providerId: selected.id,
    providerName: selected.name,
    model: resolvedModel,
    apiKey: resolvedKey,
    baseUrl: resolvedBaseUrl
  };
}

export function freeProviderCatalog() {
  return listProviders().filter((provider) => provider.freeTier || provider.models.some((model) => model.free)).map((provider) => ({
    ...provider,
    models: provider.models.filter((model) => model.free)
  }));
}

export function providerCacheSeconds() {
  return Math.floor(FREE_MODEL_TTL_MS / 1000);
}
