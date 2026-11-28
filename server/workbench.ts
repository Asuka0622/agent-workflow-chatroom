import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import type {
  ScheduledTask,
  WorkbenchConfig,
  WorkbenchPlugin,
} from '../shared/types.js';
import { runShellCommand } from './cliRunner.js';
import { listRuns, loadWorkbench, saveWorkbench } from './store.js';

const execFileAsync = promisify(execFile);

export function buildGlobalWorkbenchContext(memberId?: string): string {
  const wb = loadWorkbench();
  const sections: string[] = [];

  const activeSkills = wb.skills.filter((s) => {
    if (!s.enabled || !s.autoInject || !s.prompt.trim()) return false;
    if (Array.isArray(s.targetMemberIds) && s.targetMemberIds.length > 0) {
      return Boolean(memberId && s.targetMemberIds.includes(memberId));
    }
    return true;
  });
  if (activeSkills.length > 0) {
    sections.push(
      '【已启用技能指令（Skills）】\n' +
        activeSkills
          .slice(0, 10)
          .map((s) => `- **${s.name}**：${s.prompt.trim().slice(0, 2400)}`)
          .join('\n'),
    );
  }

  const pinnedDocs = wb.knowledge.filter((k) => k.pinned && k.content.trim());
  if (pinnedDocs.length > 0) {
    sections.push(
      '【全局知识库资料】\n' +
        pinnedDocs
          .slice(0, 6)
          .map((k) => `### ${k.title}\n${k.content.trim().slice(0, 1600)}`)
          .join('\n\n'),
    );
  }

  const enabledPlugins = wb.plugins.filter((p) => p.enabled);
  if (enabledPlugins.length > 0) {
    sections.push(
      '【工作台已启用插件 / MCP 工具】\n' +
        enabledPlugins
          .slice(0, 8)
          .map((p) => {
            const detail =
              p.kind === 'mcp_stdio' || p.kind === 'cli_tool'
                ? `${p.command || ''} ${(p.args || []).join(' ')}`.trim()
                : p.url || '';
            return `- ${p.name} (${p.kind})${p.description ? `：${p.description}` : ''}${detail ? ` [${detail}]` : ''}`;
          })
          .join('\n'),
    );
  }

  if (sections.length === 0) return '';
  return `\n\n${sections.join('\n\n')}`;
}

