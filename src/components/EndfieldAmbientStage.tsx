import React from 'react';

interface EndfieldAmbientStageProps {
  compact?: boolean;
  isBusy?: boolean;
}

/**
 * Persistent Arknights: Endfield // TIMELESS NASCENCE ∞ kinetic ambient art stage.
 * Pure GPU-composited SVG + CSS motion graphics (pointer-events: none, z-index: 0).
 */
export const EndfieldAmbientStage: React.FC<EndfieldAmbientStageProps> = ({
  compact = false,
  isBusy = false,
}) => {
  return (
    <div
      className={`ef-ambient-stage ${compact ? 'is-compact' : ''} ${isBusy ? 'is-busy' : ''}`}
      aria-hidden="true"
    >
      {/* Layer 1: Subtle Oversized Architectural Watermark + Periodic Glitch-Bar Masks */}
      <div className="ef-bg-watermark">
        <div className="ef-wm-top">
          <span className="ef-wm-word">TIMELESS</span>
          <span className="ef-wm-glitch-a" />
          <span className="ef-wm-glitch-b" />
        </div>
        <div className="ef-wm-bottom">
          <span className="ef-wm-word">NASCENCE</span>
          <span className="ef-wm-glitch-c" />
        </div>
      </div>

      {/* Layer 2: Precision Grid Traveling Light Beams */}
      <div className="ef-grid-beams">
        <span className="ef-beam-h ef-beam-h1" />
        <span className="ef-beam-h ef-beam-h2" />
        <span className="ef-beam-v ef-beam-v1" />
        <span className="ef-beam-v ef-beam-v2" />
      </div>

      {/* Layer 3: Flowing Infinity (∞) Wireframe Ribbons + Event-Horizon Sphere + Orbital Rings */}
      <svg
        className="ef-stage-svg"
        viewBox="0 0 1200 760"
        preserveAspectRatio="xMidYMid slice"
      >
        <defs>
          {/* Event-Horizon Core & Lensing Glow */}
          <radialGradient id="efStageHorizon" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#090c16" stopOpacity="0.96" />
            <stop offset="28%" stopColor="#1e1b4b" stopOpacity="0.88" />
            <stop offset="48%" stopColor="#3b82f6" stopOpacity="0.46" />
            <stop offset="70%" stopColor="#818cf8" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="efStageCyanGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.34" />
            <stop offset="55%" stopColor="#6366f1" stopOpacity="0.12" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
          </radialGradient>

          <radialGradient id="efYellowOrb" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#fef08a" stopOpacity="1" />
            <stop offset="45%" stopColor="#facc15" stopOpacity="0.7" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0" />
          </radialGradient>

          <linearGradient id="efInfRibbonMain" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.06" />
            <stop offset="28%" stopColor="#2563eb" stopOpacity="0.32" />
            <stop offset="52%" stopColor="#818cf8" stopOpacity="0.38" />
            <stop offset="78%" stopColor="#38bdf8" stopOpacity="0.28" />
            <stop offset="100%" stopColor="#facc15" stopOpacity="0.1" />
          </linearGradient>

          <linearGradient id="efInfRibbonPulse" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.15" />
            <stop offset="50%" stopColor="#facc15" stopOpacity="0.75" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.15" />
          </linearGradient>

          {/* Reusable Infinity Loop Path */}
          <path
            id="efInfinityLoopPath"
            d="M 120 390 C 210 185, 435 185, 575 390 C 715 595, 955 595, 1065 390 C 955 185, 715 185, 575 390 C 435 595, 210 595, 120 390 Z"
          />
        </defs>

        {/* Soft ambient cyan-violet depth cloud */}
        <circle cx="240" cy="560" r="240" fill="url(#efStageCyanGlow)" className="ef-float-slow" />

        {/* Multi-strand Sweeping Infinity (∞) Wireframe Ribbons */}
        <g className="ef-infinity-group">
          <use
            href="#efInfinityLoopPath"
            fill="none"
            stroke="url(#efInfRibbonMain)"
            strokeWidth="2.2"
          />
          <path
            d="M 148 390 C 232 212, 435 212, 575 390 C 715 568, 932 568, 1038 390 C 932 212, 715 212, 575 390 C 435 568, 232 568, 148 390 Z"
            fill="none"
            stroke="url(#efInfRibbonMain)"
            strokeWidth="1.2"
            strokeDasharray="6 7"
            className="ef-dash-flow"
          />
          <use
            href="#efInfinityLoopPath"
            fill="none"
            stroke="url(#efInfRibbonPulse)"
            strokeWidth="2.6"
            strokeDasharray="110 2100"
            strokeLinecap="round"
            className="ef-energy-trace"
          />
          <use
            href="#efInfinityLoopPath"
            fill="none"
            stroke="#38bdf8"
            strokeOpacity="0.65"
            strokeWidth="2"
            strokeDasharray="60 2150"
            strokeLinecap="round"
            className="ef-energy-trace-2"
          />
        </g>

        {/* Technical Hairline Coordinate Crosshairs */}
        <g stroke="#64748b" strokeOpacity="0.22" strokeWidth="0.9">
          <line x1="940" y1="30" x2="940" y2="275" strokeDasharray="3 5" />
          <line x1="805" y1="152" x2="1085" y2="152" strokeDasharray="3 5" />
          <circle cx="940" cy="152" r="118" fill="none" strokeDasharray="2 8" />
        </g>

        {/* Upper-Right Event-Horizon Black-Hole Sphere + 3 Counter-Rotating Orbital Rings */}
        <g className="ef-horizon-cluster">
          <circle cx="940" cy="152" r="136" fill="url(#efStageHorizon)" className="ef-horizon-breathe" />

          {/* Outer slow CW coordinate ring */}
          <g className="ef-ring-cw-slow">
            <circle
              cx="940"
              cy="152"
              r="98"
              fill="none"
              stroke="#60a5fa"
              strokeOpacity="0.42"
              strokeWidth="1.1"
              strokeDasharray="38 14 8 14"
            />
            <circle cx="1038" cy="152" r="3.4" fill="#facc15" />
            <circle cx="842" cy="152" r="2.2" fill="#38bdf8" />
          </g>

          {/* Mid tilted elliptical accretion ring (CCW) */}
          <g className="ef-ring-ccw-mid">
            <ellipse
              cx="940"
              cy="152"
              rx="124"
              ry="38"
              fill="none"
              stroke="#818cf8"
              strokeOpacity="0.58"
              strokeWidth="1.5"
              transform="rotate(-24 940 152)"
            />
            <ellipse
              cx="940"
              cy="152"
              rx="108"
              ry="31"
              fill="none"
              stroke="#38bdf8"
              strokeOpacity="0.45"
              strokeWidth="1"
              strokeDasharray="16 10"
              transform="rotate(-24 940 152)"
            />
          </g>

          {/* Inner rapid ring */}
          <g className="ef-ring-cw-fast">
            <circle
              cx="940"
              cy="152"
              r="54"
              fill="none"
              stroke="#93c5fd"
              strokeOpacity="0.55"
              strokeWidth="1.2"
              strokeDasharray="18 22"
            />
          </g>

          {/* Event-horizon dark core with glowing rim */}
          <circle
            cx="940"
            cy="152"
            r="38"
            fill="#0b1020"
            stroke="#60a5fa"
            strokeWidth="2"
            strokeOpacity="0.88"
          />
          <circle
            cx="940"
            cy="152"
            r="32"
            fill="none"
            stroke="#c084fc"
            strokeWidth="1"
            strokeOpacity="0.5"
          />

          {/* Pulsing golden-cyan energy orb (homage to character's hand orb) */}
          <circle cx="868" cy="196" r="22" fill="url(#efYellowOrb)" className="ef-orb-glow" />
          <circle cx="868" cy="196" r="4.2" fill="#fef9c3" />
        </g>

        {/* Twinkling Four-Point Star Flares */}
        <g className="ef-star-twinkle-1">
          <path
            d="M 838 78 L 841 91 L 854 94 L 841 97 L 838 110 L 835 97 L 822 94 L 835 91 Z"
            fill="#facc15"
          />
        </g>
        <g className="ef-star-twinkle-2">
          <path
            d="M 1044 218 L 1046 226 L 1054 228 L 1046 230 L 1044 238 L 1042 230 L 1034 228 L 1042 226 Z"
            fill="#38bdf8"
          />
        </g>
        <g className="ef-star-twinkle-3">
          <path
            d="M 172 178 L 173.8 184.5 L 180 186.2 L 173.8 188 L 172 194.5 L 170.2 188 L 164 186.2 L 170.2 184.5 Z"
            fill="#818cf8"
          />
        </g>
      </svg>

      {/* Layer 4: Right-Edge Vertical Sci-Fi HUD Rail (Barcode + Starry Capsule + Vertical Typography) */}
      {!compact && (
        <div className="ef-hud-rail">
          <div className="ef-hud-reticle" />
          <div className="ef-hud-star-pill">
            <span className="ef-micro-star s1" />
            <span className="ef-micro-star s2" />
            <span className="ef-micro-star s3" />
            <span className="ef-micro-star s4" />
            <span className="ef-micro-star s5" />
          </div>
          <div className="ef-hud-barcode">
            <span className="b1" />
            <span className="b2" />
            <span className="b3" />
            <span className="b4" />
            <span className="b5" />
            <span className="b6" />
          </div>
          <div className="ef-hud-vtext">05 // TIMELESS NASCENCE ∞</div>
        </div>
      )}
    </div>
  );
};
