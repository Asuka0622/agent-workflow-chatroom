import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import type { AgentTrigger, ProviderConfig, ProviderHealth, TokenUsage } from '../shared/types.js';

const execFileAsync = promisify(execFile);
const IS_WIN = process.platform === 'win32';

export interface RunCliOptions {
  cwd: string;
  signal?: AbortSignal;
  onLog?: (chunk: string) => void;
}

export interface RunCliResult {
  output: string;
  exitCode: number;
  commandPreview: string;
  usage?: TokenUsage;
}

export async function resolveCommandPath(cmd: string): Promise<string | undefined> {
  try {
    const locator = IS_WIN ? 'where' : 'which';
    const { stdout } = await execFileAsync(locator, [cmd], {
      timeout: 5000,
      windowsHide: true,
    });
    const first = stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean);
    return first;
  } catch {
    return undefined;
  }
}

export interface AutoCliDetectionResult {
  found: boolean;
  trigger?: AgentTrigger;
  resolvedPath?: string;
  message: string;
  suggestion?: {
    command: string;
    args: string[];
    installCmd: string;
    loginCmd: string;
    note?: string;
  };
}

export async function autoDetectCliTriggerForModel(
  modelName: string,
): Promise<AutoCliDetectionResult> {
  const key = (modelName || '').toLowerCase();

  // 1. Claude family -> official Claude Code CLI
  if (key.includes('claude') || key.includes('opus') || key.includes('sonnet') || key.includes('haiku')) {
    const args = ['-p', '--output-format', 'text'];
    const resolved = await resolveCommandPath('claude');
    if (resolved) {
      return {
        found: true,
        trigger: { type: 'cli', command: 'claude', args, inputMode: 'stdin' },
        resolvedPath: resolved,
        message: `已自动检测到本机 Claude CLI（${resolved}），已设为自动拉起`,
      };
    }
    return {
      found: false,
      message: '未检测到本机 claude CLI，暂用按需唤醒',
      suggestion: {
        command: 'claude',
        args,
        installCmd: 'npm install -g @anthropic-ai/claude-code',
        loginCmd: 'claude auth login',
      },
    };
  }

  // 2. Gemini family -> official Gemini CLI
  if (key.includes('gemini')) {
    const args = ['-p', '-'];
    const resolved = await resolveCommandPath('gemini');
    if (resolved) {
      return {
        found: true,
        trigger: { type: 'cli', command: 'gemini', args, inputMode: 'stdin' },
        resolvedPath: resolved,
        message: `已自动检测到本机 Gemini CLI（${resolved}），已设为自动拉起`,
      };
    }
    return {
      found: false,
      message: '未检测到本机 gemini CLI，暂用按需唤醒',
      suggestion: {
        command: 'gemini',
        args,
        installCmd: 'npm install -g @google/gemini-cli',
        loginCmd: 'gemini',
      },
    };
  }

  // 3. Codex / OpenAI GPT / o-series -> official Codex CLI
  if (key.includes('codex') || key.includes('gpt') || key.includes('openai') || /\bo[134]\b/.test(key)) {
    const args = ['exec', '-'];
    const resolved = await resolveCommandPath('codex');
    if (resolved) {
      return {
        found: true,
        trigger: { type: 'cli', command: 'codex', args, inputMode: 'stdin' },
        resolvedPath: resolved,
        message: `已自动检测到本机 Codex CLI（${resolved}），已设为自动拉起`,
      };
    }
    return {
      found: false,
      message: '未检测到本机 codex CLI，暂用按需唤醒',
      suggestion: {
        command: 'codex',
        args,
        installCmd: 'npm install -g @openai/codex',
        loginCmd: 'codex login',
      },
    };
  }

  // 4. DeepSeek / Qwen / Llama / Ollama -> check local Ollama first
  if (
    key.includes('deepseek') ||
    key.includes('qwen') ||
    key.includes('llama') ||
    key.includes('ollama') ||
    key.includes('mistral')
  ) {
    const resolved = await resolveCommandPath('ollama');
    if (resolved) {
      try {
        const { stdout } = await execFileAsync('ollama', ['list'], {
          timeout: 5000,
          windowsHide: true,
        });
        const models = stdout
          .split(/\r?\n/)
          .slice(1)
          .map((line) => line.trim().split(/\s+/)[0])
          .filter(Boolean);
        const token = key.includes('deepseek')
          ? 'deepseek'
          : key.includes('qwen')
            ? 'qwen'
            : key.includes('llama')
              ? 'llama'
              : key.includes('mistral')
                ? 'mistral'
                : '';
        const matched = (token && models.find((m) => m.toLowerCase().includes(token))) || models[0];
        if (matched) {
          return {
            found: true,
            trigger: { type: 'cli', command: 'ollama', args: ['run', matched], inputMode: 'stdin' },
            resolvedPath: resolved,
            message: `已自动检测到本机 Ollama 模型「${matched}」，已设为自动拉起`,
          };
        }
      } catch {
        // ignore ollama list error
      }
    }
    return {
      found: false,
      message: '未检测到本机可用 CLI（可在「模型池」配置 DeepSeek API 直连，或安装 Ollama）',
      suggestion: {
        command: 'ollama',
        args: ['run', key.includes('deepseek') ? 'deepseek-r1' : 'qwen2.5-coder:14b'],
        installCmd: 'winget install Ollama.Ollama',
        loginCmd: key.includes('deepseek') ? 'ollama pull deepseek-r1' : 'ollama pull qwen2.5-coder:14b',
        note: 'DeepSeek 也支持在左下角「模型池 → + DeepSeek API」直接填 Key 秒连',
      },
    };
  }

  return {
    found: false,
    message: '未匹配到已知官方 CLI，可在「配置启动」中手动填入本机命令行或 Webhook',
  };
}

