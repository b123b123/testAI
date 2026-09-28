import { joinUrl, postJson } from "./http.mjs";

function extractText(data) {
  const content = data.message?.content;

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
  const baseUrl = provider.baseUrl || "http://127.0.0.1:11434";
  const endpoint = provider.endpoint || "/api/chat";
  const url = joinUrl(baseUrl, endpoint);

  const data = await postJson({
    url,
    headers: {
      ...(provider.headers || {}),
    },
    body: {
      model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      stream: false,
      ...(provider.extraBody || {}),
    },
    timeoutMs: provider.timeoutMs,
    signal,
  });

  const text = extractText(data);

  if (!text) {
    throw new Error(`Provider "${providerName}" 没有返回文本内容`);
  }

  const inputTokens = data.prompt_eval_count ?? null;
  const outputTokens = data.eval_count ?? null;

  return {
    text,
    requestId: null,
    usage: {
      inputTokens,
      outputTokens,
      totalTokens:
        inputTokens === null || outputTokens === null
          ? null
          : inputTokens + outputTokens,
    },
    raw: data,
  };
}