import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ScheduledTask,
  WorkbenchConfig,
  WorkbenchPlugin,
} from '../shared/types.js';
import { runShellCommand } from './cliRunner.js';
import { listRuns, loadWorkbench, saveWorkbench } from './store.js';

const execFileAsync = promisify(execFile);

export function buildGlobalWorkbenchContext(): string {
  const wb = loadWorkbench();
  const sections: string[] = [];

  const activeSkills = wb.skills.filter((s) => s.enabled && s.autoInject && s.prompt.trim());
  if (activeSkills.length > 0) {
    sections.push(
      '【已启用全局技能指令（Skills）】\n' +
        activeSkills
          .slice(0, 6)
          .map((s) => `- **${s.name}**：${s.prompt.trim().slice(0, 800)}`)
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
