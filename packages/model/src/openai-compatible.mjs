import { assertModelString, ModelError } from "./errors.mjs";

const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
const MAX_MESSAGES = 128;
const MAX_MESSAGE_CHARS = 200_000;
const MAX_TOOLS = 128;
const MAX_TOOL_NAME_LENGTH = 128;

function validateRole(role) {
  if (!["system", "user", "assistant", "tool"].includes(role)) {
    throw new ModelError("unsupported message role", "INVALID_MESSAGE_ROLE", { role });
  }
  return role;
}

function validateToolCalls(toolCalls, index) {
  if (toolCalls === undefined) return undefined;
  if (!Array.isArray(toolCalls) || toolCalls.length > MAX_TOOLS) {
    throw new ModelError("tool_calls must be an array with at most 128 entries", "INVALID_TOOL_CALLS", { index });
  }
  return toolCalls.map((call, toolIndex) => {
    if (!call || typeof call !== "object") {
      throw new ModelError("each tool call must be an object", "INVALID_TOOL_CALL", { index, toolIndex });
    }
    const id = assertModelString(call.id, "tool call id", { maxLength: MAX_TOOL_NAME_LENGTH });
    const type = call.type === undefined ? "function" : call.type;
    if (type !== "function") throw new ModelError("unsupported tool call type", "INVALID_TOOL_CALL", { index, toolIndex });
    const fn = call.function;
    if (!fn || typeof fn !== "object") throw new ModelError("tool call function is required", "INVALID_TOOL_CALL", { index, toolIndex });
    const name = assertModelString(fn.name, "tool call name", { maxLength: MAX_TOOL_NAME_LENGTH });
    const args = fn.arguments === undefined ? "{}" : fn.arguments;
    if (typeof args !== "string" || args.length > MAX_MESSAGE_CHARS) {
      throw new ModelError("tool call arguments must be bounded text", "INVALID_TOOL_CALL", { index, toolIndex });
    }
    return { id, type: "function", function: { name, arguments: args } };
  });
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
    if (message.content !== null && typeof message.content !== "string") {
      throw new ModelError("message content must be text or null", "INVALID_MESSAGE_CONTENT", { index });
    }
    const content = message.content ?? "";
    totalChars += content.length;
    if (totalChars > MAX_MESSAGE_CHARS) {
      throw new ModelError("message content is too large", "MODEL_INPUT_TOO_LARGE", { maxChars: MAX_MESSAGE_CHARS });
    }
    const safe = { role, content: message.content };
    const toolCalls = validateToolCalls(message.tool_calls, index);
    if (toolCalls !== undefined) safe.tool_calls = toolCalls;
    if (role === "tool") {
      const toolCallId = assertModelString(message.tool_call_id, "tool_call_id", { maxLength: MAX_TOOL_NAME_LENGTH });
      safe.tool_call_id = toolCallId;
    }
    return safe;
  });
}

function validateTools(tools) {
  if (tools === undefined) return undefined;
  if (!Array.isArray(tools) || tools.length > MAX_TOOLS) {
    throw new ModelError("tools must be an array with at most 128 entries", "INVALID_TOOLS");
  }
  return tools.map((tool, index) => {
    if (!tool || typeof tool !== "object" || tool.type !== "function" || !tool.function || typeof tool.function !== "object") {
      throw new ModelError("each tool must be a function tool definition", "INVALID_TOOL_DEFINITION", { index });
    }
    const name = assertModelString(tool.function.name, "tool name", { maxLength: MAX_TOOL_NAME_LENGTH });
    const description = tool.function.description === undefined ? "" : tool.function.description;
    if (typeof description !== "string" || description.length > 4_000) {
      throw new ModelError("tool description is invalid", "INVALID_TOOL_DEFINITION", { index });
    }
    const parameters = tool.function.parameters;
    if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)) {
      throw new ModelError("tool parameters schema is required", "INVALID_TOOL_DEFINITION", { index });
    }
    return {
      type: "function",
      function: {
        name,
        description,
        parameters
      }
    };
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

function isGemini3Model(model) {
  return /^gemini-3(?:\.|-)/i.test(model);
}

function friendlyProviderError(status) {
  if (status === 400) return "AI provider rejected the request. The selected model may not support one of the request options.";
  if (status === 401) return "AI provider rejected the API key. Check that the key is correct and active.";
  if (status === 403) return "AI provider denied access. Check the API key, project permissions, and model access.";
  if (status === 404) return "AI model or endpoint was not found. Choose a supported model or check the provider URL.";
  if (status === 429) return "AI provider rate limit reached. Wait a moment or switch to another provider/model.";
  if (status >= 500) return "AI provider is temporarily unavailable. Try again in a moment or switch providers.";
  return `AI provider returned HTTP ${status}.`;
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

  async chat({ messages, temperature, maxOutputTokens = DEFAULT_MAX_OUTPUT_TOKENS, signal, tools, toolChoice } = {}) {
    const safeMessages = validateMessages(messages);
    const maxTokens = validateMaxOutputTokens(maxOutputTokens);
    const safeTools = validateTools(tools);
    if (temperature !== undefined && (typeof temperature !== "number" || temperature < 0 || temperature > 2)) {
      throw new ModelError("temperature must be between 0 and 2", "INVALID_TEMPERATURE");
    }
    if (toolChoice !== undefined && toolChoice !== "auto" && toolChoice !== "none" && toolChoice !== "required" &&
        !(toolChoice && typeof toolChoice === "object" && toolChoice.type === "function" && toolChoice.function?.name)) {
      throw new ModelError("toolChoice is invalid", "INVALID_TOOL_CHOICE");
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
    if (temperature !== undefined && !isGemini3Model(this.#model)) body.temperature = temperature;
    if (safeTools !== undefined) body.tools = safeTools;
    if (toolChoice !== undefined) body.tool_choice = toolChoice;

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
      throw new ModelError(friendlyProviderError(response.status), "MODEL_PROVIDER_ERROR", {
        status: response.status,
        providerError: typeof payload?.error?.message === "string"
          ? payload.error.message.slice(0, 500)
          : typeof payload?.message === "string"
            ? payload.message.slice(0, 500)
            : "unknown provider error"
      });
    }

    const message = payload?.choices?.[0]?.message;
    if (!message || typeof message !== "object") {
      throw new ModelError("model response did not contain a message", "INVALID_MODEL_RESPONSE");
    }
    const content = message.content === null || typeof message.content === "string" ? message.content : null;
    const toolCalls = validateToolCalls(message.tool_calls, 0);
    if (typeof content !== "string" && !toolCalls?.length) {
      throw new ModelError("model response did not contain text or tool calls", "INVALID_MODEL_RESPONSE");
    }

    return {
      content: content ?? "",
      toolCalls: toolCalls || [],
      model: payload.model || this.#model,
      id: payload.id || null,
      usage: payload.usage || null
    };
  }
}
