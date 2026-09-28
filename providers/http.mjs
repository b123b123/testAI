export class ProviderRequestError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "ProviderRequestError";
    this.status = options.status ?? null;
    this.body = options.body ?? null;
    this.url = options.url ?? null;
  }
}

export function joinUrl(baseUrl, endpoint) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  const path = String(endpoint || "").replace(/^\/+/, "");
  return `${base}/${path}`;
}

function apiKeyFromSecrets(providerName, provider, secrets) {
  const ref = provider.apiKeyRef || providerName;
  const store = secrets?.providers || secrets || {};
  const entry = store[ref];

  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") return String(entry.apiKey || "");

  return "";
}

export function resolveApiKey(providerName, provider, secrets = {}) {
  if (provider.apiKey) return String(provider.apiKey);

  const fileApiKey = apiKeyFromSecrets(providerName, provider, secrets);
  if (fileApiKey) return fileApiKey;

  const envName = provider.apiKeyEnv;
  if (envName && process.env[envName]) return process.env[envName];

  const requiresApiKey =
    provider.requiresApiKey === true ||
    provider.apiKeyRef !== undefined ||
    provider.apiKeyEnv !== undefined;

  if (requiresApiKey) {
    const ref = provider.apiKeyRef || providerName;
    throw new Error(
      `Provider "${providerName}" 未配置 API Key。请编辑 secrets.json 中的 providers.${ref}.apiKey，` +
      `或直接在 providers.json 的 providers.${providerName}.apiKey 中填写。`,
    );
  }

  return "";
}

export function authHeaders(providerName, provider, secrets = {}) {
  const apiKey = resolveApiKey(providerName, provider, secrets);

  if (!apiKey) return {};

  const headerName = provider.apiKeyHeader || "Authorization";
  const prefix = provider.apiKeyPrefix ?? "Bearer ";

  return {
    [headerName]: `${prefix}${apiKey}`,
  };
}

export async function postJson({
  url,
  headers = {},
  body,
  timeoutMs = 120000,
  signal,
}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort(new Error(`请求超时（${timeoutMs} ms）`));
  }, timeoutMs);

  const abortFromCaller = () => {
    controller.abort(signal.reason);
  };

  if (signal) {
    if (signal.aborted) {
      abortFromCaller();
    } else {
      signal.addEventListener("abort", abortFromCaller, { once: true });
    }
  }

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const rawBody = await response.text();

    if (!response.ok) {
      throw new ProviderRequestError(`模型请求失败（HTTP ${response.status}）`, {
        status: response.status,
        body: rawBody,
        url,
      });
    }

    try {
      return JSON.parse(rawBody);
    } catch {
      throw new ProviderRequestError("模型返回的内容不是有效 JSON", {
        status: response.status,
        body: rawBody,
        url,
      });
    }
  } catch (error) {
    if (error instanceof ProviderRequestError) throw error;

    const message = controller.signal.aborted
      ? String(controller.signal.reason?.message || "请求已取消")
      : error instanceof Error
        ? error.message
        : String(error);

    throw new ProviderRequestError(`请求 ${url} 失败：${message}`, { url });
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromCaller);
  }
}