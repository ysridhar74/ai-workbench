/**
 * Generative UI Component Registry
 *
 * The AI model can trigger any component in this registry by emitting:
 *   <ui:ComponentName>{ ...json props }</ui:ComponentName>
 *
 * Adding a new component:
 *   1. Build it below (or import from a separate file)
 *   2. Register it in COMPONENT_REGISTRY at the bottom
 *   3. Add its props example to the system prompt (skills/definitions/starter-skills.ts)
 */

import React, { useState } from 'react';
import type { UIComponent } from '../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Shared helpers
// ─────────────────────────────────────────────────────────────────────────────

const PALETTE = [
  '#6366f1', '#22d3ee', '#f59e0b', '#10b981', '#f43f5e',
  '#8b5cf6', '#0ea5e9', '#84cc16', '#fb923c', '#ec4899',
];

function fmt(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'number') return v.toLocaleString();
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (v instanceof Date) return v.toLocaleDateString();
  if (Array.isArray(v)) {
    // Array of primitives → comma-joined
    if (v.every(x => x === null || typeof x !== 'object')) {
      return v.map(x => (x === null || x === undefined ? '—' : String(x))).join(', ');
    }
    // Array of objects → compact JSON (truncated)
    const json = JSON.stringify(v);
    return json.length > 120 ? json.slice(0, 118) + '…' : json;
  }
  if (typeof v === 'object') {
    const json = JSON.stringify(v);
    return json.length > 120 ? json.slice(0, 118) + '…' : json;
  }
  return String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// TableCell — smart cell renderer for DataTable
// Scalar values render as plain text; arrays/objects get an expandable JSON popover
// ─────────────────────────────────────────────────────────────────────────────