async function probeVersion(cmd: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const child = spawn(cmd, ['--version'], {
      shell: IS_WIN,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve(undefined);
    }, 5000);
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.stderr.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    child.on('error', () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.on('close', () => {
      clearTimeout(timer);
      const line = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(Boolean);
      resolve(line ? line.slice(0, 120) : undefined);
    });
  });
}

export async function checkSingleCommand(
  id: string,
  command: string,
): Promise<ProviderHealth> {
  const checkedAt = new Date().toISOString();
  const resolvedPath = await resolveCommandPath(command);
  if (!resolvedPath) {
    return {
      id,
      command,
      installed: false,
      checkedAt,
    };
  }
  const version = await probeVersion(command);
  return {
    id,
    command,
    installed: true,
    resolvedPath,
    version,
    checkedAt,
  };
}

export async function checkAllEnvironment(
  providers: ProviderConfig[],
): Promise<ProviderHealth[]> {
  const checks = providers.map(async (p): Promise<ProviderHealth> => {
    if (p.connectionType && p.connectionType !== 'cli') {
      const configured = Boolean(p.apiKey?.trim() && p.model?.trim());
      return {
        id: p.id,
        command: p.connectionType,
        installed: configured,
        version: configured ? `API · ${p.model}` : '待填 API Key / 模型名',
        checkedAt: new Date().toISOString(),
      };
    }
    return checkSingleCommand(p.id, p.command);
  });
  checks.push(checkSingleCommand('git', 'git'));
  checks.push(checkSingleCommand('gh', 'gh'));
  return Promise.all(checks);
}