export async function testWorkbenchPlugin(
  plugin: WorkbenchPlugin,
  cwd: string,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  try {
    if (plugin.kind === 'cli_tool') {
      const cmd = [plugin.command || '', ...(plugin.args || [])].join(' ').trim();
      if (!cmd) {
        return { ok: false, latencyMs: 0, message: '请先填写可执行命令' };
      }
      const res = await runShellCommand(cmd, cwd, {});
      const preview = res.output.trim().slice(0, 260) || '命令执行成功（无输出）';
      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: preview,
      };
    }

    if (plugin.kind === 'mcp_stdio') {
      const bin = (plugin.command || '').trim();
      if (!bin) {
        return { ok: false, latencyMs: 0, message: '请先填写 MCP 启动命令（如 npx / node / uvx）' };
      }
      const lookupCmd = process.platform === 'win32' ? 'where' : 'which';
      const { stdout } = await execFileAsync(lookupCmd, [bin], { timeout: 6000 });
      const resolved = stdout.trim().split(/\r?\n/)[0] || bin;
      return {
        ok: true,
        latencyMs: Date.now() - start,
        message: `启动命令可用：${resolved}`,
      };
    }

    // mcp_http or webhook
    const targetUrl = (plugin.url || '').trim();
    if (!targetUrl) {
      return { ok: false, latencyMs: 0, message: '请先填写 HTTP / Webhook 地址' };
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await fetch(targetUrl, {
        method: plugin.kind === 'webhook' ? 'POST' : 'GET',
        headers:
          plugin.kind === 'webhook'
            ? { 'Content-Type': 'application/json' }
            : undefined,
        body:
          plugin.kind === 'webhook'
            ? JSON.stringify({ event: 'ping', source: 'agent-workflow', timestamp: new Date().toISOString() })
            : undefined,
        signal: controller.signal,
      });
      const text = (await res.text().catch(() => '')).slice(0, 180);
      return {
        ok: res.ok,
        latencyMs: Date.now() - start,
        message: `HTTP ${res.status}${text ? ` · ${text}` : ''}`,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

type ScheduleRunner = (task: ScheduledTask, targetRoomId: string) => Promise<void>;

export class WorkbenchScheduler {
  private timer: NodeJS.Timeout | null = null;
  private runner: ScheduleRunner | null = null;
  private runningIds = new Set<string>();

  start(runner: ScheduleRunner): void {
    this.runner = runner;
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      void this.tick();
    }, 30_000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    if (!this.runner) return;
    const wb = loadWorkbench();
    const now = Date.now();
    let dirty = false;

    for (const sched of wb.schedules) {
      if (!sched.enabled) continue;
      if (this.runningIds.has(sched.id)) continue;

      const intervalMs = Math.max(1, sched.intervalMinutes || 60) * 60_000;
      const dueAt = sched.nextRunAt ? Date.parse(sched.nextRunAt) : 0;
      if (!dueAt) {
        sched.nextRunAt = new Date(now + intervalMs).toISOString();
        dirty = true;
        continue;
      }

      if (now >= dueAt) {
        await this.executeTask(wb, sched);
        dirty = true;
      }
    }

    if (dirty) {
      saveWorkbench(wb);
    }
  }

  async runNow(taskId: string, preferredRoomId?: string): Promise<{ ok: boolean; workbench: WorkbenchConfig; message: string }> {
    const wb = loadWorkbench();
    const sched = wb.schedules.find((s) => s.id === taskId);
    if (!sched) {
      throw new Error('未找到对应的定时任务');
    }
    const msg = await this.executeTask(wb, sched, preferredRoomId);
    saveWorkbench(wb);
    return { ok: sched.lastStatus === 'ok', workbench: wb, message: msg };
  }

  private async executeTask(
    _wb: WorkbenchConfig,
    sched: ScheduledTask,
    preferredRoomId?: string,
  ): Promise<string> {
    if (!this.runner) {
      sched.lastStatus = 'error';
      sched.lastSummary = '调度器尚未就绪';
      return sched.lastSummary;
    }
    const rooms = listRuns();
    const targetRoomId = preferredRoomId || sched.roomId || rooms[0]?.id || '';
    if (!targetRoomId) {
      sched.lastStatus = 'error';
      sched.lastSummary = '暂无活跃会话房间';
      return sched.lastSummary;
    }

    this.runningIds.add(sched.id);
    const now = Date.now();
    const intervalMs = Math.max(1, sched.intervalMinutes || 60) * 60_000;
    try {
      await this.runner(sched, targetRoomId);
      sched.lastRunAt = new Date(now).toISOString();
      sched.nextRunAt = new Date(now + intervalMs).toISOString();
      sched.lastStatus = 'ok';
      sched.lastSummary = `已派发到会话 (${new Date(now).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })})`;
      return sched.lastSummary;
    } catch (err) {
      sched.lastRunAt = new Date(now).toISOString();
      sched.nextRunAt = new Date(now + intervalMs).toISOString();
      sched.lastStatus = 'error';
      sched.lastSummary = err instanceof Error ? err.message : String(err);
      return sched.lastSummary;
    } finally {
      this.runningIds.delete(sched.id);
    }
  }
}

export const workbenchScheduler = new WorkbenchScheduler();

export interface DiscoveredSkill {
  key: string;
  name: string;
  description: string;
  prompt: string;
  trigger?: string;
  source: string;
  filePath: string;
}

export function parseSkillDocument(
  rawText: string,
  fallbackName: string,
): Array<{ name: string; description: string; prompt: string; trigger?: string }> {
  const trimmed = (rawText || '').replace(/^\uFEFF/, '').trim();
  if (!trimmed) return [];

  // Support JSON skill object or array
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      const list = Array.isArray(parsed)
        ? parsed
        : parsed && typeof parsed === 'object' && Array.isArray((parsed as { skills?: unknown[] }).skills)
          ? (parsed as { skills: unknown[] }).skills
          : [parsed];
      const out: Array<{ name: string; description: string; prompt: string; trigger?: string }> = [];
      for (const item of list) {
        if (!item || typeof item !== 'object') continue;
        const obj = item as Record<string, unknown>;
        const prompt = String(obj.prompt || obj.content || obj.instructions || '').trim();
        if (!prompt) continue;
        const name = String(obj.name || obj.title || fallbackName || '未命名技能').trim();
        const description = String(obj.description || '').trim() || prompt.slice(0, 80);
        const trigger = typeof obj.trigger === 'string' && obj.trigger.trim() ? obj.trigger.trim() : undefined;
        out.push({ name, description, prompt: prompt.slice(0, 12000), trigger });
      }
      if (out.length > 0) return out;
    } catch {
      // fall through to Markdown parsing
    }
  }

  let name = fallbackName.trim() || '外部技能';
  let description = '';
  let trigger: string | undefined;
  let body = trimmed;

  // Parse YAML frontmatter (--- ... ---)
  const fmMatch = trimmed.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (fmMatch) {
    const fmLines = fmMatch[1].split(/\r?\n/);
    body = fmMatch[2].trim();

    let currentKey = '';
    const fmMap: Record<string, string> = {};
    for (const line of fmLines) {
      const keyMatch = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
      if (keyMatch && !line.startsWith(' ') && !line.startsWith('\t')) {
        currentKey = keyMatch[1].toLowerCase();
        const rawVal = keyMatch[2].trim();
        if (rawVal === '|' || rawVal === '>' || rawVal === '|-' || rawVal === '>-') {
          fmMap[currentKey] = '';
        } else {
          fmMap[currentKey] = rawVal.replace(/^['"]|['"]$/g, '');
        }
      } else if (currentKey && (line.startsWith(' ') || line.startsWith('\t'))) {
        fmMap[currentKey] = `${fmMap[currentKey] ? `${fmMap[currentKey]} ` : ''}${line.trim()}`;
      }
    }

    if (fmMap.name) name = fmMap.name.trim();
    if (fmMap.description) description = fmMap.description.trim();
    if (fmMap.trigger) trigger = fmMap.trigger.trim();
  }

  // Fallback heading extraction if name was generic (e.g. SKILL)
  if (!name || /^skill$/i.test(name)) {
    const h1 = body.match(/^#\s+(.+)$/m);
    if (h1?.[1]?.trim()) {
      name = h1[1].trim().slice(0, 60);
    }
  }

  if (!description) {
    const firstPara = body
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith('#') && !l.startsWith('```') && !l.startsWith('---'));
    description = (firstPara || '外部导入技能').slice(0, 120);
  }

  const finalPrompt = (body || trimmed).slice(0, 12000);
  if (!finalPrompt) return [];
  return [{ name, description, prompt: finalPrompt, trigger }];
}

export function discoverLocalSkills(options?: {
  cwd?: string;
  customDir?: string;
}): { skills: DiscoveredSkill[]; scannedDirs: string[] } {
  const home = os.homedir();
  const candidates: Array<{ dir: string; source: string }> = [];

  if (options?.customDir?.trim()) {
    candidates.push({ dir: path.resolve(options.customDir.trim()), source: '指定目录' });
  } else {
    candidates.push(
      { dir: path.join(home, '.agents', 'skills'), source: '本机 .agents' },
      { dir: path.join(home, '.claude', 'skills'), source: 'Claude Code' },
      { dir: path.join(home, '.codex', 'skills'), source: 'Codex' },
      { dir: path.join(home, '.cursor', 'rules'), source: 'Cursor 全局' },
    );
    if (options?.cwd?.trim()) {
      const root = path.resolve(options.cwd.trim());
      candidates.push(
        { dir: path.join(root, '.claude', 'skills'), source: '当前项目 .claude' },
        { dir: path.join(root, '.agents', 'skills'), source: '当前项目 .agents' },
        { dir: path.join(root, '.cursor', 'rules'), source: '当前项目 Cursor' },
        { dir: path.join(root, 'skills'), source: '当前项目 skills' },
      );
    }
  }

  const scannedDirs: string[] = [];
  const seenFiles = new Set<string>();
  const skills: DiscoveredSkill[] = [];

  const tryReadSkillFile = (filePath: string, source: string, fallbackName: string) => {
    const resolved = path.resolve(filePath);
    if (seenFiles.has(resolved)) return;
    try {
      const stat = fs.statSync(resolved);
      if (!stat.isFile() || stat.size === 0 || stat.size > 512 * 1024) return;
      seenFiles.add(resolved);
      const raw = fs.readFileSync(resolved, 'utf8');
      const parsed = parseSkillDocument(raw, fallbackName);
      for (let i = 0; i < parsed.length; i += 1) {
        const p = parsed[i];
        skills.push({
          key: `${resolved}#${i}`,
          name: p.name,
          description: p.description,
          prompt: p.prompt,
          trigger: p.trigger,
          source,
          filePath: resolved,
        });
      }
    } catch {
      // skip unreadable files
    }
  };

  for (const { dir, source } of candidates) {
    if (!fs.existsSync(dir)) continue;
    try {
      const stat = fs.statSync(dir);
      if (stat.isFile()) {
        scannedDirs.push(dir);
        tryReadSkillFile(dir, source, path.basename(dir, path.extname(dir)));
        continue;
      }
      if (!stat.isDirectory()) continue;
      scannedDirs.push(dir);
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
          const skillMd = path.join(full, 'SKILL.md');
          const lowerMd = path.join(full, 'skill.md');
          if (fs.existsSync(skillMd)) {
            tryReadSkillFile(skillMd, source, entry.name);
          } else if (fs.existsSync(lowerMd)) {
            tryReadSkillFile(lowerMd, source, entry.name);
          }
        } else if (entry.isFile() && /\.(md|mdc|txt|json)$/i.test(entry.name)) {
          if (/^readme\.md$/i.test(entry.name)) continue;
          const base = path.basename(entry.name, path.extname(entry.name));
          tryReadSkillFile(full, source, base);
        }
      }
    } catch {
      // ignore unreadable directories
    }
  }

  return { skills, scannedDirs };
}

