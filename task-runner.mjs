import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createProviderRouter } from "./providers/index.mjs";

const rootDir = dirname(fileURLToPath(import.meta.url));
const agentsFile = process.env.AGENTS_FILE || join(rootDir, "agents.json");
const providersFile = process.env.PROVIDERS_FILE || join(rootDir, "providers.json");
const taskPath = resolve(
  process.env.TASK_FILE ||
  process.argv[2] ||
  join(rootDir, "tasks", "cipher-race.json"),
);

const agents = JSON.parse(await readFile(agentsFile, "utf8"));
const task = JSON.parse(await readFile(taskPath, "utf8"));
const providerRouter = await createProviderRouter(providersFile);

if (task.type !== "race") {
  throw new Error(`当前 TaskRunner 只支持 race 类型，收到的是 "${task.type}"`);
}

const rules = {
  timeoutMs: integer(task.rules?.timeoutMs, 120000, 1000, 3600000),
  attemptsPerAgent: integer(task.rules?.attemptsPerAgent, 1, 1, 10),
  baseScore: number(task.rules?.baseScore, 100),
  speedBonusMax: number(task.rules?.speedBonusMax, 50),
  attemptPenalty: number(task.rules?.attemptPenalty, 10),
  normalizer: task.solution?.normalizer || "text",
};

const selectedAgentIds = task.agentIds?.length
  ? task.agentIds
  : agents.map((agent) => agent.id);
const agentMap = new Map(agents.map((agent) => [agent.id, agent]));
const contestants = selectedAgentIds.map((agentId) => {
  const agent = agentMap.get(agentId);
  if (!agent) throw new Error(`任务引用了不存在的 Agent "${agentId}"`);
  providerRouter.resolve(agent);
  return agent;
});

if (contestants.length === 0) {
  throw new Error("任务至少需要一个参赛 Agent");
}

