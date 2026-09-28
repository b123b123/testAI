import { authHeaders, joinUrl, postJson } from "./http.mjs";

function extractText(data) {
  const content = data.choices?.[0]?.message?.content;

  if (typeof content === "string") return content.trim();

  if (Array.isArray(content)) {
    return content
      .map((part) => part?.text || part?.content || "")
      .filter(Boolean)
      .join("\n")
      .trim();
  }

  return "";
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
  const baseUrl = provider.baseUrl;

  if (!baseUrl) {
    throw new Error(`Provider "${providerName}" 缺少 baseUrl`);
  }

  const endpoint = provider.endpoint || "/chat/completions";
  const url = joinUrl(baseUrl, endpoint);

  const data = await postJson({
    url,
    headers: {
      ...authHeaders(providerName, provider, secrets),
      ...(provider.headers || {}),
    },
    body: {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
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
      inputTokens: data.usage?.prompt_tokens ?? null,
      outputTokens: data.usage?.completion_tokens ?? null,
      totalTokens: data.usage?.total_tokens ?? null,
    },
    raw: data,
  };
}