export async function importSkillsFromUrl(rawUrl: string): Promise<{
  resolvedUrl: string;
  skills: Array<{ name: string; description: string; prompt: string; trigger?: string }>;
}> {
  const input = (rawUrl || '').trim();
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(input);
  } catch {
    throw new Error('请输入有效的 http:// 或 https:// 链接');
  }
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('仅支持 http:// 或 https:// 链接');
  }

  // Convert standard GitHub blob URL to raw.githubusercontent.com
  let resolvedUrl = parsedUrl.toString();
  const ghBlob = resolvedUrl.match(
    /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/i,
  );
  if (ghBlob) {
    resolvedUrl = `https://raw.githubusercontent.com/${ghBlob[1]}/${ghBlob[2]}/${ghBlob[3]}/${ghBlob[4]}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(resolvedUrl, {
      signal: controller.signal,
      headers: {
        Accept: 'text/plain, text/markdown, application/json, */*',
        'User-Agent': 'Multi-Agent-Workflow-SkillImporter/1.0',
      },
    });
    if (!res.ok) {
      throw new Error(`拉取失败（HTTP ${res.status}），请确认链接可公开访问`);
    }
    const text = await res.text();
    if (text.length > 512 * 1024) {
      throw new Error('目标文件过大（超过 512 KB）');
    }
    const pathSegs = new URL(resolvedUrl).pathname.split('/').filter(Boolean);
    const fileSeg = pathSegs[pathSegs.length - 1] || 'remote-skill';
    const parentSeg = pathSegs.length >= 2 ? pathSegs[pathSegs.length - 2] : '';
    const fallbackName = /^skill\.md$/i.test(fileSeg) && parentSeg
      ? parentSeg
      : fileSeg.replace(/\.(md|mdc|txt|json)$/i, '') || '外部链接技能';

    const skills = parseSkillDocument(text, fallbackName);
    if (skills.length === 0) {
      throw new Error('未能从该链接解析出有效的 Skill 内容');
    }
    return { resolvedUrl, skills };
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('拉取超时（12 秒），请检查网络或链接是否可达');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
