import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createProviderRouter } from "./providers/index.mjs";

const agentsFile = process.env.AGENTS_FILE || join(process.cwd(), "agents.json");
const providersFile =
  process.env.PROVIDERS_FILE || join(process.cwd(), "providers.json");

const agents = JSON.parse(await readFile(agentsFile, "utf8"));
const providerRouter = await createProviderRouter(providersFile);

if (!Array.isArray(agents) || agents.length < 2) {
  throw new Error("agents.json 至少需要配置两个 Agent");
}

const agentIds = new Set();

for (const [index, agent] of agents.entries()) {
  if (!agent.id || !agent.name || !agent.system) {
    throw new Error(`agents.json 中第 ${index + 1} 个 Agent 必须包含 id、name、system`);
  }

  if (agentIds.has(agent.id)) {
    throw new Error(`Agent ID "${agent.id}" 重复`);
  }

  agentIds.add(agent.id);
  providerRouter.resolve(agent);
}

const agentRoutes = new Map(
  agents.map((agent) => [agent.id, providerRouter.resolve(agent)]),
);

const topic =
  process.argv.slice(2).join(" ").trim() ||
  "讨论：如何设计一个支持多个 Agent 协作的聊天系统？";

const turns = Math.max(1, Number.parseInt(process.env.TURNS || "6", 10) || 6);
const maxContextMessages = Math.max(
  2,
  Number.parseInt(process.env.MAX_CONTEXT_MESSAGES || "30", 10) || 30,
);

const startedAt = new Date();
const sessionId = `${fileDate(startedAt)}-${fileTime(startedAt)}-${randomUUID().slice(0, 8)}`;
const logDir = join(process.cwd(), "logs", fileDate(startedAt));
const markdownPath = join(logDir, `${sessionId}.md`);
const jsonlPath = join(logDir, `${sessionId}.jsonl`);

function pad(value) {
  return String(value).padStart(2, "0");
}

function fileDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function fileTime(date) {
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function buildPrompt(agent, transcript) {
  const visibleMessages = transcript.slice(-maxContextMessages);
  const history = visibleMessages
    .map((message) => `【${message.speakerName}】\n${message.text}`)
    .join("\n\n");

  return [
    "以下是目前的多 Agent 对话记录：",
    "",
    history,
    "",
    `现在由你以「${agent.name}」的身份发言。`,
    "请直接回应对话中的其他人；只输出你的发言正文，不要添加自己的名字前缀。",
  ].join("\n");
}

function formatAgentRoute(agent) {
  const route = agentRoutes.get(agent.id);
  return `${agent.name}（${route.provider}/${route.model}）`;
}

function formatUsage(usage) {
  if (!usage) return "未知";

  const values = [
    usage.inputTokens === null || usage.inputTokens === undefined
      ? null
      : `输入 ${usage.inputTokens}`,
    usage.outputTokens === null || usage.outputTokens === undefined
      ? null
      : `输出 ${usage.outputTokens}`,
    usage.totalTokens === null || usage.totalTokens === undefined
      ? null
      : `总计 ${usage.totalTokens}`,
  ].filter(Boolean);

  return values.length > 0 ? values.join("，") : "未知";
}

async function appendJsonl(record) {
  await appendFile(jsonlPath, `${JSON.stringify(record)}\n`, "utf8");
}

async function appendMarkdown(message) {
  const block = [
    "",
    "---",
    "",
    `## 第 ${message.turn} 轮 · ${message.speakerName}`,
    "",
    `- 时间：${message.createdAt}`,
    `- Agent ID：\`${message.speakerId}\``,
    `- Provider：\`${message.provider}\``,
    `- Provider 类型：\`${message.providerType}\``,
    `- 模型：\`${message.model}\``,
    `- Token：${formatUsage(message.usage)}`,
    `- 耗时：${message.elapsedMs} ms`,
    message.requestId ? `- Request ID：\`${message.requestId}\`` : null,
    "",
    message.text,
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  await appendFile(markdownPath, block, "utf8");
}

await mkdir(logDir, { recursive: true });

const header = [
  "# 多 Agent 聊天记录",
  "",
  `- 会话 ID：\`${sessionId}\``,
  `- 开始时间：${startedAt.toISOString()}`,
  `- 默认 Provider：\`${providerRouter.defaultProvider}\``,
  `- 主题：${topic}`,
  `- Agent：${agents.map(formatAgentRoute).join("、")}`,
  `- 计划轮数：${turns}`,
  "",
].join("\n");

await writeFile(markdownPath, header, "utf8");

await appendJsonl({
  type: "session_start",
  sessionId,
  startedAt: startedAt.toISOString(),
  topic,
  turns,
  maxContextMessages,
  defaultProvider: providerRouter.defaultProvider,
  agents: agents.map(({ id, name, system }) => ({
    id,
    name,
    system,
    route: agentRoutes.get(id),
  })),
});

const transcript = [
  {
    speakerId: "topic",
    speakerName: "主题",
    text: topic,
  },
];

console.log(`主题：${topic}`);
console.log(`默认 Provider：${providerRouter.defaultProvider}`);
console.log(`Agent：${agents.map(formatAgentRoute).join("、")}`);
console.log(`记录目录：${logDir}\n`);

try {
  for (let index = 0; index < turns; index += 1) {
    const agent = agents[index % agents.length];
    const turn = index + 1;
    const requestStartedAt = Date.now();

    console.log(`[第 ${turn} 轮] ${agent.name} 正在思考...`);

    const result = await providerRouter.chat({
      agent,
      system: agent.system,
      prompt: buildPrompt(agent, transcript),
    });
    const createdAt = new Date();
    const message = {
      type: "message",
      sessionId,
      turn,
      speakerId: agent.id,
      speakerName: agent.name,
      provider: result.provider,
      providerType: result.providerType,
      model: result.model,
      text: result.text,
      usage: result.usage,
      requestId: result.requestId,
      createdAt: createdAt.toISOString(),
      elapsedMs: Date.now() - requestStartedAt,
    };

    transcript.push(message);
    await appendJsonl(message);
    await appendMarkdown(message);

    console.log(`\n[${agent.name} · ${message.provider}/${message.model}]\n${result.text}\n`);
  }

  const endedAt = new Date();

  await appendJsonl({
    type: "session_end",
    sessionId,
    endedAt: endedAt.toISOString(),
    turns,
  });

  await appendFile(
    markdownPath,
    [
      "",
      "---",
      "",
      "## 会话结束",
      "",
      `- 结束时间：${endedAt.toISOString()}`,
      `- 总轮数：${turns}`,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`聊天完成。Markdown 记录：${markdownPath}`);
  console.log(`聊天完成。JSONL 记录：${jsonlPath}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);

  await appendJsonl({
    type: "error",
    sessionId,
    createdAt: new Date().toISOString(),
    message,
  });

  await appendFile(
    markdownPath,
    ["", "---", "", "## 运行错误", "", message, ""].join("\n"),
    "utf8",
  );

  console.error(`运行失败：${message}`);
  process.exitCode = 1;
}
