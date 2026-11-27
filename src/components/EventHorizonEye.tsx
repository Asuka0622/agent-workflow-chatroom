import React, { useId, useMemo } from 'react';

export type EyeMood = 'idle' | 'busy' | 'approval' | 'error';

interface EventHorizonEyeProps {
  className?: string;
  mood?: EyeMood;
  /** Corner brackets + caption around the eye (off for the mascot halo) */
  framed?: boolean;
  label?: string;
}

// Eye is drawn in a 400x400 box around its centre
const C = 200;

function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

const arc = (r: number, a0: number, a1: number) =>
  `M ${C + r * Math.cos(a0)} ${C + r * Math.sin(a0)} A ${r} ${r} 0 0 1 ${C + r * Math.cos(a1)} ${C + r * Math.sin(a1)}`;

/**
 * The violet-pink "event horizon" eye: deep navy starfield core, cobalt → violet → pink halo,
 * rotating tick bands and a horizontal lens flare. Mood tints: approval (lemon), error (red).
 */
export const EventHorizonEye: React.FC<EventHorizonEyeProps> = ({ className = '', mood = 'idle', framed = false, label }) => {
  const uid = useId().replace(/:/g, '');
  const id = (name: string) => `${name}-${uid}`;
  const stars = useMemo(() => {
    const rnd = seeded(20261128);
    return Array.from({ length: 46 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 56;
      return { x: C + Math.cos(a) * r, y: C + Math.sin(a) * r, r: 0.4 + rnd() * 1.1, o: 0.35 + rnd() * 0.65 };
    });
  }, []);

  return (
    <svg className={`ef-eye is-mood-${mood} ${className}`} viewBox="0 0 400 400" aria-hidden="true">
      <defs>
        <radialGradient id={id('halo')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#0a1240" />
          <stop offset="40%" stopColor="#0d1a66" />
          <stop offset="49%" stopColor="#2746e8" />
          <stop offset="58%" stopColor="#6a5cf6" />
          <stop offset="68%" stopColor="#c26cf0" stopOpacity="0.85" />
          <stop offset="80%" stopColor="#f1b8f6" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#f5d0fe" stopOpacity="0" />
        </radialGradient>
        <radialGradient id={id('core')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1b2a8f" />
          <stop offset="55%" stopColor="#0a1038" />
          <stop offset="100%" stopColor="#050720" />
        </radialGradient>
        <radialGradient id={id('flash')} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
          <stop offset="30%" stopColor="#dbeafe" stopOpacity="0.85" />
          <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={id('flare')} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <radialGradient id={id('lemon')} cx="50%" cy="50%" r="50%">
          <stop offset="40%" stopColor="#f4e27a" stopOpacity="0" />
          <stop offset="56%" stopColor="#facc15" stopOpacity="1" />
          <stop offset="72%" stopColor="#f4e27a" stopOpacity="0.7" />
          <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
        </radialGradient>
        <clipPath id={id('clip')}>
          <circle cx={C} cy={C} r="60" />
        </clipPath>
      </defs>

      <g className="ef-eye-intro">
        {framed && (
          <>
            <g stroke="#7a86a3" strokeOpacity="0.55" strokeWidth="1" fill="none">
              <path d={`M ${C - 168} ${C - 140} h 14 M ${C - 168} ${C - 140} v 14`} />
              <path d={`M ${C + 168} ${C - 140} h -14 M ${C + 168} ${C - 140} v 14`} />
              <path d={`M ${C - 168} ${C + 140} h 14 M ${C - 168} ${C + 140} v -14`} />
              <path d={`M ${C + 168} ${C + 140} h -14 M ${C + 168} ${C + 140} v -14`} />
            </g>
            {label && (
              <text x={C - 64} y={C - 128} className="ef-svg-micro">
                {label}
              </text>
            )}
          </>
        )}

        <circle cx={C} cy={C} r="150" fill="none" stroke="#a5b0cf" strokeOpacity="0.45" strokeWidth="0.8" />
        <g className="ef-ring-cw-slow">
          <circle cx={C} cy={C} r="138" fill="none" stroke="#8796c4" strokeOpacity="0.55" strokeWidth="0.9" strokeDasharray="2 6" />
          <circle cx={C + 138} cy={C} r="3" fill="#9db4ff" />
        </g>

        <g className="ef-ring-ccw-mid">
          <path d={arc(160, -1.2, 0.5)} fill="none" stroke="#5a78f0" strokeOpacity="0.55" strokeWidth="9" strokeDasharray="1.4 5" />
          <path d={arc(160, -1.2, 0.5)} fill="none" stroke="#5a78f0" strokeOpacity="0.5" strokeWidth="0.8" />
          <path d={arc(124, 2.3, 3.6)} fill="none" stroke="#9aa6c9" strokeOpacity="0.6" strokeWidth="6" strokeDasharray="1 4" />
        </g>

        <circle cx={C} cy={C} r="118" fill={`url(#${id('halo')})`} className="ef-horizon-breathe" />
        <circle cx={C} cy={C} r="62" fill={`url(#${id('core')})`} />
        <g clipPath={`url(#${id('clip')})`} className="ef-core-stars">
          {stars.map((s, i) => (
            <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={s.o} />
          ))}
        </g>
        <circle cx={C} cy={C} r="62.5" fill="none" stroke="#9db4ff" strokeWidth="1.4" strokeOpacity="0.9" />
        <circle cx={C} cy={C} r="70" fill="none" stroke="#e9d5ff" strokeWidth="0.8" strokeOpacity="0.55" />

        <circle cx={C} cy={C} r="122" fill={`url(#${id('lemon')})`} className="ef-mood-approval" />
        <circle cx={C} cy={C} r="63" fill="none" stroke="#ef4444" strokeWidth="2.4" className="ef-mood-error" />

        <g className="ef-ring-cw-fast">
          <ellipse cx={C} cy={C} rx="132" ry="30" fill="none" stroke="#ffffff" strokeOpacity="0.75" strokeWidth="1.2" transform={`rotate(-16 ${C} ${C})`} />
        </g>
        <ellipse cx={C} cy={C} rx="104" ry="22" fill="none" stroke="#c4b5fd" strokeOpacity="0.6" strokeWidth="0.9" strokeDasharray="12 8" transform={`rotate(-16 ${C} ${C})`} />

        <g className="ef-eye-flash">
          <rect x={C - 190} y={C - 0.9} width="380" height="1.8" fill={`url(#${id('flare')})`} />
          <rect x={C - 0.7} y={C - 34} width="1.4" height="68" fill="#ffffff" opacity="0.7" />
          <circle cx={C} cy={C} r="16" fill={`url(#${id('flash')})`} />
          <circle cx={C} cy={C} r="2.6" fill="#ffffff" />
        </g>
      </g>
    </svg>
  );
};
