import { assertModelString, ModelError } from "./errors.mjs";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const MAX_MESSAGES = 128;
const MAX_MESSAGE_CHARS = 200_000;

function validateRole(role) {
  if (!["system", "user", "assistant", "tool"].includes(role)) {
    throw new ModelError("unsupported message role", "INVALID_MESSAGE_ROLE", { role });
  }
  return role;
}

function validateMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES) {
    throw new ModelError("messages must contain between 1 and 128 entries", "INVALID_MESSAGES");
  }
  let totalChars = 0;
  return messages.map((message, index) => {
    if (!message || typeof message !== "object") {
      throw new ModelError("each message must be an object", "INVALID_MESSAGE", { index });
    }
    const role = validateRole(message.role);
    if (typeof message.content !== "string") {
      throw new ModelError("message content must be text", "INVALID_MESSAGE_CONTENT", { index });
    }
    totalChars += message.content.length;
    if (totalChars > MAX_MESSAGE_CHARS) {
      throw new ModelError("message content is too large", "MODEL_INPUT_TOO_LARGE", { maxChars: MAX_MESSAGE_CHARS });
    }
    return { role, content: message.content };
  });
}

function validateTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1_000 || timeoutMs > 300_000) {
    throw new ModelError("timeoutMs must be between 1000 and 300000", "INVALID_TIMEOUT");
  }
  return timeoutMs;
}

function validateMaxOutputTokens(value) {
  if (!Number.isInteger(value) || value < 1 || value > 32_768) {
    throw new ModelError("maxOutputTokens must be between 1 and 32768", "INVALID_MAX_OUTPUT_TOKENS");
  }
  return value;
}

function normalizeBaseUrl(baseUrl) {
  assertModelString(baseUrl, "baseUrl", { maxLength: 2_048 });
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new ModelError("baseUrl must be a valid URL", "INVALID_BASE_URL");
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new ModelError("model endpoint must use HTTPS except localhost", "INSECURE_BASE_URL");
  }
  return parsed.toString().replace(/\/$/, "");
}

export class OpenAICompatibleProvider {
  #baseUrl;
  #apiKey;
  #model;
  #timeoutMs;
  #fetch;

  constructor({
    baseUrl = DEFAULT_BASE_URL,
    apiKey = "",
    model,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
    extraHeaders = {}
  } = {}) {
    this.#baseUrl = normalizeBaseUrl(baseUrl);
    this.#apiKey = apiKey;
    this.#model = assertModelString(model, "model", { maxLength: 256 });
    this.#timeoutMs = validateTimeout(timeoutMs);
    if (typeof fetchImpl !== "function") throw new ModelError("fetch implementation is required", "FETCH_UNAVAILABLE");
    this.#fetch = fetchImpl;
    this.extraHeaders = { ...extraHeaders };
  }

  get model() {
    return this.#model;
  }

  async chat({ messages, temperature, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, signal } = {}) {
    const safeMessages = validateMessages(messages);
    const maxTokens = validateMaxOutputTokens(maxOutputTokens);
    if (temperature !== undefined && (typeof temperature !== "number" || temperature < 0 || temperature > 2)) {
      throw new ModelError("temperature must be between 0 and 2", "INVALID_TEMPERATURE");
    }

    const headers = {
      "content-type": "application/json",
      ...this.extraHeaders
    };
    if (this.#apiKey) headers.authorization = `Bearer ${this.#apiKey}`;

    const body = {
      model: this.#model,
      messages: safeMessages,
      max_tokens: maxTokens
    };
    if (temperature !== undefined) body.temperature = temperature;

    const timeoutController = new AbortController();
    const timer = setTimeout(() => timeoutController.abort(new Error("model request timed out")), this.#timeoutMs);
    const combinedSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;

    let response;
    try {
      response = await this.#fetch(`${this.#baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: combinedSignal
      });
    } catch (error) {
      if (error?.name === "AbortError") throw new ModelError("model request timed out or was cancelled", "MODEL_REQUEST_ABORTED");
      throw new ModelError("model request failed", "MODEL_REQUEST_FAILED", { cause: error?.message });
    } finally {
      clearTimeout(timer);
    }

    const text = await response.text();
    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new ModelError("model returned invalid JSON", "INVALID_MODEL_RESPONSE", { status: response.status });
    }

    if (!response.ok) {
      throw new ModelError("model provider returned an error", "MODEL_PROVIDER_ERROR", {
        status: response.status,
        providerError: payload?.error?.message || payload?.message || "unknown provider error"
      });
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      throw new ModelError("model response did not contain text", "INVALID_MODEL_RESPONSE");
    }

    return {
      content,
      model: payload.model || this.#model,
      id: payload.id || null,
      usage: payload.usage || null
    };
  }
}
