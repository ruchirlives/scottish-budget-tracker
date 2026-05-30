import React from 'react';
import ReactDOM from 'react-dom/client';
import { ArrowDownUp, ChevronRight, Database, Download, LineChart as LineChartIcon, Plus, Search, X } from 'lucide-react';
import {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import '@xyflow/react/dist/style.css';
import './style.css';
import level4Data from '../data/budget-level-4.normalized.json';
import candidateData from '../data/budget-line-flow-candidates.json';
import flowData from '../data/budget-line-flows.json';
import outturnData from '../data/provisional-outturn-2024-25.json';

type BudgetRow = {
  year: string;
  sheet: string;
  area: string;
  canonicalArea: string;
  portfolio: string;
  budgetLine: string;
  resource: number;
  capital: number;
  total: number;
};

type AggregateRow = {
  name: string;
  resource: number;
  capital: number;
  total: number;
  rows: BudgetRow[];
};

type BudgetLineNodeData = {
  label: string;
  canonicalArea: string;
  series: Array<{ year: string; amount: number }>;
};

type AggregationNodeData = {
  label: string;
  series: Array<{ year: string; amount: number }>;
  inputCount: number;
};

type BudgetLineNode = Node<BudgetLineNodeData, 'budgetLine'>;
type AggregationNode = Node<AggregationNodeData, 'aggregation'>;
type CanvasNode = BudgetLineNode | AggregationNode;

type FlowLink = {
  year: string;
  canonicalArea: string;
  portfolio: string;
};

type BudgetFlow = {
  id: string;
  type: string;
  confidence: string;
  label: string;
  fromYear: string;
  toYear: string;
  links: FlowLink[];
  notes?: string;
};

type FlowCandidate = {
  id: string;
  type: string;
  confidence: string;
  score: number;
  from: Array<FlowLink & { total: number }>;
  to: Array<FlowLink & { total: number }>;
  reason: string;
  evidence?: Array<{
    kind: string;
    detail: string;
    score?: number;
  }>;
};

const rows = level4Data as BudgetRow[];
const flows = flowData.flows as BudgetFlow[];
const flowCandidates = candidateData.candidates as FlowCandidate[];
const years = Array.from(new Set(rows.map((row) => row.year))).sort();

function flowToCandidate(f: BudgetFlow): FlowCandidate {
  const linksWithTotal = f.links.map((lk) => {
    const row = rows.find((r) => r.year === lk.year && r.canonicalArea === lk.canonicalArea && r.portfolio === lk.portfolio);
    return { ...lk, total: row?.total ?? 0 };
  });
  return {
    id: f.id,
    type: 'continuation',
    confidence: f.confidence,
    score: 1,
    from: linksWithTotal.slice(0, -1),
    to: linksWithTotal.slice(1),
    reason: f.notes ?? 'Exact label match across years.',
    evidence: linksWithTotal.slice(1).map((lk) => ({
      kind: 'continues_next_year',
      detail: `${lk.portfolio} appears in ${lk.year} at ${lk.total.toFixed(1)}m.`,
      score: 1,
    })),
  };
}

const allBudgetLines: FlowCandidate[] = [
  ...flowCandidates,
  ...flows.map(flowToCandidate),
];
const latestYear = years.at(-1) ?? '';
const palette = ['#0065bd', '#2d7d46', '#d16b00', '#6f4bb2', '#c0392b', '#0f8b8d', '#5c6670'];

function money(value: number) {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value * 1_000_000);
}

function compactMoney(value: number) {
  return `GBP ${(value / 1000).toFixed(value >= 10_000 ? 1 : 2)}bn`;
}

function tooltipMoney(value: unknown) {
  return money(Number(value) || 0);
}

function aggregateBy(items: BudgetRow[], key: (row: BudgetRow) => string) {
  const grouped = new Map<string, AggregateRow>();
  for (const row of items) {
    const name = key(row).trim() || 'Unlabelled';
    const existing = grouped.get(name) ?? { name, resource: 0, capital: 0, total: 0, rows: [] };
    existing.resource += row.resource;
    existing.capital += row.capital;
    existing.total += row.total;
    existing.rows.push(row);
    grouped.set(name, existing);
  }
  return Array.from(grouped.values()).sort((a, b) => b.total - a.total);
}

function shortText(value: string, maxLength = 140) {
  return value.length > maxLength ? `${value.slice(0, maxLength).trim()}...` : value;
}

