import React, { useEffect, useRef } from 'react';
import { BRAND } from '../brand';
import { EventHorizonEye, type EyeMood } from './EventHorizonEye';

export type StageMood = EyeMood;

interface AmbientStageProps {
  /** Canvas or workspace split pane is open */
  compact?: boolean;
  /** A conversation is open: fade the art behind the centred message column */
  reading?: boolean;
  /** Hide bottom-right decorations so the dock mascot has room */
  quietBottom?: boolean;
  /** The mascot is carrying the eye as her halo, so the stage eye steps back */
  eyeDocked?: boolean;
  /** Room mood: tints the eye and adds an energy surge on the rails */
  mood?: StageMood;
}

// Parallax depth per layer class: [x px, y px] at full pointer deflection
const PARALLAX_DEPTH: Record<string, [number, number]> = {
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

// Main ∞ centre-line: small left lobe, large right lobe
const INF_PATH =
  'M 560 480 C 680 330, 1000 250, 1120 420 C 1200 540, 900 700, 700 600 C 640 570, 600 530, 560 480 C 500 410, 400 330, 250 370 C 90 410, 80 560, 230 590 C 380 620, 480 560, 560 480 Z';

// Variants of the ∞ obtained by scaling around the crossing point
const around = (sx: number, sy: number, dx = 0, dy = 0) =>
  `translate(${560 + dx} ${480 + dy}) scale(${sx} ${sy}) translate(-560 -480)`;

const SPARKLES = [
  { x: 210, y: 150, s: 1.1, c: '#ffffff', d: 0 },
  { x: 905, y: 620, s: 1, c: '#e0e7ff', d: 3 },
  { x: 120, y: 470, s: 0.65, c: '#bfdbfe', d: 1.5 },
];

/**
 * Ambient art stage (pointer-events: none, z-index 0): a cobalt ∞ rail
 * track, the event-horizon eye and a journal spine along the right edge.
 */
export const AmbientStage: React.FC<AmbientStageProps> = ({
  compact = false,
  reading = false,
  quietBottom = false,
  eyeDocked = false,
  mood = 'idle',
}) => {
  const stageRef = useRef<HTMLDivElement>(null);
  useStageParallax(stageRef);

  const classes = [
    'ef-ambient-stage',
    `is-mood-${mood}`,
    mood === 'busy' ? 'is-busy' : '',
    compact ? 'is-compact' : '',
    reading ? 'is-reading' : '',
    eyeDocked ? 'is-eye-docked' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div ref={stageRef} className={classes} aria-hidden="true">
      {/* Layer 1: cobalt ∞ rail track */}
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
          <linearGradient id="efCobalt" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#6d8bff" stopOpacity="0.35" />
            <stop offset="35%" stopColor="#2a4de6" stopOpacity="0.95" />
            <stop offset="70%" stopColor="#3554f0" stopOpacity="1" />
            <stop offset="100%" stopColor="#7b8cff" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        <g className="ef-par-mid">
          {/* Primary cobalt rail track: two hairline rails + moving cross ties */}
          <g className="ef-rail-main">
            {/* Night-sky glow band (dark theme only) */}
            <use href="#efInf" fill="none" stroke="#5b7bff" strokeWidth="20" strokeLinecap="round" className="ef-rail-glow" />
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
              <use href="#efInf" fill="none" stroke="#a5f3fc" strokeWidth="2.6" strokeDasharray="60 770" strokeLinecap="round" className="ef-surge-trace" />
              <use href="#efInf" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeDasharray="30 800" strokeLinecap="round" className="ef-surge-trace is-b" />
            </g>
          </g>
        </g>

        {/* Four-point sparkles */}
        {SPARKLES.map((s, i) => (
          <g key={i} className="ef-sparkle" style={{ animationDelay: `${s.d}s`, transformOrigin: `${s.x}px ${s.y}px` }}>
            <path
              transform={`translate(${s.x} ${s.y}) scale(${s.s})`}
              d="M 0 -14 C 1.2 -3, 3 -1.2, 14 0 C 3 1.2, 1.2 3, 0 14 C -1.2 3, -3 1.2, -14 0 C -3 -1.2, -1.2 -3, 0 -14 Z"
              fill={s.c}
            />
          </g>
        ))}
      </svg>

      {/* Layer 2: the event-horizon eye, pinned to the top-right corner of the stage */}
      <div className="ef-stage-eye ef-par-near">
        <EventHorizonEye mood={mood} framed label={BRAND.eyeLabel} />
      </div>

      {/* Layer 3: journal spine along the right edge */}
      {!compact && !quietBottom && (
        <div className="jr-spine">
          <span>{BRAND.spine}</span>
        </div>
      )}
    </div>
  );
};
