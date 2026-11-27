import type { ProviderConfig } from '../shared/types.js';
import type { RunCliResult } from './cliRunner.js';

export interface RunApiOptions {
  signal?: AbortSignal;
  onLog?: (chunk: string) => void;
}

function normalizeBaseUrl(raw: string, fallback: string): string {
  return (raw || fallback).trim().replace(/\/+$/, '');
}

async function runOpenAiCompatible(
  provider: ProviderConfig,
  prompt: string,
  options: RunApiOptions,
  signal: AbortSignal,
): Promise<RunCliResult> {
  const baseUrl = normalizeBaseUrl(provider.apiBaseUrl || '', 'https://api.openai.com/v1');
  const model = (provider.model || '').trim();
  const apiKey = (provider.apiKey || '').trim();
  if (!model) throw new Error(`模型「${provider.shortName}」未填写模型名（如 deepseek-chat / gpt-4o）`);
  if (!apiKey) throw new Error(`模型「${provider.shortName}」未填写 API Key`);

  const url = baseUrl.endsWith('/chat/completions')
    ? baseUrl
    : `${baseUrl}/chat/completions`;
  const commandPreview = `POST ${url} (model: ${model})`;
  options.onLog?.(`[API] 正在请求 ${url}（模型：${model}）...\n`);

  const messages: Array<{ role: string; content: string }> = [];
  if (provider.systemPrompt?.trim()) {
    messages.push({ role: 'system', content: provider.systemPrompt.trim() });
  }
  messages.push({ role: 'user', content: prompt });

  const reqBody: Record<string, unknown> = {
    model,
    messages,
    stream: false,
  };
  if (provider.thinkingLevel && provider.thinkingLevel !== 'default') {
    if (provider.thinkingLevel === 'on' || provider.thinkingLevel === 'off') {
      reqBody.thinking = {
        type: provider.thinkingLevel === 'on' ? 'enabled' : 'disabled',
      };
    } else {
      reqBody.reasoning_effort =
        provider.thinkingLevel === 'max' ? 'xhigh' : provider.thinkingLevel;
    }
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(reqBody),
    signal,
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`API 请求失败 (${res.status})：${rawText.slice(0, 600)}`);
  }

  let data: {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };
  try {
    data = JSON.parse(rawText);
  } catch {
    throw new Error(`API 返回非 JSON 内容：${rawText.slice(0, 400)}`);
  }

  const msg = data.choices?.[0]?.message;
  const content = msg?.content?.trim() || '';
  if (data.usage) {
    options.onLog?.(
      `[API] 完成（输入 ${data.usage.prompt_tokens ?? '?'} tokens / 输出 ${data.usage.completion_tokens ?? '?'} tokens）\n`,
    );
  }
  return {
    output: content || '（API 返回空内容）',
    exitCode: 0,
    commandPreview,
  };
}

