import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import * as ollama from "./ollama.mjs";
import * as openaiCompatible from "./openai-compatible.mjs";
import * as openaiResponses from "./openai-responses.mjs";

const adapters = {
  "openai-responses": openaiResponses,
  "openai-compatible": openaiCompatible,
  ollama,
};

async function readSecrets(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) {
      throw new Error(`密钥文件不是有效 JSON：${filePath}`);
    }
    throw error;
  }
}

export async function createProviderRouter(configPath, options = {}) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const providerConfigs = config.providers || {};
  const providerNames = Object.keys(providerConfigs);

  if (providerNames.length === 0) {
    throw new Error("providers.json 至少需要配置一个 Provider");
  }

  const secretsFile =
    options.secretsFile ||
    process.env.SECRETS_FILE ||
    join(dirname(configPath), "secrets.json");
  const secrets =
    options.secrets ||
    await readSecrets(secretsFile);

  const defaultProvider =
    process.env.DEFAULT_PROVIDER || config.defaultProvider || providerNames[0];

  if (!providerConfigs[defaultProvider]) {
    throw new Error(`默认 Provider "${defaultProvider}" 不存在`);
  }

  function resolve(agent = {}) {
    const providerName = agent.provider || defaultProvider;
    const provider = providerConfigs[providerName];

    if (!provider) {
      throw new Error(
        `Agent "${agent.name || agent.id || "unknown"}" 引用了不存在的 Provider "${providerName}"`,
      );
    }

    const adapter = adapters[provider.type];

    if (!adapter) {
      throw new Error(
        `Provider "${providerName}" 使用了不支持的类型 "${provider.type}"`,
      );
    }

    const envModel =
      provider.modelEnv && process.env[provider.modelEnv]
        ? process.env[provider.modelEnv]
        : "";
    const model = agent.model || envModel || provider.model;

    if (!model) {
      throw new Error(
        `Provider "${providerName}" 缺少 model，且 Agent 没有单独指定 model`,
      );
    }

    return {
      providerName,
      providerType: provider.type,
      model,
      provider,
      adapter,
    };
  }

  return {
    defaultProvider,
    providerNames,
    secretsFile,
    resolve(agent) {
      const route = resolve(agent);

      return {
        provider: route.providerName,
        providerType: route.providerType,
        model: route.model,
      };
    },
    async chat({ agent, system, prompt, signal }) {
      const route = resolve(agent);
      const result = await route.adapter.chat({
        providerName: route.providerName,
        provider: route.provider,
        model: route.model,
        system,
        prompt,
        signal,
        secrets,
      });

      return {
        ...result,
        provider: route.providerName,
        providerType: route.providerType,
        model: route.model,
      };
    },
  };
}