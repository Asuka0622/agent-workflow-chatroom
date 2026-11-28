import React, { useEffect, useState } from 'react';
import { EventHorizonEye, type EyeMood } from './EventHorizonEye';

export type RinneState = 'idle' | 'listening' | 'working' | 'approval' | 'error' | 'done' | 'sleep';

interface RinneMascotProps {
  variant: 'hero' | 'dock';
  state?: RinneState;
  /** Line shown in the speech bubble (dock variant only) */
  line?: string;
}

// Art lives in public/mascot (see docs/mascot/RINNE.md). Missing files fall back to idle, then a placeholder.
// Relative to index.html so it works both from the local server and a file:// desktop build
const MASCOT_BASE = './mascot/';
const failedSources = new Set<string>();

function candidates(variant: 'hero' | 'dock', state: RinneState): string[] {
  const list = variant === 'hero' ? ['rinne-hero.png', 'rinne-idle.png'] : [`rinne-${state}.png`, 'rinne-idle.png'];
  return Array.from(new Set(list)).map((f) => MASCOT_BASE + f);
}

export const RINNE_LINES: Record<RinneState, string> = {
  idle: '已接线，随时待命。',
  listening: '有成员在监听，任务一来就送到。',
  working: '正在协作中…',
  approval: '这一单，等你拍板。',
  error: '线路出错了，看看排障提示？',
  done: '完成，交付已归档。',
  sleep: '大家都不在线…我先眯一会儿。',
};

export const RINNE_LINES_EN: Record<RinneState, string> = {
  idle: 'Wired in and standing by.',
  listening: 'Members are listening — ready to relay.',
  working: 'Collaborating now…',
  approval: 'Ready for your final call.',
  error: 'Line issue detected — check diagnostics?',
  done: 'Done and archived.',
  sleep: 'Everyone is offline… taking a quick nap.',
};

const EYE_MOOD: Partial<Record<RinneState, EyeMood>> = { working: 'busy', approval: 'approval', error: 'error' };

export const RinneMascot: React.FC<RinneMascotProps> = ({ variant, state = 'idle', line }) => {
  const sources = candidates(variant, state);
  const pickSource = () => sources.find((s) => !failedSources.has(s)) || null;
  const [src, setSrc] = useState<string | null>(pickSource);

  useEffect(() => {
    setSrc(pickSource());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, state]);

  const handleError = () => {
    if (src) failedSources.add(src);
    setSrc(pickSource());
  };

  return (
    <div className={`rinne rinne-${variant} is-${state}`} aria-hidden="true">
      {variant === 'dock' && line && (
        <div className="rinne-bubble">
          <span className="rinne-bubble-tag">RINNE // {state.toUpperCase()}</span>
          <span className="rinne-bubble-text">{line}</span>
        </div>
      )}
      {/* The event-horizon eye sits behind her as a halo */}
      <EventHorizonEye className="rinne-halo" mood={EYE_MOOD[state] ?? 'idle'} />
      <div className="rinne-figure">
        {src ? (
          <img key={src} className="rinne-img" src={src} alt="" draggable={false} onError={handleError} />
        ) : (
          <RinnePlaceholder variant={variant} />
        )}
      </div>
    </div>
  );
};

/** Neutral silhouette shown until real art is dropped into public/mascot */
const RinnePlaceholder: React.FC<{ variant: 'hero' | 'dock' }> = ({ variant }) => (
  <svg className="rinne-placeholder" viewBox="0 0 200 240">
    <defs>
      <linearGradient id={`rinnePh-${variant}`} x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="#2a4de6" stopOpacity="0.16" />
        <stop offset="100%" stopColor="#2a4de6" stopOpacity="0.04" />
      </linearGradient>
    </defs>
    {/* long hair + shoulders */}
    <path
      d="M 100 26 C 62 26 48 58 50 92 C 52 130 40 168 30 240 L 170 240 C 160 168 148 130 150 92 C 152 58 138 26 100 26 Z"
      fill={`url(#rinnePh-${variant})`}
      stroke="#2a4de6"
      strokeOpacity="0.45"
      strokeDasharray="4 4"
    />
    <path d="M 40 240 C 46 196 70 178 100 178 C 130 178 154 196 160 240" fill="none" stroke="#2a4de6" strokeOpacity="0.45" />
    <ellipse cx="100" cy="92" rx="34" ry="40" fill="#ffffff" fillOpacity="0.55" stroke="#2a4de6" strokeOpacity="0.5" />
    {/* headphones: white cup + glowing eye cup */}
    <path d="M 64 86 C 64 50 136 50 136 86" fill="none" stroke="#94a3b8" strokeWidth="3" />
    <circle cx="64" cy="96" r="11" fill="#f8fafc" stroke="#94a3b8" />
    <circle cx="136" cy="96" r="12" fill="#0d1a66" stroke="#c26cf0" strokeWidth="2" />
    <rect x="118" y="95.4" width="36" height="1.2" fill="#ffffff" />
    {/* lemon eyes */}
    <circle cx="87" cy="96" r="3" fill="#f4e27a" />
    <circle cx="113" cy="96" r="3" fill="#f4e27a" />
    {/* task orb */}
    <circle cx="150" cy="200" r="9" fill="#f4e27a" fillOpacity="0.9" />
    <text x="100" y="232" textAnchor="middle" className="rinne-placeholder-text">
      RINNE // 立绘待放入
    </text>
  </svg>
);