function SankeyViz({ candidate, allRows, allYears }: { candidate: FlowCandidate; allRows: BudgetRow[]; allYears: string[] }) {
  const { from, to } = candidate;
  const hasFrom = from.length > 0;
  const hasTo = to.length > 0;

  const area = hasFrom ? from[0].canonicalArea : hasTo ? to[0].canonicalArea : '';
  const portfolios = [...new Set([...from.map((n) => n.portfolio), ...to.map((n) => n.portfolio)])];
  const portColor = new Map<string, string>();
  portfolios.forEach((p, i) => portColor.set(p, palette[i % palette.length]));

  const MIN_SEG = 10;

  interface YearData { year: string; portTotals: Map<string, number>; portSum: number; areaTotal: number; }
  const yearData: YearData[] = [];

  const allKnownAreas = [...new Set([area, ...from.map((n) => n.canonicalArea), ...to.map((n) => n.canonicalArea)])];

  for (const year of allYears) {
    const yearRows = allRows.filter((r) => r.year === year);
    const yearArea = allKnownAreas.find((a) => yearRows.some((r) => r.canonicalArea === a)) ?? area;
    const areaRows = yearRows.filter((r) => r.canonicalArea === yearArea);
    const areaTotal = areaRows.reduce((s, r) => s + r.total, 0);
    const portTotals = new Map<string, number>();
    for (const port of portfolios) {
      const total = yearRows.filter((r) => r.portfolio === port).reduce((s, r) => s + r.total, 0);
      if (total !== 0) portTotals.set(port, total);
    }
    const portSum = [...portTotals.values()].reduce((s, v) => s + Math.abs(v), 0);
    if (areaTotal > 0) {
      yearData.push({ year, portTotals, portSum, areaTotal });
    }
  }

  if (yearData.length <= 1) {
    return <p className="data-note" style={{ textAlign: 'center', margin: '24px 0' }}>Not enough year data to visualise flow.</p>;
  }

  const maxArea = Math.max(...yearData.map((d) => d.areaTotal), 1);
  const W = Math.max(580, yearData.length * 130);
  const H = 280;
  const COL_W = (W - 24) / yearData.length;
  const BAR_W = Math.min(COL_W - 24, 70);
  const PAD_T = 36;
  const PAD_B = 44;
  const DRAW_H = H - PAD_T - PAD_B;

  interface SegRect { x: number; y: number; w: number; h: number; portfolio: string; total: number; color: string; year: string; }
  const allSegs: SegRect[] = [];

  for (let yi = 0; yi < yearData.length; yi++) {
    const yd = yearData[yi];
    const cx = 12 + yi * COL_W + (COL_W - BAR_W) / 2;
    const barH = Math.max(18, (yd.areaTotal / maxArea) * DRAW_H);
    const barY = H - PAD_B - barH;

    const active = portfolios
      .filter((p) => yd.portTotals.has(p))
      .sort((a, b) => (yd.portTotals.get(b) ?? 0) - (yd.portTotals.get(a) ?? 0));

    if (active.length > 0) {
      const totalSegH = active.reduce((s, p) => {
        const pH = (yd.portTotals.get(p) ?? 0) / yd.areaTotal * barH;
        return s + Math.max(MIN_SEG, pH);
      }, 0);
      const segSpace = Math.min(barH, totalSegH);
      let cumY = barY + (barH - segSpace);
      for (const port of active) {
        const pAmt = Math.abs(yd.portTotals.get(port) ?? 0);
        const natH = (pAmt / yd.areaTotal) * barH;
        const pct = totalSegH > 0 ? Math.max(MIN_SEG, natH) / segSpace : 1 / active.length;
        const segH = Math.max(MIN_SEG, Math.round(pct * segSpace));
        allSegs.push({ x: cx, y: cumY, w: BAR_W, h: segH, portfolio: port, total: pAmt, color: portColor.get(port) ?? '#94a3b8', year: yd.year });
        cumY += segH;
      }
    }
  }

  interface LinkDef { fx: number; fy: number; tx: number; ty: number; amt: number; color: string; kind: string; }
  const links: LinkDef[] = [];
  let maxLinkAmt = 1;

  for (let yi = 0; yi < yearData.length - 1; yi++) {
    for (const port of portfolios) {
      const fp = allSegs.find((p) => p.portfolio === port && p.year === yearData[yi].year);
      const tp = allSegs.find((p) => p.portfolio === port && p.year === yearData[yi + 1].year);
      if (fp && tp) {
        const amt = Math.abs(tp.total);
        links.push({ fx: fp.x + fp.w, fy: fp.y + fp.h / 2, tx: tp.x, ty: tp.y + tp.h / 2, amt, color: fp.color, kind: 'continuation' });
        if (amt > maxLinkAmt) maxLinkAmt = amt;
      }
    }
  }

  for (const fn of from) {
    for (const tn of to) {
      if (fn.portfolio !== tn.portfolio) {
        const fp = allSegs.find((p) => p.portfolio === fn.portfolio && p.year === fn.year);
        const tp = allSegs.find((p) => p.portfolio === tn.portfolio && p.year === tn.year);
        if (fp && tp) {
          const amt = Math.abs(tn.total);
          links.push({ fx: fp.x + fp.w, fy: fp.y + fp.h / 2, tx: tp.x, ty: tp.y + tp.h / 2, amt, color: portColor.get(tn.portfolio) ?? '#d16b00', kind: 'transition' });
          if (amt > maxLinkAmt) maxLinkAmt = amt;
        }
      }
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '320px' }}>
      {yearData.map((yd, i) => (
        <text key={`yh-${i}`} x={12 + i * COL_W + COL_W / 2} y={14} fill="#334155" fontSize={10} fontWeight={700} textAnchor="middle">{yd.year}</text>
      ))}
      {links.map((l, i) => {
        const thick = Math.max(2, (l.amt / maxLinkAmt) * 24);
        const cp = (l.tx - l.fx) * 0.4;
        return (
          <path key={i} d={`M ${l.fx},${l.fy - thick / 2} C ${l.fx + cp},${l.fy - thick / 2} ${l.tx - cp},${l.ty - thick / 2} ${l.tx},${l.ty - thick / 2} L ${l.tx},${l.ty + thick / 2} C ${l.tx - cp},${l.ty + thick / 2} ${l.fx + cp},${l.fy + thick / 2} ${l.fx},${l.fy + thick / 2} Z`}
            fill={`${l.color}30`} stroke={`${l.color}50`} strokeWidth={0.5} strokeDasharray={l.kind === 'transition' ? '5,3' : undefined} />
        );
      })}
      {yearData.map((yd, yi) => {
        const cx = 12 + yi * COL_W + (COL_W - BAR_W) / 2;
        const barH = Math.max(18, (yd.areaTotal / maxArea) * DRAW_H);
        const barY = H - PAD_B - barH;
        return (
          <g key={`bar-${yi}`}>
            <rect x={cx} y={barY} width={BAR_W} height={barH} fill="#f1f5f9" stroke="#e2e8f0" strokeWidth={1} rx={4} />
            <text x={cx + BAR_W / 2} y={barY - 5} fill="#475569" fontSize={10} fontWeight={600} textAnchor="middle">{money(yd.areaTotal)}</text>
            {yd.portSum > 0 && (
              <text x={cx + BAR_W / 2} y={barY + barH + 11} fill="#64748b" fontSize={8} textAnchor="middle">{((yd.portSum / yd.areaTotal) * 100).toFixed(1)}%</text>
            )}
          </g>
        );
      })}
      {allSegs.map((s, i) => {
        const yd = yearData.find((d) => d.year === s.year);
        const pct = yd ? (s.total / yd.areaTotal * 100).toFixed(1) : null;
        return (
          <g key={`seg-${i}`}>
            <rect x={s.x} y={s.y} width={s.w} height={s.h} fill={s.color} rx={1.5} stroke="rgba(255,255,255,0.6)" strokeWidth={0.5} />
            {s.h > 16 && (
              <text x={s.x + s.w / 2} y={s.y + s.h / 2} fill="white" fontSize={8} fontWeight={700} textAnchor="middle" dominantBaseline="middle">
                {s.portfolio.length > 14 ? s.portfolio.slice(0, 12) + '…' : s.portfolio}
              </text>
            )}
            {s.h > 14 && s.h <= 16 && (
              <text x={s.x + s.w / 2} y={s.y + s.h / 2} fill="white" fontSize={7} fontWeight={600} textAnchor="middle" dominantBaseline="middle">
                {money(s.total)}
              </text>
            )}
            <title>{`${s.portfolio}: ${money(s.total)}${pct ? ` (${pct}%)` : ''} of ${area}`}</title>
          </g>
        );
      })}
      {links.filter((l) => l.kind === 'continuation').map((l, i) => {
        const mx = (l.fx + l.tx) / 2;
        const my = (l.fy + l.ty) / 2;
        return <text key={`la-${i}`} x={mx} y={my} fill="#475569" fontSize={8} fontWeight={600} textAnchor="middle" dominantBaseline="middle">{money(l.amt)}</text>;
      })}
      {links.filter((l) => l.kind === 'transition').map((l, i) => {
        const mx = (l.fx + l.tx) / 2;
        const my = (l.fy + l.ty) / 2;
        return <text key={`ta-${i}`} x={mx} y={my} fill="#d16b00" fontSize={8} fontWeight={700} textAnchor="middle" dominantBaseline="middle">{money(l.amt)}</text>;
      })}
      {!hasFrom && hasTo && <text x={W / 2} y={H / 2} fill="#64748b" fontSize={13} fontStyle="italic" textAnchor="middle" dominantBaseline="middle">New line — no prior-year data</text>}
      {hasFrom && !hasTo && <text x={W / 2} y={H / 2} fill="#64748b" fontSize={13} fontStyle="italic" textAnchor="middle" dominantBaseline="middle">Retired — no continuation</text>}
      {area && <text x={W / 2} y={H - 4} fill="#94a3b8" fontSize={9} fontStyle="italic" textAnchor="middle">within {area}</text>}
    </svg>
  );
}
const maxBudgetAreaTotal = Math.max(...years.flatMap((year) => aggregateBy(rows.filter((row) => row.year === year), (row) => row.canonicalArea).map((row) => row.total)));