export function runProviderCli(
  provider: ProviderConfig,
  prompt: string,
  options: RunCliOptions,
): Promise<RunCliResult> {
  const args = [...provider.args];
  const cmdLower = provider.command.toLowerCase();
  const isClaudeCli = cmdLower === 'claude' || cmdLower.endsWith('\\claude') || cmdLower.endsWith('/claude') || cmdLower.endsWith('claude.cmd') || cmdLower.endsWith('claude.exe');
  // Upgrade Claude CLI `-p --output-format text` to `--output-format json` at runtime to extract exact official tokens & cost
  let expectClaudeJson = false;
  if (isClaudeCli && (args.includes('-p') || args.includes('--print'))) {
    const fmtIdx = args.findIndex((a) => a === '--output-format');
    if (fmtIdx >= 0 && args[fmtIdx + 1] === 'text') {
      args[fmtIdx + 1] = 'json';
      expectClaudeJson = true;
    } else if (fmtIdx >= 0 && args[fmtIdx + 1] === 'json') {
      expectClaudeJson = true;
    } else if (fmtIdx === -1 && !args.some((a) => a.startsWith('--output-format='))) {
      args.push('--output-format', 'json');
      expectClaudeJson = true;
    }
  }
  if (provider.model && provider.modelFlag) {
    args.push(provider.modelFlag, provider.model);
  }
  const effort = provider.thinkingLevel;
  if (effort && effort !== 'default') {
    if (cmdLower.includes('claude')) {
      const validClaude = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
      if (validClaude.has(effort)) {
        args.push('--effort', effort);
      }
    } else if (cmdLower.includes('codex')) {
      const validCodex = new Set(['minimal', 'low', 'medium', 'high', 'xhigh']);
      const mapped = effort === 'max' ? 'xhigh' : effort;
      if (validCodex.has(mapped)) {
        args.push('-c', `model_reasoning_effort=${mapped}`);
      }
    }
  }
  if (provider.inputMode === 'arg') {
    args.push(prompt);
  }

  const commandPreview =
    provider.inputMode === 'stdin'
      ? `${provider.command} ${args.join(' ')} < prompt.txt`
      : `${provider.command} ${args.slice(0, -1).join(' ')} "<prompt>"`;

  const cwd = fs.existsSync(options.cwd) ? options.cwd : process.cwd();

  return new Promise((resolve, reject) => {
    const child = spawn(provider.command, args, {
      cwd,
      shell: IS_WIN,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        FORCE_COLOR: '0',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutMs = Math.max(30, provider.timeoutSec || 300) * 1000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(
        new Error(
          `CLI 执行超时（>${provider.timeoutSec}s）：${commandPreview}`,
        ),
      );
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error('用户手动终止了当前工作流'));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      if (!expectClaudeJson) {
        options.onLog?.(text);
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      options.onLog?.(`[stderr] ${text}`);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(
        new Error(
          `无法启动 CLI「${provider.command}」：${err.message}。请确认已安装并在终端完成订阅登录，或切换到模拟演练模式。`,
        ),
      );
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);

      if (code === 0) {
        let finalOutput = stdout.trim() || stderr.trim() || '（CLI 执行完成，无标准输出）';
        let parsedUsage: TokenUsage | undefined;
        if (expectClaudeJson && stdout.trim()) {
          try {
            const parsed = JSON.parse(stdout.trim()) as {
              result?: string;
              total_cost_usd?: number;
              usage?: {
                input_tokens?: number;
                output_tokens?: number;
                cache_read_input_tokens?: number;
                cache_creation_input_tokens?: number;
              };
            };
            if (typeof parsed.result === 'string' && parsed.result.trim()) {
              finalOutput = parsed.result.trim();
            }
            if (parsed.usage) {
              const cacheRead = Math.max(0, Math.round(parsed.usage.cache_read_input_tokens || 0));
              const cacheCreate = Math.max(0, Math.round(parsed.usage.cache_creation_input_tokens || 0));
              const inTok = Math.max(0, Math.round(parsed.usage.input_tokens || 0)) + cacheRead + cacheCreate;
              const outTok = Math.max(0, Math.round(parsed.usage.output_tokens || 0));
              parsedUsage = {
                inputTokens: inTok,
                outputTokens: outTok,
                totalTokens: inTok + outTok,
                cacheReadTokens: cacheRead || undefined,
                costUsd:
                  typeof parsed.total_cost_usd === 'number' && Number.isFinite(parsed.total_cost_usd)
                    ? parsed.total_cost_usd
                    : undefined,
                estimated: false,
                source: 'cli',
              };
              options.onLog?.(
                `[Claude CLI] 完成（精确计数：输入 ${inTok} / 输出 ${outTok} / 合计 ${inTok + outTok} tokens${parsedUsage.costUsd ? ` · $${parsedUsage.costUsd.toFixed(4)}` : ''}）\n`,
              );
            }
          } catch {
            // Fall back to plain stdout if Claude returned non-JSON text
          }
        }
        resolve({
          output: finalOutput,
          exitCode: 0,
          commandPreview,
          usage: parsedUsage,
        });
      } else {
        const detail = (stderr || stdout).trim().slice(-1500);
        reject(
          new Error(
            `CLI「${provider.command}」退出码 ${code ?? -1}。\n${detail || '请检查 CLI 是否已登录订阅账号或参数是否兼容。'}`,
          ),
        );
      }
    });

    if (provider.inputMode === 'stdin') {
      child.stdin.write(prompt, 'utf8');
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

export function runShellCommand(
  command: string,
  cwd: string,
  options: { signal?: AbortSignal; onLog?: (chunk: string) => void; timeoutSec?: number },
): Promise<RunCliResult> {
  const safeCwd = fs.existsSync(cwd) ? cwd : process.cwd();
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: safeCwd,
      shell: true,
      windowsHide: true,
      env: { ...process.env, PYTHONUTF8: '1', FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timeoutMs = Math.max(30, options.timeoutSec ?? 180) * 1000;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`命令超时：${command}`));
    }, timeoutMs);

    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill();
      reject(new Error('用户手动终止了当前工作流'));
    };

    if (options.signal) {
      if (options.signal.aborted) {
        onAbort();
        return;
      }
      options.signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stdout += text;
      options.onLog?.(text);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      stderr += text;
      options.onLog?.(`[stderr] ${text}`);
    });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      const combined = [stdout.trim(), stderr.trim()].filter(Boolean).join('\n');
      if (code === 0) {
        resolve({
          output: combined || '（命令执行成功，无输出）',
          exitCode: 0,
          commandPreview: command,
        });
      } else {
        reject(
          new Error(`命令退出码 ${code ?? -1}：${command}\n${combined.slice(-1500)}`),
        );
      }
    });
  });
}

