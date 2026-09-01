import { ModelError, assertModelString } from "./errors.mjs";

export class ModelRouter {
  #providers = new Map();
  #defaultProvider = null;

  register(name, provider, { defaultProvider = false } = {}) {
    assertModelString(name, "provider name", { maxLength: 128 });
    if (!provider || typeof provider.chat !== "function") {
      throw new ModelError("provider must expose chat()", "INVALID_PROVIDER");
    }
    if (this.#providers.has(name)) throw new ModelError(`provider already registered: ${name}`, "PROVIDER_EXISTS");
    this.#providers.set(name, provider);
    if (defaultProvider || this.#defaultProvider === null) this.#defaultProvider = name;
    return this;
  }

  setDefault(name) {
    assertModelString(name, "provider name", { maxLength: 128 });
    if (!this.#providers.has(name)) throw new ModelError(`provider not found: ${name}`, "PROVIDER_NOT_FOUND");
    this.#defaultProvider = name;
  }

  list() {
    return [...this.#providers.keys()];
  }

  get(name = this.#defaultProvider) {
    if (!name || !this.#providers.has(name)) throw new ModelError("no model provider is configured", "PROVIDER_NOT_FOUND");
    return this.#providers.get(name);
  }

  async chat(request, { provider } = {}) {
    return this.get(provider).chat(request);
  }
}
