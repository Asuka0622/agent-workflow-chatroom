import type { TokenUsage } from '../shared/types.js';

/**
 * Lightweight BPE-calibrated token estimator for mixed CJK + Latin/code text.
 * Used as a clearly labeled fallback (`estimated: true`) when a CLI or external GUI agent
 * does not return exact provider billing counters.
 */
export function estimateTextTokens(text: string): number {
  const s = (text || '').trim();
  if (!s) return 0;
  let cjk = 0;
  let other = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    if (
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x30ff) ||
      (code >= 0xff00 && code <= 0xffef)
    ) {
      cjk++;
    } else {
      other++;
    }
  }
  return Math.max(1, Math.ceil(cjk * 0.72 + other / 3.8));
}

export function normalizeTokenUsage(
  raw?: Partial<TokenUsage> & {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    input_tokens?: number;
    output_tokens?: number;
  },
  fallback?: { inputText: string; outputText: string },
  source: 'api' | 'agent' | 'estimated' = 'estimated',
): TokenUsage {
  const rawIn = raw?.inputTokens ?? raw?.prompt_tokens ?? raw?.input_tokens;
  const rawOut = raw?.outputTokens ?? raw?.completion_tokens ?? raw?.output_tokens;
  const rawTotal = raw?.totalTokens ?? raw?.total_tokens;

  const hasExact =
    (typeof rawIn === 'number' && Number.isFinite(rawIn) && rawIn >= 0) ||
    (typeof rawOut === 'number' && Number.isFinite(rawOut) && rawOut >= 0) ||
    (typeof rawTotal === 'number' && Number.isFinite(rawTotal) && rawTotal > 0);

  if (hasExact) {
    const inputTokens = Math.max(0, Math.round(rawIn ?? 0));
    const outputTokens = Math.max(0, Math.round(rawOut ?? 0));
    const totalTokens = Math.max(
      inputTokens + outputTokens,
      Math.round(rawTotal ?? inputTokens + outputTokens),
    );
    return {
      inputTokens,
      outputTokens,
      totalTokens,
      estimated: Boolean(raw?.estimated),
      source: raw?.source || (source === 'estimated' ? 'agent' : source),
    };
  }

  const inputTokens = estimateTextTokens(fallback?.inputText || '');
  const outputTokens = estimateTextTokens(fallback?.outputText || '');
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimated: true,
    source: 'estimated',
  };
}
