# 多 Agent 聊天、任务竞赛与日志分析

这是一个零依赖的 Node.js 示例项目，用于：

- 让两个或多个 Agent 围绕同一个主题聊天。
- 为不同 Agent 配置不同模型和 Provider。
- 让多个 Agent 独立完成同一项任务并比赛排名。
- 将每一次对话和任务尝试保存为 JSONL 与 Markdown。
- 把日志转换成可以筛选、统计图表和导出 PDF 的静态 HTML 页面。

项目不要求安装 npm 依赖，使用 Node.js 内置的 `fetch`、文件系统和 HTTP 服务。

## 目录

1. [第一次使用](#1-第一次使用)
2. [功能状态](#2-功能状态)
3. [项目结构](#3-项目结构)
4. [核心概念](#4-核心概念)
5. [环境准备和密钥文件](#5-环境准备和密钥文件)
6. [配置模型 Provider](#6-配置模型-provider)
7. [配置 Agent](#7-配置-agent)
8. [运行多 Agent 聊天](#8-运行多-agent-聊天)
9. [运行 Agent 任务竞赛](#9-运行-agent-任务竞赛)
10. [查看 HTML 日志](#10-查看-html-日志)
11. [日志文件格式](#11-日志文件格式)
12. [完整环境变量参考](#12-完整环境变量参考)
13. [常见问题](#13-常见问题)
14. [安全与隐私](#14-安全与隐私)
15. [添加新的 Provider](#15-添加新的-provider)
16. [README 维护规则](#16-readme-维护规则)

## 1. 第一次使用

### 第一步：进入项目目录

```powershell
cd C:\Users\Administrator\Desktop\testAI
```

### 第二步：检查 Node.js

```powershell
node --version
```

建议使用 Node.js 18 或更高版本，项目已在 Node.js 24 上验证。

### 第三步：选择模型 Provider

第一次使用只需要配置一个 Provider。最简单的三种选择是：

- OpenAI：编辑 `secrets.json` 中的 `providers.openai.apiKey`。
- DeepSeek：编辑 `secrets.json` 中的 `providers.deepseek.apiKey`。
- 本地 Ollama：不需要云端 API Key，但需要先安装并启动 Ollama。

项目根目录已经提供 `secrets.json`，直接打开并填写：

```json
{
  "providers": {
    "openai": {
      "apiKey": "在这里粘贴你的 OpenAI API Key"
    },
    "deepseek": {
      "apiKey": ""
    },
    "qwen": {
      "apiKey": ""
    }
  }
}
```

保存后直接运行，不需要设置系统环境变量。`secrets.json` 已加入 `.gitignore`，不会被提交到 Git。

如果不想使用独立密钥文件，也可以直接在 `providers.json` 对应 Provider 中增加：

```json
{
  "apiKey": "在这里粘贴 API Key"
}
```

当前 `agents.json` 默认使用 OpenAI。如果选择其他 Provider，还需要修改 Agent 的 `provider` 和 `model`。

### 第四步：运行一次聊天

```powershell
node .\multi-agent-chat.mjs "讨论：如何设计一个多 Agent 协作系统？"
```

运行结束后会生成：

```text
logs/YYYYMMDD/会话ID.md
logs/YYYYMMDD/会话ID.jsonl
```

`.md` 可以直接阅读，`.jsonl` 用于统计分析和 HTML 查看器。

### 第五步：生成 HTML 日志页面

```powershell
node .\view-logs.mjs --open
```

如果浏览器没有自动打开，手动打开：

```text
viewer\index.html
```

### 第六步：运行任务竞赛

示例任务是让三个 Agent 比赛破解凯撒密码：

```powershell
node .\task-runner.mjs .\tasks\cipher-race.json
```

然后再次生成 HTML 日志：

```powershell
node .\view-logs.mjs --open
```

## 2. 功能状态

| 功能 | 状态 | 入口 |
|---|---|---|
| 多 Agent 轮流聊天 | 可用 | `multi-agent-chat.mjs` |
| Agent 分别使用不同 Provider | 可用 | `agents.json`、`providers.json` |
| OpenAI Responses API | 可用 | `providers/openai-responses.mjs` |
| OpenAI-compatible Chat Completions | 可用 | `providers/openai-compatible.mjs` |
| 本地 Ollama | 可用 | `providers/ollama.mjs` |
| Markdown 和 JSONL 日志 | 可用 | `logs/` |
| 本地 API Key 配置文件 | 可用 | `secrets.json` |\n| HTML 统计仪表盘 | 可用 | `view-logs.mjs` |
| 独立任务竞赛 | 初始版可用 | `task-runner.mjs` |
| 正确答案自动评测 | 可用 | 任务文件中的 `solution` |
| 速度奖励和重试扣分 | 可用 | 任务文件中的 `rules` |
| 任意 Shell 或 Python 执行 | 尚未开放 | 后续需增加受控工具层 |
| 多 Agent 共享黑板的协作任务 | 尚未实现 | 后续扩展 TaskRunner |
| 任务结果的专用 HTML 排行榜 | 部分支持 | 当前通过任务 JSON 和任务 Markdown 查看 |

## 3. 项目结构

```text
testAI/
├── README.md                       # 本操作说明
├── AGENTS.md                       # 后续开发时必须遵守的文档维护规则
├── agents.json                     # Agent 名称、角色和模型路由
├── providers.json                  # Provider 地址、模型和密钥引用
├── secrets.json                    # 用户填写 API Key，本地文件且已忽略提交
├── secrets.example.json            # secrets.json 的空白模板
├── multi-agent-chat.mjs            # 多 Agent 聊天入口
├── task-runner.mjs                 # 任务竞赛入口
├── view-logs.mjs                   # 日志统计和 HTML 生成入口
├── providers/
│   ├── index.mjs                   # Provider 统一路由
│   ├── http.mjs                    # 请求、鉴权、超时和错误封装
│   ├── openai-responses.mjs        # OpenAI Responses API 适配器
│   ├── openai-compatible.mjs       # Chat Completions 兼容适配器
│   └── ollama.mjs                  # Ollama 原生适配器
├── tasks/
│   └── cipher-race.json            # 凯撒密码竞赛示例
├── logs/                           # 自动生成的聊天和任务日志
└── viewer/                         # 自动生成的 HTML 日志页面
```

`logs/` 和 `viewer/` 已加入 `.gitignore`，因为其中可能包含敏感对话和模型输出。
## 4. 核心概念

### Agent

一个 Agent 包含：

- `id`：程序内部唯一标识。
- `name`：显示名称。
- `provider`：使用哪个模型服务。
- `model`：使用哪个模型。
- `system`：角色和任务约束。

Agent 不等于独立进程。程序会读取同一个 Agent 配置，然后通过 Provider 路由调用对应模型。

### Provider

Provider 表示“怎样访问一个模型服务”，例如：

- OpenAI Responses API。
- DeepSeek 等兼容 Chat Completions 的服务。
- 本地 Ollama。

聊天主程序只调用统一的：

```js
providerRouter.chat({
  agent,
  system,
  prompt,
  signal,
});
```

所有适配器都返回相同结构：

```js
{
  text,          // 文本答案
  provider,      // Provider 名称
  providerType,  // Provider 类型
  model,         // 实际使用的模型
  usage,       // 输入、输出和总 Token
  requestId,   // 可能为 null
  raw          // Provider 原始响应，仅适配器内部使用
}
```

### TaskRunner

TaskRunner 负责：

- 读取任务配置。
- 把公开题目发送给每个参赛 Agent。
- 隔离参赛 Agent，不让它们看到彼此的答案。
- 解析 Agent 的结构化答案。
- 使用本地 `solution` 判定正确性。
- 统计耗时、Token、尝试次数和得分。
- 输出排行榜和结构化日志。

### HTML 日志查看器

`view-logs.mjs` 读取 `logs/**/*.jsonl`，生成纯静态 HTML。页面不需要 Node 服务，不需要联网，也不会把日志上传到外部。

## 5. 环境准备和密钥文件

### Node.js

```powershell
node --version
```

要求：

- Node.js 18 或更高版本。
- 无需执行 `npm install`。
- 无需额外图表库、Web 框架或数据库。

### 推荐方式：编辑 secrets.json

项目根目录已经有：

```text
secrets.json
secrets.example.json
```

`secrets.example.json` 是模板；`secrets.json` 是你的本地真实配置文件，并且已经被 `.gitignore` 忽略。

填写示例：

```json
{
  "providers": {
    "openai": {
      "apiKey": "sk-你的 OpenAI Key"
    },
    "deepseek": {
      "apiKey": "sk-你的 DeepSeek Key"
    },
    "qwen": {
      "apiKey": "sk-你的 DashScope Key"
    },
    "ollama": {
      "apiKey": ""
    }
  }
}
```

只需要填写实际使用的 Provider。例如只使用 OpenAI 时，只有 `providers.openai.apiKey` 必须有值。

不需要设置任何系统环境变量。运行程序时，Provider 路由会自动读取本项目目录下的 `secrets.json`。

### 简化方式：直接写在 providers.json

也可以直接在 `providers.json` 中粘贴：

```json
{
  "openai": {
    "type": "openai-responses",
    "baseUrl": "https://api.openai.com/v1",
    "apiKey": "sk-你的 OpenAI Key",
    "apiKeyRef": "openai",
    "model": "gpt-4.1-mini"
  }
}
```

解析优先级：

1. `providers.json` 中当前 Provider 的 `apiKey`。
2. `secrets.json` 中 `apiKeyRef` 指向的 `apiKey`。
3. 可选的 `apiKeyEnv` 系统环境变量兼容方式。
4. 无鉴权 Provider 返回空密钥，例如默认 Ollama。

`providers.json` 是普通项目文件，可能被提交或分享。把真实 Key 写进去之前必须确认不会提交该文件。

### 自定义密钥文件位置

默认位置是 `providers.json` 同目录下的 `secrets.json`。如确实需要切换位置，可以选用 `SECRETS_FILE` 环境变量，但这不是正常使用的必需步骤。

## 6. 配置模型 Provider

配置文件是 `providers.json`。当前配置使用 `apiKeyRef` 指向密钥文件：

```json
{
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "type": "openai-responses",
      "baseUrl": "https://api.openai.com/v1",
      "apiKeyRef": "openai",
      "modelEnv": "OPENAI_MODEL",
      "model": "gpt-4.1-mini",
      "timeoutMs": 120000
    },
    "deepseek": {
      "type": "openai-compatible",
      "baseUrl": "https://api.deepseek.com/v1",
      "apiKeyRef": "deepseek",
      "modelEnv": "DEEPSEEK_MODEL",
      "model": "deepseek-chat",
      "timeoutMs": 120000
    },
    "qwen": {
      "type": "openai-compatible",
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKeyRef": "qwen",
      "modelEnv": "QWEN_MODEL",
      "model": "qwen-plus",
      "timeoutMs": 120000
    },
    "ollama": {
      "type": "ollama",
      "baseUrl": "http://127.0.0.1:11434",
      "modelEnv": "OLLAMA_MODEL",
      "model": "qwen3:8b",
      "timeoutMs": 300000
    }
  }
}
```

### Provider 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `type` | 是 | `openai-responses`、`openai-compatible` 或 `ollama` |
| `baseUrl` | 是 | 模型服务基础地址 |
| `endpoint` | 否 | 覆盖默认接口路径 |
| `apiKeyRef` | 需要密钥时 | 指向 `secrets.json.providers` 中的键 |
| `apiKey` | 否 | 直接把 Key 写在当前 Provider 中，优先级最高 |
| `apiKeyEnv` | 否 | 可选的系统环境变量兼容方式 |
| `apiKeyHeader` | 否 | 自定义鉴权请求头，默认 `Authorization` |
| `apiKeyPrefix` | 否 | 鉴权值前缀，默认 `Bearer ` |
| `modelEnv` | 否 | 可临时覆盖模型的环境变量 |
| `model` | 通常需要 | Provider 默认模型 |
| `timeoutMs` | 否 | 单次请求超时，默认 120000 ms |
| `headers` | 否 | 额外请求头 |
| `extraBody` | 否 | 合并到请求体的额外字段 |

### 使用 DeepSeek

编辑 `secrets.json`：

```json
{
  "providers": {
    "deepseek": {
      "apiKey": "你的 DeepSeek API Key"
    }
  }
}
```

然后让 Agent 使用 `deepseek`：

```json
{
  "provider": "deepseek",
  "model": "deepseek-chat"
}
```

### 使用通义千问兼容模式

编辑 `secrets.json`：

```json
{
  "providers": {
    "qwen": {
      "apiKey": "你的 DashScope API Key"
    }
  }
}
```

修改 Agent：

```json
{
  "provider": "qwen",
  "model": "qwen-plus"
}
```

### 使用本地 Ollama

安装并启动 Ollama 后：

```powershell
ollama pull qwen3:8b
ollama serve
```

修改 Agent：

```json
{
  "provider": "ollama",
  "model": "qwen3:8b"
}
```

Ollama 默认不需要 API Key，也不需要修改 `secrets.json`。

### 临时覆盖全部默认 Provider

```powershell
$env:DEFAULT_PROVIDER = "deepseek"
```

没有单独设置 `agent.provider` 时，会使用该 Provider。

## 7. 配置 Agent

配置文件是 `agents.json`。示例：

```json
[
  {
    "id": "product",
    "name": "产品经理",
    "provider": "openai",
    "model": "gpt-4.1-mini",
    "system": "你是产品经理 Agent。请提出可执行方案，并回应其他 Agent 的观点。"
  },
  {
    "id": "engineer",
    "name": "工程师",
    "provider": "deepseek",
    "model": "deepseek-chat",
    "system": "你是工程师 Agent。请指出技术风险并给出实现建议。"
  }
]
```

Agent 字段：

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 唯一标识，任务和日志会引用它 |
| `name` | 是 | 页面和终端显示名称 |
| `system` | 是 | 系统提示词、角色、约束和输出要求 |
| `provider` | 否 | 未填写时使用默认 Provider |
| `model` | 否 | 未填写时依次使用模型环境变量和 Provider 默认模型 |

Agent 数量没有上限。聊天时会按数组顺序轮流发言；任务竞赛时默认所有 Agent 参赛，也可以由任务的 `agentIds` 指定部分 Agent。

## 8. 运行多 Agent 聊天

```powershell
node .\multi-agent-chat.mjs "讨论主题"
```

如果没有传入主题，程序会使用内置的默认讨论主题。

### 控制发言轮数

```powershell
$env:TURNS = "9"
node .\multi-agent-chat.mjs "讨论主题"
```

### 控制上下文长度

```powershell
$env:MAX_CONTEXT_MESSAGES = "30"
```

程序会保存完整聊天日志，但发送给模型时只使用最近 30 条记录，避免上下文无限增长。

### 聊天输出

```text
logs/YYYYMMDD/会话ID.md
logs/YYYYMMDD/会话ID.jsonl
```

聊天主程序不直接保存 API Key。

### 使用其他 Agent 配置文件

```powershell
$env:AGENTS_FILE = "D:\configs\my-agents.json"
$env:PROVIDERS_FILE = "D:\configs\my-providers.json"
node .\multi-agent-chat.mjs "讨论主题"
```
## 9. 运行 Agent 任务竞赛

任务竞赛由 `task-runner.mjs` 执行。当前支持 `race` 类型：

- 所有参赛 Agent 并发处理同一个任务。
- 每个 Agent 只能看到自己之前的尝试。
- 不同 Agent 之间互相隔离，不能看到其他人的答案。
- 程序统一评测，不把标准答案发送给模型。
- 正确性、耗时、Token 和得分都会写入日志。

### 运行内置凯撒密码任务

```powershell
node .\task-runner.mjs .\tasks\cipher-race.json
```

### 指定默认任务

```powershell
$env:TASK_FILE = "D:\tasks\my-task.json"
node .\task-runner.mjs
```

### 任务配置示例

```json
{
  "id": "caesar-race-demo",
  "type": "race",
  "title": "凯撒密码破解赛",
  "prompt": "破解下面的凯撒密码并提交完整明文。",
  "input": {
    "ciphertext": "YMJ VZNHP GWTBS KTC OZRUX TAJW YMJ QFED ITL"
  },
  "hints": [
    "使用英文字母经典凯撒位移",
    "位移范围是 1 到 25"
  ],
  "solution": {
    "answer": "THE QUICK BROWN FOX JUMPS OVER THE LAZY DOG",
    "normalizer": "text"
  },
  "rules": {
    "timeoutMs": 90000,
    "attemptsPerAgent": 2,
    "baseScore": 100,
    "speedBonusMax": 50,
    "attemptPenalty": 15
  },
  "agentIds": ["product", "engineer", "researcher"]
}
```

### 任务字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `id` | 是 | 任务唯一标识 |
| `type` | 是 | 当前只支持 `race` |
| `title` | 是 | 任务和日志标题 |
| `prompt` | 是 | 发送给 Agent 的任务说明 |
| `input` | 否 | 公开题目数据 |
| `hints` | 否 | 所有 Agent 都能看到的提示 |
| `solution` | 是 | 本地评测标准，不发送给模型 |
| `rules` | 否 | 超时、尝试次数和评分规则 |
| `agentIds` | 否 | 参赛 Agent；省略时使用全部 Agent |

### solution 字段

支持两种判定方式。

#### 直接答案

```json
{
  "solution": {
    "answer": "正确答案",
    "normalizer": "text"
  }
}
```

`normalizer`：

- `text`：忽略大小写、空格、常见标点和符号。
- `exact`：只去除首尾空白，其他字符必须完全一致。

#### SHA-256 校验

```json
{
  "solution": {
    "sha256": "答案标准化后的 SHA-256 小写十六进制值"
  }
}
```

程序会先对 Agent 答案执行“忽略大小写、空格、标点和符号”的标准化，再计算 SHA-256。

### rules 字段

| 字段 | 默认值 | 说明 |
|---|---:|---|
| `timeoutMs` | 120000 | 每次尝试的超时毫秒数 |
| `attemptsPerAgent` | 1 | 每个 Agent 最多尝试几次 |
| `baseScore` | 100 | 正确时的基础分 |
| `speedBonusMax` | 50 | 满速时的最大速度奖励 |
| `attemptPenalty` | 10 | 第二次及之后每次尝试的扣分 |

最终得分：

```text
正确：baseScore + speedBonus - retryPenalty
错误：0
```

排名顺序：

1. 是否答对。
2. 得分高低。
3. 总耗时长短。

### Agent 输出协议

TaskRunner 会要求 Agent 只输出：

```json
{
  "answer": "最终答案",
  "confidence": 0.9,
  "reasoning": "简要推理",
  "method": "使用方法"
}
```

即使模型使用了 Markdown 代码块，程序也会尝试提取 JSON。如果解析失败，会把整段文本作为答案参与评测。

### 任务输出文件

```text
logs/YYYYMMDD/
├── 运行ID.md
├── 运行ID.jsonl
└── 运行ID-results.json
```

- `.md`：排行榜和每个 Agent 的完整尝试。
- `.jsonl`：聊天兼容事件和任务评分事件。
- `-results.json`：程序化排名结果。

### solution 和日志的关系

`solution` 字段本身不会发送给模型，也不会写入日志。但是，如果模型正确回答了题目，模型的原始回答和解析后的答案会正常写入日志。因此日志本身仍应视为可能包含敏感内容。

### 当前限制

当前版本没有开放任意 Shell、Python 或文件系统工具。它适合：

- 凯撒密码。
- ROT13。
- Base64 或十六进制转换。
- 维吉尼亚密码。
- 简单替换密码。
- 通过文本推理完成的题目。

AES、RSA 等强加密通常需要密钥、协议信息或受控计算工具，不应期待模型在没有任何工具时直接破解。后续可以增加白名单工具和代码执行沙箱。

## 10. 查看 HTML 日志

### 生成并打开

```powershell
node .\view-logs.mjs --open
```

### 只生成不打开

```powershell
node .\view-logs.mjs
```

### 指定日志和输出目录

```powershell
$env:LOGS_DIR = "D:\chat-logs"
$env:VIEWER_DIR = "D:\chat-viewer"
node .\view-logs.mjs --open
```

### 生成结构

```text
viewer/
├── index.html
├── sessions/
│   ├── 会话ID.html
│   └── 任务运行ID.html
└── data/
    └── log-data.json
```

### 仪表盘内容

- 会话数和消息数。
- 总 Token、输入 Token、输出 Token。
- 平均响应时间和 P95。
- Provider Token 占比。
- 每日会话数量。
- Agent 消息量排行。
- 模型 Token 使用排行。
- 按主题、Agent、Provider 或模型筛选。
- 每个会话的完整消息和模型路由。
- 错误信息。
- 打印和导出 PDF。

HTML 文件可以直接双击打开。它们不依赖服务器或外部 CDN。

## 11. 日志文件格式

### Markdown 日志

`*.md` 适合人阅读，包含会话信息、消息内容、Provider、模型、Token、耗时和错误。

### JSONL 日志

`*.jsonl` 每行是一个独立 JSON 对象，适合程序分析。当前事件类型：

| `type` | 说明 |
|---|---|
| `session_start` | 会话或任务开始 |
| `message` | 一次 Agent 回复或任务尝试 |
| `task_attempt` | 任务尝试的评分明细 |
| `contestant_result` | 单个参赛 Agent 的最终结果 |
| `task_result` | 整场任务的排行榜 |
| `session_end` | 会话或任务结束 |
| `error` | 运行错误 |

### 普通 message 的主要字段

```json
{
  "type": "message",
  "sessionId": "20260928-100000-demo",
  "turn": 1,
  "speakerId": "product",
  "speakerName": "产品经理",
  "provider": "openai",
  "providerType": "openai-responses",
  "model": "gpt-4.1-mini",
  "text": "Agent 回复内容",
  "usage": {
    "inputTokens": 100,
    "outputTokens": 50,
    "totalTokens": 150
  },
  "requestId": "req_xxx",
  "createdAt": "2026-09-28T02:00:00.000Z",
  "elapsedMs": 1200
}
```

任务尝试还会附带 `task` 字段：

```json
{
  "attempt": 1,
  "correct": true,
  "score": 145,
  "answer": "Agent 提交的答案",
  "confidence": 0.95,
  "method": "brute-force"
}
```

### 重新生成 HTML

HTML 可以随时从 JSONL 重新生成：

```powershell
node .\view-logs.mjs --open
```

HTML 生成器不会修改原始日志。
## 12. 完整环境变量参考

### 配置文件路径

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `AGENTS_FILE` | `./agents.json` | Agent 配置文件 |
| `PROVIDERS_FILE` | `./providers.json` | Provider 配置文件 |
| `SECRETS_FILE` | `./secrets.json` | 本地 API Key 文件，可选覆盖 |
| `TASK_FILE` | `./tasks/cipher-race.json` | 默认任务文件 |
| `LOGS_DIR` | `./logs` | HTML 查看器扫描的日志目录 |
| `VIEWER_DIR` | `./viewer` | HTML 输出目录 |

### 运行行为

| 环境变量 | 默认值 | 用途 |
|---|---:|---|
| `DEFAULT_PROVIDER` | `providers.json.defaultProvider` | 临时覆盖默认 Provider |
| `TURNS` | `6` | 聊天总发言轮数 |
| `MAX_CONTEXT_MESSAGES` | `30` | 每次请求最多发送多少条历史消息 |
| `OPENAI_MODEL` | Provider 默认模型 | 临时覆盖 OpenAI 模型 |
| `DEEPSEEK_MODEL` | Provider 默认模型 | 临时覆盖 DeepSeek 模型 |
| `QWEN_MODEL` | Provider 默认模型 | 临时覆盖千问模型 |
| `OLLAMA_MODEL` | Provider 默认模型 | 临时覆盖 Ollama 模型 |

### API Key

默认不需要系统环境变量。密钥按以下顺序读取：

1. `providers.json` 当前 Provider 的 `apiKey`。
2. `secrets.json` 中对应 `apiKeyRef` 的 `apiKey`。
3. 可选的 `apiKeyEnv` 环境变量。

`secrets.json` 是推荐方式，并且已加入 `.gitignore`。

可选兼容环境变量：

| 环境变量 | Provider |
|---|---|
| `OPENAI_API_KEY` | OpenAI |
| `DEEPSEEK_API_KEY` | DeepSeek |
| `DASHSCOPE_API_KEY` | 通义千问兼容模式 |

Ollama 默认不需要 API Key。

### 常用命令

| 目标 | 命令 |
|---|---|
| 多 Agent 聊天 | `node .\multi-agent-chat.mjs "主题"` |
| 密码竞赛 | `node .\task-runner.mjs .\tasks\cipher-race.json` |
| 生成 HTML | `node .\view-logs.mjs` |
| 生成并打开 HTML | `node .\view-logs.mjs --open` |
| 检查脚本语法 | `node --check .\multi-agent-chat.mjs` |

## 13. 常见问题

### `node` 不是可识别的命令

安装 Node.js 18 或更高版本，并重新打开 PowerShell。

### 缺少 API Key

例如：

```text
Provider "openai" 未配置 API Key。请编辑 secrets.json 中的 providers.openai.apiKey，或直接在 providers.json 的 providers.openai.apiKey 中填写。
```

推荐解决方法：打开项目根目录的 `secrets.json`，填写：

```json
{
  "providers": {
    "openai": {
      "apiKey": "你的 API Key"
    }
  }
}
```

也可以直接在 `providers.json` 的 `providers.openai` 下增加 `apiKey`。系统环境变量方式仍然可用，但不再要求用户配置。

确认 Agent 使用的 Provider 和填写 Key 的 Provider 名称一致。

### HTTP 401 或 403

通常表示：

- API Key 错误。
- API Key 已失效。
- 账号没有该模型权限。
- 请求发送到了错误的 Provider 地址。

### 模型不存在

检查 `agents.json` 中的 `model` 和对应 Provider 的 `model`。不同账号可使用的模型可能不同。

### HTTP 404

通常是 `baseUrl` 或 `endpoint` 配置错误。

- OpenAI Responses 默认路径：`/responses`
- OpenAI-compatible 默认路径：`/chat/completions`
- Ollama 默认路径：`/api/chat`

### Ollama 连接失败

确认服务已启动：

```powershell
ollama serve
```

确认模型已下载：

```powershell
ollama pull qwen3:8b
```

默认地址是 `http://127.0.0.1:11434`。

### HTML 页面没有记录

先运行聊天或任务：

```powershell
node .\multi-agent-chat.mjs "测试主题"
node .\view-logs.mjs --open
```

如果使用了自定义 `LOGS_DIR`，生成 HTML 时也必须设置相同的 `LOGS_DIR`。

### JSON 文件解析失败

检查：

- 文件是有效 JSON，不能使用 `//` 注释。
- 最后一个字段后不能有多余逗号。
- 推荐使用 UTF-8 编码。
- 优先检查 `secrets.json`；如果直接写入了 `providers.json`，要确认该文件不会被提交或分享。

### 任务没有任何 Agent 解出

查看：

- `logs/YYYYMMDD/运行ID.md`
- `logs/YYYYMMDD/运行ID-results.json`
- `logs/YYYYMMDD/运行ID.jsonl`

常见原因：

- 模型没有按 JSON 格式输出。
- 题目或提示不足。
- 标准答案的 `normalizer` 不匹配。
- 超时过短。
- 模型能力不足以完成该任务。

### 任务输出不是 JSON

程序会先尝试提取 Markdown JSON 代码块，再尝试截取第一个 `{` 到最后一个 `}`。如果全部失败，会把整段输出当作答案。可以在 Agent 的 `system` 提示中加强 JSON 输出约束。

## 14. 安全与隐私

### API Key

- 推荐把 Key 放在 `secrets.json`。
- `secrets.json` 已加入 `.gitignore`，不要强制提交。
- 可以直接写在本地 `providers.json` 的 `apiKey` 字段，但该文件可能被提交或分享。
- 系统环境变量方式仅作为兼容功能保留。
- 不要把 Key 粘贴到聊天日志、任务文件或 README。
- 不要把包含 Key 的终端历史公开。

### 日志隐私

日志可能包含：

- 用户输入的讨论主题。
- 发送给模型的完整提示。
- 模型输出。
- 任务答案和解题过程。
- Provider、模型、Token 和耗时信息。

`logs/` 和 `viewer/` 已被 Git 忽略，但仍应像普通敏感文件一样管理。如果要分享日志，请先检查内容并脱敏。

### 远程模型

使用 OpenAI、DeepSeek、千问等远程服务时，题目和对话内容会发送给对应服务商。不要在未确认合规的情况下发送密钥、个人信息、内部代码或商业机密。

### 任务标准答案

`solution` 不会主动发送给参赛模型，也不会直接写入日志。但如果 Agent 正确回答，正确答案会作为模型回复出现在日志中。

### 代码执行

当前版本没有开放任意 Shell、Python、文件系统或网络工具。不要直接给模型增加不受限制的 `eval`、`exec` 或 Shell 调用。后续实现工具层时，应使用白名单、超时、资源限制和隔离目录。

## 15. 添加新的 Provider

Provider 适配器必须导出统一函数：

```js
export async function chat({
  providerName,
  provider,
  model,
  system,
  prompt,
  signal,
}) {
  return {
    text: "模型返回文本",
    requestId: null,
    usage: {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
    },
    raw: {},
  };
}
```

增加步骤：

1. 在 `providers/` 新建适配器文件。
2. 实现 `chat()`。
3. 在 `providers/index.mjs` 中导入并注册新的 `type`。
4. 在 `providers.json` 增加配置。
5. 在 `agents.json` 中让 Agent 使用新的 Provider。
6. 在 README 中补充配置、环境变量、限制和示例。
7. 使用本地模拟服务完成测试，避免测试消耗真实 API 额度。

## 16. README 维护规则

README 是用户操作入口，不是可选文档。任何功能优化都必须同步修改本文件。

### 必须同步 README 的改动

| 改动类型 | 必须更新 |
|---|---|
| 新增或修改命令 | 第一次使用、常用命令、相关功能章节 |
| 新增环境变量 | 完整环境变量参考 |
| 修改 `agents.json` | 配置 Agent |
| 修改 `providers.json` | 配置 Provider、添加自定义 Provider |
| 新增 Provider 类型 | Provider 状态表、配置参考、示例 |
| 修改任务字段 | 任务竞赛配置和字段表 |
| 修改评分规则 | TaskRunner 评分章节 |
| 修改日志事件或字段 | 日志文件格式 |
| 修改 HTML 查看器 | 查看 HTML 日志 |
| 修改安全边界 | 安全与隐私 |
| 删除或重命名文件 | 项目结构和目录说明 |
| 修改依赖、Node 版本或密钥文件 | 环境准备和密钥文件 |

### 每次修改功能的完成标准

- 新用户可以只阅读 README 完成配置和运行。
- 所有命令都在当前代码中真实存在。
- 所有环境变量名称与代码一致。
- 所有 JSON 示例都是有效 JSON。
- 示例文件名与项目结构一致。
- 新增限制和已知问题已经明确说明。
- README 中的功能状态表已经更新。
- 如果改变了日志格式，HTML 查看器说明已经同步更新。
- 如果改变了安全问题，安全章节已经同步更新。

### 推荐的修改流程

1. 修改代码。
2. 更新 README 对应章节。
3. 检查 README 目录和交叉引用。
4. 运行 `node --check`。
5. 使用模拟 Provider 或模拟日志测试功能。
6. 确认 README 示例可以执行。
7. 检查 `git diff -- README.md`，确保说明没有遗漏。

`AGENTS.md` 中记录了同样的强制规则。后续让编码 Agent 修改项目时，应要求它把 README 更新视为功能修改的一部分，而不是单独的可选收尾工作。