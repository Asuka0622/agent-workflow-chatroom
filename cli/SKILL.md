---
name: local-agent-chatroom-cli
description: Drive the local Multi-Agent Group Chatroom desktop app (http://127.0.0.1:4310) deterministically via the `chatroom` CLI harness (CLI-Anything style) with `--json` output, zero-polling join/pull/reply, file attachments, member status, and workbench extensions.
---

# `chatroom` CLI — Local Multi-Agent Chatroom Harness

Use the installed `chatroom` CLI whenever interacting with the user's local Multi-Agent Group Chatroom (`http://127.0.0.1:4310`). Always pass `--json` when parsing outputs programmatically.

## Core Rule: Zero Polling
- Never write a `while` / `sleep` loop polling `chatroom pull`.
- Register once (`chatroom join`), finish your turn immediately, and only run `chatroom pull` + `chatroom reply` when invoked on demand.

## Quick Command Reference

### 1. Inspect Status, Members & Rooms
```bash
chatroom status --json
chatroom members --json
chatroom rooms --json
chatroom history --limit 15 --json
```

### 2. Join Chatroom (Auto-Binds Local CLI When Available)
```bash
chatroom join --model "DeepSeek-V4.1-Flash" --avatar "🐋" --json
# With explicit official CLI trigger:
chatroom join --model "Gemini 4 Pro" --cli gemini --args "-p -" --json
```
`chatroom join` persists your `agentId` to `~/.chatroom-cli.json` so subsequent `pull` and `reply` commands don't need an ID.

### 3. Zero-Token Standby (`wait`) & Reply — Minimal Quota Mode
For GUI agents without an official headless CLI (e.g., WorkBuddy), **never** run a short-interval LLM polling loop! Instead, park inside a single blocking `chatroom wait` command (streams keep-alive heartbeats every 15s to stderr with **0 LLM tokens**, auto-reconnects if the chatroom app restarts, and wakes in `< 5ms` when `@mentioned`):
```bash
chatroom wait agent_deepseek-v4-1-flash --timeout 240 --heartbeat 15 --json
# Check `action` in JSON:
# - "handle_task": solve `task`, reply, then immediately call `chatroom wait` again
# - "continue_wait": no task yet, call `chatroom wait` again to stay on standby
# - "stop": user clicked 停等 in chatroom UI, exit standby cleanly
chatroom reply --agent agent_deepseek-v4-1-flash --task <taskId> "回复内容" --json
# Or pipe multi-line Markdown:
cat answer.md | chatroom reply --agent agent_deepseek-v4-1-flash --task <taskId> --stdin --json
```
Or for one-shot on-demand wake:
```bash
chatroom pull --json
chatroom reply "已完成方案评估。" --json
```

### 4. Send Group Messages, Attachments & Workflows
```bash
chatroom send "@Claude Opus 5.5 请评审这段改动" --json
chatroom send "请检查这个配置文件" --to claude --attach ./package.json --json
chatroom send "给订单页加筛选和导出" --workflow --json
```

### 5. Manage Member Profile, Thinking Level & Presence
```bash
chatroom rename claude --name "Claude 主架构" --avatar "🧠" --thinking high --json
chatroom rename agent_gemini-4-hydrogen --thinking xhigh --json
chatroom rename agent_deepseek-v4-1-flash --offline --json
chatroom detect-cli agent_gemini-4-hydrogen --json
```

### 6. Workbench Extensions (Skills, MCP/CLI Plugins, Global KB)
```bash
chatroom workbench --json
chatroom skill list --json
chatroom skill add "安全检查" --trigger /sec --prompt "检查注入与越权风险" --json
chatroom plugin list --json
chatroom plugin test plugin_git_status --json
chatroom kb list --json
chatroom kb add "接口规范" --file ./docs/api.md --json
chatroom export --out ./report.md --json
```
