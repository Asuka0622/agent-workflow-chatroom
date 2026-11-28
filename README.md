# RINNE RELAY (TIMELESS // STUDIO) — Multi-Agent Local Group Chatroom & Visual Workflow Orchestrator

> Pure local-first (`127.0.0.1:4310`) multi-model collaboration desktop app & visual workflow studio — strictly bound to localhost, zero cloud upload, featuring original operator mascot **Rinne (环音)** and a **Claude Canvas**-style split-pane DAG orchestrator.

Bring **Claude**, **DeepSeek**, **Doubao**, **Gemini / Antigravity (`agy`)**, **Codex / GPT**, **Ollama**, **WorkBuddy**, and **AWS Quick** into one unified local multi-agent studio — `@mention` models in parallel, let them auto-relay or debate, orchestrate 12-node visual DAG workflows with real-time progress HUDs, inspect/edit local workspace code & Git diffs side-by-side, and keep GUI agents responsive with **0-token keep-alive long-polling**, **built-in MCP**, or **single-turn folder File-Bridge**.

---

## What's New (Latest Update)

- **Separated Formal Feed & Live Waiting Tray (`正式消息流` 与 `接单与处理中` 彻底分离)**
  - Formal message cards render only finished/error replies in **strict actual reply arrival order** (whoever replies first lands first, with clean stage headers).
  - Pending / thinking / bridge-waiting replies live in a compact bottom **Live Waiting Tray** with real-time elapsed timers, per-message cancel, 35s stall/confirmation-dialog warning, and inline **manual paste reply** fallback.
  - **Non-blocking concurrent chat & event-driven auto-relay**: one member stalling on a client confirmation dialog never blocks other members or freezes downstream `@mention` relays.
- **Visual Workflow Canvas 2.0 (Live Progress HUD + Anti-Trap Guidance + AI Generator)**
  - **Real-time Canvas Progress HUD**: top step-progress bar (`X/Y 步 · %`), live ticking node timers, inline node live-log previews, Node Inspector live execution log panel, 1-click **Stop**, and live log sync with the chatroom waiting tray.
  - **New-User Topology Advisor & Data-Flow Badges**: node cards explicitly display data visibility (`并行盲跑（彼此看不到对方输出）`, `汇合 N 路结果`, `接续「上游节点」`); unmerged blind parallel branches trigger a 1-click **`+ 补下游汇总 / 裁判`** or **`改为串行交接`** fix bar, plus a 30-second **`? 用法`** cheat sheet and 3 starter patterns (`串行接力`, `并行盲跑 + 裁判`, `双模型对抗`).
  - **AI Workflow Generator with Member Picker**: generate or edit DAGs from one sentence using any **online chatroom member**, configured **API provider**, or **0-token local synthesizer**, with instant cancel and automatic fallback.
  - **`+ 新建画布` + 8 Categorized Templates** (`开发 / 评审 / 脑暴 / 写作`) + template copy / JSON export & import.
- **Guided Model Pool & Antigravity CLI (`agy`) Support**
  - Upgraded Gemini CLI preset & auto-detection to official **Antigravity CLI (`agy -p --output-format text`)** with automatic `%LOCALAPPDATA%\agy\bin` probing (works immediately after install without restarting the app) and `--effort` passthrough.
  - Step-by-step 1→2→3 setup guides, direct API Key console links, 1-click OpenAI-compatible presets (`DeepSeek / OpenAI / OpenRouter / 硅基流动 / 本机 Ollama`), **`终端运行`** auto-execution, and **`复制命令后自动打开终端`** toggle.
- **3-Scenario Agent Onboarding, Built-In MCP & Member Management**
  - Streamlined 3-scenario invite wizard (`终端/IDE 接入`, `文件夹桥接`, `MCP 接入`), single-turn safe File-Bridge prompts, built-in local **MCP Server** (`server/mcpServer.ts`), sidebar right-click member context menu (`@点名 / 编辑 / 离线 / 停等 / 移除`), and 2-click delete inside member profile modal.
- **Per-Member Skills & 3-Way External Skill Importer**
  - Scope any Skill to specific members (`targetMemberIds`), and import external Skills by **scanning local machine**, **uploading `.md/.json` files**, or **importing from URL**.
- **Original Mascot Rinne (环音)**
  - 9 high-resolution transparent expression artworks (`public/mascot/rinne-*.png`) dynamically reflecting room state (`idle / listening / working / approval / done / error / sleep`).