function TableCell({ value }: { value: unknown }) {
  const [open, setOpen] = useState(false);

  const isComplex = value !== null && typeof value === 'object';

  if (!isComplex) {
    return <span className="truncate block max-w-xs">{fmt(value)}</span>;
  }

  // Shallow plain object → render as a compact inline key-value list, no popover needed
  if (isShallowObject(value)) {
    const entries = Object.entries(value as Record<string, unknown>);
    return (
      <dl className="space-y-0.5 min-w-[120px]">
        {entries.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-1.5">
            <dt className="text-[10px] text-slate-400 shrink-0 capitalize">{k.replace(/_/g, ' ')}:</dt>
            <dd className="text-[11px] font-medium text-slate-700 truncate">{fmt(v)}</dd>
          </div>
        ))}
      </dl>
    );
  }

  const isArr = Array.isArray(value);
  const count = isArr ? (value as unknown[]).length : Object.keys(value as object).length;
  const label = isArr ? `[${count} item${count !== 1 ? 's' : ''}]` : `{${count} key${count !== 1 ? 's' : ''}}`;
  const json = JSON.stringify(value, null, 2);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-indigo-50 text-indigo-600 border border-indigo-200 hover:bg-indigo-100 transition-colors whitespace-nowrap"
      >
        {label} {open ? '▴' : '▾'}
      </button>
      {open && (
        <div className="absolute z-20 top-6 left-0 w-80 rounded-lg border border-slate-200 bg-white shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200">
            <span className="text-[10px] font-mono text-slate-500">{label}</span>
            <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600 text-xs leading-none">✕</button>
          </div>
          <pre className="text-[11px] font-mono text-slate-700 p-3 overflow-auto max-h-64 whitespace-pre-wrap break-words leading-relaxed">
            {json}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// DataTable
// Props: { title?, columns: string[], rows: unknown[][], caption? }
// or:    { title?, data: Record<string,unknown>[] }   (auto-detect columns)
// ─────────────────────────────────────────────────────────────────────────────

interface DataTableProps {
  title?: string;
  caption?: string;
  columns?: string[];
  rows?: unknown[][];
  data?: Record<string, unknown>[];
}

function DataTable({ title, caption, columns, rows, data }: DataTableProps) {
  const [sortCol, setSortCol] = useState<number | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [page, setPage] = useState(0);
  const PAGE_SIZE = 20;

  // Normalise: if `data` array provided, extract columns + rows
  let cols: string[] = columns ?? [];
  let rawRows: unknown[][] = rows ?? [];

  if (data && data.length > 0) {
    cols = Array.from(new Set(data.flatMap(r => Object.keys(r))));
    rawRows = data.map(r => cols.map(c => r[c] ?? null));
  }

  // Sort
  let sorted = [...rawRows];
  if (sortCol !== null) {
    sorted.sort((a, b) => {
      const av = a[sortCol]; const bv = b[sortCol];
      const cmp = String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }

  const totalPages = Math.ceil(sorted.length / PAGE_SIZE);
  const pageRows = sorted.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const toggleSort = (i: number) => {
    if (sortCol === i) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(i); setSortDir('asc'); }
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm my-3">
      {(title || caption) && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
          {caption && <p className="text-xs text-slate-500 mt-0.5">{caption}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              {cols.map((col, i) => (
                <th
                  key={i}
                  onClick={() => toggleSort(i)}
                  className="px-3 py-2 text-left font-medium text-slate-600 cursor-pointer select-none whitespace-nowrap hover:bg-slate-100"
                >
                  {col}
                  {sortCol === i && <span className="ml-1 text-indigo-500">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                {row.map((cell, ci) => (
                  <td key={ci} className="px-3 py-2 text-slate-700 border-b border-slate-100 max-w-xs">
                    <TableCell value={cell} />
                  </td>
                ))}
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr><td colSpan={cols.length} className="px-3 py-4 text-center text-slate-400">No results</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-2 border-t border-slate-100 text-xs text-slate-500">
          <span>{sorted.length} rows · page {page + 1}/{totalPages}</span>
          <div className="flex gap-1">
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">←</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page === totalPages - 1}
              className="px-2 py-1 rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50">→</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// StatsDashboard
// Props: { title?, stats: Array<{ label, value, delta?, unit?, color? }> }
// ─────────────────────────────────────────────────────────────────────────────

interface StatItem {
  label: string;
  value: string | number;
  delta?: number;   // positive = up, negative = down
  unit?: string;    // e.g. "%", "$", "ms"
  color?: string;   // hex or tailwind color name
  icon?: string;    // emoji
}

interface StatsDashboardProps {
  title?: string;
  stats: StatItem[];
}

function StatsDashboard({ title, stats }: StatsDashboardProps) {
  return (
    <div className="my-3">
      {title && <h3 className="text-sm font-semibold text-slate-700 mb-2">{title}</h3>}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {stats.map((s, i) => {
          const accent = s.color ?? PALETTE[i % PALETTE.length];
          const deltaUp = s.delta !== undefined && s.delta > 0;
          const deltaDown = s.delta !== undefined && s.delta < 0;
          return (
            <div key={i} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
              style={{ borderLeftWidth: 3, borderLeftColor: accent }}>
              <div className="flex items-start justify-between">
                <p className="text-xs text-slate-500 leading-tight">{s.label}</p>
                {s.icon && <span className="text-lg">{s.icon}</span>}
              </div>
              <p className="mt-1.5 text-2xl font-bold text-slate-800 tabular-nums">
                {fmt(s.value)}{s.unit && <span className="text-sm font-medium text-slate-400 ml-1">{s.unit}</span>}
              </p>
              {s.delta !== undefined && (
                <p className={`mt-1 text-xs font-medium ${deltaUp ? 'text-emerald-600' : deltaDown ? 'text-rose-500' : 'text-slate-400'}`}>
                  {deltaUp ? '▲' : deltaDown ? '▼' : '–'} {Math.abs(s.delta).toLocaleString()}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// BarChart
// Props: { title?, data: Array<{ label, value, color? }>, xLabel?, yLabel?, horizontal? }
// ─────────────────────────────────────────────────────────────────────────────

interface BarChartProps {
  title?: string;
  data: Array<{ label: string; value: number; color?: string }>;
  xLabel?: string;
  yLabel?: string;
  horizontal?: boolean;
}

function BarChart({ title, data, xLabel, yLabel, horizontal }: BarChartProps) {
  if (!data || data.length === 0) return null;
  const max = Math.max(...data.map(d => d.value));

  if (horizontal) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm my-3">
        {title && <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>}
        <div className="space-y-2">
          {data.map((d, i) => {
            const pct = max > 0 ? (d.value / max) * 100 : 0;
            const color = d.color ?? PALETTE[i % PALETTE.length];
            return (
              <div key={i} className="flex items-center gap-2">
                <span className="text-xs text-slate-500 w-28 truncate text-right shrink-0">{d.label}</span>
                <div className="flex-1 h-5 bg-slate-100 rounded overflow-hidden">
                  <div className="h-full rounded transition-all" style={{ width: `${pct}%`, backgroundColor: color }} />
                </div>
                <span className="text-xs font-medium text-slate-600 w-16 text-right shrink-0">{d.value.toLocaleString()}</span>
              </div>
            );
          })}
        </div>
        {xLabel && <p className="text-xs text-slate-400 text-center mt-2">{xLabel}</p>}
      </div>
    );
  }

  const chartH = 160;
  const barW = Math.max(24, Math.min(60, Math.floor(480 / data.length) - 8));
  const gap = 8;
  const totalW = data.length * (barW + gap) - gap;

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm my-3 overflow-x-auto">
      {title && <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>}
      {yLabel && <p className="text-xs text-slate-400 mb-1">{yLabel}</p>}
      <svg viewBox={`0 0 ${totalW + 4} ${chartH + 32}`} width={totalW + 4} height={chartH + 32}>
        {data.map((d, i) => {
          const barH = max > 0 ? Math.max(2, (d.value / max) * chartH) : 2;
          const x = i * (barW + gap);
          const y = chartH - barH;
          const color = d.color ?? PALETTE[i % PALETTE.length];
          return (
            <g key={i}>
              <rect x={x} y={y} width={barW} height={barH} fill={color} rx={3} opacity={0.9} />
              <text x={x + barW / 2} y={y - 3} textAnchor="middle" fontSize={9} fill="#64748b">
                {d.value.toLocaleString()}
              </text>
              <text x={x + barW / 2} y={chartH + 14} textAnchor="middle" fontSize={9} fill="#94a3b8">
                {d.label.length > 8 ? d.label.slice(0, 8) + '…' : d.label}
              </text>
            </g>
          );
        })}
      </svg>
      {xLabel && <p className="text-xs text-slate-400 text-center">{xLabel}</p>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EntityCard
// Props: { title, subtitle?, badge?, badgeColor?, fields: Record<string,unknown>, tags? }
// ─────────────────────────────────────────────────────────────────────────────

interface EntityCardProps {
  title: string;
  subtitle?: string;
  badge?: string;
  badgeColor?: string;
  fields: Record<string, unknown>;
  tags?: string[];
}

/** Returns true if every own value in an object is a scalar (not array/object) */
function isShallowObject(v: unknown): v is Record<string, unknown> {
  return (
    v !== null &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    Object.values(v as object).every(x => x === null || typeof x !== 'object')
  );
}

/**
 * Returns true if this is a plain object that has SOME scalar keys and SOME
 * array/object keys — e.g. financials: { currentFiscalYear, annualReports[], valuation{} }
 * We render scalars inline, then each child array/object as its own expandable sub-section.
 */
function isMixedObject(v: unknown): v is Record<string, unknown> {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const vals = Object.values(v as object);
  const hasScalar = vals.some(x => x === null || typeof x !== 'object');
  const hasComplex = vals.some(x => x !== null && typeof x === 'object');
  return hasScalar || hasComplex; // catches any non-shallow object that isn't an array
}

/** Mini expandable sub-section used inside MixedObjectField */
function SubSection({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const humanLabel = label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const arr = Array.isArray(value) ? value as Record<string, unknown>[] : null;
  const isArrOfObjects = arr !== null && arr.length > 0 &&
    arr.every(x => x !== null && typeof x === 'object' && !Array.isArray(x));

  if (isArrOfObjects) {
    const cols = Array.from(new Set(arr!.flatMap(r => Object.keys(r))));
    return (
      <div>
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide hover:text-indigo-600 transition-colors mb-1"
        >
          <span>{humanLabel}</span>
          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 font-mono normal-case tracking-normal text-[10px]">
            {arr!.length} item{arr!.length !== 1 ? 's' : ''}
          </span>
          <span className="text-slate-400">{open ? '▴' : '▾'}</span>
        </button>
        {open && (
          <div className="rounded-lg border border-slate-200 overflow-hidden mb-2">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map(col => (
                    <th key={col} className="px-3 py-1.5 text-left font-medium text-slate-500 whitespace-nowrap">
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {arr!.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    {cols.map(col => (
                      <td key={col} className="px-3 py-1.5 text-slate-700 border-b border-slate-100">
                        <TableCell value={row[col] ?? null} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  if (isShallowObject(value)) {
    const subEntries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="mb-2">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">{humanLabel}</p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-1 pl-3 border-l-2 border-indigo-100">
          {subEntries.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 min-w-0">
              <p className="text-[10px] text-slate-400 capitalize">{k.replace(/_/g, ' ')}</p>
              <p className="text-xs font-medium text-slate-700 break-words">{fmt(v)}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // fallback: collapsible JSON
  return (
    <div className="mb-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide hover:text-indigo-600 transition-colors"
      >
        <span>{humanLabel}</span>
        <span className="text-slate-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <pre className="mt-1 text-[11px] font-mono text-slate-700 p-2 rounded border border-slate-200 overflow-auto max-h-36 whitespace-pre-wrap break-words bg-slate-50">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

function EntityCardField({ label, value }: { label: string; value: unknown }) {
  const [open, setOpen] = useState(false);
  const isComplex = value !== null && typeof value === 'object';
  const humanLabel = label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // ── Tier 1: Scalar ────────────────────────────────────────────────────────
  if (!isComplex) {
    return (
      <div className="flex flex-col gap-0.5 min-w-0">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{humanLabel}</p>
        <p className="text-xs font-medium text-slate-700 break-words">{fmt(value)}</p>
      </div>
    );
  }

  // ── Tier 2: Shallow plain object (e.g. headquarters: {city, state, country}) ──
  // Every value is scalar — render as inline sub-grid, no expand needed
  if (isShallowObject(value)) {
    const subEntries = Object.entries(value as Record<string, unknown>);
    return (
      <div className="col-span-2">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{humanLabel}</p>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2 pl-3 border-l-2 border-indigo-100">
          {subEntries.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 min-w-0">
              <p className="text-[10px] text-slate-400 capitalize">{k.replace(/_/g, ' ')}</p>
              <p className="text-xs font-medium text-slate-700 break-words">{fmt(v)}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Tier 3: Array of objects (e.g. addresses: [{type, street, ...}]) ──────
  // Expandable mini-table
  const arr = Array.isArray(value) ? value as Record<string, unknown>[] : null;
  const isArrOfObjects = arr !== null && arr.length > 0 &&
    arr.every(x => x !== null && typeof x === 'object' && !Array.isArray(x));

  if (isArrOfObjects) {
    const cols = Array.from(new Set(arr!.flatMap(r => Object.keys(r))));
    return (
      <div className="col-span-2">
        <button
          onClick={() => setOpen(o => !o)}
          className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide hover:text-indigo-600 transition-colors mb-2"
        >
          <span>{humanLabel}</span>
          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 font-mono normal-case tracking-normal">
            {arr!.length} item{arr!.length !== 1 ? 's' : ''}
          </span>
          <span className="text-slate-400">{open ? '▴' : '▾'}</span>
        </button>
        {open && (
          <div className="rounded-lg border border-slate-200 overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {cols.map(col => (
                    <th key={col} className="px-3 py-1.5 text-left font-medium text-slate-500 whitespace-nowrap">
                      {col.replace(/_/g, ' ')}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {arr!.map((row, ri) => (
                  <tr key={ri} className={ri % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                    {cols.map(col => (
                      <td key={col} className="px-3 py-1.5 text-slate-700 border-b border-slate-100">
                        <TableCell value={row[col] ?? null} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  // ── Tier 4: Mixed object — has scalars AND nested arrays/objects ──────────
  // e.g. financials: { currentFiscalYear: 2025, annualReports: [...], valuation: {...} }
  // Render scalar keys as an inline sub-grid, then each complex child as a SubSection
  if (!Array.isArray(value) && isMixedObject(value)) {
    const obj = value as Record<string, unknown>;
    const scalarEntries = Object.entries(obj).filter(([, v]) => v === null || typeof v !== 'object');
    const complexEntries = Object.entries(obj).filter(([, v]) => v !== null && typeof v === 'object');
    return (
      <div className="col-span-2">
        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">{humanLabel}</p>
        <div className="pl-3 border-l-2 border-indigo-100 space-y-3">
          {scalarEntries.length > 0 && (
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {scalarEntries.map(([k, v]) => (
                <div key={k} className="flex flex-col gap-0.5 min-w-0">
                  <p className="text-[10px] text-slate-400 capitalize">{k.replace(/_/g, ' ')}</p>
                  <p className="text-xs font-medium text-slate-700 break-words">{fmt(v)}</p>
                </div>
              ))}
            </div>
          )}
          {complexEntries.map(([k, v]) => (
            <SubSection key={k} label={k} value={v} />
          ))}
        </div>
      </div>
    );
  }

  // ── Tier 5: Fallback — deeply nested or scalar array → collapsible JSON ───
  const label2 = Array.isArray(value)
    ? `[${(value as unknown[]).length} items]`
    : `{${Object.keys(value as object).length} keys}`;
  return (
    <div className="col-span-2">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-wide hover:text-indigo-600 transition-colors"
      >
        <span>{humanLabel}</span>
        <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-500 font-mono normal-case tracking-normal">{label2}</span>
        <span className="text-slate-400">{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <pre className="mt-2 text-[11px] font-mono text-slate-700 p-3 rounded-lg border border-slate-200 overflow-auto max-h-48 whitespace-pre-wrap break-words leading-relaxed bg-slate-50">
          {JSON.stringify(value, null, 2)}
        </pre>
      )}
    </div>
  );
}

/** Render a single cell value to an HTML string for the print window */
function valueToHtml(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value !== 'object') return String(fmt(value));

  // Shallow object → comma-separated key: value pairs
  if (isShallowObject(value)) {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `<span class="kv"><span class="kv-key">${k.replace(/_/g, ' ')}:</span> ${fmt(v)}</span>`)
      .join('');
  }

  // Array of primitives
  if (Array.isArray(value) && value.every(x => x === null || typeof x !== 'object')) {
    return (value as unknown[]).map(x => fmt(x)).join(', ') || '—';
  }

  return ''; // complex — handled at field level
}

/** Render an array-of-objects as an HTML table string */
function arrToTable(arr: Record<string, unknown>[]): string {
  const cols = Array.from(new Set(arr.flatMap(r => Object.keys(r))));
  const thead = cols.map(c => `<th>${c.replace(/_/g, ' ')}</th>`).join('');
  const tbody = arr.map(row =>
    `<tr>${cols.map(c => {
      const v = row[c] ?? null;
      // nested shallow object inside table cell — render inline
      if (isShallowObject(v)) {
        return `<td>${Object.entries(v as Record<string, unknown>).map(([k2, v2]) => `<span class="kv"><span class="kv-key">${k2.replace(/_/g, ' ')}:</span> ${fmt(v2)}</span>`).join('')}</td>`;
      }
      return `<td>${fmt(v)}</td>`;
    }).join('')}</tr>`
  ).join('');
  return `<table><thead><tr>${thead}</tr></thead><tbody>${tbody}</tbody></table>`;
}

/** Serialise an EntityCard's fields to clean HTML for the print window */
function fieldToHtml(label: string, value: unknown): string {
  const humanLabel = label.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  // ── Scalar ───────────────────────────────────────────────────────────────
  if (value === null || value === undefined || typeof value !== 'object') {
    return `<div class="field"><span class="label">${humanLabel}</span><span class="value">${fmt(value)}</span></div>`;
  }

  // ── Shallow object (e.g. headquarters, leadership, contactInfo) ───────────
  if (isShallowObject(value)) {
    const rows = Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `<div class="subfield"><span class="sublabel">${k.replace(/_/g, ' ')}</span><span class="value">${fmt(v)}</span></div>`)
      .join('');
    return `<div class="field full"><span class="label">${humanLabel}</span><div class="subgrid">${rows}</div></div>`;
  }

  // ── Array of objects (e.g. annualReports, departments) ───────────────────
  const arr = Array.isArray(value) ? value as Record<string, unknown>[] : null;
  if (arr !== null && arr.length > 0 && arr.every(x => x !== null && typeof x === 'object' && !Array.isArray(x))) {
    return `<div class="field full"><span class="label">${humanLabel}</span>${arrToTable(arr)}</div>`;
  }

  // ── Mixed object (e.g. financials: {currentFiscalYear, annualReports[], valuation{}}) ──
  if (!Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    const scalarEntries = Object.entries(obj).filter(([, v]) => v === null || typeof v !== 'object');
    const complexEntries = Object.entries(obj).filter(([, v]) => v !== null && typeof v === 'object');

    let inner = '';

    // Scalar sub-fields as a mini grid
    if (scalarEntries.length > 0) {
      inner += `<div class="subgrid">${scalarEntries.map(([k, v]) =>
        `<div class="subfield"><span class="sublabel">${k.replace(/_/g, ' ')}</span><span class="value">${fmt(v)}</span></div>`
      ).join('')}</div>`;
    }

    // Complex sub-fields recursively
    for (const [k, v] of complexEntries) {
      const subLabel = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      const subArr = Array.isArray(v) ? v as Record<string, unknown>[] : null;

      if (subArr !== null && subArr.length > 0 && subArr.every(x => x !== null && typeof x === 'object' && !Array.isArray(x))) {
        inner += `<div class="subsection"><span class="sublabel-heading">${subLabel}</span>${arrToTable(subArr)}</div>`;
      } else if (isShallowObject(v)) {
        const rows = Object.entries(v as Record<string, unknown>)
          .map(([k2, v2]) => `<div class="subfield"><span class="sublabel">${k2.replace(/_/g, ' ')}</span><span class="value">${fmt(v2)}</span></div>`)
          .join('');
        inner += `<div class="subsection"><span class="sublabel-heading">${subLabel}</span><div class="subgrid">${rows}</div></div>`;
      } else {
        inner += `<div class="subsection"><span class="sublabel-heading">${subLabel}</span><pre>${JSON.stringify(v, null, 2)}</pre></div>`;
      }
    }

    return `<div class="field full"><span class="label">${humanLabel}</span><div class="mixed-body">${inner}</div></div>`;
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  return `<div class="field full"><span class="label">${humanLabel}</span><pre>${JSON.stringify(value, null, 2)}</pre></div>`;
}

function printEntityCard(title: string, subtitle: string | undefined, badge: string | undefined, badgeColor: string | undefined, tags: string[] | undefined, fields: Record<string, unknown>) {
  const fieldsHtml = Object.entries(fields).map(([k, v]) => fieldToHtml(k, v)).join('');
  const tagsHtml = tags && tags.length > 0
    ? tags.map(t => `<span class="tag">${t}</span>`).join('')
    : '';
  const badgeHtml = badge
    ? `<span class="badge" style="background:${badgeColor ?? '#6366f1'}">${badge}</span>`
    : '';

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 12px; color: #1e293b; padding: 32px; }
  .card { border: 1px solid #e2e8f0; border-radius: 10px; overflow: hidden; }
  .header { background: linear-gradient(to right, #eef2ff, #fff); padding: 16px 20px; border-bottom: 1px solid #e2e8f0; display: flex; justify-content: space-between; align-items: flex-start; }
  .header-left h1 { font-size: 15px; font-weight: 700; color: #1e293b; }
  .header-left p { font-size: 11px; color: #64748b; margin-top: 3px; }
  .tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 6px; }
  .tag { background: #e0e7ff; color: #4338ca; font-size: 10px; padding: 2px 8px; border-radius: 999px; }
  .badge { color: #fff; font-size: 10px; font-weight: 700; padding: 3px 10px; border-radius: 999px; white-space: nowrap; }
  .body { padding: 16px 20px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px 24px; }
  .field { display: flex; flex-direction: column; gap: 2px; }
  .field.full { grid-column: 1 / -1; }
  .label { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #94a3b8; }
  .value { font-size: 11px; font-weight: 500; color: #334155; word-break: break-word; }
  .subgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px 16px; margin-top: 4px; padding-left: 10px; border-left: 2px solid #c7d2fe; }
  .subfield { display: flex; flex-direction: column; gap: 1px; }
  .sublabel { font-size: 9px; color: #94a3b8; text-transform: capitalize; }
  table { width: 100%; border-collapse: collapse; font-size: 10px; margin-top: 6px; }
  th { background: #f8fafc; padding: 5px 8px; text-align: left; font-weight: 600; color: #64748b; border-bottom: 1px solid #e2e8f0; white-space: nowrap; }
  td { padding: 4px 8px; color: #334155; border-bottom: 1px solid #f1f5f9; }
  tr:last-child td { border-bottom: none; }
  pre { font-family: 'Courier New', monospace; font-size: 10px; background: #f8fafc; padding: 8px; border-radius: 4px; border: 1px solid #e2e8f0; white-space: pre-wrap; word-break: break-word; margin-top: 4px; }
  .kv { display: inline-block; margin-right: 10px; font-size: 11px; color: #334155; }
  .kv-key { font-size: 9px; font-weight: 600; color: #94a3b8; text-transform: capitalize; margin-right: 2px; }
  .mixed-body { display: flex; flex-direction: column; gap: 10px; margin-top: 4px; padding-left: 10px; border-left: 2px solid #c7d2fe; }
  .subsection { display: flex; flex-direction: column; gap: 4px; }
  .sublabel-heading { font-size: 9px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #6366f1; }
  .footer { margin-top: 20px; font-size: 9px; color: #94a3b8; text-align: right; }
  @media print {
    body { padding: 0; }
    @page { margin: 20mm; }
  }
</style>
</head>
<body>
<div class="card">
  <div class="header">
    <div class="header-left">
      <h1>${title}</h1>
      ${subtitle ? `<p>${subtitle}</p>` : ''}
      ${tagsHtml ? `<div class="tags">${tagsHtml}</div>` : ''}
    </div>
    ${badgeHtml}
  </div>
  <div class="body">
    <div class="grid">${fieldsHtml}</div>
  </div>
</div>
<div class="footer">Generated ${new Date().toLocaleString()}</div>
</body>
</html>`;

  const win = window.open('', '_blank', 'width=900,height=700');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.addEventListener('load', () => { win.focus(); win.print(); });
}

function EntityCard({ title, subtitle, badge, badgeColor, fields, tags }: EntityCardProps) {
  const entries = Object.entries(fields);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm my-3 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-gradient-to-r from-indigo-50 to-white border-b border-slate-100 flex items-start justify-between">
        <div>
          <h3 className="text-sm font-semibold text-slate-800">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.map((t, i) => (
                <span key={i} className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {badge && (
            <span className="px-2.5 py-1 text-xs font-semibold rounded-full text-white"
              style={{ backgroundColor: badgeColor ?? '#6366f1' }}>
              {badge}
            </span>
          )}
          <button
            onClick={() => printEntityCard(title, subtitle, badge, badgeColor, tags, fields)}
            title="Download as PDF"
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium text-slate-500 border border-slate-200 hover:bg-slate-50 hover:text-slate-700 hover:border-slate-300 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
            PDF
          </button>
        </div>
      </div>
      {/* All fields in one unified grid — EntityCardField sets col-span-2 for complex values */}
      <div className="px-4 py-3">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          {entries.map(([k, v]) => (
            <EntityCardField key={k} label={k} value={v} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// QueryResult  (wraps DataTable + summary header — used for mongo query results)
// Props: { title?, query?, collection?, database?, rowCount, durationMs?, rows, columns? }
// ─────────────────────────────────────────────────────────────────────────────

interface QueryResultProps {
  title?: string;
  query?: string;
  collection?: string;
  database?: string;
  rowCount: number;
  durationMs?: number;
  rows: Record<string, unknown>[];
  columns?: string[];
}

function QueryResult({ title, query, collection, database, rowCount, durationMs, rows, columns }: QueryResultProps) {
  return (
    <div className="my-3">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        {title && <span className="text-sm font-semibold text-slate-700">{title}</span>}
        {database && collection && (
          <span className="px-2 py-0.5 bg-slate-100 text-slate-500 text-xs rounded font-mono">{database}.{collection}</span>
        )}
        <span className="px-2 py-0.5 bg-indigo-50 text-indigo-600 text-xs rounded">{rowCount.toLocaleString()} rows</span>
        {durationMs !== undefined && (
          <span className="text-xs text-slate-400">{durationMs}ms</span>
        )}
      </div>
      {query && (
        <p className="text-xs text-slate-500 italic mb-2">"{query}"</p>
      )}
      <DataTable data={rows} columns={columns} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline
// Props: { title?, events: Array<{ date, label, description?, color?, icon? }> }
// ─────────────────────────────────────────────────────────────────────────────

interface TimelineEvent {
  date: string;
  label: string;
  description?: string;
  color?: string;
  icon?: string;
}

interface TimelineProps {
  title?: string;
  events: TimelineEvent[];
}

function Timeline({ title, events }: TimelineProps) {
  return (
    <div className="my-3">
      {title && <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>}
      <div className="relative pl-6 border-l-2 border-slate-200 space-y-4">
        {events.map((e, i) => {
          const color = e.color ?? PALETTE[i % PALETTE.length];
          return (
            <div key={i} className="relative">
              <div className="absolute -left-[25px] w-4 h-4 rounded-full border-2 border-white flex items-center justify-center text-xs"
                style={{ backgroundColor: color }}>
                {e.icon ?? ''}
              </div>
              <div className="bg-white border border-slate-200 rounded-lg p-3 shadow-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-semibold text-slate-700">{e.label}</span>
                  <span className="text-xs text-slate-400">{e.date}</span>
                </div>
                {e.description && <p className="text-xs text-slate-500">{e.description}</p>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// LineChart
// Props: { title?, series: Array<{ label, data: number[], color? }>, xLabels?: string[] }
// ─────────────────────────────────────────────────────────────────────────────

interface LineChartProps {
  title?: string;
  series: Array<{ label: string; data: number[]; color?: string }>;
  xLabels?: string[];
}

function LineChart({ title, series, xLabels }: LineChartProps) {
  if (!series || series.length === 0) return null;
  const allValues = series.flatMap(s => s.data);
  const maxVal = Math.max(...allValues);
  const minVal = Math.min(...allValues);
  const range = maxVal - minVal || 1;
  const W = 480; const H = 140; const PAD = 32;
  const dataLen = series[0].data.length;
  const xStep = (W - PAD * 2) / Math.max(dataLen - 1, 1);

  const toX = (i: number) => PAD + i * xStep;
  const toY = (v: number) => PAD + (1 - (v - minVal) / range) * (H - PAD * 2);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm my-3 overflow-x-auto">
      {title && <h3 className="text-sm font-semibold text-slate-700 mb-3">{title}</h3>}
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = PAD + t * (H - PAD * 2);
          const val = maxVal - t * range;
          return (
            <g key={i}>
              <line x1={PAD} x2={W - PAD} y1={y} y2={y} stroke="#e2e8f0" strokeWidth={0.5} />
              <text x={PAD - 4} y={y + 3} textAnchor="end" fontSize={8} fill="#94a3b8">{val.toLocaleString()}</text>
            </g>
          );
        })}
        {/* Series lines */}
        {series.map((s, si) => {
          const color = s.color ?? PALETTE[si % PALETTE.length];
          const pts = s.data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ');
          return (
            <g key={si}>
              <polyline points={pts} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
              {s.data.map((v, i) => (
                <circle key={i} cx={toX(i)} cy={toY(v)} r={3} fill={color} />
              ))}
            </g>
          );
        })}
        {/* X labels */}
        {xLabels && xLabels.map((l, i) => (
          <text key={i} x={toX(i)} y={H - 4} textAnchor="middle" fontSize={8} fill="#94a3b8">
            {l.length > 8 ? l.slice(0, 8) + '…' : l}
          </text>
        ))}
      </svg>
      {/* Legend */}
      {series.length > 1 && (
        <div className="flex flex-wrap gap-3 mt-2">
          {series.map((s, si) => (
            <div key={si} className="flex items-center gap-1.5 text-xs text-slate-500">
              <div className="w-3 h-2 rounded" style={{ backgroundColor: s.color ?? PALETTE[si % PALETTE.length] }} />
              {s.label}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// AlertPanel
// Props: { type: 'info'|'success'|'warning'|'error', title, message, items? }
// ─────────────────────────────────────────────────────────────────────────────

interface AlertPanelProps {
  type: 'info' | 'success' | 'warning' | 'error';
  title: string;
  message?: string;
  items?: string[];
}

function AlertPanel({ type, title, message, items }: AlertPanelProps) {
  const styles = {
    info:    { bg: 'bg-blue-50',   border: 'border-blue-200',  text: 'text-blue-800',  icon: 'ℹ️' },
    success: { bg: 'bg-green-50',  border: 'border-green-200', text: 'text-green-800', icon: '✅' },
    warning: { bg: 'bg-amber-50',  border: 'border-amber-200', text: 'text-amber-800', icon: '⚠️' },
    error:   { bg: 'bg-red-50',    border: 'border-red-200',   text: 'text-red-800',   icon: '❌' },
  }[type] ?? { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-800', icon: 'ℹ️' };

  return (
    <div className={`rounded-xl border p-4 my-3 ${styles.bg} ${styles.border}`}>
      <div className="flex items-start gap-2">
        <span className="text-base mt-0.5">{styles.icon}</span>
        <div>
          <p className={`text-sm font-semibold ${styles.text}`}>{title}</p>
          {message && <p className={`text-xs mt-1 ${styles.text} opacity-80`}>{message}</p>}
          {items && items.length > 0 && (
            <ul className={`mt-2 space-y-0.5 text-xs ${styles.text} opacity-80`}>
              {items.map((item, i) => <li key={i} className="flex items-start gap-1"><span>•</span>{item}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// KeyValueList  (simple two-column list for structured data)
// Props: { title?, items: Array<{ key, value, color? }> }
// ─────────────────────────────────────────────────────────────────────────────

interface KeyValueListProps {
  title?: string;
  items: Array<{ key: string; value: unknown; color?: string }>;
}

function KeyValueList({ title, items }: KeyValueListProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm my-3 overflow-hidden">
      {title && (
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-100">
          <h3 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">{title}</h3>
        </div>
      )}
      <dl className="divide-y divide-slate-100">
        {items.map((item, i) => (
          <div key={i} className="flex items-start px-4 py-2.5 gap-4">
            <dt className="text-xs text-slate-500 w-36 shrink-0">{item.key}</dt>
            <dd className="text-xs font-medium text-slate-800 flex-1"
              style={item.color ? { color: item.color } : undefined}>
              {fmt(item.value)}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ComparisonTable
// Props: { title?, caption?, aspects: string[], items: Array<{ name, values: string[] }> }
//
// Renders a side-by-side comparison grid:
//   rows = aspects (features/attributes)
//   cols = items being compared
//
// Example:
//   aspects: ["Definition", "Use case", "Latency"]
//   items: [
//     { name: "RAG", values: ["Retrieval-augmented...", "Dynamic knowledge", "Higher"] },
//     { name: "Context window", values: ["Tokens passed...", "Short-term info", "Lower"] }
//   ]
// ─────────────────────────────────────────────────────────────────────────────

interface ComparisonItem {
  name: string;
  color?: string;       // optional accent hex
  values: string[];     // one value per aspect, in order
}

interface ComparisonTableProps {
  title?: string;
  caption?: string;
  aspects: string[];    // row labels
  items: ComparisonItem[];  // columns
}

function ComparisonTable({ title, caption, aspects, items }: ComparisonTableProps) {
  if (!aspects?.length || !items?.length) return null;

  return (
    <div className="rounded-xl border border-slate-200 bg-white overflow-hidden shadow-sm my-3">
      {(title || caption) && (
        <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
          {title && <h3 className="text-sm font-semibold text-slate-800">{title}</h3>}
          {caption && <p className="text-xs text-slate-500 mt-0.5">{caption}</p>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-slate-200">
              {/* empty corner cell */}
              <th className="px-4 py-3 w-36 bg-slate-50 text-left text-slate-400 font-medium text-[11px] uppercase tracking-wide">
                Aspect
              </th>
              {items.map((item, i) => {
                const accent = item.color ?? PALETTE[i % PALETTE.length];
                return (
                  <th key={i} className="px-4 py-3 text-left font-semibold text-slate-800 bg-white border-l border-slate-100"
                    style={{ borderTopColor: accent, borderTopWidth: 3 }}>
                    <span className="block text-sm">{item.name}</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {aspects.map((aspect, ai) => (
              <tr key={ai} className={ai % 2 === 0 ? 'bg-white' : 'bg-slate-50/50'}>
                <td className="px-4 py-3 font-semibold text-slate-600 whitespace-nowrap border-r border-slate-100 align-top">
                  {aspect}
                </td>
                {items.map((item, ii) => (
                  <td key={ii} className="px-4 py-3 text-slate-700 leading-relaxed border-l border-slate-100 align-top">
                    {item.values[ai] ?? '—'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Component Registry
// ─────────────────────────────────────────────────────────────────────────────

type ComponentRenderer = (props: unknown) => React.ReactElement | null;

const COMPONENT_REGISTRY: Record<string, ComponentRenderer> = {
  DataTable:          (p) => <DataTable         {...(p as DataTableProps)} />,
  StatsDashboard:     (p) => <StatsDashboard    {...(p as StatsDashboardProps)} />,
  BarChart:           (p) => <BarChart          {...(p as BarChartProps)} />,
  EntityCard:         (p) => <EntityCard        {...(p as EntityCardProps)} />,
  QueryResult:        (p) => <QueryResult       {...(p as QueryResultProps)} />,
  Timeline:           (p) => <Timeline          {...(p as TimelineProps)} />,
  LineChart:          (p) => <LineChart         {...(p as LineChartProps)} />,
  AlertPanel:         (p) => <AlertPanel        {...(p as AlertPanelProps)} />,
  KeyValueList:       (p) => <KeyValueList      {...(p as KeyValueListProps)} />,
  ComparisonTable:    (p) => <ComparisonTable   {...(p as ComparisonTableProps)} />,
};

// ─────────────────────────────────────────────────────────────────────────────
// UIComponentBlock  (rendered in ChatPage for each uiComponent on a message)
// ─────────────────────────────────────────────────────────────────────────────

interface UIComponentBlockProps {
  component: UIComponent;
}

export function UIComponentBlock({ component }: UIComponentBlockProps) {
  const renderer = COMPONENT_REGISTRY[component.componentType];

  if (!renderer) {
    return (
      <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 my-2 text-xs text-amber-700">
        Unknown UI component: <code className="font-mono">{component.componentType}</code>
      </div>
    );
  }

  try {
    return <>{renderer(component.props)}</>;
  } catch (err) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 my-2 text-xs text-red-700">
        Error rendering <code className="font-mono">{component.componentType}</code>: {String(err)}
      </div>
    );
  }
}

export { COMPONENT_REGISTRY };
export type { DataTableProps, StatsDashboardProps, BarChartProps, EntityCardProps, QueryResultProps };
