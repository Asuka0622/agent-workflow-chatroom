# TIMELESS // STUDIO — Multi-Agent Local Group Chatroom & Visual Workflow Orchestrator

> Pure local-first (`127.0.0.1:4310`) multi-model collaboration desktop app inspired by **Arknights: Endfield / TIMELESS NASCENCE ∞** industrial sci-fi HUD aesthetics and **Claude Canvas** split-pane ergonomics.

Bring **Claude**, **DeepSeek**, **Gemini**, **Codex / GPT**, **Ollama**, **WorkBuddy**, and **AWS Quick** into one unified local multi-agent studio — `@mention` models in parallel, orchestrate 12-node visual DAG workflows, browse/edit workspace code & Git diffs side-by-side, and keep GUI agents responsive with **0-token keep-alive long-polling** or **folder File-Bridge**.

---

## Key Features

- **Multi-Model Group Chatroom**
  - Parallel `@model` / `@全员` dispatch with bidirectional composer pill sync, custom avatars, quick rename, native thinking-effort controls, and live presence (`在线 · 空闲`, `工作中`, `⚡ 监听待命`, `离线`).
  - Rich attachments: `+` menu for local upload, workspace file picker, long text/code snippets, full-window drag & drop, and `Ctrl+V` screenshot paste.
- **Claude-Style Split-Pane Visual Workflow Canvas (`@xyflow/react`)**
  - Resizable split-pane & fullscreen visual flow studio with drag-and-drop nodes, handle wiring, auto-layout, inline per-node model switching, and live **Artifacts** output preview.
  - **12 Executable Node Types**:
    - *AI Collaboration*: `AI 模型节点`, `并行分支`, `汇总与投票 (consensus)`, `双模型辩论 (debate)`, `审查修复循环 (review_loop)`
    - *Flow Control*: `需求输入`, `条件分支 IF/ELSE (condition)` with dual green/amber handles, `人工拍板关 (human_gate)`, `延时等待 (delay)`
    - *Tools & I/O*: `读取工作区文件 (file_read)`, `写入本地文件 (file_write)`, `Shell 命令 (shell)`, `HTTP / Webhook (http)`
  - Built-in reusable templates + save/manage custom templates.
- **Split-Pane Local Workspace & Git Diff**
  - Lazy-loaded directory tree, instant search, create file/folder, line-numbered code viewer, Markdown preview, inline editor (`Ctrl+S`), 1-click **「引用到对话」**, and live **Git 变更 & 着色 Diff** with 1-click **「发给群聊审查」**.
- **Universal Agent Connectivity (Zero-Token Standby & File-Bridge)**
  - **Auto CLI Binding**: Direct invocation of local official CLIs (`claude`, `gemini`, `codex`, `ollama`) or OpenAI/Anthropic/Gemini-compatible APIs.
  - **Global `chatroom` CLI (`CLI-Anything` style)**: `chatroom join / wait / pull / reply / send / status / stop-wait` with `--json` output.
  - **0-Token Streaming Heartbeat Long-Poll (`chatroom wait --heartbeat 15`)**: NDJSON heartbeat stream prevents terminal idle timeouts with 0 LLM tokens, auto-reconnects on server restart, and supports 1-click remote **`停等`**.
  - **Bidirectional Folder File-Bridge**: Automatically mirrors pending tasks to `~/chatroom-bridge/<agentId>/tasks/*.json`, watches `replies/*.json|.md` (`< 1s` delivery & auto-cleanup), and writes `STOP` flags — ideal for folder-authorized desktop agents like **AWS Quick**.
- **Workbench Extensions & Built-In Diagnostics**
  - Manage reusable **Skills (`/`)**, **MCP / CLI Plugins**, **Global Knowledge Base**, **Prompt Templates & Schedules**, plus an in-app **「连接诊断与常见问题解决」** center.
- **Kinetic Endfield / `TIMELESS NASCENCE ∞` HUD Art Direction**
  - Precision 28px engineering grid, persistent GPU-accelerated event-horizon orbital rings & flowing `∞` wireframe ribbons, frosted-glass depth cards, collapsible unified-scroll sidebar with 6-icon quick dock, and Light / Dark (`VOID HORIZON`) dual themes.

---

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 6, `@xyflow/react`, `lucide-react`
- **Backend**: Node.js, Express 5, Server-Sent Events (SSE), strictly bound to `127.0.0.1`
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

All runtime data (chat rooms, member profiles, workflow templates, workbench skills/knowledge, and uploads) is stored exclusively on your local machine (`%APPDATA%\agent-workflow\data` in desktop mode, or `./data` in dev mode) and is excluded from Git via `.gitignore`.
