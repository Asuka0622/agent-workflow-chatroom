import type { ThinkingLevel } from './types.js';

export interface ThinkingOptionItem {
  value: ThinkingLevel;
  label: string;
  shortLabel: string;
}

const OPTION_META: Record<ThinkingLevel, { label: string; shortLabel: string }> = {
  default: { label: '默认', shortLabel: '默认' },
  off: { label: '关闭思考', shortLabel: '关' },
  on: { label: '深度思考', shortLabel: '开' },
  minimal: { label: 'Minimal', shortLabel: 'Min' },
  low: { label: 'Low', shortLabel: 'Low' },
  medium: { label: 'Medium', shortLabel: 'Med' },
  high: { label: 'High', shortLabel: 'High' },
  xhigh: { label: 'XHigh', shortLabel: 'XHigh' },
  max: { label: 'Max', shortLabel: 'Max' },
};

export function getThinkingLabel(level?: ThinkingLevel): string {
  if (!level) return '默认';
  return OPTION_META[level]?.shortLabel || level;
}

export function getThinkingFullLabel(level?: ThinkingLevel): string {
  if (!level) return '默认';
  return OPTION_META[level]?.label || level;
}

export function getNativeThinkingOptions(params: {
  modelName?: string;
  id?: string;
  command?: string;
  customOptions?: ThinkingLevel[];
}): ThinkingOptionItem[] {
  const toItems = (vals: ThinkingLevel[]): ThinkingOptionItem[] =>
    vals.map((v) => ({
      value: v,
      label: OPTION_META[v]?.label || v,
      shortLabel: OPTION_META[v]?.shortLabel || v,
    }));

  if (params.customOptions && params.customOptions.length > 0) {
    const withDefault: ThinkingLevel[] = params.customOptions.includes('default')
      ? params.customOptions
      : ['default', ...params.customOptions];
    return toItems(withDefault);
  }

  const key = `${params.modelName || ''} ${params.id || ''} ${params.command || ''}`.toLowerCase();

  // Claude Code CLI / Opus / Sonnet: native low, medium, high, xhigh, max
  if (key.includes('claude') || key.includes('opus') || key.includes('sonnet')) {
    return toItems(['default', 'low', 'medium', 'high', 'xhigh', 'max']);
  }

  // Gemini 4 Hydrogen: native Low / Medium / High / Extra High
  if (key.includes('hydrogen')) {
    return toItems(['default', 'low', 'medium', 'high', 'xhigh']);
  }

  // Gemini 4 Neon: native Low / High
  if (key.includes('neon')) {
    return toItems(['default', 'low', 'high']);
  }

  // Other Gemini models: off / low / medium / high
  if (key.includes('gemini')) {
    return toItems(['default', 'off', 'low', 'medium', 'high']);
  }

  // DeepSeek family: native thinking toggle (off / on)
  if (key.includes('deepseek')) {
    return toItems(['default', 'off', 'on']);
  }

  // OpenAI Codex / GPT-5 / o1 / o3 / o4: low / medium / high / xhigh
  if (key.includes('codex') || key.includes('gpt') || /\bo[134]\b/.test(key)) {
    return toItems(['default', 'low', 'medium', 'high', 'xhigh']);
  }

  // Qwen / GLM / others with thinking toggle
  if (key.includes('qwen') || key.includes('glm')) {
    return toItems(['default', 'off', 'on']);
  }

  return toItems(['default', 'low', 'medium', 'high']);
}