function seriesForBudgetLine(canonicalArea: string, portfolio: string) {
  return years.map((year) => ({
    year,
    amount: rows
      .filter((row) => row.year === year && row.canonicalArea === canonicalArea && row.portfolio === portfolio)
      .reduce((sum, row) => sum + row.total, 0),
  }));
}

function sumSeries(seriesList: Array<Array<{ year: string; amount: number }>>) {
  return years.map((year) => ({
    year,
    amount: seriesList.reduce((sum, series) => sum + (series.find((point) => point.year === year)?.amount ?? 0), 0),
  }));
}

function latestSeriesAmount(series: Array<{ year: string; amount: number }>) {
  return series.at(-1)?.amount ?? 0;
}
function BudgetTracker() {
  const [selectedYear, setSelectedYear] = React.useState(latestYear);
  const [query, setQuery] = React.useState('');
  const [selectedArea, setSelectedArea] = React.useState<string | null>(null);
  const [selectedLine, setSelectedLine] = React.useState<string | null>(null);
  const [budgetMode, setBudgetMode] = React.useState<'explore' | 'flows'>('explore');
  const [selectedFlowId, setSelectedFlowId] = React.useState(flows[0]?.id ?? '');
  const [flowQuery, setFlowQuery] = React.useState('');
  const [candidateQuery, setCandidateQuery] = React.useState('');
  const [selectedCandidate, setSelectedCandidate] = React.useState<FlowCandidate | null>(null);

  React.useEffect(() => {
    setSelectedArea(null);
    setSelectedLine(null);
  }, [selectedYear]);

  const yearRows = rows.filter((row) => row.year === selectedYear);
  const areaRows = aggregateBy(yearRows, (row) => row.canonicalArea);
  const selectedAreaRows = selectedArea ? yearRows.filter((row) => row.canonicalArea === selectedArea) : yearRows;
  const drillRows = aggregateBy(selectedAreaRows, (row) => row.portfolio);

  const visibleRows = (selectedArea ? drillRows : areaRows)
    .filter((row) => row.name.toLowerCase().includes(query.toLowerCase()))
    .slice(0, 30);

  const total = visibleRows.reduce((sum, row) => sum + row.total, 0);
  const top = visibleRows[0];
  const selectedLineRows = selectedArea && selectedLine
    ? rows.filter((row) => row.canonicalArea === selectedArea && row.portfolio === selectedLine)
    : [];
  const trend = years.map((year) => ({
    year,
    total: rows
      .filter((row) => row.year === year)
      .filter((row) => !selectedArea || row.canonicalArea === selectedArea)
      .filter((row) => !selectedLine || row.portfolio === selectedLine)
      .reduce((sum, row) => sum + row.total, 0),
  }));
  const detailRows = selectedLineRows.filter((row) => row.year === selectedYear);
  const selectedFlow = flows.find((flow) => flow.id === selectedFlowId) ?? flows[0];
  const visibleFlows = flows.filter((flow) => (
    flow.label.toLowerCase().includes(flowQuery.toLowerCase())
    || flow.links.some((link) => link.canonicalArea.toLowerCase().includes(flowQuery.toLowerCase()))
    || flow.type.toLowerCase().includes(flowQuery.toLowerCase())
  ));
  const visibleCandidates = allBudgetLines.filter((candidate) => {
    const haystack = [
      candidate.type,
      candidate.confidence,
      candidate.reason,
      ...candidate.from.map((node) => `${node.canonicalArea} ${node.portfolio}`),
      ...candidate.to.map((node) => `${node.canonicalArea} ${node.portfolio}`),
    ].join(' ').toLowerCase();
    return haystack.includes(candidateQuery.toLowerCase());
  }).slice(0, 60);
  const flowSeries = selectedFlow
    ? selectedFlow.links.map((link) => {
      const linkedRows = rows.filter((row) => (
        row.year === link.year
        && row.canonicalArea === link.canonicalArea
        && row.portfolio === link.portfolio
      ));
      return {
        year: link.year,
        total: linkedRows.reduce((sum, row) => sum + row.total, 0),
        resource: linkedRows.reduce((sum, row) => sum + row.resource, 0),
        capital: linkedRows.reduce((sum, row) => sum + row.capital, 0),
        sourceArea: linkedRows[0]?.area ?? link.canonicalArea,
        portfolio: link.portfolio,
      };
    })
    : [];

  function selectBar(row: AggregateRow) {
    if (!selectedArea) {
      setSelectedArea(row.name);
      setSelectedLine(null);
      setQuery('');
      return;
    }
    setSelectedLine(row.name);
  }

  function selectBarPayload(data: unknown) {
    const payload = data && typeof data === 'object' && 'payload' in data
      ? (data as { payload: AggregateRow }).payload
      : data;
    selectBar(payload as AggregateRow);
  }

  function resetDrillDown() {
    setSelectedArea(null);
    setSelectedLine(null);
  }

  return (
    <>
      <details className="about-info">
        <summary>About this tracker</summary>
        <p>
          <strong>Scottish Budget Tracker</strong> — an independent tool for exploring
          published Scottish Government budget data across multiple years. Not affiliated
          with, endorsed by, or produced by the Scottish Government.
        </p>
        <p>
          <strong>Data source:</strong> Scottish Government Level 4 budget supporting
          documents (<a href="https://www.gov.scot/publications/scottish-budget-2022-23/documents/" target="_blank" rel="noopener">2022-23</a>,
          <a href="https://www.gov.scot/publications/scottish-budget-2023-24/documents/" target="_blank" rel="noopener">2023-24</a>,
          <a href="https://www.gov.scot/publications/scottish-budget-2024-25/documents/" target="_blank" rel="noopener">2024-25</a>,
          <a href="https://www.gov.scot/publications/scottish-budget-2025-2026/documents/" target="_blank" rel="noopener">2025-26</a>).
          Provisional outturn data from the
          <a href="https://www.gov.scot/publications/2024-25-provisional-outturn-briefing-note-24-june-2025/" target="_blank" rel="noopener">2024-25 provisional outturn briefing note</a>.
        </p>
        <p>
          <strong>Disclaimer:</strong> Budget line flows between years are heuristic
          suggestions, not official mappings. Cross-year comparisons should be treated
          as indicative. Always verify against the original source documents.
        </p>
        <p>
          <strong>Code:</strong> Open source on
          <a href="https://github.com/ruchirlives/scottish-budget-tracker" target="_blank" rel="noopener">GitHub</a>.
          Built with React, TypeScript, Vite, Recharts, and read-excel-file.
        </p>
      </details>
      <div className="subtabs" role="tablist" aria-label="Budget mode">
        <button className={budgetMode === 'explore' ? 'active' : ''} onClick={() => setBudgetMode('explore')} type="button">Explore lines</button>
        <button className={budgetMode === 'flows' ? 'active' : ''} onClick={() => setBudgetMode('flows')} type="button">Flow model</button>
      </div>

      {budgetMode === 'flows' && selectedFlow ? (
        <>
          <section className="toolbar" aria-label="Flow controls">
            <label className="search">
              <Search size={18} />
              <input value={flowQuery} onChange={(event) => setFlowQuery(event.target.value)} placeholder="Filter mapped flows" />
            </label>
          </section>

          <section className="metrics" aria-label="Flow summary">
            <article>
              <span>Flow type</span>
              <strong>{selectedFlow.type}</strong>
            </article>
            <article>
              <span>Confidence</span>
              <strong>{selectedFlow.confidence}</strong>
            </article>
            <article>
              <span>Mapped years</span>
              <strong>{selectedFlow.links.length}</strong>
            </article>
          </section>

          <p className="data-note">{selectedFlow.notes ?? 'Explicitly mapped Level 4 budget-line flow.'}</p>

          <section className="dashboard-grid">
            <div className="panel wide">
              <div className="panel-title">
                <LineChartIcon size={20} />
                <h2>{selectedFlow.label}</h2>
              </div>
              <ResponsiveContainer width="100%" height={340}>
                <LineChart data={flowSeries}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="year" />
                  <YAxis tickFormatter={compactMoney} />
                  <Tooltip formatter={tooltipMoney} />
                  <Line dataKey="total" stroke="#0065bd" strokeWidth={3} dot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <div className="panel table-panel">
              <div className="panel-title">
                <Download size={20} />
                <h2>Mapped flows</h2>
              </div>
              <div className="flow-list">
                {visibleFlows.map((flow) => (
                  <button className={flow.id === selectedFlow.id ? 'active' : ''} key={flow.id} onClick={() => setSelectedFlowId(flow.id)} type="button">
                    <span>{flow.label}</span>
                    <small>{flow.links[0]?.canonicalArea} | {flow.confidence} | {flow.links.length} years</small>
                  </button>
                ))}
              </div>
            </div>

            <div className="panel table-panel">
              <div className="panel-title">
                <Download size={20} />
                <h2>Mapped source rows</h2>
              </div>
              <table className="records-table">
                <thead>
                  <tr>
                    <th>Year</th>
                    <th>Source area</th>
                    <th>Line</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {flowSeries.map((row) => (
                    <tr key={`${row.year}-${row.portfolio}`}>
                      <td>{row.year}</td>
                      <td>{row.sourceArea}</td>
                      <td>{row.portfolio}</td>
                      <td>{compactMoney(row.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="panel table-panel">
              <div className="panel-title">
                <Download size={20} />
                <h2>Track budget lines</h2>
              </div>
              <label className="search full">
                <Search size={18} />
                <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Filter by type, area, or line" />
              </label>
              <div className="candidate-list">
                {visibleCandidates.map((candidate) => (
                  <article key={candidate.id} onClick={() => setSelectedCandidate(candidate)} className={selectedCandidate?.id === candidate.id ? 'selected' : ''}>
                    <div>
                      <strong>{candidate.type}</strong>
                      <span>{candidate.confidence} | score {candidate.score}</span>
                    </div>
                    <p>
                      {candidate.from.length > 0 ? candidate.from.map((node) => `${node.year}: ${node.portfolio}`).join(' + ') : 'New line'}
                      {' -> '}
                      {candidate.to.length > 0 ? candidate.to.map((node) => `${node.year}: ${node.portfolio}`).join(' + ') : 'Retired'}
                    </p>
                    <small>{candidate.reason}</small>
                    {candidate.evidence && candidate.evidence.length > 0 && (
                      <ul>
                        {candidate.evidence.map((item) => (
                          <li key={`${candidate.id}-${item.kind}-${item.detail}`}>
                            <span>{item.kind.replace(/_/g, ' ')}</span>
                            {item.detail}
                            {typeof item.score === 'number' ? ` (${item.score})` : ''}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                ))}
              </div>
            </div>
          </section>

          {selectedCandidate && (
            <div className="sankey-overlay" onClick={() => setSelectedCandidate(null)}>
              <div className="sankey-modal" onClick={(e) => e.stopPropagation()}>
                <div className="sankey-modal-header">
                  <span><strong className="cap">{selectedCandidate.type}</strong> — {selectedCandidate.confidence} (score {selectedCandidate.score})</span>
                  <button onClick={() => setSelectedCandidate(null)} type="button">✕</button>
                </div>
                <SankeyViz candidate={selectedCandidate} allRows={rows} allYears={years} />
                <p className="data-note" style={{ marginTop: 12 }}>{selectedCandidate.reason}</p>
                {selectedCandidate.evidence && selectedCandidate.evidence.length > 0 && (
                  <ul className="sankey-evidence">
                    {selectedCandidate.evidence.map((item) => (
                      <li key={`${selectedCandidate.id}-${item.kind}-${item.detail}`}>
                        <span>{item.kind.replace(/_/g, ' ')}</span>
                        {item.detail}
                        {typeof item.score === 'number' ? ` (${item.score})` : ''}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </>
      ) : (
        <>
      <section className="toolbar" aria-label="Dashboard controls">
        <div className="segmented">
          {years.map((year) => (
            <button className={year === selectedYear ? 'active' : ''} key={year} onClick={() => setSelectedYear(year)} type="button">
              {year}
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={selectedArea ? 'Filter Level 4 lines' : 'Filter budget areas'} />
        </label>
      </section>

      <nav className="breadcrumb" aria-label="Drill-down path">
        <button onClick={resetDrillDown} type="button">All budget areas</button>
        {selectedArea && (
          <>
            <ChevronRight size={16} />
            <button onClick={() => setSelectedLine(null)} type="button">{selectedArea}</button>
          </>
        )}
        {selectedLine && (
          <>
            <ChevronRight size={16} />
            <span>{selectedLine}</span>
          </>
        )}
        {(selectedArea || selectedLine) && (
          <button className="clear-drill" onClick={resetDrillDown} type="button">
            <X size={16} />
            Reset
          </button>
        )}
      </nav>

      <section className="metrics" aria-label="Budget summary">
        <article>
          <span>Total shown</span>
          <strong>{compactMoney(total)}</strong>
        </article>
        <article>
          <span>{selectedArea ? 'Largest line' : 'Largest area'}</span>
          <strong>{top?.name ?? 'None'}</strong>
        </article>
        <article>
          <span>Visible records</span>
          <strong>{visibleRows.length}</strong>
        </article>
      </section>

      <section className="dashboard-grid">
        <div className="panel wide">
          <div className="panel-title">
            <LineChartIcon size={20} />
            <h2>{selectedArea ? `Level 4 lines in ${selectedArea}` : 'Budget area totals'}</h2>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={visibleRows} layout="vertical" margin={{ left: 16, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={compactMoney} domain={selectedArea ? ['auto', 'auto'] : [0, maxBudgetAreaTotal]} />
              <YAxis dataKey="name" type="category" width={180} tick={{ fontSize: 12 }} />
              <Tooltip formatter={tooltipMoney} />
              <Bar dataKey="total" radius={[0, 4, 4, 0]} onClick={selectBarPayload} cursor="pointer">
                {visibleRows.map((row, index) => (
                  <Cell key={row.name} fill={selectedLine === row.name ? '#111827' : palette[index % palette.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <div className="panel-title">
            <ArrowDownUp size={20} />
            <h2>{selectedLine ?? selectedArea ?? 'Multi-year trend'}</h2>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis tickFormatter={compactMoney} />
              <Tooltip formatter={tooltipMoney} />
              <Line dataKey="total" stroke="#0065bd" strokeWidth={3} dot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="panel table-panel">
          <div className="panel-title">
            <Download size={20} />
            <h2>{selectedLine ? 'Selected line detail' : selectedArea ? 'Click a line for detail' : 'Click an area to drill down'}</h2>
          </div>
          <table className="records-table">
            <thead>
              <tr>
                <th>{selectedArea ? 'Line' : 'Area'}</th>
                <th>Resource</th>
                <th>Capital</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <tr className="clickable-row" key={row.name} onClick={() => selectBar(row)}>
                  <td>{row.name}</td>
                  <td>{compactMoney(row.resource)}</td>
                  <td>{compactMoney(row.capital)}</td>
                  <td>{compactMoney(row.total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {selectedLine && (
            <div className="line-detail">
              {detailRows.map((row, index) => (
                <article key={`${row.area}-${row.portfolio}-${index}`}>
                  <strong>{row.portfolio}</strong>
                  <small>{row.area}</small>
                  <p>{shortText(row.budgetLine, 320)}</p>
                  <span>{money(row.total)}</span>
                </article>
              ))}
            </div>
          )}
        </div>
      </section>
        </>
      )}
    </>
  );
}

function OutturnTracker() {
  const portfolioRows = outturnData.variances.filter((row) => !/^Total|^TOTAL|^Other Bodies|^Funding Adjustments/.test(row.portfolio));
  const varianceExtent = Math.max(...portfolioRows.map((row) => Math.abs(row.totalExcludingNonCash)));
  const summaryRows = [
    { name: 'Fiscal budget', value: outturnData.summary.fiscalBudget },
    { name: 'Provisional fiscal outturn', value: outturnData.summary.provisionalFiscalOutturn },
    { name: 'Remaining funding', value: outturnData.summary.remainingFunding },
  ];

  return (
    <>
      <section className="metrics" aria-label="Outturn summary">
        <article>
          <span>Fiscal budget</span>
          <strong>{compactMoney(outturnData.summary.fiscalBudget)}</strong>
        </article>
        <article>
          <span>Provisional outturn</span>
          <strong>{compactMoney(outturnData.summary.provisionalFiscalOutturn)}</strong>
        </article>
        <article>
          <span>Remaining funding</span>
          <strong>{compactMoney(outturnData.summary.remainingFunding)}</strong>
        </article>
      </section>

      <p className="data-note">
        Provisional outturn is broad budget-scale expenditure reporting. Portfolio bars show HM Treasury fiscal budget variances in GBP million; negative values are underspends against budget.
      </p>

      <section className="dashboard-grid">
        <div className="panel wide">
          <div className="panel-title">
            <LineChartIcon size={20} />
            <h2>2024-25 portfolio variances</h2>
          </div>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={portfolioRows} layout="vertical" margin={{ left: 16, right: 24 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tickFormatter={(value) => `${value}m`} domain={[-varianceExtent, varianceExtent]} />
              <YAxis dataKey="portfolio" type="category" width={200} tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: unknown) => `${Number(value).toLocaleString('en-GB')}m`} />
              <Bar dataKey="totalExcludingNonCash" radius={[4, 4, 4, 4]}>
                {portfolioRows.map((row, index) => (
                  <Cell key={row.portfolio} fill={row.totalExcludingNonCash < 0 ? '#c0392b' : palette[index % palette.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel">
          <div className="panel-title">
            <ArrowDownUp size={20} />
            <h2>Budget against outturn</h2>
          </div>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={summaryRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={compactMoney} />
              <Tooltip formatter={tooltipMoney} />
              <Bar dataKey="value" fill="#0065bd" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="panel table-panel">
          <div className="panel-title">
            <Download size={20} />
            <h2>Variance table</h2>
          </div>
          <table className="records-table">
            <thead>
              <tr>
                <th>Portfolio</th>
                <th>Resource</th>
                <th>Capital</th>
                <th>Total exc non-cash</th>
              </tr>
            </thead>
            <tbody>
              {portfolioRows.map((row) => (
                <tr key={row.portfolio}>
                  <td>{row.portfolio}</td>
                  <td>{row.resource}m</td>
                  <td>{row.capital}m</td>
                  <td>{row.totalExcludingNonCash}m</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

const canvasNodeTypes = {
  budgetLine: BudgetLineCanvasNode,
  aggregation: AggregationCanvasNode,
};

function CanvasTracker() {
  return (
    <ReactFlowProvider>
      <CanvasTrackerInner />
    </ReactFlowProvider>
  );
}

function CanvasTrackerInner() {
  const { screenToFlowPosition } = useReactFlow();
  const [query, setQuery] = React.useState('');
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  const availableLines = React.useMemo(() => (
    aggregateBy(rows, (row) => `${row.canonicalArea}||${row.portfolio}`)
      .map((row) => {
        const [canonicalArea, portfolio] = row.name.split('||');
        return {
          id: `${canonicalArea}||${portfolio}`,
          canonicalArea,
          portfolio,
          series: seriesForBudgetLine(canonicalArea, portfolio),
        };
      })
      .filter((line) => `${line.canonicalArea} ${line.portfolio}`.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => latestSeriesAmount(b.series) - latestSeriesAmount(a.series))
      .slice(0, 80)
  ), [query]);

  React.useEffect(() => {
    setNodes((currentNodes) => {
      const inputSeriesByAggregation = new Map<string, Array<Array<{ year: string; amount: number }>>>();
      for (const edge of edges) {
        const source = currentNodes.find((node) => node.id === edge.source);
        const target = currentNodes.find((node) => node.id === edge.target);
        if (!source || !target || target.type !== 'aggregation') continue;
        const sourceSeries = source.type === 'budgetLine'
          ? (source.data as BudgetLineNodeData).series
          : (source.data as AggregationNodeData).series;
        inputSeriesByAggregation.set(target.id, [...(inputSeriesByAggregation.get(target.id) ?? []), sourceSeries]);
      }

      return currentNodes.map((node) => {
        if (node.type !== 'aggregation') return node;
        const inputSeries = inputSeriesByAggregation.get(node.id) ?? [];
        return {
          ...node,
          data: {
            ...(node.data as AggregationNodeData),
            inputCount: inputSeries.length,
            series: sumSeries(inputSeries),
          },
        };
      });
    });
  }, [edges, setNodes]);

  const onConnect = React.useCallback((connection: Connection) => {
    setEdges((currentEdges) => addEdge({
      ...connection,
      style: { stroke: '#0065bd', strokeWidth: 2 },
    }, currentEdges));
  }, [setEdges]);

  function handleDragStart(event: React.DragEvent<HTMLButtonElement>, line: { canonicalArea: string; portfolio: string; series: Array<{ year: string; amount: number }> }) {
    event.dataTransfer.setData('application/budget-line', JSON.stringify(line));
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }

  function handleDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const rawLine = event.dataTransfer.getData('application/budget-line');
    if (!rawLine) return;
    const line = JSON.parse(rawLine) as { canonicalArea: string; portfolio: string; series: Array<{ year: string; amount: number }> };
    const id = `line:${line.canonicalArea}:${line.portfolio}`;
    const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const nextNode: BudgetLineNode = {
      id,
      type: 'budgetLine',
      position,
      data: {
        label: line.portfolio,
        canonicalArea: line.canonicalArea,
        series: line.series,
      },
    };
    setNodes((currentNodes) => currentNodes.some((node) => node.id === id)
      ? currentNodes.map((node) => node.id === id ? { ...node, position } : node)
      : [...currentNodes, nextNode]);
  }

  function addAggregation() {
    const id = `aggregation:${crypto.randomUUID()}`;
    const nextNode: AggregationNode = {
      id,
      type: 'aggregation',
      position: { x: 520, y: 160 + nodes.filter((node) => node.type === 'aggregation').length * 90 },
      data: {
        label: `Aggregation ${nodes.filter((node) => node.type === 'aggregation').length + 1}`,
        inputCount: 0,
        series: sumSeries([]),
      },
    };
    setNodes((currentNodes) => [...currentNodes, nextNode]);
  }

  return (
    <section className="canvas-workspace">
      <aside className="canvas-sidebar">
        <div className="panel-title">
          <Search size={20} />
          <h2>Budget lines</h2>
        </div>
        <label className="search full">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search budget lines" />
        </label>
        <div className="budget-line-palette">
          {availableLines.map((line) => (
            <button draggable key={line.id} onDragStart={(event) => handleDragStart(event, line)} type="button">
              <span>{line.portfolio}</span>
              <small>{line.canonicalArea}</small>
              <strong>{compactMoney(latestSeriesAmount(line.series))}</strong>
            </button>
          ))}
        </div>
      </aside>

      <section className="canvas-panel">
        <div className="canvas-toolbar">
          <button onClick={addAggregation} type="button">
            <Plus size={18} />
            Aggregation
          </button>
          <span>{nodes.length} nodes | {edges.length} links</span>
        </div>
        <div className="flow-canvas" onDragOver={handleDragOver} onDrop={handleDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={canvasNodeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
          >
            <Background color="#d8dee8" gap={18} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        </div>
      </section>
    </section>
  );
}

function BudgetLineCanvasNode({ data }: NodeProps<BudgetLineNode>) {
  return (
    <div className="canvas-node budget-node">
      <strong>{data.label}</strong>
      <span>{data.canonicalArea}</span>
      <SeriesMiniTable series={data.series} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function AggregationCanvasNode({ data }: NodeProps<AggregationNode>) {
  return (
    <div className="canvas-node aggregation-node">
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      <span>{data.inputCount} inputs</span>
      <SeriesMiniTable series={data.series} />
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function SeriesMiniTable({ series }: { series: Array<{ year: string; amount: number }> }) {
  return (
    <table>
      <tbody>
        {series.map((point) => (
          <tr key={point.year}>
            <td>{point.year}</td>
            <td>{compactMoney(point.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function App() {
  const [activeTab, setActiveTab] = React.useState<'budget' | 'outturn' | 'canvas'>('budget');

  return (
    <main>
      <header className="app-header">
        <div>
          <p className="eyebrow">Scottish Budget Tracker</p>
          <h1>Compare planned budgets with broad outturn reporting</h1>
          <p className="disclaimer">Independent project using published Scottish Government data. Not affiliated with or endorsed by the Scottish Government.</p>
        </div>
        <a className="source-link" href={activeTab === 'outturn' ? outturnData.sourceUrl : 'https://www.gov.scot/publications/scottish-budget-2025-2026/documents/'} target="_blank">
          <Database size={18} />
          {activeTab === 'outturn' ? 'outturn source' : 'budget source'}
        </a>
      </header>

      <div className="tabs" role="tablist" aria-label="Data view">
        <button className={activeTab === 'budget' ? 'active' : ''} onClick={() => setActiveTab('budget')} type="button">Budget Tracker</button>
        <button className={activeTab === 'outturn' ? 'active' : ''} onClick={() => setActiveTab('outturn')} type="button">Outturn</button>
        <button className={activeTab === 'canvas' ? 'active' : ''} onClick={() => setActiveTab('canvas')} type="button">Canvas</button>
      </div>

      {activeTab === 'budget' ? <BudgetTracker /> : activeTab === 'outturn' ? <OutturnTracker /> : <CanvasTracker />}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
