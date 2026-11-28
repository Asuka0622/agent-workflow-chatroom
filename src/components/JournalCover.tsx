import React, { useMemo } from 'react';
import type { WorkflowRun } from '../../shared/types';
import { BRAND } from '../brand';
import { useI18n } from '../i18n';
import { RinneMascot } from './RinneMascot';
import { EventHorizonEye } from './EventHorizonEye';

/** One "issue" of the journal = one chat room */
export interface CoverIssue {
  no: number;
  title: string;
  createdAt?: string;
  workspace: string;
  statusLabel: string;
  messageCount: number;
  requirement?: string;
}

/** A workflow step, listed as a contents line */
export interface CoverStep {
  id: string;
  title: string;
  owner: string;
}

interface QuickAction {
  label: string;
  onPick: () => void;
}

interface JournalCoverProps {
  showRinne: boolean;
  issue: CoverIssue;
  workflowName: string;
  steps: CoverStep[];
  quickActions: QuickAction[];
  onOpenSteps: () => void;
  runs: WorkflowRun[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CJK = /[㐀-鿿豈-﫿]/;

function dateStamp(iso?: string) {
  const d = iso ? new Date(iso) : new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** Fit the masthead: shrink long titles, allow two lines for very long ones */
function mastheadFit(title: string) {
  const isCjk = CJK.test(title);
  const len = Array.from(title).length;
  // Characters that fit one line at full size (Song ≈ 1em per glyph, Bodoni ≈ 0.6em)
  const perLine = isCjk ? 5.6 : 7.6;
  const lines = len > perLine * 1.9 ? 2 : 1;
  // Two-line titles get a little extra headroom so the cover stays on one screen
  const room = perLine * lines * (lines === 2 ? 0.86 : 1);
  const scale = Math.max(0.3, Math.min(1, room / Math.max(1, len)));
  return { isCjk, scale };
}

/** Short vertical tagline from the workflow name (drop parenthetical notes) */
function verticalTag(name: string) {
  const clean = name.replace(/[（(].*?[）)]/g, '').trim();
  return clean && Array.from(clean).length <= 10 ? clean : BRAND.vertical;
}

/** FIG.2 numbers: messages per day over the last 7 days, across every room */
function useDaily(runs: WorkflowRun[]) {
  return useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Array.from({ length: 7 }, (_, i) => ({ t: today.getTime() - (6 - i) * DAY_MS, n: 0 }));
    for (const run of runs) {
      for (const m of run.messages || []) {
        if (m.role === 'system') continue;
        const idx = Math.floor((new Date(m.createdAt).getTime() - days[0].t) / DAY_MS);
        if (idx >= 0 && idx < 7) days[idx].n += 1;
      }
    }
    return days;
  }, [runs]);
}

/** FIG.1 — this issue's lineup: how many workflow steps each member owns */
const LineupPlate: React.FC<{ steps: CoverStep[] }> = ({ steps }) => {
  const { tr } = useI18n();
  const owners = useMemo(() => {
    const m = new Map<string, number>();
    steps.forEach((s) => m.set(s.owner, (m.get(s.owner) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [steps]);
  const max = Math.max(1, ...owners.map(([, n]) => n));
  return (
    <figure className="jr-plate is-tilt-l">
      <div className="jr-plate-art">
        {owners.length === 0 ? (
          <p className="jr-plate-empty">{tr('还没有配置工作流步骤。', 'No workflow steps configured yet.')}</p>
        ) : (
          <svg viewBox="0 0 240 104" className="jr-chart">
            {owners.map(([name, n], i) => {
              const y = 6 + i * 20;
              const w = (n / max) * 150;
              return (
                <g key={name}>
                  <text x="0" y={y + 9} className="jr-chart-label">
                    {name.length > 9 ? `${name.slice(0, 8)}…` : name}
                  </text>
                  <line x1="70" y1={y + 6} x2="226" y2={y + 6} className="jr-chart-track" />
                  <rect x="70" y={y + 2} width={Math.max(2, w)} height="8" className="jr-chart-bar" />
                  <text x={74 + w} y={y + 9.5} className="jr-chart-num">
                    {n}
                  </text>
                </g>
              );
            })}
          </svg>
        )}
      </div>
      <figcaption>
        <b>FIG.1</b> {tr('本期阵容', 'Lineup')} <span>steps per member</span>
      </figcaption>
    </figure>
  );
};

/** FIG.2 — columns, messages per day over the last 7 days */
const DailyPlate: React.FC<{ days: { t: number; n: number }[] }> = ({ days }) => {
  const { tr } = useI18n();
  const max = Math.max(1, ...days.map((d) => d.n));
  const label = (t: number) => {
    const d = new Date(t);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };
  return (
    <figure className="jr-plate is-tilt-r">
      <div className="jr-plate-art">
        <svg viewBox="0 0 240 104" className="jr-chart">
          <line x1="0" y1="84" x2="240" y2="84" className="jr-chart-axis" />
          {days.map((d, i) => {
            const h = (d.n / max) * 66;
            const x = 8 + i * 33;
            return (
              <g key={d.t}>
                <rect x={x} y={84 - Math.max(1, h)} width="18" height={Math.max(1, h)} className="jr-chart-bar" />
                {d.n > 0 && (
                  <text x={x + 9} y={80 - h} textAnchor="middle" className="jr-chart-num">
                    {d.n}
                  </text>
                )}
                <text x={x + 9} y="98" textAnchor="middle" className="jr-chart-label">
                  {label(d.t)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <figcaption>
        <b>FIG.2</b> {tr('近 7 日消息量', '7-Day Activity')} <span>messages per day</span>
      </figcaption>
    </figure>
  );
};

/**
 * Empty-room hero as a journal cover. Each room is one issue: the room name is the masthead,
 * the active workflow's steps are the contents, and the plates show real numbers.
 */
export const JournalCover: React.FC<JournalCoverProps> = ({
  showRinne,
  issue,
  workflowName,
  steps,
  quickActions,
  onOpenSteps,
  runs,
}) => {
  const { isEn, tr } = useI18n();
  const days = useDaily(runs);
  const fit = mastheadFit(issue.title);
  const issueNo = `No.${String(issue.no).padStart(2, '0')}`;
  const brief = issue.requirement?.trim();

  return (
    <section className="jr-cover has-rinne">
      {showRinne ? (
        <RinneMascot variant="hero" />
      ) : (
        <div className="rinne rinne-hero is-eye-only" aria-hidden="true">
          <EventHorizonEye className="rinne-halo" />
        </div>
      )}

      <header className="jr-folio">
        <span className="jr-folio-brand">{BRAND.title}</span>
        <span className="jr-folio-sep">—</span>
        <span>{issueNo}</span>
        <span className="jr-folio-sep">—</span>
        <span>{dateStamp(issue.createdAt)}</span>
        <span className="jr-folio-sep">—</span>
        <span className="jr-folio-mid">{issue.workspace}</span>
      </header>

      <h1
        className={`jr-masthead ${fit.isCjk ? 'is-cjk' : ''}`}
        style={{ '--mh-scale': fit.scale } as React.CSSProperties}
        title={issue.title}
      >
        {issue.title}
      </h1>

      <div className="jr-issue">
        <span>
          {workflowName} · {isEn ? `${steps.length} stages` : `${steps.length} 个板块`}
        </span>
        <span>
          {issue.statusLabel} · {isEn ? `${issue.messageCount} messages` : `${issue.messageCount} 条消息`}
        </span>
      </div>

      <div className="jr-body">
        <div className="jr-lead">
          <span className="jr-kicker">
            {brief ? tr('本期需求 · BRIEF', 'CURRENT BRIEF') : BRAND.kicker}
          </span>
          {brief ? (
            <p className="jr-brief">{brief}</p>
          ) : (
            <>
              <h2 className="jr-headline">
                {isEn ? (
                  <>
                    One local room,
                    <br />
                    every model in sync.
                  </>
                ) : (
                  <>
                    {BRAND.headline[0]}
                    <br />
                    {BRAND.headline[1]}
                  </>
                )}
              </h2>
              <p className="jr-dek">
                {isEn
                  ? 'Mention models in parallel, run visual multi-step DAGs, and keep all code & keys strictly on localhost.'
                  : BRAND.dek}
              </p>
            </>
          )}
          <div className="jr-quick">
            <span className="jr-quick-label">{tr('快速开始', 'Quick Start')}</span>
            {quickActions.map((a) => (
              <button key={a.label} type="button" className="jr-quick-btn" onClick={a.onPick}>
                {a.label}
              </button>
            ))}
          </div>
        </div>

        <nav className="jr-contents" aria-label={tr('工作流步骤', 'Workflow Steps')}>
          <button
            type="button"
            className="jr-contents-head"
            onClick={onOpenSteps}
            title={tr('在画布中打开工作流', 'Open workflow in canvas')}
          >
            {tr('本期 · CONTENTS', 'STEPS · CONTENTS')} <span>{tr('打开画布 →', 'Open Canvas →')}</span>
          </button>
          {steps.map((step, i) => (
            <button key={step.id} type="button" className="jr-step" onClick={onOpenSteps}>
              <span className="jr-step-no">{String(i + 1).padStart(2, '0')}</span>
              <span className="jr-step-title">{step.title}</span>
              <span className="jr-step-leader" aria-hidden="true" />
              <span className="jr-step-owner">{step.owner}</span>
            </button>
          ))}
        </nav>

        <aside className="jr-aside" aria-hidden="true">
          <div className="jr-vertical">{verticalTag(workflowName)}</div>
          <div className="jr-barcode">
            <span />
            <em>
              {issueNo} {dateStamp(issue.createdAt).replace(/\./g, '')}
            </em>
          </div>
        </aside>
      </div>

      <div className="jr-plates">
        <LineupPlate steps={steps} />
        <DailyPlate days={days} />
      </div>
    </section>
  );
};
