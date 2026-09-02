const state = { provider: "", model: "", apiKey: "", baseUrl: "" };
const originalFetch = window.fetch.bind(window);

function byId(id) {
  return document.getElementById(id);
}

function setMessage(text, ok = null) {
  const node = byId("modelMessage");
  if (!node) return;
  node.textContent = text;
  node.className = `model-message ${ok === true ? "model-ok" : ok === false ? "model-bad" : ""}`;
}

function renderModels(provider) {
  const select = byId("modelSelect");
  const customBase = byId("baseUrlField");
  const customModel = byId("customModelField");
  const customBaseInput = byId("baseUrlInput");
  const customModelInput = byId("customModelInput");
  if (!select || !provider) return;

  select.replaceChildren();
  const models = Array.isArray(provider.models) ? provider.models : [];
  models.forEach((model) => {
    const option = document.createElement("option");
    option.value = model.id;
    option.textContent = `${model.name}${model.free ? " · Free" : ""}`;
    select.appendChild(option);
  });

  const isCustom = provider.id === "custom";
  select.disabled = isCustom;
  state.model = models[0]?.id || "";
  state.baseUrl = isCustom ? "" : provider.baseUrl || "";
  if (!isCustom) select.value = state.model;

  if (customBase) customBase.hidden = !isCustom;
  if (customModel) customModel.hidden = !isCustom;
  if (customBaseInput) customBaseInput.value = isCustom ? state.baseUrl : provider.baseUrl || "";
  if (customModelInput) customModelInput.value = "";

  const keyLink = byId("modelKeyLink");
  if (keyLink) {
    if (provider.docsUrl) {
      keyLink.href = provider.docsUrl;
      keyLink.hidden = false;
      keyLink.textContent = provider.freeTier ? "Get a free key" : "Get API key";
    } else {
      keyLink.hidden = true;
    }
  }

  const badge = byId("modelBadge");
  if (badge) badge.textContent = provider.freeTier ? "Free tier" : "BYOK";
}

function renderProviders(providers) {
  const select = byId("providerSelect");
  if (!select) return;
  select.replaceChildren();
  providers.forEach((provider) => {
    const option = document.createElement("option");
    option.value = provider.id;
    option.textContent = `${provider.name}${provider.freeTier ? " · Free tier" : ""}`;
    select.appendChild(option);
  });
  const initial = providers.find((provider) => provider.id === "gemini") || providers[0];
  if (!initial) return;
  select.value = initial.id;
  state.provider = initial.id;
  renderModels(initial);
  select.addEventListener("change", () => {
    state.provider = select.value;
    const provider = providers.find((item) => item.id === state.provider);
    renderModels(provider);
    setMessage("");
  });
}

async function loadProviders() {
  try {
    const response = await originalFetch("/v1/models/providers", { headers: { accept: "application/json" } });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.message || "Unable to load AI providers");
    renderProviders(Array.isArray(payload.providers) ? payload.providers : []);
  } catch (error) {
    setMessage(error.message || "Unable to load AI providers", false);
  }
}

const modelPanel = byId("modelPanel");
if (modelPanel) {
  const keyInput = byId("apiKeyInput");
  const modelSelect = byId("modelSelect");
  const baseUrlInput = byId("baseUrlInput");
  const customModelInput = byId("customModelInput");
  const testButton = byId("testModelButton");

  modelSelect?.addEventListener("change", () => { state.model = modelSelect.value.trim(); });
  keyInput?.addEventListener("input", () => { state.apiKey = keyInput.value; setMessage(""); });
  baseUrlInput?.addEventListener("input", () => { state.baseUrl = baseUrlInput.value.trim(); });
  customModelInput?.addEventListener("input", () => { state.model = customModelInput.value.trim(); });

  testButton?.addEventListener("click", async () => {
    state.apiKey = keyInput?.value.trim() || "";
    state.baseUrl = baseUrlInput?.value.trim() || state.baseUrl;
    const rawModel = state.provider === "custom" ? customModelInput?.value : modelSelect?.value;
    state.model = rawModel?.trim() || "";
    if (!state.apiKey) return setMessage("Enter your AI API key first.", false);
    testButton.disabled = true;
    setMessage("Testing AI connection…");
    try {
      const response = await originalFetch("/v1/models/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(state)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.message || `Connection failed (${response.status})`);
      setMessage(`Connected · ${payload.provider} · ${payload.model} · ${payload.latencyMs} ms`, true);
    } catch (error) {
      setMessage(error.message || "Connection failed", false);
    } finally {
      testButton.disabled = false;
    }
  });

  window.fetch = async (input, init = {}) => {
    const url = typeof input === "string" ? input : input?.url || "";
    if (!url.endsWith("/v1/agent/run")) return originalFetch(input, init);

    state.apiKey = keyInput?.value.trim() || state.apiKey;
    state.baseUrl = baseUrlInput?.value.trim() || state.baseUrl;
    const rawModel = state.provider === "custom" ? customModelInput?.value : modelSelect?.value;
    state.model = rawModel?.trim() || state.model;
    if (!state.apiKey) throw new Error("AI API key is required. Choose a provider and enter your key.");
    if (!state.model) throw new Error("Choose or enter an AI model before starting the task.");
    if (state.provider === "custom" && !state.baseUrl) throw new Error("Enter a base URL for the custom provider.");

    const sourceOptions = typeof input === "object" && input instanceof Request
      ? { method: input.method, headers: input.headers, body: await input.text() }
      : init;
    let body = {};
    try { body = JSON.parse(sourceOptions.body || "{}"); } catch { throw new Error("Pinaka could not prepare the task request."); }
    const payload = { ...body, provider: state.provider, model: state.model, apiKey: state.apiKey, baseUrl: state.baseUrl };
    const nextOptions = { ...init, method: "POST", headers: { ...(init.headers || {}), "content-type": "application/json" }, body: JSON.stringify(payload) };
    const response = await originalFetch(input, nextOptions);
    if (response.ok) {
      state.apiKey = "";
      if (keyInput) keyInput.value = "";
    }
    return response;
  };

  loadProviders();
}
