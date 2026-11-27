import React, { useEffect, useMemo, useRef } from 'react';

interface EndfieldAmbientStageProps {
  compact?: boolean;
  isBusy?: boolean;
  /** Hide bottom-right decorations so the dock mascot has room */
  quietBottom?: boolean;
  /** A conversation is open: fade the art behind the centred message column */
  reading?: boolean;
  /** Room mood: tints the eye and adds an energy surge on the rails */
  mood?: StageMood;
}

export type StageMood = 'idle' | 'busy' | 'approval' | 'error';

// Parallax depth per layer class: [x px, y px] at full pointer deflection
const PARALLAX_DEPTH: Record<string, [number, number]> = {
  'ef-par-far': [-5, -3],
  'ef-par-mid': [9, 6],
  'ef-par-near': [16, 10],
};

/**
 * Smoothed pointer parallax. Writes transform straight onto the few layer elements
 * (no inherited custom properties, so only those layers restyle each frame).
 */
function useStageParallax(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const layers = Object.entries(PARALLAX_DEPTH).flatMap(([cls, depth]) =>
      Array.from(el.getElementsByClassName(cls)).map((node) => ({ node: node as HTMLElement | SVGElement, depth })),
    );
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let raf = 0;
    const loop = () => {
      cx += (tx - cx) * 0.07;
      cy += (ty - cy) * 0.07;
      for (const { node, depth } of layers) {
        node.style.transform = `translate(${(cx * depth[0]).toFixed(2)}px, ${(cy * depth[1]).toFixed(2)}px)`;
      }
      raf = Math.abs(tx - cx) > 0.002 || Math.abs(ty - cy) > 0.002 ? requestAnimationFrame(loop) : 0;
    };
    const onMove = (e: PointerEvent) => {
      tx = (e.clientX / window.innerWidth) * 2 - 1;
      ty = (e.clientY / window.innerHeight) * 2 - 1;
      if (!raf) raf = requestAnimationFrame(loop);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      cancelAnimationFrame(raf);
    };
  }, [ref]);
}