async function runAnthropicApi(
  provider: ProviderConfig,
  prompt: string,
  options: RunApiOptions,
  signal: AbortSignal,
): Promise<RunCliResult> {
  const baseUrl = normalizeBaseUrl(provider.apiBaseUrl || '', 'https://api.anthropic.com');
  const model = (provider.model || 'claude-sonnet-4-5').trim();
  const apiKey = (provider.apiKey || '').trim();
  if (!apiKey) throw new Error(`模型「${provider.shortName}」未填写 Anthropic API Key`);

  const url = baseUrl.endsWith('/v1/messages')
    ? baseUrl
    : baseUrl.endsWith('/v1')
      ? `${baseUrl}/messages`
      : `${baseUrl}/v1/messages`;
  const commandPreview = `POST ${url} (model: ${model})`;
  options.onLog?.(`[Anthropic API] 正在请求 ${url}（模型：${model}）...\n`);

  const thinkingBudgets: Record<string, number> = {
    low: 2048,
    medium: 6000,
    high: 12000,
    xhigh: 20000,
    max: 32000,
    on: 12000,
  };
  const budget =
    provider.thinkingLevel &&
    provider.thinkingLevel !== 'default' &&
    provider.thinkingLevel !== 'off'
      ? thinkingBudgets[provider.thinkingLevel]
      : undefined;

  const body: Record<string, unknown> = {
    model,
    max_tokens: budget ? budget + 4096 : 4096,
    messages: [{ role: 'user', content: prompt }],
  };
  if (budget) {
    body.thinking = { type: 'enabled', budget_tokens: budget };
  }
  if (provider.systemPrompt?.trim()) {
    body.system = provider.systemPrompt.trim();
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal,
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Anthropic API 失败 (${res.status})：${rawText.slice(0, 600)}`);
  }

  const data = JSON.parse(rawText) as {
    content?: Array<{ type?: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  const text = (data.content || [])
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n')
    .trim();

  if (data.usage) {
    options.onLog?.(
      `[Anthropic API] 完成（输入 ${data.usage.input_tokens ?? '?'} / 输出 ${data.usage.output_tokens ?? '?'} tokens）\n`,
    );
  }
  return {
    output: text || '（Anthropic API 返回空内容）',
    exitCode: 0,
    commandPreview,
  };
}

async function runGeminiApi(
  provider: ProviderConfig,
  prompt: string,
  options: RunApiOptions,
  signal: AbortSignal,
): Promise<RunCliResult> {
  const baseUrl = normalizeBaseUrl(
    provider.apiBaseUrl || '',
    'https://generativelanguage.googleapis.com',
  );
  const model = (provider.model || 'gemini-2.5-pro').trim();
  const apiKey = (provider.apiKey || '').trim();
  if (!apiKey) throw new Error(`模型「${provider.shortName}」未填写 Gemini API Key`);

  const url = `${baseUrl}/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const safePreviewUrl = `${baseUrl}/v1beta/models/${model}:generateContent`;
  const commandPreview = `POST ${safePreviewUrl}`;
  options.onLog?.(`[Gemini API] 正在请求 ${safePreviewUrl}...\n`);

  const geminiBudgets: Record<string, number> = {
    off: 0,
    minimal: 512,
    low: 1024,
    medium: 4096,
    high: 16384,
    xhigh: 24576,
    max: 24576,
    on: 8192,
  };
  const gBudget =
    provider.thinkingLevel && provider.thinkingLevel !== 'default'
      ? geminiBudgets[provider.thinkingLevel]
      : undefined;

  const body: Record<string, unknown> = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  };
  if (gBudget !== undefined) {
    body.generationConfig = { thinkingConfig: { thinkingBudget: gBudget } };
  }
  if (provider.systemPrompt?.trim()) {
    body.systemInstruction = { parts: [{ text: provider.systemPrompt.trim() }] };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  const rawText = await res.text();
  if (!res.ok) {
    throw new Error(`Gemini API 失败 (${res.status})：${rawText.slice(0, 600)}`);
  }

  const data = JSON.parse(rawText) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('\n')
    .trim();

  options.onLog?.('[Gemini API] 请求完成。\n');
  return {
    output: text || '（Gemini API 返回空内容）',
    exitCode: 0,
    commandPreview,
  };
}

export function isApiProvider(provider?: ProviderConfig): boolean {
  return Boolean(
    provider &&
      provider.connectionType &&
      provider.connectionType !== 'cli',
  );
}

export async function runProviderApi(
  provider: ProviderConfig,
  prompt: string,
  options: RunApiOptions = {},
): Promise<RunCliResult> {
  const timeoutMs = Math.max(15, provider.timeoutSec || 180) * 1000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const onExternalAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onExternalAbort, { once: true });

  try {
    switch (provider.connectionType) {
      case 'openai_api':
        return await runOpenAiCompatible(provider, prompt, options, controller.signal);
      case 'anthropic_api':
        return await runAnthropicApi(provider, prompt, options, controller.signal);
      case 'gemini_api':
        return await runGeminiApi(provider, prompt, options, controller.signal);
      default:
        throw new Error(`不支持的 API 类型：${String(provider.connectionType)}`);
    }
  } catch (err) {
    if (options.signal?.aborted) {
      throw new Error('用户手动终止了当前任务');
    }
    if (controller.signal.aborted) {
      throw new Error(`API 请求超时（>${provider.timeoutSec || 180}s）`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', onExternalAbort);
  }
}

export async function testProviderConnection(
  provider: ProviderConfig,
): Promise<{ ok: boolean; latencyMs: number; message: string }> {
  const start = Date.now();
  try {
    const res = await runProviderApi(
      { ...provider, timeoutSec: 25 },
      '请只回复两个字母：OK',
    );
    return {
      ok: true,
      latencyMs: Date.now() - start,
      message: `连接成功（${Date.now() - start}ms）：${res.output.slice(0, 60)}`,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - start,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
