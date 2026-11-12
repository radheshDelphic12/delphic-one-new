import { useMemo, useState } from 'react';
import { buildOwnershipGraph, layoutRadial, layoutTree } from './ownershipGraph.js';

const PALETTE = {
  group: { fill: '#105AA9', stroke: '#0B3F76', text: '#FFFFFF', sub: '#CFE1F5' },
  external: { fill: '#F3F4F6', stroke: '#9CA3AF', text: '#1F2937', sub: '#6B7280' },
  operational: { fill: '#ECFDF5', stroke: '#10B981', text: '#064E3B', sub: '#047857' },
  planning: { fill: '#FFFBEB', stroke: '#F59E0B', text: '#78350F', sub: '#B45309' },
  future: { fill: '#EFF6FF', stroke: '#3B82F6', text: '#1E3A8A', sub: '#1D4ED8' },
};
const pctText = (n) => `${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 3 })}%`;
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

function paletteOf(node) {
  if (node.kind === 'group') return PALETTE.group;
  if (node.kind === 'external') return PALETTE.external;
  return PALETTE[node.status] || PALETTE.external;
}

function subtitle(node) {
  if (node.kind === 'group') return 'Holding group';
  if (node.kind === 'external') return 'Outside holder';
  const status = node.status ? node.status[0].toUpperCase() + node.status.slice(1) : '';
  return node.company?.holders.length ? `${status} · ${pctText(node.total_pct)} held` : `${status} · ownership not set`;
}

function EdgeLabel({ x, y, pct }) {
  const text = pctText(pct);
  const w = text.length * 6.6 + 12;
  return (
    <g pointerEvents="none">
      <rect x={x - w / 2} y={y - 9} width={w} height={18} rx={9} fill="#FFFFFF" stroke="#CBD5E1" />
      <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="#0F172A">{text}</text>
    </g>
  );
}

/**
 * Group Dashboard > Companies & Stakes > Group chart: who owns what, as a structure chart (top-down) or a circular chart (group in the middle,
 * each ownership level on its own ring). Click a business to edit its ownership.
 */
export default function OwnershipChart({ companies, groups, statuses, onOpenCompany, initialMode = 'structure' }) {
  const [mode, setMode] = useState(initialMode);
  const graph = useMemo(() => buildOwnershipGraph(companies, groups, statuses), [companies, groups, statuses]);
  const layout = useMemo(() => (graph.nodes.length ? (mode === 'circular' ? layoutRadial(graph) : layoutTree(graph)) : null), [graph, mode]);

  return (
    <section className="space-y-3" data-testid="ownership-chart">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-3 text-xs text-tertiary-600" data-testid="chart-legend">
          {[['group', 'Holding group'], ['operational', 'Operational'], ['planning', 'Planning'], ['future', 'Future'], ['external', 'Outside holder']].map(([k, label]) => (
            <span key={k} className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border" style={{ background: PALETTE[k].fill, borderColor: PALETTE[k].stroke }} />{label}</span>
          ))}
          <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-dashed border-tertiary-400 bg-white opacity-60" />Dimmed = holder shown for context</span>
        </div>
        <div className="inline-flex rounded-xl border border-tertiary-100 bg-white p-0.5 text-xs" role="tablist" aria-label="Chart style">
          {[['structure', 'Structure chart'], ['circular', 'Circular chart']].map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={mode === key} data-testid={`chart-mode-${key}`} onClick={() => setMode(key)} className={`rounded-[10px] px-3 py-1.5 font-medium ${mode === key ? 'bg-primary-600 text-white' : 'text-tertiary-600 hover:bg-tertiary-50'}`}>{label}</button>
          ))}
        </div>
      </div>

      <div className="overflow-auto rounded-2xl border border-tertiary-100 bg-white p-2 shadow-card">
        {!layout ? (
          <p className="px-4 py-10 text-center text-sm text-tertiary-500" data-testid="chart-empty">No ownership to draw for the chosen statuses. Add holders with the ownership icon in the register.</p>
        ) : (
          <svg role="img" aria-label="Ownership chart of the group" viewBox={`0 0 ${layout.width} ${layout.height}`} width="100%" style={{ maxWidth: layout.width, minWidth: Math.min(layout.width, 720) }} className="mx-auto block h-auto" data-testid="chart-svg" data-mode={mode}>
            {mode === 'circular' && layout.radii.filter((r) => r > 0).map((r) => <circle key={r} cx={layout.cx} cy={layout.cy} r={r} fill="none" stroke="#E5E7EB" strokeDasharray="4 6" />)}
            {layout.edges.map((e) => {
              const curve = mode === 'structure';
              const d = curve ? `M ${e.a.x} ${e.a.y} C ${e.a.x} ${e.a.y + 48}, ${e.b.x} ${e.b.y - 48}, ${e.b.x} ${e.b.y}` : `M ${e.a.x} ${e.a.y} L ${e.b.x} ${e.b.y}`;
              const lx = curve ? (e.a.x + e.b.x) / 2 : e.a.x + (e.b.x - e.a.x) * 0.58;
              const ly = curve ? (e.a.y + e.b.y) / 2 : e.a.y + (e.b.y - e.a.y) * 0.58;
              return (
                <g key={`${e.from}>${e.to}`} data-testid="chart-edge">
                  <path d={d} fill="none" stroke="#94A3B8" strokeWidth="1.5" />
                  <EdgeLabel x={lx} y={ly} pct={e.pct} />
                </g>
              );
            })}
            {graph.nodes.map((n) => {
              const box = layout.pos.get(n.id);
              const c = paletteOf(n);
              const open = n.company && !n.context ? () => onOpenCompany?.(n.company) : n.company ? () => onOpenCompany?.(n.company) : null;
              return (
                <g
                  key={n.id}
                  data-testid="chart-node"
                  data-node={n.label}
                  opacity={n.context ? 0.55 : 1}
                  style={open ? { cursor: 'pointer' } : undefined}
                  role={open ? 'button' : undefined}
                  tabIndex={open ? 0 : undefined}
                  aria-label={open ? `Edit ownership of ${n.label}` : n.label}
                  onClick={open || undefined}
                  onKeyDown={open ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}
                >
                  <title>{`${n.label} — ${subtitle(n)}`}</title>
                  <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={12} fill={c.fill} stroke={c.stroke} strokeWidth="1.5" strokeDasharray={n.context ? '5 4' : undefined} />
                  <text x={box.x + box.w / 2} y={box.y + box.h / 2 - 3} textAnchor="middle" fontSize="12.5" fontWeight="700" fill={c.text}>{clip(n.label, mode === 'circular' ? 22 : 23)}</text>
                  <text x={box.x + box.w / 2} y={box.y + box.h / 2 + 14} textAnchor="middle" fontSize="10.5" fill={c.sub}>{clip(subtitle(n), 30)}</text>
                </g>
              );
            })}
          </svg>
        )}
      </div>

      {graph.unattached.length > 0 && (
        <div className="rounded-2xl border border-tertiary-100 bg-white p-3 shadow-card" data-testid="chart-unattached">
          <p className="text-xs font-semibold text-tertiary-700">Ownership not set <span className="font-normal text-tertiary-500">({graph.unattached.length}) — not in the chart until a holder is added; click one to set it</span></p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {graph.unattached.map((c) => (
              <button key={c.id} type="button" onClick={() => onOpenCompany?.(c)} className="rounded-full border border-tertiary-200 bg-canvas-muted px-2.5 py-1 text-xs text-tertiary-700 hover:border-primary-300 hover:bg-primary-50">{c.name}</button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
