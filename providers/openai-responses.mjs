import { authHeaders, joinUrl, postJson } from "./http.mjs";

function extractText(data) {
  const parts = [];

  for (const item of data.output || []) {
    if (item.type !== "message") continue;

    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) {
        parts.push(content.text);
      }
    }
  }

  return parts.join("\n").trim() || String(data.output_text || "").trim();
}

export async function chat({
  providerName,
  provider,
  model,
  system,
  prompt,
  signal,
  secrets,
}) {
  const baseUrl = provider.baseUrl || "https://api.openai.com/v1";
  const endpoint = provider.endpoint || "/responses";
  const url = joinUrl(baseUrl, endpoint);

  const data = await postJson({
    url,
    headers: {
      ...authHeaders(providerName, provider, secrets),
      ...(provider.headers || {}),
    },
    body: {
      model,
      instructions: system,
      input: prompt,
      store: false,
      ...(provider.extraBody || {}),
    },
    timeoutMs: provider.timeoutMs,
    signal,
  });

  const text = extractText(data);

  if (!text) {
    throw new Error(`Provider "${providerName}" 没有返回文本内容`);
  }

  return {
    text,
    requestId: data.id || null,
    usage: {
      inputTokens: data.usage?.input_tokens ?? null,
      outputTokens: data.usage?.output_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
    },
    raw: data,
  };
}