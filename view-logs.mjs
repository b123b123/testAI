import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = dirname(fileURLToPath(import.meta.url));
const logsDir = resolve(process.env.LOGS_DIR || join(rootDir, "logs"));
const viewerDir = resolve(process.env.VIEWER_DIR || join(rootDir, "viewer"));
const sessionsDir = join(viewerDir, "sessions");
const dataDir = join(viewerDir, "data");
const palette = ["#4f46e5", "#0891b2", "#16a34a", "#f59e0b", "#e11d48", "#7c3aed", "#0f766e"];

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function number(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(number(value));
}

function formatDateTime(value) {
  if (!value) return "未知";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(date);
}

function formatDuration(value) {
  const ms = number(value);
  if (ms <= 0) return "0 ms";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)} s`;
  return `${(ms / 60000).toFixed(1)} min`;
}

function dateKey(value) {
  if (!value) return "未知日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知日期";
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function safeName(value) {
  return String(value || "session")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120) || "session";
}

function messageTokens(message) {
  const usage = message.usage || {};
  if (usage.totalTokens !== null && usage.totalTokens !== undefined) {
    return number(usage.totalTokens);
  }
  return number(usage.inputTokens) + number(usage.outputTokens);
}

function percentile(values, ratio) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1);
  return sorted[index];
}

async function walkJsonlFiles(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walkJsonlFiles(fullPath)));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(fullPath);
  }
  return files;
}

async function parseJsonl(filePath) {
  const content = await readFile(filePath, "utf8");
  const records = [];
  const parseErrors = [];

  content.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      records.push(JSON.parse(trimmed));
    } catch (error) {
      parseErrors.push({
        line: index + 1,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });

  return { records, parseErrors };
}

function buildSession(filePath, records, parseErrors) {
  const start = records.find((record) => record.type === "session_start") || null;
  const end = [...records].reverse().find((record) => record.type === "session_end") || null;
  const messages = records.filter((record) => record.type === "message");
  const errors = records.filter((record) => record.type === "error");
  const id = start?.sessionId || messages[0]?.sessionId || relative(logsDir, filePath).replaceAll("\\", "/");
  const startedAt = start?.startedAt || messages[0]?.createdAt || null;
  const endedAt = end?.endedAt || messages.at(-1)?.createdAt || null;
  const durationMs = startedAt && endedAt
    ? Math.max(0, new Date(endedAt).getTime() - new Date(startedAt).getTime())
    : 0;
  const agentMap = new Map();

  for (const agent of start?.agents || []) {
    agentMap.set(agent.id || agent.name, {
      id: agent.id || agent.name,
      name: agent.name || agent.id || "未知 Agent",
    });
  }

  for (const message of messages) {
    agentMap.set(message.speakerId || message.speakerName, {
      id: message.speakerId || message.speakerName,
      name: message.speakerName || message.speakerId || "未知 Agent",
    });
  }

  const providers = [...new Set(messages.map((message) => message.provider).filter(Boolean))];
  const models = [...new Set(messages.filter((message) => message.model)
    .map((message) => `${message.provider || "provider"}/${message.model}`))];
  const latencies = messages.map((message) => number(message.elapsedMs)).filter((value) => value > 0);
  const usage = messages.reduce((total, message) => {
    total.inputTokens += number(message.usage?.inputTokens);
    total.outputTokens += number(message.usage?.outputTokens);
    total.totalTokens += messageTokens(message);
    return total;
  }, { inputTokens: 0, outputTokens: 0, totalTokens: 0 });

  return {
    id,
    topic: start?.topic || "未记录主题",
    startedAt,
    endedAt,
    durationMs,
    plannedTurns: number(start?.turns),
    messageCount: messages.length,
    errorCount: errors.length,
    parseErrorCount: parseErrors.length,
    averageLatency: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0,
    p95Latency: percentile(latencies, 0.95),
    usage,
    agents: [...agentMap.values()],
    providers,
    models,
    status: errors.length > 0 ? "error" : end ? "complete" : "interrupted",
    sourceFile: relative(logsDir, filePath).replaceAll("\\", "/"),
    messages,
    errors,
    parseErrors,
  };
}

async function loadSessions() {
  const files = await walkJsonlFiles(logsDir);
  const sessions = [];

  for (const file of files) {
    const parsed = await parseJsonl(file);
    if (parsed.records.length === 0 && parsed.parseErrors.length === 0) continue;
    sessions.push(buildSession(file, parsed.records, parsed.parseErrors));
  }

  sessions.sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime;
  });

  const usedNames = new Map();
  for (const session of sessions) {
    const base = safeName(session.id);
    const count = (usedNames.get(base) || 0) + 1;
    usedNames.set(base, count);
    session.viewerFileName = count === 1 ? `${base}.html` : `${base}-${count}.html`;
  }

  return sessions;
}
function aggregateSessions(sessions) {
  const messages = sessions.flatMap((session) => session.messages);
  const providers = new Map();
  const agents = new Map();
  const models = new Map();
  const dates = new Map();

  function bump(map, key, seed) {
    if (!map.has(key)) map.set(key, { key, ...seed });
    return map.get(key);
  }

  for (const message of messages) {
    const tokens = messageTokens(message);
    const providerKey = message.provider || "未知 Provider";
    const agentKey = message.speakerId || message.speakerName || "未知 Agent";
    const modelKey = `${message.provider || "provider"}/${message.model || "unknown"}`;

    const provider = bump(providers, providerKey, { label: providerKey, messages: 0, tokens: 0, latencyTotal: 0 });
    provider.messages += 1;
    provider.tokens += tokens;
    provider.latencyTotal += number(message.elapsedMs);

    const agent = bump(agents, agentKey, { label: message.speakerName || agentKey, messages: 0, tokens: 0, latencyTotal: 0 });
    agent.messages += 1;
    agent.tokens += tokens;
    agent.latencyTotal += number(message.elapsedMs);

    const model = bump(models, modelKey, { label: modelKey, messages: 0, tokens: 0, latencyTotal: 0 });
    model.messages += 1;
    model.tokens += tokens;
    model.latencyTotal += number(message.elapsedMs);
  }

  for (const session of sessions) {
    const date = bump(dates, dateKey(session.startedAt), { label: dateKey(session.startedAt), sessions: 0, messages: 0, tokens: 0 });
    date.sessions += 1;
    date.messages += session.messageCount;
    date.tokens += session.usage.totalTokens;
  }

  const providerStats = [...providers.values()];
  const agentStats = [...agents.values()];
  const modelStats = [...models.values()];

  for (const item of [...providerStats, ...agentStats, ...modelStats]) {
    item.averageLatency = item.messages > 0 ? item.latencyTotal / item.messages : 0;
  }

  const latencies = messages.map((message) => number(message.elapsedMs)).filter((value) => value > 0);
  const totalTokens = messages.reduce((sum, message) => sum + messageTokens(message), 0);
  const inputTokens = messages.reduce((sum, message) => sum + number(message.usage?.inputTokens), 0);
  const outputTokens = messages.reduce((sum, message) => sum + number(message.usage?.outputTokens), 0);
  const byTokens = (a, b) => b.tokens - a.tokens || b.messages - a.messages;
  const byMessages = (a, b) => b.messages - a.messages || b.tokens - a.tokens;

  return {
    totals: {
      sessions: sessions.length,
      messages: messages.length,
      providers: providers.size,
      agents: agents.size,
      models: models.size,
      totalTokens,
      inputTokens,
      outputTokens,
      errorSessions: sessions.filter((session) => session.errorCount > 0).length,
      completedSessions: sessions.filter((session) => session.status === "complete").length,
      averageLatency: messages.length ? latencies.reduce((sum, value) => sum + value, 0) / messages.length : 0,
      p95Latency: percentile(latencies, 0.95),
    },
    providers: providerStats.sort(byMessages),
    agents: agentStats.sort(byMessages),
    models: modelStats.sort(byMessages),
    dates: [...dates.values()].sort((a, b) => a.label.localeCompare(b.label)),
    topProvider: [...providerStats].sort(byTokens)[0] || null,
    topAgent: [...agentStats].sort(byMessages)[0] || null,
    topModel: [...modelStats].sort(byTokens)[0] || null,
  };
}

function renderMetric(label, value, hint = "") {
  return `<article class="metric"><span class="metric-label">${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong>${hint ? `<small>${escapeHtml(hint)}</small>` : ""}</article>`;
}

function renderBarChart(items, valueGetter, labelGetter, color = palette[0]) {
  if (!items.length) return `<div class="empty">暂无数据</div>`;
  const values = items.map((item) => number(valueGetter(item)));
  const max = Math.max(...values, 1);
  const rowHeight = 42;
  const top = 14;
  const left = 150;
  const width = 720;
  const barWidth = 500;
  const height = top * 2 + items.length * rowHeight;

  const rows = items.map((item, index) => {
    const y = top + index * rowHeight;
    const label = escapeHtml(labelGetter(item));
    const value = values[index];
    const widthValue = Math.max(2, (value / max) * barWidth);
    return `
      <text x="${left - 12}" y="${y + 22}" text-anchor="end" class="svg-label">${label}</text>
      <rect x="${left}" y="${y + 8}" width="${barWidth}" height="20" rx="10" class="svg-track" />
      <rect x="${left}" y="${y + 8}" width="${widthValue}" height="20" rx="10" fill="${color}"><title>${label}: ${formatNumber(value)}</title></rect>
      <text x="${left + barWidth + 10}" y="${y + 23}" class="svg-value">${formatNumber(value)}</text>`;
  }).join("");

  return `<svg class="bar-chart" viewBox="0 0 ${width} ${height}" role="img">${rows}</svg>`;
}

function renderColumnChart(items) {
  if (!items.length) return `<div class="empty">暂无数据</div>`;
  const recent = items.slice(-14);
  const width = 760;
  const height = 280;
  const left = 45;
  const right = 20;
  const top = 25;
  const bottom = 55;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const max = Math.max(...recent.map((item) => item.sessions), 1);
  const step = chartWidth / recent.length;
  const barWidth = Math.max(12, Math.min(44, step * 0.58));

  const bars = recent.map((item, index) => {
    const barHeight = Math.max(2, (item.sessions / max) * chartHeight);
    const x = left + index * step + (step - barWidth) / 2;
    const y = top + chartHeight - barHeight;
    return `
      <rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" rx="7" fill="${palette[index % palette.length]}"><title>${escapeHtml(item.label)}：${item.sessions} 个会话，${item.messages} 条消息</title></rect>
      <text x="${x + barWidth / 2}" y="${y - 7}" text-anchor="middle" class="svg-value">${item.sessions}</text>
      <text x="${x + barWidth / 2}" y="${height - 22}" text-anchor="middle" class="svg-date">${escapeHtml(item.label.slice(5))}</text>`;
  }).join("");

  return `<svg class="column-chart" viewBox="0 0 ${width} ${height}" role="img"><line x1="${left}" y1="${top + chartHeight}" x2="${width - right}" y2="${top + chartHeight}" class="svg-axis" />${bars}</svg>`;
}

function renderDonutChart(items, valueGetter) {
  const values = items.map((item) => number(valueGetter(item)));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (total <= 0) return `<div class="empty">暂无 Token 数据</div>`;

  let offset = 0;
  const circles = items.map((item, index) => {
    const percentage = (values[index] / total) * 100;
    const circle = `<circle cx="70" cy="70" r="52" fill="none" stroke="${palette[index % palette.length]}" stroke-width="18" pathLength="100" stroke-dasharray="${percentage} ${100 - percentage}" stroke-dashoffset="${-offset}" transform="rotate(-90 70 70)"><title>${escapeHtml(item.label)}：${formatNumber(values[index])}</title></circle>`;
    offset += percentage;
    return circle;
  }).join("");

  const legend = items.map((item, index) => {
    const percentage = ((values[index] / total) * 100).toFixed(1);
    return `<li><span class="legend-dot" style="background:${palette[index % palette.length]}"></span><span>${escapeHtml(item.label)}</span><strong>${percentage}%</strong></li>`;
  }).join("");

  return `<div class="donut-layout"><svg viewBox="0 0 140 140" class="donut" role="img">${circles}<text x="70" y="66" text-anchor="middle" class="donut-number">${formatNumber(total)}</text><text x="70" y="86" text-anchor="middle" class="donut-caption">Tokens</text></svg><ul class="legend">${legend}</ul></div>`;
}

function formatMultiline(value) {
  return escapeHtml(value).replaceAll("\n", "<br>");
}
function baseStyles() {
  return `
    :root { color-scheme: light; --bg:#f5f7fb; --card:#fff; --text:#172033; --muted:#667085; --line:#e4e7ec; --brand:#4f46e5; --brand-soft:#eef2ff; --success:#15803d; --danger:#b42318; --shadow:0 12px 30px rgba(16,24,40,.07); }
    * { box-sizing:border-box; }
    body { margin:0; background:var(--bg); color:var(--text); font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; line-height:1.6; }
    a { color:var(--brand); text-decoration:none; } a:hover { text-decoration:underline; }
    .shell { width:min(1240px,calc(100% - 32px)); margin:0 auto; padding:28px 0 56px; }
    .hero { background:linear-gradient(135deg,#111827,#312e81 58%,#4f46e5); color:white; border-radius:24px; padding:32px; box-shadow:var(--shadow); }
    .hero h1 { margin:0 0 8px; font-size:clamp(26px,4vw,42px); } .hero p { margin:0; color:rgba(255,255,255,.76); }
    .hero-actions { display:flex; flex-wrap:wrap; gap:10px; margin-top:20px; }
    .button { display:inline-flex; align-items:center; border:0; border-radius:999px; padding:9px 15px; background:rgba(255,255,255,.14); color:white; cursor:pointer; font:inherit; }
    .button:hover { background:rgba(255,255,255,.22); text-decoration:none; }
    .metrics { display:grid; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); gap:14px; margin:20px 0; }
    .metric,.card,.table-card,.message,.error-box { background:var(--card); border:1px solid var(--line); border-radius:18px; box-shadow:var(--shadow); }
    .metric { padding:18px; } .metric-label { display:block; color:var(--muted); font-size:13px; } .metric strong { display:block; margin:4px 0; font-size:27px; line-height:1.2; } .metric small { color:var(--muted); }
    .grid { display:grid; grid-template-columns:repeat(12,1fr); gap:16px; } .span-7{grid-column:span 7}.span-5{grid-column:span 5}.span-6{grid-column:span 6}
    .card,.table-card { padding:22px; } .card h2,.table-card h2 { margin:0 0 4px; font-size:18px; } .card-header { display:flex; align-items:baseline; justify-content:space-between; gap:12px; margin-bottom:18px; } .card-header p { margin:0; color:var(--muted); font-size:13px; }
    .insights { display:grid; grid-template-columns:repeat(auto-fit,minmax(220px,1fr)); gap:14px; margin:16px 0; }
    .insight { padding:17px; border-radius:16px; background:var(--card); border:1px solid var(--line); } .insight span { color:var(--muted); font-size:13px; } .insight strong { display:block; margin-top:3px; }
    .filters { display:grid; grid-template-columns:2fr 1fr 1fr; gap:10px; margin:16px 0; }
    input,select { width:100%; border:1px solid var(--line); border-radius:11px; padding:10px 12px; background:white; color:var(--text); font:inherit; }
    table { width:100%; border-collapse:collapse; } th,td { padding:12px 10px; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; } th { color:var(--muted); font-size:13px; font-weight:600; } tbody tr:hover { background:#fafbff; }
    .pill { display:inline-block; padding:2px 8px; margin:2px 4px 2px 0; border-radius:999px; background:var(--brand-soft); color:#3730a3; font-size:12px; white-space:nowrap; }
    .status { font-weight:700; font-size:12px; }.status.complete{color:var(--success)}.status.error{color:var(--danger)}.status.interrupted{color:#b54708}
    .bar-chart,.column-chart { width:100%; height:auto; }.svg-label{fill:#475467;font-size:12px}.svg-value{fill:#344054;font-size:11px;font-weight:700}.svg-date{fill:#667085;font-size:10px}.svg-track{fill:#eef2f6}.svg-axis{stroke:#d0d5dd;stroke-width:1}
    .donut-layout { display:grid; grid-template-columns:180px 1fr; gap:18px; align-items:center; }.donut{width:170px;height:170px}.donut-number{fill:#101828;font-size:15px;font-weight:800}.donut-caption{fill:#667085;font-size:8px}
    .legend { list-style:none; padding:0; margin:0; }.legend li{display:grid;grid-template-columns:12px 1fr auto;gap:8px;align-items:center;padding:6px 0}.legend-dot{width:10px;height:10px;border-radius:50%}
    .empty { padding:32px; color:var(--muted); text-align:center; border:1px dashed var(--line); border-radius:12px; }
    .breadcrumb { margin-bottom:14px; }.message{padding:18px;margin-bottom:14px;border-left:5px solid var(--brand)}.message-head{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px;margin-bottom:10px}.message-author{font-weight:800}.message-meta{color:var(--muted);font-size:12px}.message-text{overflow-wrap:anywhere}.error-box{padding:18px;margin-bottom:14px;border-color:#fecaca;background:#fff7f7;color:#7a271a}
    @media(max-width:900px){.span-7,.span-5,.span-6{grid-column:span 12}.filters{grid-template-columns:1fr}.donut-layout{grid-template-columns:1fr}.shell{width:min(100% - 20px,1240px)}.hero{padding:24px;border-radius:18px}.table-card{overflow-x:auto}table{min-width:820px}}
  `;
}

function renderDashboard(sessions, analysis, generatedAt) {
  const providerOptions = analysis.providers.map((item) => `<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)}</option>`).join("");
  const agentOptions = analysis.agents.map((item) => `<option value="${escapeHtml(item.label)}">${escapeHtml(item.label)}</option>`).join("");
  const rows = sessions.map((session) => {
    const agents = session.agents.map((agent) => agent.name).join("、") || "无";
    const models = session.models.map((model) => `<span class="pill">${escapeHtml(model)}</span>`).join("");
    const searchText = [session.id, session.topic, agents, session.providers.join(" "), session.models.join(" ")].join(" ").toLowerCase();
    return `<tr data-search="${escapeHtml(searchText)}" data-provider="${escapeHtml(session.providers.join("|"))}" data-agent="${escapeHtml(session.agents.map((agent) => agent.name).join("|"))}">
      <td>${escapeHtml(formatDateTime(session.startedAt))}</td>
      <td><a href="./sessions/${encodeURIComponent(session.viewerFileName)}"><strong>${escapeHtml(session.topic)}</strong></a><div class="message-meta">${escapeHtml(session.id)}</div></td>
      <td>${escapeHtml(agents)}</td><td>${models}</td><td>${formatNumber(session.messageCount)}</td><td>${formatNumber(session.usage.totalTokens)}</td>
      <td>${escapeHtml(formatDuration(session.averageLatency))}</td><td><span class="status ${escapeHtml(session.status)}">${escapeHtml(session.status)}</span></td>
    </tr>`;
  }).join("");

  const providerTokenItems = [...analysis.providers].sort((a, b) => b.tokens - a.tokens);
  const agentMessageItems = [...analysis.agents].sort((a, b) => b.messages - a.messages).slice(0, 10);
  const modelTokenItems = [...analysis.models].sort((a, b) => b.tokens - a.tokens).slice(0, 10);

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>多 Agent 聊天日志仪表盘</title><style>${baseStyles()}</style></head>
  <body><main class="shell">
    <header class="hero"><h1>多 Agent 聊天日志</h1><p>生成时间：${escapeHtml(formatDateTime(generatedAt))} · 日志目录：${escapeHtml(logsDir)}</p><div class="hero-actions"><button class="button" onclick="window.print()">打印 / 导出 PDF</button></div></header>
    <section class="metrics">
      ${renderMetric("会话数", formatNumber(analysis.totals.sessions), `${formatNumber(analysis.totals.completedSessions)} 个已完成`)}
      ${renderMetric("消息数", formatNumber(analysis.totals.messages), `${formatNumber(analysis.totals.errorSessions)} 个异常会话`)}
      ${renderMetric("总 Token", formatNumber(analysis.totals.totalTokens), `输入 ${formatNumber(analysis.totals.inputTokens)} / 输出 ${formatNumber(analysis.totals.outputTokens)}`)}
      ${renderMetric("平均响应", formatDuration(analysis.totals.averageLatency), `P95 ${formatDuration(analysis.totals.p95Latency)}`)}
      ${renderMetric("Provider", formatNumber(analysis.totals.providers), "已使用模型服务")}
      ${renderMetric("Agent / 模型", `${analysis.totals.agents} / ${analysis.totals.models}`, "独立角色与实际模型")}
    </section>
    <section class="insights">
      <article class="insight"><span>最活跃 Agent</span><strong>${escapeHtml(analysis.topAgent?.label || "暂无")}</strong><small>${formatNumber(analysis.topAgent?.messages || 0)} 条消息</small></article>
      <article class="insight"><span>Token 最多的 Provider</span><strong>${escapeHtml(analysis.topProvider?.label || "暂无")}</strong><small>${formatNumber(analysis.topProvider?.tokens || 0)} Tokens</small></article>
      <article class="insight"><span>Token 最多的模型</span><strong>${escapeHtml(analysis.topModel?.label || "暂无")}</strong><small>${formatNumber(analysis.topModel?.tokens || 0)} Tokens</small></article>
      <article class="insight"><span>平均会话消息数</span><strong>${analysis.totals.sessions ? (analysis.totals.messages / analysis.totals.sessions).toFixed(1) : "0"} 条/会话</strong><small>按全部日志计算</small></article>
    </section>
    <section class="grid">
      <article class="card span-5"><div class="card-header"><div><h2>Provider Token 占比</h2><p>观察不同模型服务的消耗</p></div></div>${renderDonutChart(providerTokenItems, (item) => item.tokens)}</article>
      <article class="card span-7"><div class="card-header"><div><h2>每日会话数量</h2><p>最近 14 个有记录的日期</p></div></div>${renderColumnChart(analysis.dates)}</article>
      <article class="card span-6"><div class="card-header"><div><h2>Agent 消息量</h2><p>哪些角色参与最多</p></div></div>${renderBarChart(agentMessageItems, (item) => item.messages, (item) => item.label, palette[1])}</article>
      <article class="card span-6"><div class="card-header"><div><h2>模型 Token 用量</h2><p>按实际 Provider/模型统计</p></div></div>${renderBarChart(modelTokenItems, (item) => item.tokens, (item) => item.label, palette[2])}</article>
    </section>
    <section class="table-card" style="margin-top:16px"><div class="card-header"><div><h2>会话列表</h2><p>点击主题查看完整聊天记录</p></div></div>
      <div class="filters"><input id="session-search" type="search" placeholder="搜索主题、Agent、模型或会话 ID"><select id="provider-filter"><option value="">全部 Provider</option>${providerOptions}</select><select id="agent-filter"><option value="">全部 Agent</option>${agentOptions}</select></div>
      <table><thead><tr><th>开始时间</th><th>主题</th><th>Agents</th><th>Provider / 模型</th><th>消息</th><th>Tokens</th><th>平均耗时</th><th>状态</th></tr></thead><tbody id="session-rows">${rows || `<tr><td colspan="8" class="empty">暂无日志</td></tr>`}</tbody></table>
    </section>
  </main>
  <script>
    const search=document.getElementById("session-search"),provider=document.getElementById("provider-filter"),agent=document.getElementById("agent-filter");
    const rows=[...document.querySelectorAll("#session-rows tr[data-search]")];
    function applyFilters(){const term=search.value.trim().toLowerCase();for(const row of rows){const matchSearch=!term||row.dataset.search.includes(term);const matchProvider=!provider.value||row.dataset.provider.split("|").includes(provider.value);const matchAgent=!agent.value||row.dataset.agent.split("|").includes(agent.value);row.style.display=matchSearch&&matchProvider&&matchAgent?"":"none";}}
    search.addEventListener("input",applyFilters);provider.addEventListener("change",applyFilters);agent.addEventListener("change",applyFilters);
  </script></body></html>`;
}
function renderSessionPage(session, previous, next) {
  const messages = session.messages.map((message, index) => {
    const meta = [
      formatDateTime(message.createdAt),
      `${message.provider || "未知"}/${message.model || "未知"}`,
      `${formatNumber(messageTokens(message))} Tokens`,
      formatDuration(message.elapsedMs),
    ];
    return `<article class="message" style="border-left-color:${palette[index % palette.length]}"><div class="message-head"><div><div class="message-author">${escapeHtml(message.speakerName || message.speakerId || "未知 Agent")}</div><div class="message-meta">${meta.map(escapeHtml).join(" · ")}</div></div><div class="message-meta">第 ${formatNumber(message.turn)} 轮</div></div><div class="message-text">${formatMultiline(message.text)}</div></article>`;
  }).join("");

  const errors = session.errors.map((error) => `<div class="error-box"><strong>运行错误</strong><br>${formatMultiline(error.message || "未知错误")}</div>`).join("");
  const parseErrors = session.parseErrors.map((error) => `<div class="error-box"><strong>JSONL 第 ${error.line} 行解析错误</strong><br>${escapeHtml(error.message)}</div>`).join("");
  const navigation = [
    previous ? `<a class="button" href="./${encodeURIComponent(previous.viewerFileName)}">上一个会话</a>` : "",
    next ? `<a class="button" href="./${encodeURIComponent(next.viewerFileName)}">下一个会话</a>` : "",
  ].filter(Boolean).join("");
  const providers = session.providers.map((provider) => `<span class="pill">${escapeHtml(provider)}</span>`).join("");
  const models = session.models.map((model) => `<span class="pill">${escapeHtml(model)}</span>`).join("");
  const agents = session.agents.map((agent) => `<span class="pill">${escapeHtml(agent.name)}</span>`).join("");

  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(session.topic)} · 聊天记录</title><style>${baseStyles()}</style></head>
  <body><main class="shell"><div class="breadcrumb"><a href="../index.html">← 返回日志仪表盘</a></div>
    <header class="hero"><h1>${escapeHtml(session.topic)}</h1><p>${escapeHtml(session.id)} · ${escapeHtml(formatDateTime(session.startedAt))}</p><div class="hero-actions"><button class="button" onclick="window.print()">打印 / 导出 PDF</button>${navigation}</div></header>
    <section class="metrics">
      ${renderMetric("消息", formatNumber(session.messageCount), `计划 ${formatNumber(session.plannedTurns)} 轮`)}
      ${renderMetric("总 Token", formatNumber(session.usage.totalTokens), `输入 ${formatNumber(session.usage.inputTokens)} / 输出 ${formatNumber(session.usage.outputTokens)}`)}
      ${renderMetric("会话耗时", formatDuration(session.durationMs), `平均响应 ${formatDuration(session.averageLatency)}`)}
      ${renderMetric("状态", session.status, `${formatNumber(session.errorCount)} 个错误`)}
    </section>
    <section class="card"><div class="card-header"><div><h2>会话信息</h2><p>实际参与者和模型路由</p></div></div><p><strong>Agent：</strong>${agents || "无"}</p><p><strong>Provider：</strong>${providers || "无"}</p><p><strong>模型：</strong>${models || "无"}</p><p><strong>源日志：</strong><code>${escapeHtml(session.sourceFile)}</code></p></section>
    ${errors}${parseErrors}
    <section style="margin-top:20px"><h2>完整聊天记录</h2>${messages || `<div class="empty">该会话没有消息记录</div>`}</section>
  </main></body></html>`;
}

const generatedAt = new Date().toISOString();
const sessions = await loadSessions();
const analysis = aggregateSessions(sessions);

await mkdir(sessionsDir, { recursive: true });
await mkdir(dataDir, { recursive: true });
await writeFile(join(viewerDir, "index.html"), renderDashboard(sessions, analysis, generatedAt), "utf8");
await Promise.all(sessions.map((session, index) => writeFile(
  join(sessionsDir, session.viewerFileName),
  renderSessionPage(session, sessions[index + 1] || null, sessions[index - 1] || null),
  "utf8",
)));
await writeFile(
  join(dataDir, "log-data.json"),
  JSON.stringify({ generatedAt, logsDir, totals: analysis.totals, analysis, sessions }, null, 2),
  "utf8",
);

console.log(`已扫描 ${sessions.length} 个会话，共 ${analysis.totals.messages} 条消息。`);
console.log(`HTML 仪表盘：${join(viewerDir, "index.html")}`);

if (process.argv.includes("--open")) {
  const { spawn } = await import("node:child_process");
  const indexPath = join(viewerDir, "index.html");
  const command = process.platform === "win32"
    ? { file: "cmd", args: ["/c", "start", "", indexPath] }
    : process.platform === "darwin"
      ? { file: "open", args: [indexPath] }
      : { file: "xdg-open", args: [indexPath] };
  const child = spawn(command.file, command.args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
}