// Deterministic pseudo-random so the starfield / sparkles stay stable between renders
function seeded(seed: number) {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

// Eye (event horizon) centre in the 1200x760 stage viewBox
const EX = 968;
const EY = 176;

// Main ∞ centre-line: small left lobe, large right lobe sweeping under the eye
const INF_PATH =
  'M 560 480 C 680 330, 1000 250, 1120 420 C 1200 540, 900 700, 700 600 C 640 570, 600 530, 560 480 C 500 410, 400 330, 250 370 C 90 410, 80 560, 230 590 C 380 620, 480 560, 560 480 Z';

// Variants of the ∞ obtained by scaling around the crossing point
const around = (sx: number, sy: number, dx = 0, dy = 0) =>
  `translate(${560 + dx} ${480 + dy}) scale(${sx} ${sy}) translate(-560 -480)`;

const PILLARS = [
  ['01', 'GROUP CHATROOM'],
  ['02', 'FLOW CANVAS'],
  ['03', 'SKILL MATRIX'],
  ['04', 'PLUGIN // MCP'],
  ['05', 'TIMELESS COLLAB'],
  ['06', 'SCHEDULED RELAY'],
];

/**
 * TIMELESS NASCENCE ∞ kinetic ambient art stage.
 * Pure SVG + CSS motion graphics (pointer-events: none, z-index: 0).
 */
export const EndfieldAmbientStage: React.FC<EndfieldAmbientStageProps> = ({
  compact = false,
  isBusy = false,
  quietBottom = false,
  reading = false,
  mood,
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  useStageParallax(stageRef);
  const stageMood: StageMood = mood ?? (isBusy ? 'busy' : 'idle');

  const { coreStars, sparkles, dust } = useMemo(() => {
    const rnd = seeded(20261127);
    const coreStars = Array.from({ length: 46 }, () => {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * 56;
      return { x: EX + Math.cos(a) * r, y: EY + Math.sin(a) * r, r: 0.4 + rnd() * 1.1, o: 0.35 + rnd() * 0.65 };
    });
    const sparkles = [
      { x: 210, y: 150, s: 1.1, c: '#ffffff', d: 0 },
      { x: 742, y: 118, s: 0.8, c: '#c7d2fe', d: 1.3 },
      { x: 838, y: 300, s: 0.7, c: '#ffffff', d: 0.6 },
      { x: 1116, y: 268, s: 0.9, c: '#93c5fd', d: 2.1 },
      { x: 420, y: 640, s: 0.75, c: '#ffffff', d: 1.7 },
      { x: 905, y: 620, s: 1, c: '#e0e7ff', d: 0.9 },
      { x: 120, y: 470, s: 0.65, c: '#bfdbfe', d: 2.6 },
      { x: 655, y: 405, s: 0.6, c: '#ffffff', d: 3.1 },
    ];
    const dust = Array.from({ length: 34 }, () => ({
      x: rnd() * 1200,
      y: 60 + rnd() * 660,
      r: 0.6 + rnd() * 1.3,
      d: rnd() * 4,
    }));
    return { coreStars, sparkles, dust };
  }, []);

  return (
    <div
      ref={stageRef}
      className={`ef-ambient-stage is-mood-${stageMood} ${compact ? 'is-compact' : ''} ${stageMood === 'busy' ? 'is-busy' : ''} ${reading ? 'is-reading' : ''}`}
      aria-hidden="true"
    >
      {/* Layer 1: oversized hollow halftone typography struck through by black data bars */}
      <div className="ef-bg-watermark ef-par-far">
        <div className="ef-wm-top">
          <span className="ef-wm-word">TIMELESS</span>
          <span className="ef-wm-index">05</span>
          <span className="ef-wm-bar ef-wm-bar-top">
            <span className="ef-wm-label">THE FOUNDATION // LOCAL PROTOCOL // 05</span>
          </span>
          <span className="ef-wm-glitch-a" />
        </div>
        <div className="ef-wm-bottom">
          <span className="ef-wm-word">NASCENCE</span>
          <span className="ef-wm-bar ef-wm-bar-bottom">
            <span className="ef-wm-label is-ghost">SINGULARITY LOCK // ORIGIN_05 // ∞</span>
          </span>
          <span className="ef-wm-glitch-c" />
        </div>
        <div className="ef-dot-patch" />
      </div>

      {/* Layer 2: precision grid travelling light beams */}
      <div className="ef-grid-beams">
        <span className="ef-beam-h ef-beam-h1" />
        <span className="ef-beam-h ef-beam-h2" />
        <span className="ef-beam-v ef-beam-v1" />
        <span className="ef-beam-v ef-beam-v2" />
      </div>

      {/* Layer 3: event-horizon eye + cobalt ∞ rail ribbons + prism glass ribbon */}
      <svg className="ef-stage-svg" viewBox="0 0 1200 760" preserveAspectRatio="xMaxYMid slice">
        <defs>
          <path id="efInf" d={INF_PATH} />
          {/* Same curve normalised to length 1000, used to draw the rails in on load */}
          <path id="efInfDraw" d={INF_PATH} pathLength={1000} />

          {/* Rails: a wide stroke minus a slightly narrower one leaves two parallel hairlines */}
          <mask id="efRailMask" maskUnits="userSpaceOnUse" x="-100" y="-100" width="1400" height="960">
            <use href="#efInfDraw" fill="none" stroke="#fff" strokeWidth="9.5" className="ef-draw-in" />
            <use href="#efInf" fill="none" stroke="#000" strokeWidth="7" />
          </mask>
          <mask id="efGlassEdgeMask" maskUnits="userSpaceOnUse" x="-100" y="-100" width="1400" height="960">
            <use href="#efInfDraw" fill="none" stroke="#fff" strokeWidth="30" className="ef-draw-in is-late" />
            <use href="#efInf" fill="none" stroke="#000" strokeWidth="27" />
          </mask>

          <linearGradient id="efCobalt" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6d8bff" stopOpacity="0.35" />
            <stop offset="35%" stopColor="#2a4de6" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#3554f0" stopOpacity="1" />
            <stop offset="100%" stopColor="#7b8cff" stopOpacity="0.6" />
          </linearGradient>
          <linearGradient id="efPrism" x1="0%" y1="0%" x2="100%" y2="30%">
            <stop offset="0%" stopColor="#7dd3fc" />
            <stop offset="30%" stopColor="#a7f3d0" />
            <stop offset="55%" stopColor="#f5d0fe" />
            <stop offset="80%" stopColor="#93c5fd" />
            <stop offset="100%" stopColor="#c4b5fd" />
          </linearGradient>
          <linearGradient id="efGlassBody" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#e0e7ff" stopOpacity="0.35" />
          </linearGradient>

          {/* Eye: pink/violet haze → cobalt band → deep navy core */}
          <radialGradient id="efEyeHalo" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#0a1240" />
            <stop offset="40%" stopColor="#0d1a66" />
            <stop offset="49%" stopColor="#2746e8" />
            <stop offset="58%" stopColor="#6a5cf6" />
            <stop offset="68%" stopColor="#c26cf0" stopOpacity="0.85" />
            <stop offset="80%" stopColor="#f1b8f6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#f5d0fe" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="efEyeCore" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#1b2a8f" />
            <stop offset="55%" stopColor="#0a1038" />
            <stop offset="100%" stopColor="#050720" />
          </radialGradient>
          <radialGradient id="efEyeFlash" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="1" />
            <stop offset="30%" stopColor="#dbeafe" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#93c5fd" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="efFlareH" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
            <stop offset="50%" stopColor="#ffffff" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="efLemonOrb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fefce8" />
            <stop offset="35%" stopColor="#f4f18a" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#a7f3d0" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="efMoodLemon" cx="50%" cy="50%" r="50%">
            <stop offset="40%" stopColor="#f4e27a" stopOpacity="0" />
            <stop offset="56%" stopColor="#facc15" stopOpacity="1" />
            <stop offset="72%" stopColor="#f4e27a" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#fef9c3" stopOpacity="0" />
          </radialGradient>
          <clipPath id="efCoreClip">
            <circle cx={EX} cy={EY} r="60" />
          </clipPath>
          <filter id="efSoftGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="6" />
          </filter>
        </defs>

        {/* Floating dust */}
        <g className="ef-dust">
          {dust.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={p.r}
              className="ef-dust-dot"
              style={{ animationDelay: `${p.d}s` }}
            />
          ))}
        </g>

        <g className="ef-par-mid">
        {/* Prism glass ribbon (behind the rails) */}
        <g className="ef-intro-fade is-late">
        <g className="ef-glass-ribbon" transform={around(1.07, 1.24, 0, 14)}>
          <use href="#efInf" fill="none" stroke="url(#efGlassBody)" strokeWidth="28" strokeLinecap="round" />
          <rect x="-100" y="-100" width="1400" height="960" fill="url(#efPrism)" mask="url(#efGlassEdgeMask)" />
          <use
            href="#efInf"
            fill="none"
            stroke="#ffffff"
            strokeWidth="3"
            strokeDasharray="160 90 40 300"
            className="ef-glass-glint"
          />
        </g>
        </g>

        {/* Loose wireframe strands */}
        <g className="ef-strands ef-intro-fade" fill="none" stroke="#3a5bef">
          <use href="#efInf" transform={around(0.9, 0.82, 6, -4)} strokeWidth="0.9" strokeOpacity="0.45" />
          <use href="#efInf" transform={around(1.14, 1.32, -4, 6)} strokeWidth="0.7" strokeOpacity="0.3" />
          <use
            href="#efInf"
            transform={around(0.96, 1.1, 0, 8)}
            strokeWidth="0.8"
            strokeOpacity="0.4"
            strokeDasharray="5 7"
            className="ef-dash-flow"
          />
        </g>

        {/* Secondary rail track */}
        <g className="ef-intro-fade is-late">
        <g transform={around(0.93, 0.9, 2, -6)} opacity="0.4">
          <rect x="-100" y="-100" width="1400" height="960" fill="url(#efCobalt)" mask="url(#efRailMask)" />
          <use
            href="#efInf"
            fill="none"
            stroke="#2a4de6"
            strokeWidth="7"
            strokeDasharray="1.2 16"
            className="ef-rail-ties ef-rail-ties-slow"
          />
        </g>
        </g>

        {/* Primary cobalt rail track: two hairline rails + moving cross ties */}
        <g className="ef-rail-main">
          <rect x="-100" y="-100" width="1400" height="960" fill="url(#efCobalt)" mask="url(#efRailMask)" />
          <g className="ef-intro-fade is-late">
          <use
            href="#efInf"
            fill="none"
            stroke="#2a4de6"
            strokeOpacity="0.8"
            strokeWidth="8"
            strokeDasharray="1.2 11"
            className="ef-rail-ties"
          />
          <use
            href="#efInf"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.4"
            strokeDasharray="90 2400"
            strokeLinecap="round"
            className="ef-energy-trace"
          />
          <use
            href="#efInf"
            fill="none"
            stroke="#a5f3fc"
            strokeWidth="2"
            strokeDasharray="40 2450"
            strokeLinecap="round"
            className="ef-energy-trace-2"
          />
          </g>
          {/* Busy surge: extra energy packets fade in while members are working */}
          <g className="ef-surge">
            <use href="#efInf" fill="none" stroke="#f4e27a" strokeWidth="2.6" strokeDasharray="60 770" strokeLinecap="round" className="ef-surge-trace" />
            <use href="#efInf" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeDasharray="30 800" strokeLinecap="round" className="ef-surge-trace is-b" />
          </g>
        </g>
        </g>

        {/* Arc-lock hairline from the lemon orb to the eye */}
        <g className="ef-arc-lock">
          <line x1="232" y1="214" x2={EX - 150} y2={EY + 6} stroke="#5b6b8c" strokeOpacity="0.4" strokeWidth="0.8" />
          <text x="560" y="194" className="ef-svg-micro">
            ARC_LOCK [232,214] → [{EX},{EY}]
          </text>
          <circle cx="232" cy="214" r="26" fill="url(#efLemonOrb)" className="ef-orb-glow" />
          <circle cx="232" cy="214" r="4" fill="#fefce8" />
        </g>

        {/* Event-horizon eye */}
        <g className="ef-par-near">
        <g className="ef-eye-intro">
        <g className="ef-horizon-cluster">
          {/* HUD corner brackets & label */}
          <g stroke="#7a86a3" strokeOpacity="0.55" strokeWidth="1" fill="none">
            <path d={`M ${EX - 168} ${EY - 140} h 14 M ${EX - 168} ${EY - 140} v 14`} />
            <path d={`M ${EX + 168} ${EY - 140} h -14 M ${EX + 168} ${EY - 140} v 14`} />
            <path d={`M ${EX - 168} ${EY + 140} h 14 M ${EX - 168} ${EY + 140} v -14`} />
            <path d={`M ${EX + 168} ${EY + 140} h -14 M ${EX + 168} ${EY + 140} v -14`} />
          </g>
          <text x={EX - 64} y={EY - 128} className="ef-svg-micro">
            ORIGIN_05 // EVENT HORIZON
          </text>

          {/* Outer concentric hairlines */}
          <circle cx={EX} cy={EY} r="150" fill="none" stroke="#a5b0cf" strokeOpacity="0.45" strokeWidth="0.8" />
          <g className="ef-ring-cw-slow">
            <circle
              cx={EX}
              cy={EY}
              r="138"
              fill="none"
              stroke="#8796c4"
              strokeOpacity="0.55"
              strokeWidth="0.9"
              strokeDasharray="2 6"
            />
            <circle cx={EX + 138} cy={EY} r="3" fill="#f4e27a" />
          </g>

          {/* Ladder arc segments (rotating tick bands) */}
          <g className="ef-ring-ccw-mid">
            <path
              d={`M ${EX + 160 * Math.cos(-1.2)} ${EY + 160 * Math.sin(-1.2)} A 160 160 0 0 1 ${EX + 160 * Math.cos(0.5)} ${EY + 160 * Math.sin(0.5)}`}
              fill="none"
              stroke="#5a78f0"
              strokeOpacity="0.55"
              strokeWidth="9"
              strokeDasharray="1.4 5"
            />
            <path
              d={`M ${EX + 160 * Math.cos(-1.2)} ${EY + 160 * Math.sin(-1.2)} A 160 160 0 0 1 ${EX + 160 * Math.cos(0.5)} ${EY + 160 * Math.sin(0.5)}`}
              fill="none"
              stroke="#5a78f0"
              strokeOpacity="0.5"
              strokeWidth="0.8"
            />
            <path
              d={`M ${EX + 124 * Math.cos(2.3)} ${EY + 124 * Math.sin(2.3)} A 124 124 0 0 1 ${EX + 124 * Math.cos(3.6)} ${EY + 124 * Math.sin(3.6)}`}
              fill="none"
              stroke="#9aa6c9"
              strokeOpacity="0.6"
              strokeWidth="6"
              strokeDasharray="1 4"
            />
          </g>

          {/* Glowing halo + core */}
          <circle cx={EX} cy={EY} r="118" fill="url(#efEyeHalo)" className="ef-horizon-breathe" />
          <circle cx={EX} cy={EY} r="62" fill="url(#efEyeCore)" />
          <g clipPath="url(#efCoreClip)" className="ef-core-stars">
            {coreStars.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.r} fill="#ffffff" opacity={s.o} />
            ))}
          </g>
          <circle cx={EX} cy={EY} r="62.5" fill="none" stroke="#9db4ff" strokeWidth="1.4" strokeOpacity="0.9" />
          <circle cx={EX} cy={EY} r="70" fill="none" stroke="#e9d5ff" strokeWidth="0.8" strokeOpacity="0.55" />
          {/* Mood overlays */}
          <circle cx={EX} cy={EY} r="122" fill="url(#efMoodLemon)" className="ef-mood-approval" />
          <circle cx={EX} cy={EY} r="63" fill="none" stroke="#ef4444" strokeWidth="2.4" className="ef-mood-error" />

          {/* Tilted accretion ellipses */}
          <g className="ef-ring-cw-fast">
            <ellipse
              cx={EX}
              cy={EY}
              rx="132"
              ry="30"
              fill="none"
              stroke="#ffffff"
              strokeOpacity="0.75"
              strokeWidth="1.2"
              transform={`rotate(-16 ${EX} ${EY})`}
            />
          </g>
          <ellipse
            cx={EX}
            cy={EY}
            rx="104"
            ry="22"
            fill="none"
            stroke="#c4b5fd"
            strokeOpacity="0.6"
            strokeWidth="0.9"
            strokeDasharray="12 8"
            transform={`rotate(-16 ${EX} ${EY})`}
          />

          {/* Central star flash + long horizontal lens flare */}
          <g className="ef-eye-flash">
            <rect x={EX - 190} y={EY - 0.9} width="380" height="1.8" fill="url(#efFlareH)" />
            <rect x={EX - 0.7} y={EY - 34} width="1.4" height="68" fill="#ffffff" opacity="0.7" />
            <circle cx={EX} cy={EY} r="16" fill="url(#efEyeFlash)" />
            <circle cx={EX} cy={EY} r="2.6" fill="#ffffff" />
          </g>
        </g>

        </g>
        </g>

        {/* Four-point sparkles */}
        {sparkles.map((s, i) => (
          <g
            key={i}
            className="ef-sparkle"
            style={{ animationDelay: `${s.d}s`, transformOrigin: `${s.x}px ${s.y}px` }}
          >
            <path
              transform={`translate(${s.x} ${s.y}) scale(${s.s})`}
              d="M 0 -14 C 1.2 -3, 3 -1.2, 14 0 C 3 1.2, 1.2 3, 0 14 C -1.2 3, -3 1.2, -14 0 C -3 -1.2, -1.2 -3, 0 -14 Z"
              fill={s.c}
            />
          </g>
        ))}
      </svg>

      {/* Layer 4: right-edge rail — starfield capsules, chevron, emblem, barcode */}
      {!compact && (
        <div className="ef-hud-rail">
          <div className="ef-capsule">
            <span className="ef-capsule-slit" />
          </div>
          <svg className="ef-chevron" viewBox="0 0 24 16">
            <path d="M 1 1 L 12 10 L 23 1 L 23 5 L 12 15 L 1 5 Z" />
          </svg>
          <div className="ef-emblem">
            <svg viewBox="0 0 40 40">
              <circle cx="20" cy="20" r="15" fill="none" strokeWidth="1.2" />
              <path
                d="M 8 20 C 8 13, 16 13, 20 20 C 24 27, 32 27, 32 20 C 32 13, 24 13, 20 20 C 16 27, 8 27, 8 20 Z"
                fill="none"
                strokeWidth="2.2"
              />
              <ellipse cx="20" cy="20" rx="18" ry="6" fill="none" strokeWidth="0.8" transform="rotate(-24 20 20)" />
            </svg>
          </div>
          <div className="ef-hud-tag">TIMELESS // 05</div>
          <div className="ef-rail-ticks">
            <svg className="ef-chevron is-mini" viewBox="0 0 24 16">
              <path d="M 1 1 L 12 10 L 23 1 L 23 5 L 12 15 L 1 5 Z" />
            </svg>
            <div className="ef-hud-barcode">
              <span className="b1" />
              <span className="b2" />
              <span className="b3" />
              <span className="b4" />
              <span className="b5" />
              <span className="b6" />
            </div>
          </div>
          <div className="ef-hud-vtext">05 // TIMELESS NASCENCE ∞</div>
          {!quietBottom && (
            <div className="ef-capsule is-bottom">
              <span className="ef-capsule-slit" />
            </div>
          )}
        </div>
      )}

      {/* Layer 5: decorative HUD index list (bottom-right) */}
      {!compact && !quietBottom && (
        <div className="ef-pillar-menu">
          <div className="ef-pillar-head">
            <span>FOUNDATION // SIX MODULES</span>
            <b>05</b>
          </div>
          {PILLARS.map(([n, label]) => (
            <div key={n} className={`ef-pillar-row ${n === '05' ? 'is-active' : ''}`}>
              <span className="n">{n}</span>
              <span className="l">{label}</span>
              {n === '05' && <span className="arrow">▸</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
