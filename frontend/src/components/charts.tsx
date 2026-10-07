import React, { useRef, useState } from 'react';
import { Icon } from './Icon';

/**
 * Lightweight HTML/CSS charts. Colors come from the validated categorical palette (--series-1..5, light and
 * dark steps in index.css), assigned in a fixed order per chart. Every mark has a hover/focus tooltip, every
 * multi-series chart has a legend with values, and every chart card offers a table view.
 */

export interface Segment {
  key: string;
  label: string;
  value: number;
  detail?: string;
}

interface TipState {
  x: number;
  y: number;
  title: string;
  lines: string[];
}

function useTooltip() {
  const ref = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<TipState | null>(null);
  const show = (e: React.MouseEvent | React.FocusEvent, title: string, lines: string[]) => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    const target = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const point = 'clientX' in e ? { x: e.clientX, y: e.clientY } : { x: target.left + target.width / 2, y: target.top };
    setTip({ x: Math.min(Math.max(point.x - box.left, 80), box.width - 80), y: point.y - box.top, title, lines });
  };
  const hide = () => setTip(null);
  const node = tip ? (
    <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">
      <div className="viz-tip-title">{tip.title}</div>
      {tip.lines.map((l) => (
        <div key={l}>{l}</div>
      ))}
    </div>
  ) : null;
  return { ref, show, hide, node };
}

/** Card wrapper with a chart/table switch (the table is the accessible and print-friendly view). */
export function ChartCard({
  title,
  subtitle,
  table,
  children,
  footer,
}: {
  title: string;
  subtitle?: React.ReactNode;
  table: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [view, setView] = useState<'chart' | 'table'>('chart');
  return (
    <section className="card chart-card">
      <header className="chart-head">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="muted small">{subtitle}</p>}
        </div>
        <div className="seg-mini" role="group" aria-label={`${title} view`}>
          <button type="button" aria-pressed={view === 'chart'} onClick={() => setView('chart')} title="Chart view">
            <Icon name="chart" size={16} />
          </button>
          <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')} title="Table view">
            <Icon name="table" size={16} />
          </button>
        </div>
      </header>
      <div className="chart-body">{view === 'chart' ? children : table}</div>
      {footer && <footer className="chart-foot">{footer}</footer>}
    </section>
  );
}

/** Single-series horizontal bars (one hue; the title names the series, so no legend). */
export function BarList({
  items,
  format = (v) => v.toLocaleString(),
  unit,
  reference,
}: {
  items: { key: string; label: string; value: number; note?: React.ReactNode; flagged?: boolean }[];
  format?: (v: number) => string;
  unit?: string;
  reference?: { value: number; label: string };
}) {
  const tip = useTooltip();
  const max = Math.max(1, reference?.value || 0, ...items.map((i) => i.value)) * 1.08;
  return (
    <div className="barlist" ref={tip.ref}>
      {reference && (
        <div className="bar-ref" style={{ left: `calc(var(--bar-label-w) + (100% - var(--bar-label-w)) * ${reference.value / max})` }} aria-hidden="true">
          <span>{reference.label}</span>
        </div>
      )}
      {items.map((item) => (
        <div key={item.key} className="bar-row">
          <div className="bar-label">
            <span>{item.label}</span>
            {item.note && <span className="bar-note">{item.note}</span>}
          </div>
          <div className="bar-track">
            <div
              className={`bar-fill${item.flagged ? ' is-flagged' : ''}`}
              style={{ width: `${(item.value / max) * 100}%` }}
              tabIndex={0}
              aria-label={`${item.label}: ${format(item.value)}${unit ? ` ${unit}` : ''}`}
              onMouseMove={(e) => tip.show(e, item.label, [`${format(item.value)}${unit ? ` ${unit}` : ''}`])}
              onFocus={(e) => tip.show(e, item.label, [`${format(item.value)}${unit ? ` ${unit}` : ''}`])}
              onMouseLeave={tip.hide}
              onBlur={tip.hide}
            />
            <span className="bar-value">{format(item.value)}</span>
          </div>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

/** Rows of stacked horizontal bars sharing one scale; categories keep a fixed color slot. */
export function StackedBars({
  rows,
  categories,
  format = (v) => v.toLocaleString(),
}: {
  rows: { key: string; label: React.ReactNode; tipLabel: string; segments: Segment[]; caption?: React.ReactNode }[];
  categories: { key: string; label: string }[];
  format?: (v: number) => string;
}) {
  const tip = useTooltip();
  const totals = rows.map((r) => r.segments.reduce((s, x) => s + x.value, 0));
  const max = Math.max(1, ...totals);
  const legendTotals = categories.map((c) => rows.reduce((s, r) => s + (r.segments.find((x) => x.key === c.key)?.value || 0), 0));
  return (
    <div className="stacked" ref={tip.ref}>
      <ul className="viz-legend">
        {categories.map((c, i) => (
          <li key={c.key}>
            <span className={`swatch s${i + 1}`} aria-hidden="true" />
            {c.label}
            <strong>{format(legendTotals[i])}</strong>
          </li>
        ))}
      </ul>
      {rows.map((row, ri) => (
        <div key={row.key} className="bar-row">
          <div className="bar-label">
            <span>{row.label}</span>
            {row.caption && <span className="bar-note">{row.caption}</span>}
          </div>
          <div className="bar-track">
            <div className="stack-fill" style={{ width: `${(totals[ri] / max) * 100}%` }}>
              {categories.map((c, i) => {
                const seg = row.segments.find((x) => x.key === c.key);
                if (!seg || seg.value <= 0) return null;
                const lines = [format(seg.value), ...(seg.detail ? [seg.detail] : [])];
                return (
                  <div
                    key={c.key}
                    className={`stack-seg s${i + 1}`}
                    style={{ flexGrow: seg.value }}
                    tabIndex={0}
                    aria-label={`${row.tipLabel}, ${c.label}: ${lines.join(', ')}`}
                    onMouseMove={(e) => tip.show(e, `${row.tipLabel} · ${c.label}`, lines)}
                    onFocus={(e) => tip.show(e, `${row.tipLabel} · ${c.label}`, lines)}
                    onMouseLeave={tip.hide}
                    onBlur={tip.hide}
                  />
                );
              })}
            </div>
            <span className="bar-value">{format(totals[ri])}</span>
          </div>
        </div>
      ))}
      {tip.node}
    </div>
  );
}

/** A labelled ring for a single proportion (e.g. work-log completeness). */
export function Ring({ value, total, label }: { value: number; total: number; label: string }) {
  const pct = total > 0 ? value / total : 0;
  const r = 42;
  const c = 2 * Math.PI * r;
  return (
    <figure className="ring" aria-label={`${label}: ${Math.round(pct * 100)}% (${value} of ${total})`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={r} className="ring-track" />
        <circle cx="50" cy="50" r={r} className="ring-value" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 50 50)" />
      </svg>
      <figcaption>
        <strong>{Math.round(pct * 100)}%</strong>
        <span>{label}</span>
      </figcaption>
    </figure>
  );
}