---

## Key Features

- **Multi-Model Group Chatroom**
  - Parallel `@model` / `@全员` dispatch with bidirectional composer pill sync, actual arrival order, configurable AI-to-AI auto-relay rounds (`0 ~ ∞`), custom avatars, quick rename, native thinking-effort controls, per-message token/quota tracking, and live presence (`在线 · 空闲`, `工作中`, `⚡ 监听待命`, `离线`).
  - Rich attachments: `+` menu for local upload, workspace file picker, long text/code snippets, full-window drag & drop, and `Ctrl+V` screenshot paste.
- **Claude-Style Split-Pane Visual Workflow Canvas (`@xyflow/react`)**
  - Resizable split-pane & fullscreen visual flow studio with drag-and-drop nodes, handle wiring, auto-layout, inline per-node model switching, real-time execution HUD, and **Artifacts** output preview.
  - **12 Executable Node Types**:
    - *AI Collaboration*: `AI 模型节点`, `并行分支`, `汇总与投票 (consensus)`, `双模型辩论 (debate)`, `审查修复循环 (review_loop)`
    - *Flow Control*: `需求输入`, `条件分支 IF/ELSE (condition)` with dual green/amber handles, `人工拍板关 (human_gate)`, `延时等待 (delay)`
    - *Tools & I/O*: `读取工作区文件 (file_read)`, `写入本地文件 (file_write)`, `Shell 命令 (shell)`, `HTTP / Webhook (http)`
- **Split-Pane Local Workspace & Git Diff**
  - Lazy-loaded directory tree, instant search, create file/folder, line-numbered code viewer, Markdown preview, inline editor (`Ctrl+S`), 1-click **「引用到对话」**, and live **Git 变更 & 着色 Diff** with 1-click **「发给群聊审查」**.
- **Universal Agent Connectivity (CLI / API / 0-Token Standby / File-Bridge / MCP)**
  - **Official CLIs & APIs**: Direct invocation of local official CLIs (`claude`, `agy`, `codex`, `ollama`) or OpenAI / Azure OpenAI / Anthropic / Gemini APIs.
  - **Global `chatroom` CLI (`CLI-Anything` style)**: `chatroom join / wait / pull / reply / send / status / stop-wait` with `--json` output.
  - **0-Token Streaming Heartbeat Long-Poll (`chatroom wait --heartbeat 15`)**: NDJSON heartbeat stream prevents terminal idle timeouts with 0 LLM tokens, auto-reconnects on server restart, and supports 1-click remote **`停等`**.
  - **Single-Turn Folder File-Bridge**: Mirrors pending tasks to `~/chatroom-bridge/<agentId>/tasks/*.json`, watches `replies/*.json|.md` (`< 1s` delivery & auto-cleanup), and supports inline manual paste fallback.
  - **Local MCP Endpoint**: Streamable HTTP / JSON-RPC MCP server built right into `127.0.0.1:4310`.
- **Workbench Extensions & Built-In Diagnostics**
  - Manage per-member **Skills (`/`)** with 3-way external import, **MCP / CLI Plugins**, **Global Knowledge Base**, **Prompt Templates & Schedules**, plus an in-app **「连接诊断与常见问题解决」** center.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 6, `@xyflow/react`, `lucide-react`
- **Backend**: Node.js, Express 5, Server-Sent Events (SSE), MCP JSON-RPC, strictly bound to `127.0.0.1`
- **Desktop**: Electron + `electron-builder` (Windows unpacked / portable)
- **CLI Harness**: `bin/chatroom.cjs` → `cli/chatroom.ts` (`npm link` installs global `chatroom`)

---

## Quick Start

```powershell
# 1. Install dependencies
npm install

# 2. Development mode (backend + Vite dev server)
npm run dev

# 3. Production build & local web server (http://127.0.0.1:4310)
npm run build
npm start

# 4. Package Windows desktop app (release/win-unpacked/Multi-Agent-Workflow.exe)
npm run desktop:dir

# 5. Optional: link global `chatroom` CLI
npm link
chatroom status
```

---

## Local Data Privacy

All runtime data (chat rooms, member profiles, API keys, workflow templates, workbench skills/knowledge, and uploads) is stored exclusively on your local machine (`%APPDATA%\agent-workflow\data` in desktop mode, or `./data` in dev mode) and is excluded from Git via `.gitignore`.