export async function collectRepoContext(repoPath: string): Promise<string> {
  if (!repoPath || !fs.existsSync(repoPath)) {
    return `（目录不存在或未提供：${repoPath || '空'}）`;
  }
  const lines: string[] = [`目录：${repoPath}`];
  const ignored = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'target', '__pycache__']);

  try {
    const topEntries = fs.readdirSync(repoPath, { withFileTypes: true }).slice(0, 40);
    lines.push('顶层文件/目录：');
    for (const entry of topEntries) {
      if (ignored.has(entry.name)) continue;
      lines.push(`- ${entry.isDirectory() ? '[DIR] ' : ''}${entry.name}`);
      if (entry.isDirectory()) {
        try {
          const sub = fs
            .readdirSync(path.join(repoPath, entry.name), { withFileTypes: true })
            .slice(0, 12);
          for (const s of sub) {
            if (ignored.has(s.name)) continue;
            lines.push(`  - ${s.isDirectory() ? '[DIR] ' : ''}${s.name}`);
          }
        } catch {
          // ignore unreadable subdir
        }
      }
    }
  } catch (err) {
    lines.push(`读取目录失败：${String(err)}`);
  }

  const pkgPath = path.join(repoPath, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = fs.readFileSync(pkgPath, 'utf8').slice(0, 1800);
      lines.push('\npackage.json 摘录：\n```json\n' + pkg + '\n```');
    } catch {
      // ignore
    }
  }

  return lines.join('\n');
}

export async function collectGitSummary(repoPath: string): Promise<string> {
  if (!repoPath || !fs.existsSync(repoPath)) {
    return '（未指定有效本地仓库路径）';
  }
  try {
    const status = await runShellCommand('git status --short && git diff --stat', repoPath, {
      timeoutSec: 15,
    });
    return status.output || '（工作区干净，暂无未提交改动）';
  } catch (err) {
    return `（当前目录不是 Git 仓库或无改动：${err instanceof Error ? err.message : String(err)}）`;
  }
}
