import { ModelError } from "@pinaka/model";

const DEFAULT_MAX_ROUNDS = 12;
const MAX_TOOL_CALLS_PER_ROUND = 16;
const MAX_TOOL_RESULT_CHARS = 50_000;
const MAX_TOTAL_TOOL_CALLS = 64;

function validatePositiveInteger(value, name, max) {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new ModelError(`${name} must be a positive integer no greater than ${max}`, `INVALID_${name.toUpperCase()}`);
  }
  return value;
}

function parseArguments(raw, toolName) {
  if (raw === undefined || raw === "") return {};
  if (typeof raw !== "string") {
    throw new ModelError(`tool arguments for ${toolName} must be text`, "INVALID_TOOL_ARGUMENTS");
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("arguments must be a JSON object");
    }
    return parsed;
  } catch (error) {
    throw new ModelError(`tool arguments for ${toolName} are invalid JSON`, "INVALID_TOOL_ARGUMENTS", {
      cause: error?.message
    });
  }
}

function serializeToolResult(value, toolName) {
  let result;
  try {
    result = JSON.stringify(value ?? null);
  } catch (error) {
    throw new ModelError(`tool ${toolName} returned unserializable data`, "INVALID_TOOL_RESULT", {
      cause: error?.message
    });
  }
  if (result.length > MAX_TOOL_RESULT_CHARS) {
    throw new ModelError(`tool ${toolName} returned too much data`, "TOOL_RESULT_TOO_LARGE", {
      maxChars: MAX_TOOL_RESULT_CHARS
    });
  }
  return result;
}

function validateRouter(router) {
  if (!router || typeof router.chat !== "function") {
    throw new ModelError("model router is required", "ROUTER_REQUIRED");
  }
  return router;
}

function validateRegistry(registry) {
  if (!registry || typeof registry.execute !== "function" || typeof registry.definitions !== "function" || typeof registry.has !== "function") {
    throw new ModelError("tool registry is required", "TOOL_REGISTRY_REQUIRED");
  }
  return registry;
}

export async function runToolCallingLoop({
  router,
  registry,
  messages,
  provider,
  maxOutputTokens,
  maxRounds = DEFAULT_MAX_ROUNDS,
  signal,
  toolChoice = "auto"
} = {}) {
  validateRouter(router);
  validateRegistry(registry);
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new ModelError("messages must contain at least one entry", "INVALID_MESSAGES");
  }
  validatePositiveInteger(maxRounds, "maxRounds", DEFAULT_MAX_ROUNDS);

  const conversation = messages.map((message) => ({ ...message }));
  const toolDefinitions = registry.definitions();
  let totalToolCalls = 0;
  let lastResponse = null;

  for (let round = 1; round <= maxRounds; round += 1) {
    const response = await router.chat(
      {
        messages: conversation,
        tools: toolDefinitions,
        toolChoice,
        maxOutputTokens,
        signal
      },
      { provider }
    );
    lastResponse = response;

    const toolCalls = Array.isArray(response?.toolCalls) ? response.toolCalls : [];
    if (toolCalls.length === 0) {
      return {
        content: typeof response?.content === "string" ? response.content : "",
        response,
        messages: conversation,
        rounds: round,
        toolCalls: totalToolCalls
      };
    }
    if (toolCalls.length > MAX_TOOL_CALLS_PER_ROUND) {
      throw new ModelError("model requested too many tools in one round", "TOO_MANY_TOOL_CALLS", {
        max: MAX_TOOL_CALLS_PER_ROUND
      });
    }
    if (totalToolCalls + toolCalls.length > MAX_TOTAL_TOOL_CALLS) {
      throw new ModelError("tool call budget exceeded", "TOOL_CALL_BUDGET_EXCEEDED", {
        max: MAX_TOTAL_TOOL_CALLS
      });
    }

    const seenIds = new Set();
    conversation.push({
      role: "assistant",
      content: response.content || null,
      tool_calls: toolCalls
    });

    for (const call of toolCalls) {
      if (!call?.id || seenIds.has(call.id)) {
        throw new ModelError("tool call ids must be unique within a round", "INVALID_TOOL_CALL_ID");
      }
      seenIds.add(call.id);
      const toolName = call.function?.name;
      if (!registry.has(toolName)) {
        throw new ModelError(`model requested unknown tool: ${toolName}`, "UNKNOWN_TOOL_REQUESTED", {
          tool: toolName
        });
      }
      const args = parseArguments(call.function?.arguments, toolName);
      let output;
      try {
        output = await registry.execute(toolName, args);
      } catch (error) {
        output = {
          error: error?.message || "tool execution failed",
          code: error?.code || "TOOL_EXECUTION_FAILED"
        };
      }
      conversation.push({
        role: "tool",
        tool_call_id: call.id,
        content: serializeToolResult(output, toolName)
      });
      totalToolCalls += 1;
    }
  }

  throw new ModelError("tool-calling loop exceeded its round limit", "AGENT_ROUND_LIMIT", {
    maxRounds,
    lastResponse
  });
}