function integer(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function fileDate(date) {
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
}

function fileTime(date) {
  return `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function safeName(value) {
  return String(value || "task")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "task";
}

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[\s\u3000\p{P}\p{S}]+/gu, "");
}

function normalizeExact(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

function normalizeAnswer(value, mode) {
  if (mode === "exact") return normalizeExact(value);
  return normalizeText(value);
}

function evaluateAnswer(answer, solution, normalizer) {
  if (solution?.sha256) {
    const actualHash = createHash("sha256")
      .update(normalizeText(answer))
      .digest("hex")
      .toLowerCase();
    return actualHash === String(solution.sha256).toLowerCase();
  }

  if (solution?.answer === undefined) {
    throw new Error("任务缺少 solution.answer 或 solution.sha256");
  }

  return normalizeAnswer(answer, normalizer) === normalizeAnswer(solution.answer, normalizer);
}

function parseAgentResponse(rawText) {
  const raw = String(rawText || "").trim();
  const candidates = [];
  const fenced = [...raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];

  for (const match of fenced) candidates.push(match[1].trim());

  const firstBrace = raw.indexOf("{");
  const lastBrace = raw.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(raw.slice(firstBrace, lastBrace + 1));
  }

  candidates.push(raw);

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return {
          answer: String(parsed.answer ?? "").trim(),
          confidence: parsed.confidence ?? null,
          reasoning: String(parsed.reasoning ?? "").trim(),
          method: String(parsed.method ?? "").trim(),
          raw,
        };
      }
    } catch {
      // 尝试下一个候选内容。
    }
  }

  return {
    answer: raw,
    confidence: null,
    reasoning: "",
    method: "",
    raw,
  };
}

function buildTaskPrompt(agent, previousAttempts) {
  const lines = [
    "你正在参加一场独立解题竞赛。",
    `任务标题：${task.title || task.id}`,
    `任务说明：${task.prompt || ""}`,
  ];

  if (task.input && Object.keys(task.input).length > 0) {
    lines.push("", "题目输入：", JSON.stringify(task.input, null, 2));
  }

  if (Array.isArray(task.hints) && task.hints.length > 0) {
    lines.push("", "公开提示：");
    for (const hint of task.hints) lines.push(`- ${hint}`);
  }

  if (previousAttempts.length > 0) {
    lines.push("", "你之前的提交没有通过判定：");
    for (const attempt of previousAttempts) {
      lines.push(`- 第 ${attempt.attempt} 次答案：${attempt.parsed.answer || "(空)"}`);
    }
    lines.push("请换一种方法分析，不要简单重复之前的答案。");
  }

  lines.push(
    "",
    `你是「${agent.name}」。其他竞赛 Agent 的答案对你不可见。`,
    "只返回一个 JSON 对象，不要使用 Markdown 代码块：",
    '{"answer":"最终答案","confidence":0.0,"reasoning":"简要推理","method":"使用方法"}',
    "answer 只填写最终答案本身，不要附加“答案是”等前缀。",
  );

  return lines.join("\n");
}

function calculateScore(result, elapsedMs) {
  if (!result.correct) return 0;

  const speedRatio = Math.max(0, 1 - elapsedMs / rules.timeoutMs);
  const speedBonus = Math.round(rules.speedBonusMax * speedRatio);
  const retryPenalty = Math.max(0, result.attempt - 1) * rules.attemptPenalty;

  return Math.max(0, Math.round(rules.baseScore + speedBonus - retryPenalty));
}
const startedAt = new Date();
const runId = `${fileDate(startedAt)}-${fileTime(startedAt)}-${safeName(task.id)}-${randomUUID().slice(0, 8)}`;
const logDir = join(rootDir, "logs", fileDate(startedAt));
const markdownPath = join(logDir, `${runId}.md`);
const jsonlPath = join(logDir, `${runId}.jsonl`);
const resultPath = join(logDir, `${runId}-results.json`);
let logQueue = Promise.resolve();

function queueLog(record) {
  logQueue = logQueue.then(() => appendFile(jsonlPath, `${JSON.stringify(record)}\n`, "utf8"));
  return logQueue;
}

function routeFor(agent) {
  return providerRouter.resolve(agent);
}

function emptyUsage() {
  return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
}

function addUsage(total, usage) {
  total.inputTokens += number(usage?.inputTokens, 0);
  total.outputTokens += number(usage?.outputTokens, 0);
  total.totalTokens += number(usage?.totalTokens, 0);
  return total;
}

async function runAttempt(agent, attemptNumber, previousAttempts) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(new Error(`任务超时（${rules.timeoutMs} ms）`)),
    rules.timeoutMs,
  );
  const route = routeFor(agent);
  const requestStartedAt = Date.now();
  const createdAt = new Date().toISOString();

  try {
    const result = await providerRouter.chat({
      agent,
      system: agent.system,
      prompt: buildTaskPrompt(agent, previousAttempts),
      signal: controller.signal,
    });
    const elapsedMs = Date.now() - requestStartedAt;
    const parsed = parseAgentResponse(result.text);
    const correct = evaluateAnswer(parsed.answer, task.solution, rules.normalizer);
    const attempt = {
      attempt: attemptNumber,
      agentId: agent.id,
      agentName: agent.name,
      provider: result.provider,
      providerType: result.providerType,
      model: result.model,
      parsed,
      correct,
      elapsedMs,
      usage: result.usage || emptyUsage(),
      requestId: result.requestId || null,
      error: null,
    };

    attempt.score = calculateScore(attempt, elapsedMs);

    await queueLog({
      type: "message",
      sessionId: runId,
      turn: attemptNumber,
      speakerId: agent.id,
      speakerName: agent.name,
      provider: attempt.provider,
      providerType: attempt.providerType,
      model: attempt.model,
      text: parsed.raw,
      usage: attempt.usage,
      requestId: attempt.requestId,
      createdAt,
      elapsedMs,
      task: {
        attempt: attemptNumber,
        correct,
        score: attempt.score,
        answer: parsed.answer,
        confidence: parsed.confidence,
        method: parsed.method,
      },
    });
    await queueLog({ type: "task_attempt", sessionId: runId, taskId: task.id, ...attempt });

    return attempt;
  } catch (error) {
    const elapsedMs = Date.now() - requestStartedAt;
    const message = error instanceof Error ? error.message : String(error);
    const attempt = {
      attempt: attemptNumber,
      agentId: agent.id,
      agentName: agent.name,
      provider: route.provider,
      providerType: route.providerType,
      model: route.model,
      parsed: { answer: "", confidence: null, reasoning: "", method: "", raw: "" },
      correct: false,
      score: 0,
      elapsedMs,
      usage: emptyUsage(),
      requestId: null,
      error: message,
    };

    await queueLog({
      type: "message",
      sessionId: runId,
      turn: attemptNumber,
      speakerId: agent.id,
      speakerName: agent.name,
      provider: attempt.provider,
      providerType: attempt.providerType,
      model: attempt.model,
      text: `尝试失败：${message}`,
      usage: attempt.usage,
      requestId: null,
      createdAt,
      elapsedMs,
      task: { attempt: attemptNumber, correct: false, score: 0, error: message },
    });
    await queueLog({ type: "task_attempt", sessionId: runId, taskId: task.id, ...attempt });

    return attempt;
  } finally {
    clearTimeout(timeout);
  }
}

async function runContestant(agent) {
  const agentStartedAt = Date.now();
  const attempts = [];
  let successfulAttempt = null;
  let usage = emptyUsage();

  for (let attemptNumber = 1; attemptNumber <= rules.attemptsPerAgent; attemptNumber += 1) {
    const attempt = await runAttempt(agent, attemptNumber, attempts);
    attempts.push(attempt);
    usage = addUsage(usage, attempt.usage);

    if (attempt.correct) {
      successfulAttempt = attempt;
      break;
    }

    if (attempt.error) break;
  }

  const totalElapsedMs = Date.now() - agentStartedAt;
  const score = successfulAttempt
    ? calculateScore({ correct: true, attempt: successfulAttempt.attempt }, totalElapsedMs)
    : 0;
  const lastAttempt = attempts.at(-1);
  const summary = {
    agentId: agent.id,
    agentName: agent.name,
    correct: Boolean(successfulAttempt),
    score,
    attemptCount: attempts.length,
    successfulAttempt: successfulAttempt?.attempt ?? null,
    answer: successfulAttempt?.parsed.answer || lastAttempt?.parsed.answer || "",
    method: successfulAttempt?.parsed.method || lastAttempt?.parsed.method || "",
    totalElapsedMs,
    provider: successfulAttempt?.provider || lastAttempt?.provider || null,
    model: successfulAttempt?.model || lastAttempt?.model || null,
    usage,
    attempts,
  };

  await queueLog({
    type: "contestant_result",
    sessionId: runId,
    taskId: task.id,
    agentId: summary.agentId,
    agentName: summary.agentName,
    correct: summary.correct,
    score: summary.score,
    attemptCount: summary.attemptCount,
    totalElapsedMs: summary.totalElapsedMs,
    usage: summary.usage,
  });

  return summary;
}

await mkdir(logDir, { recursive: true });

const header = [
  `# ${task.title || task.id}`,
  "",
  `- Task ID：\`${task.id}\``,
  `- Run ID：\`${runId}\``,
  `- 开始时间：${startedAt.toISOString()}`,
  `- 类型：\`${task.type}\``,
  `- 超时：${rules.timeoutMs} ms`,
  `- 每个 Agent 最大尝试：${rules.attemptsPerAgent}`,
  `- 参赛 Agent：${contestants.map((agent) => agent.name).join("、")}`,
  "",
  "## 任务说明",
  "",
  task.prompt || "",
  "",
].join("\n");

await writeFile(markdownPath, header, "utf8");
await queueLog({
  type: "session_start",
  sessionId: runId,
  kind: "task_race",
  startedAt: startedAt.toISOString(),
  topic: `[比赛] ${task.title || task.id}`,
  turns: contestants.length * rules.attemptsPerAgent,
  taskId: task.id,
  agents: contestants.map(({ id, name, system }) => ({ id, name, system })),
});
await queueLog({
  type: "task_start",
  sessionId: runId,
  taskId: task.id,
  title: task.title || task.id,
  startedAt: startedAt.toISOString(),
  rules: { ...rules, solution: undefined },
  agentIds: contestants.map((agent) => agent.id),
});

console.log(`任务：${task.title || task.id}`);
console.log(`参赛 Agent：${contestants.map((agent) => agent.name).join("、")}`);

const results = await Promise.all(contestants.map(runContestant));
const leaderboard = results
  .map((result) => ({ ...result, attempts: undefined }))
  .sort((a, b) => {
    if (a.correct !== b.correct) return a.correct ? -1 : 1;
    if (b.score !== a.score) return b.score - a.score;
    return a.totalElapsedMs - b.totalElapsedMs;
  })
  .map((result, index) => ({ ...result, rank: index + 1 }));

const endedAt = new Date();
const winner = leaderboard.find((result) => result.correct) || null;
const resultRecord = {
  type: "task_result",
  sessionId: runId,
  taskId: task.id,
  endedAt: endedAt.toISOString(),
  winnerAgentId: winner?.agentId || null,
  winnerAgentName: winner?.agentName || null,
  leaderboard,
};
await queueLog(resultRecord);
await queueLog({
  type: "session_end",
  sessionId: runId,
  endedAt: endedAt.toISOString(),
  turns: results.reduce((sum, result) => sum + result.attemptCount, 0),
});

const tableRows = leaderboard.map((result) => [
  result.rank,
  result.agentName,
  result.correct ? "正确" : "未解出",
  result.score,
  `${result.totalElapsedMs} ms`,
  `${result.attemptCount} 次`,
  `${result.provider || "-"} / ${result.model || "-"}`,
].join(" | "));

const detailSections = results.map((result) => {
  const attempts = result.attempts.map((attempt) => [
    `### 第 ${attempt.attempt} 次尝试`,
    "",
    `- 结果：${attempt.correct ? "正确" : attempt.error ? `错误：${attempt.error}` : "错误"}`,
    `- 答案：${attempt.parsed.answer || "(空)"}`,
    `- 方法：${attempt.parsed.method || "(未提供)"}`,
    `- 耗时：${attempt.elapsedMs} ms`,
    "",
    "```text",
    attempt.parsed.raw || attempt.error || "",
    "```",
  ].join("\n")).join("\n\n");

  return `## ${result.agentName}\n\n- 结果：${result.correct ? "正确" : "未解出"}\n- 得分：${result.score}\n- 总耗时：${result.totalElapsedMs} ms\n- 尝试次数：${result.attemptCount}\n\n${attempts}`;
}).join("\n\n");

const markdown = [
  "",
  "## 排行榜",
  "",
  "| 排名 | Agent | 结果 | 得分 | 耗时 | 尝试 | Provider / 模型 |",
  "|---:|---|---|---:|---:|---:|---|",
  ...tableRows.map((row) => `| ${row} |`),
  "",
  winner ? `**获胜者：${winner.agentName}**` : "**没有 Agent 解出本题**",
  "",
  "## 详细提交",
  "",
  detailSections,
  "",
  `- 结束时间：${endedAt.toISOString()}`,
  `- 源码日志：\`${jsonlPath}\``,
  "",
].join("\n");

await logQueue;
await appendFile(markdownPath, markdown, "utf8");
await writeFile(resultPath, JSON.stringify({ runId, taskId: task.id, leaderboard, endedAt: endedAt.toISOString() }, null, 2), "utf8");

console.log("\n排行榜：");
for (const result of leaderboard) {
  console.log(`${result.rank}. ${result.agentName} | ${result.correct ? "正确" : "未解出"} | ${result.score} 分 | ${result.totalElapsedMs} ms | ${result.attemptCount} 次`);
}
console.log(`\nMarkdown：${markdownPath}`);
console.log(`JSONL：${jsonlPath}`);
console.log(`结果 JSON：${resultPath}`);