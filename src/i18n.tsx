import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type Locale = 'zh-CN' | 'en';

export const LOCALE_OPTIONS: Array<{ code: Locale; label: string; short: string }> = [
  { code: 'zh-CN', label: '简体中文', short: '中' },
  { code: 'en', label: 'English', short: 'EN' },
];

const STORAGE_KEY = 'app_locale';

function readInitialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh-CN') return saved;
  } catch {
    // ignore storage errors
  }
  return 'zh-CN';
}

const STAGE_LABEL_MAP: Record<string, string> = {
  '实时待命 · 自动响应': 'Live Standby · Auto',
  '待命接单中': 'Claiming Task',
  '文件桥接 · 等待回执': 'File-Bridge · Waiting',
  '文件桥接 · 已回执': 'File-Bridge · Received',
  '等待接单': 'Waiting for Claim',
  '自动拉起': 'Auto Launch',
  '已接单 · 生成中': 'Claimed · Generating',
  '群聊 · 模拟': 'Chat · Dry-Run',
  '群聊 · API': 'Chat · API',
  '群聊 · 订阅 CLI': 'Chat · CLI',
  '主动发言': 'Proactive Reply',
  '新协作会话': 'New Session',
  '公共协作群聊': 'Group Session',
  '需求输入': 'Task Input',
  '任务输入': 'Task Input',
  '人工拍板': 'Human Approval',
};

export function translateKnownLabel(raw: string | undefined, locale: Locale): string {
  if (!raw) return '';
  if (locale !== 'en') return raw;
  const trimmed = raw.trim();
  if (STAGE_LABEL_MAP[trimmed]) return STAGE_LABEL_MAP[trimmed];
  return trimmed
    .replace(/^启动工作流\s*·\s*/, 'Start Workflow · ')
    .replace(/^互聊接力\s*·\s*第\s*(\d+)\/(\d+)\s*轮/, 'Auto-Relay · Round $1/$2')
    .replace(/^无限互聊\s*·\s*第\s*(\d+)\s*轮/, 'Unlimited Relay · Round $1')
    .replace(/·\s*已接单\s*·\s*生成中/, '· Claimed · Generating')
    .replace(/·\s*文件桥接\s*·\s*等待回执/, '· File-Bridge · Waiting')
    .replace(/·\s*实时待命\s*·\s*自动响应/, '· Live Standby');
}

interface I18nContextValue {
  locale: Locale;
  isEn: boolean;
  setLocale: (next: Locale) => void;
  toggleLocale: () => void;
  tr: (zh: string, en: string) => string;
  tl: (raw: string | undefined) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'zh-CN',
  isEn: false,
  setLocale: () => {},
  toggleLocale: () => {},
  tr: (zh) => zh,
  tl: (raw) => raw || '',
});

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [locale, setLocaleState] = useState<Locale>(readInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage errors
    }
  }, []);

  const toggleLocale = useCallback(() => {
    setLocaleState((prev) => {
      const next: Locale = prev === 'zh-CN' ? 'en' : 'zh-CN';
      try {
        localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title =
      locale === 'en'
        ? 'RINNE RELAY — Multi-Agent Local Workflow Studio'
        : 'Multi-Agent 本地订阅工作流编排器';
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      isEn: locale === 'en',
      setLocale,
      toggleLocale,
      tr: (zh, en) => (locale === 'en' ? en : zh),
      tl: (raw) => translateKnownLabel(raw, locale),
    }),
    [locale, setLocale, toggleLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}
