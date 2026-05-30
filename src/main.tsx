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
  type NodeChange,
  type Node,
  type NodeProps,
  SelectionMode,
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

type EnrichedBudgetRow = BudgetRow & {
  flowStatuses: string[];
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
  highlightedYears?: string[];
  annotation?: string;
};

type AggregationNodeData = {
  label: string;
  series: Array<{ year: string; amount: number }>;
  inputCount: number;
  highlightedYears?: string[];
  annotation?: string;
};

type RuleCondition = {
  id: string;
  field: 'portfolio' | 'canonicalArea' | 'area' | 'budgetLine' | 'year' | 'total' | 'flowStatus';
  operator: 'contains' | 'equals' | 'greater_than' | 'less_than' | 'matches_regex';
  value: string;
};

type RuleAggregationNodeData = {
  label: string;
  conditions: RuleCondition[];
  series: Array<{ year: string; amount: number }>;
  matchCount: number;
  highlightedYears?: string[];
  annotation?: string;
};

type BudgetLineNode = Node<BudgetLineNodeData, 'budgetLine'>;
type AggregationNode = Node<AggregationNodeData, 'aggregation'>;
type RuleAggregationNode = Node<RuleAggregationNodeData, 'ruleAggregation'>;
type CanvasNode = BudgetLineNode | AggregationNode | RuleAggregationNode;

type CanvasStorage = {
  nodes: CanvasNode[];
  edges: Edge[];
};

type AnimationAction = 'highlight' | 'unhighlight' | 'show' | 'hide' | 'annotate' | 'unannotate' | 'move' | 'zoom' | 'pan' | 'text' | 'panToNode';
const viewportActions = new Set(['zoom', 'pan', 'panToNode', 'text']);

type AnimationStep = {
  delay: number;
  action: AnimationAction;
  nodeId?: string;
  value?: string | string[] | number | { x: number; y: number };
};

type AnimationScript = {
  id: string;
  name: string;
  steps: AnimationStep[];
};

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
const flowStatusesByRowKey = buildFlowStatuses();
const enrichedRows = rows.map((row) => ({
  ...row,
  flowStatuses: Array.from(flowStatusesByRowKey.get(rowKey(row)) ?? ['unmapped']),
}));
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
const budgetCanvasStorageKey = 'scottish-budget-tracker:canvas:v1';
const animScriptsStorageKey = 'scottish-budget-tracker:canvas:animations:v1';

function rowKey(row: Pick<BudgetRow, 'year' | 'canonicalArea' | 'portfolio'>) {
  return `${row.year}||${row.canonicalArea}||${row.portfolio}`;
}

function addFlowStatus(target: Map<string, Set<string>>, key: string, status: string) {
  target.set(key, new Set([...(target.get(key) ?? []), status]));
}

function buildFlowStatuses() {
  const statuses = new Map<string, Set<string>>();
  for (const flow of flows) {
    for (const link of flow.links) {
      addFlowStatus(statuses, rowKey(link), flow.type || 'continuation');
    }
  }
  for (const candidate of flowCandidates) {
    for (const link of [...candidate.from, ...candidate.to]) {
      addFlowStatus(statuses, rowKey(link), candidate.type);
      addFlowStatus(statuses, rowKey(link), `candidate:${candidate.type}`);
    }
  }
  return statuses;
}

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

function seriesForBudgetLine(portfolio: string) {
  return years.map((year) => ({
    year,
    amount: rows
      .filter((row) => row.year === year && row.portfolio === portfolio)
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

function readCanvasStorage(): CanvasStorage {
  if (typeof window === 'undefined') return { nodes: [], edges: [] };
  try {
    const raw = window.localStorage.getItem(budgetCanvasStorageKey);
    if (!raw) return { nodes: [], edges: [] };
    const parsed = JSON.parse(raw) as Partial<CanvasStorage>;
    return {
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { nodes: [], edges: [] };
  }
}

function readAnimScripts(): AnimationScript[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(animScriptsStorageKey);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

const defaultDemoScript: AnimationScript = {
  id: 'nature-investment-story',
  name: 'Nature Investment Story',
  steps: [
    { delay: 800, action: 'text', value: 'Scotland\u2019s Nature Investment Surge' },
    { delay: 2500, action: 'text', value: '' },

    { delay: 300, action: 'panToNode', nodeId: 'aggregation:1780134564103', value: 0.65 },
    { delay: 500, action: 'annotate', nodeId: 'aggregation:1780134564103', value: 'NatureScot (new 2024\u201325): \u00a392.4M combined' },
    { delay: 2200, action: 'unannotate', nodeId: 'aggregation:1780134564103' },

    { delay: 400, action: 'panToNode', nodeId: 'line:Net Zero and Energy:NatureScot Resource - Staff costs', value: 0.9 },
    { delay: 300, action: 'highlight', nodeId: 'line:Net Zero and Energy:NatureScot Resource - Staff costs', value: ['2024-25', '2025-26'] },
    { delay: 2000, action: 'unhighlight', nodeId: 'line:Net Zero and Energy:NatureScot Resource - Staff costs' },
    { delay: 300, action: 'highlight', nodeId: 'line:Net Zero and Energy:Nature Restoration', value: ['2024-25', '2025-26'] },
    { delay: 2000, action: 'unhighlight', nodeId: 'line:Net Zero and Energy:Nature Restoration' },

    { delay: 400, action: 'panToNode', nodeId: 'aggregation:1780134564996', value: 0.6 },
    { delay: 500, action: 'annotate', nodeId: 'aggregation:1780134564996', value: 'Rural Affairs: \u00a3108.2M \u2192 \u00a3118.4M' },
    { delay: 2200, action: 'unannotate', nodeId: 'aggregation:1780134564996' },

    { delay: 400, action: 'panToNode', nodeId: 'line:Rural Affairs, Land Reform and Islands:Peatlands', value: 0.9 },
    { delay: 300, action: 'highlight', nodeId: 'line:Rural Affairs, Land Reform and Islands:Peatlands', value: ['2024-25', '2025-26'] },
    { delay: 2000, action: 'unhighlight', nodeId: 'line:Rural Affairs, Land Reform and Islands:Peatlands' },
    { delay: 300, action: 'highlight', nodeId: 'line:Rural Affairs, Land Reform and Islands:Woodland Grants', value: ['2024-25', '2025-26'] },
    { delay: 2000, action: 'unhighlight', nodeId: 'line:Rural Affairs, Land Reform and Islands:Woodland Grants' },

    { delay: 600, action: 'panToNode', nodeId: 'aggregation:1780134579396', value: 0.8 },
    { delay: 300, action: 'highlight', nodeId: 'aggregation:1780134579396', value: ['2022-23', '2023-24', '2024-25', '2025-26'] },
    { delay: 500, action: 'text', value: 'Total Nature Investment: \u00a3200.6M \u2192 \u00a3205.3M' },
    { delay: 2500, action: 'text', value: 'Up from \u00a326.5M in 2023\u201324 \u2014 a 7.6x increase' },
    { delay: 3000, action: 'text', value: '' },
  ],
};

function refreshBudgetLineNodeData(nodes: CanvasNode[]) {
  return nodes.map((node) => {
    if (node.type !== 'budgetLine') return node;
    const data = node.data as BudgetLineNodeData;
    return {
      ...node,
      data: {
        ...data,
        series: seriesForBudgetLine(data.label),
      },
    };
  });
}

function hasCanvasPath(edges: Edge[], source: string, target: string) {
  const nextBySource = new Map<string, string[]>();
  for (const edge of edges) {
    nextBySource.set(edge.source, [...(nextBySource.get(edge.source) ?? []), edge.target]);
  }

  const visited = new Set<string>();
  const stack = [source];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || visited.has(current)) continue;
    if (current === target) return true;
    visited.add(current);
    stack.push(...(nextBySource.get(current) ?? []));
  }
  return false;
}

function recomputeAggregationNodes(nodes: CanvasNode[], edges: Edge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, Edge[]>();
  for (const edge of edges) {
    incomingByTarget.set(edge.target, [...(incomingByTarget.get(edge.target) ?? []), edge]);
  }

  const seriesCache = new Map<string, Array<{ year: string; amount: number }>>();

  function seriesForNode(nodeId: string, visiting = new Set<string>()): Array<{ year: string; amount: number }> {
    const cached = seriesCache.get(nodeId);
    if (cached) return cached;

    const node = nodeById.get(nodeId);
    if (!node) return sumSeries([]);
    if (node.type === 'budgetLine') {
      const series = (node.data as BudgetLineNodeData).series;
      seriesCache.set(nodeId, series);
      return series;
    }

    if (node.type === 'ruleAggregation') {
      const series = (node.data as RuleAggregationNodeData).series;
      seriesCache.set(nodeId, series);
      return series;
    }

    if (visiting.has(nodeId)) return sumSeries([]);
    const nextVisiting = new Set(visiting);
    nextVisiting.add(nodeId);
    const inputSeries = (incomingByTarget.get(nodeId) ?? []).map((edge) => seriesForNode(edge.source, nextVisiting));
    const series = sumSeries(inputSeries);
    seriesCache.set(nodeId, series);
    return series;
  }

  return nodes.map((node) => {
    if (node.type !== 'aggregation') return node;
    return {
      ...node,
      data: {
        ...(node.data as AggregationNodeData),
        inputCount: incomingByTarget.get(node.id)?.length ?? 0,
        series: seriesForNode(node.id),
      },
    };
  });
}

function valueForRuleField(row: EnrichedBudgetRow, field: RuleCondition['field']) {
  if (field === 'flowStatus') return row.flowStatuses;
  if (field === 'total') return row.total;
  return row[field];
}

function conditionMatches(row: EnrichedBudgetRow, condition: RuleCondition): boolean {
  const expected = condition.value.trim();
  if (!expected) return true;
  const actual = valueForRuleField(row, condition.field);

  if (Array.isArray(actual)) {
    return actual.some((value) => {
      const actualText = String(value).toLowerCase();
      const expectedText = expected.toLowerCase();
      if (condition.operator === 'equals') return actualText === expectedText;
      if (condition.operator === 'matches_regex') {
        try {
          return new RegExp(expected, 'i').test(String(value));
        } catch {
          return false;
        }
      }
      return actualText.includes(expectedText);
    });
  }

  if (typeof actual === 'number') {
    const expectedNumber = Number(expected);
    if (!Number.isFinite(expectedNumber)) return false;
    if (condition.operator === 'greater_than') return actual > expectedNumber;
    if (condition.operator === 'less_than') return actual < expectedNumber;
    return actual === expectedNumber;
  }

  const actualText = String(actual ?? '').toLowerCase();
  const expectedText = expected.toLowerCase();
  if (condition.operator === 'equals') return actualText === expectedText;
  if (condition.operator === 'matches_regex') {
    try {
      return new RegExp(expected, 'i').test(String(actual ?? ''));
    } catch {
      return false;
    }
  }
  return actualText.includes(expectedText);
}

function rowsForRule(conditions: RuleCondition[]) {
  return enrichedRows.filter((row) => conditions.every((condition) => conditionMatches(row, condition)));
}

function seriesForRule(conditions: RuleCondition[]) {
  const matchingRows = rowsForRule(conditions);
  return {
    matchCount: matchingRows.length,
    series: years.map((year) => ({
      year,
      amount: matchingRows
        .filter((row) => row.year === year)
        .reduce((sum, row) => sum + row.total, 0),
    })),
  };
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
  ruleAggregation: RuleAggregationCanvasNode,
};

let toggleCanvasNodeSelection: ((nodeId: string) => void) | null = null;

function CanvasTracker() {
  return (
    <ReactFlowProvider>
      <CanvasTrackerInner />
    </ReactFlowProvider>
  );
}

function CanvasTrackerInner() {
  const { screenToFlowPosition, fitView, setViewport, getViewport, setCenter } = useReactFlow();
  const initialCanvas = React.useMemo(readCanvasStorage, []);
  const canvasMcpBaseUrl = React.useMemo(
    () => (import.meta.env.VITE_CANVAS_MCP_URL ?? '').replace(/\/$/, ''),
    [],
  );
  const [query, setQuery] = React.useState('');
  const [parentFilter, setParentFilter] = React.useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<CanvasNode>(refreshBudgetLineNodeData(initialCanvas.nodes));
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialCanvas.edges);
  const nodesRef = React.useRef<CanvasNode[]>(nodes);
  const edgesRef = React.useRef<Edge[]>(edges);
  const mcpCursorRef = React.useRef<string | null>(null);
  const [renamingNodeId, setRenamingNodeId] = React.useState<string | null>(null);
  const [editingRuleNodeId, setEditingRuleNodeId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const flowCanvasRef = React.useRef<HTMLDivElement | null>(null);
  const [animScripts, setAnimScripts] = React.useState<AnimationScript[]>(() => {
    const saved = readAnimScripts();
    return saved.length > 0 ? saved : [defaultDemoScript];
  });
  const [selectedAnimScriptId, setSelectedAnimScriptId] = React.useState(animScripts[0]?.id ?? '');
  const [isAnimating, setIsAnimating] = React.useState(false);
  const [showAnimEditor, setShowAnimEditor] = React.useState(false);
  const [animStepIndex, setAnimStepIndex] = React.useState(-1);
  const [animOverlayText, setAnimOverlayText] = React.useState('');
  const animTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const animStopRef = React.useRef(false);
  const animSnapshotsRef = React.useRef<Array<{ nodeId: string; data: CanvasNode['data']; position: { x: number; y: number }; hidden?: boolean }>>([]);
  const initialViewportRef = React.useRef<{ x: number; y: number; zoom: number } | null>(null);

  React.useEffect(() => {
    try {
      window.localStorage.setItem(animScriptsStorageKey, JSON.stringify(animScripts));
    } catch { /* ignore quota errors */ }
  }, [animScripts]);

  React.useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  React.useEffect(() => {
    edgesRef.current = edges;
  }, [edges]);

  const createCanvasEdge = React.useCallback((source: string, target: string): Edge => ({
    id: `edge:${source}:${target}:${Date.now()}`,
    source,
    target,
    animated: true,
    style: { stroke: '#f97316', strokeWidth: 2.5 },
  }), []);

  const postCanvasMcpState = React.useCallback((nextNodes: CanvasNode[], nextEdges: Edge[]) => {
    if (!canvasMcpBaseUrl && import.meta.env.PROD) {
      return;
    }

    window.fetch(`${canvasMcpBaseUrl}/canvas/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nodes: nextNodes,
        edges: nextEdges,
        updatedAt: new Date().toISOString(),
      }),
    }).catch(() => {
      // The canvas works without the MCP server; ignore transient disconnects.
    });
  }, [canvasMcpBaseUrl]);

  const applyAnimStep = React.useCallback((step: AnimationStep) => {
    if (step.action === 'zoom') {
      const zoom = step.value as number | undefined;
      if (typeof zoom === 'number') {
        const vp = getViewport();
        const el = flowCanvasRef.current;
        if (el) {
          const { width, height } = el.getBoundingClientRect();
          const flowCX = (width / 2 - vp.x) / vp.zoom;
          const flowCY = (height / 2 - vp.y) / vp.zoom;
          setViewport({ x: width / 2 - flowCX * zoom, y: height / 2 - flowCY * zoom, zoom });
        } else {
          setViewport({ x: vp.x, y: vp.y, zoom });
        }
      }
      setAnimStepIndex((prev) => prev + 1);
      return;
    }
    if (step.action === 'pan') {
      const pos = step.value as { x: number; y: number } | undefined;
      if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
        setViewport({ x: pos.x, y: pos.y, zoom: getViewport().zoom });
      }
      setAnimStepIndex((prev) => prev + 1);
      return;
    }
    if (step.action === 'text') {
      setAnimOverlayText(String(step.value ?? ''));
      setAnimStepIndex((prev) => prev + 1);
      return;
    }
    if (step.action === 'panToNode') {
      const target = nodesRef.current.find((n) => n.id === step.nodeId);
      if (target) {
        const cx = target.position.x + ((target.measured?.width ?? 200) / 2);
        const cy = target.position.y + ((target.measured?.height ?? 170) / 2);
        const zoom = typeof step.value === 'number' ? step.value : getViewport().zoom;
        setCenter(cx, cy, { zoom, duration: 500 });
      }
      setAnimStepIndex((prev) => prev + 1);
      return;
    }
    animSnapshotsRef.current = animSnapshotsRef.current.slice(0, animStepIndex + 1);
    setNodes((nds) => {
      const target = nds.find((n) => n.id === step.nodeId);
      if (target) {
        animSnapshotsRef.current.push({
          nodeId: target.id,
          data: { ...target.data },
          position: { ...target.position },
          hidden: target.hidden,
        });
      }
      return nds.map((n) => {
        if (n.id !== step.nodeId) return n;
        if (step.action === 'highlight') return { ...n, data: { ...n.data, highlightedYears: step.value as string[] | undefined } } as CanvasNode;
        if (step.action === 'unhighlight') return { ...n, data: { ...n.data, highlightedYears: undefined } } as CanvasNode;
        if (step.action === 'show') return { ...n, hidden: false };
        if (step.action === 'hide') return { ...n, hidden: true };
        if (step.action === 'annotate') return { ...n, data: { ...n.data, annotation: step.value as string | undefined } } as CanvasNode;
        if (step.action === 'unannotate') return { ...n, data: { ...n.data, annotation: undefined } } as CanvasNode;
        if (step.action === 'move') {
          const pos = step.value as { x: number; y: number } | undefined;
          if (pos) return { ...n, position: { x: pos.x, y: pos.y } };
        }
        return n;
      });
    });
    setAnimStepIndex((prev) => prev + 1);
  }, [setNodes, animStepIndex, setViewport, getViewport, setCenter]);

  const stepForward = React.useCallback(() => {
    const script = animScripts.find((s) => s.id === selectedAnimScriptId);
    if (!script) return;
    const steps = script.steps.filter((s) => s.nodeId || viewportActions.has(s.action));
    if (animStepIndex >= steps.length - 1) return;
    applyAnimStep(steps[animStepIndex + 1]);
  }, [animScripts, selectedAnimScriptId, animStepIndex, applyAnimStep]);

  const stepBackward = React.useCallback(() => {
    if (animStepIndex < 0) return;
    const snap = animSnapshotsRef.current[animStepIndex];
    if (!snap) { setAnimStepIndex((prev) => prev - 1); return; }
    animSnapshotsRef.current = animSnapshotsRef.current.slice(0, animStepIndex);
    setNodes((nds) => nds.map((n) => {
      if (n.id !== snap.nodeId) return n;
      return { ...n, data: { ...snap.data }, position: { ...snap.position }, hidden: snap.hidden } as CanvasNode;
    }));
    setAnimStepIndex((prev) => prev - 1);
  }, [animStepIndex, setNodes]);

  const resetAnimation = React.useCallback(() => {
    animStopRef.current = true;
    if (animTimerRef.current !== null) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    for (let i = animStepIndex; i >= 0; i--) {
      const snap = animSnapshotsRef.current[i];
      if (snap) {
        setNodes((nds) => nds.map((n) => {
          if (n.id !== snap.nodeId) return n;
          return { ...n, data: { ...snap.data }, position: { ...snap.position }, hidden: snap.hidden } as CanvasNode;
        }));
      }
    }
    animSnapshotsRef.current = [];
    setAnimStepIndex(-1);
    setIsAnimating(false);
    setAnimOverlayText('');
    if (initialViewportRef.current) {
      setViewport(initialViewportRef.current);
      initialViewportRef.current = null;
    }
  }, [animStepIndex, setNodes, setViewport]);

  const stopAnimation = React.useCallback(() => {
    animStopRef.current = true;
    if (animTimerRef.current !== null) {
      clearTimeout(animTimerRef.current);
      animTimerRef.current = null;
    }
    setIsAnimating(false);
  }, []);

  const runAnimation = React.useCallback(() => {
    const script = animScripts.find((s) => s.id === selectedAnimScriptId);
    if (!script || script.steps.length === 0) return;

    resetAnimation();
    initialViewportRef.current = getViewport();
    animStopRef.current = false;
    setIsAnimating(true);

    const validSteps = script.steps.filter((s) => s.nodeId || viewportActions.has(s.action));

    let index = 0;
    const runStep = () => {
      if (animStopRef.current || index >= validSteps.length) {
        setIsAnimating(false);
        return;
      }
      applyAnimStep(validSteps[index]);
      index++;
      animTimerRef.current = setTimeout(runStep, validSteps[index - 1].delay);
    };

    animTimerRef.current = setTimeout(runStep, validSteps[0]?.delay ?? 0);
  }, [animScripts, selectedAnimScriptId, resetAnimation, applyAnimStep]);

  const runAnimationRef = React.useRef(runAnimation);
  runAnimationRef.current = runAnimation;
  const stopAnimationRef = React.useRef(stopAnimation);
  stopAnimationRef.current = stopAnimation;
  const stepForwardRef = React.useRef(stepForward);
  stepForwardRef.current = stepForward;
  const stepBackwardRef = React.useRef(stepBackward);
  stepBackwardRef.current = stepBackward;
  const resetAnimationRef = React.useRef(resetAnimation);
  resetAnimationRef.current = resetAnimation;

  React.useEffect(() => {
    if (!canvasMcpBaseUrl && import.meta.env.PROD) return;
    window.fetch(`${canvasMcpBaseUrl}/canvas/scripts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(animScripts),
    }).catch(() => {});
  }, [animScripts, canvasMcpBaseUrl]);

  const applyCanvasMcpCommand = React.useCallback((command: { tool: string; arguments?: Record<string, unknown> }) => {
    const args = command.arguments ?? {};
    let nextNodes = nodesRef.current;
    let nextEdges = edgesRef.current;

    const requestedPosition = {
      x: typeof args.x === 'number' ? args.x : 120 + nextNodes.length * 32,
      y: typeof args.y === 'number' ? args.y : 120 + nextNodes.length * 24,
    };

    if (command.tool === 'canvas_clear') {
      nextNodes = [];
      nextEdges = [];
      window.localStorage.removeItem('scottish-budget-tracker:canvas:v1');
    }

    if (command.tool === 'canvas_add_budget_line') {
      const canonicalArea = String(args.canonicalArea ?? '');
      const portfolio = String(args.portfolio ?? '');
      if (canonicalArea && portfolio) {
        const id = String(args.id ?? `line:${canonicalArea}:${portfolio}`);
        const existing = nextNodes.find((node) => node.id === id);
        const series = seriesForBudgetLine(portfolio);
        if (!existing) {
          nextNodes = [
            ...nextNodes,
            {
              id,
              type: 'budgetLine',
              position: requestedPosition,
              data: {
                label: portfolio,
                canonicalArea,
                series,
              },
            } as CanvasNode,
          ];
        } else {
          nextNodes = nextNodes.map((node) => node.id === id ? {
            ...node,
            position: requestedPosition,
            data: {
              ...(node.data as BudgetLineNodeData),
              label: portfolio,
              canonicalArea,
              series,
            },
          } as CanvasNode : node);
        }
      }
    }

    if (command.tool === 'canvas_add_aggregation') {
      const id = String(args.id ?? `aggregation:${Date.now()}`);
      const inputNodeIds = Array.isArray(args.inputNodeIds) ? args.inputNodeIds.map(String) : [];
      nextNodes = [
        ...nextNodes,
        {
          id,
          type: 'aggregation',
          position: requestedPosition,
          data: {
            label: String(args.label ?? 'Aggregation'),
            series: [],
            inputCount: 0,
          },
        } as CanvasNode,
      ];
      nextEdges = [
        ...nextEdges,
        ...inputNodeIds
          .filter((source) => source !== id && nextNodes.some((node) => node.id === source))
          .map((source) => createCanvasEdge(source, id)),
      ];
    }

    if (command.tool === 'canvas_add_rule') {
      const id = String(args.id ?? `rule:${Date.now()}`);
      const conditions = Array.isArray(args.conditions) ? args.conditions : [];
      const result = seriesForRule(conditions as RuleCondition[]);
      nextNodes = [
        ...nextNodes,
        {
          id,
          type: 'ruleAggregation',
          position: requestedPosition,
          data: {
            label: String(args.label ?? 'Rule Aggregation'),
            conditions: conditions as RuleCondition[],
            matchCount: result.matchCount,
            series: result.series,
          },
        } as CanvasNode,
      ];
    }

    if (command.tool === 'canvas_connect') {
      const source = String(args.source ?? '');
      const target = String(args.target ?? '');
      const sourceExists = nextNodes.some((node) => node.id === source);
      const targetExists = nextNodes.some((node) => node.id === target);
      const wouldDuplicate = nextEdges.some((edge) => edge.source === source && edge.target === target);
      if (source && target && source !== target && sourceExists && targetExists && !wouldDuplicate && !hasCanvasPath(nextEdges, target, source)) {
        nextEdges = [...nextEdges, createCanvasEdge(source, target)];
      }
    }

    if (command.tool === 'canvas_rename_node') {
      const id = String(args.id ?? args.nodeId ?? '');
      const label = String(args.label ?? '');
      if (id && label) {
        nextNodes = nextNodes.map((node) => (
          node.id === id && (node.type === 'aggregation' || node.type === 'ruleAggregation')
            ? ({ ...node, data: { ...node.data, label } } as CanvasNode)
            : node
        ));
      }
    }

    if (command.tool === 'canvas_move_node') {
      const id = String(args.nodeId ?? '');
      const x = typeof args.x === 'number' ? args.x : undefined;
      const y = typeof args.y === 'number' ? args.y : undefined;
      if (id && (x !== undefined || y !== undefined)) {
        nextNodes = nextNodes.map((node) => (
          node.id === id ? { ...node, position: { x: x ?? node.position.x, y: y ?? node.position.y } } : node
        ));
      }
    }

    if (command.tool === 'canvas_highlight_years') {
      const id = String(args.nodeId ?? '');
      const years = Array.isArray(args.years) ? args.years.map(String) : [];
      if (id) {
        nextNodes = nextNodes.map((node) => node.id !== id ? node : ({ ...node, data: { ...node.data, highlightedYears: years.length > 0 ? years : undefined } } as CanvasNode));
      }
    }

    if (command.tool === 'canvas_annotate_node') {
      const id = String(args.nodeId ?? '');
      const annotation = String(args.annotation ?? '');
      if (id) {
        nextNodes = nextNodes.map((node) => node.id !== id ? node : ({ ...node, data: { ...node.data, annotation: annotation || undefined } } as CanvasNode));
      }
    }

    if (command.tool === 'canvas_anim_save_script') {
      const scriptId = String(args.id ?? '');
      const scriptName = String(args.name ?? 'New script');
      const steps = Array.isArray(args.steps) ? args.steps : [];
      setAnimScripts((prev) => {
        const exists = prev.find((s) => s.id === scriptId);
        const updated = exists
          ? prev.map((s) => s.id === scriptId ? { ...s, name: scriptName, steps } : s)
          : [...prev, { id: scriptId, name: scriptName, steps }];
        setTimeout(() => window.localStorage.setItem(animScriptsStorageKey, JSON.stringify(updated)), 0);
        return updated;
      });
      if (scriptId) setSelectedAnimScriptId(scriptId);
    }

    if (command.tool === 'canvas_anim_delete_script') {
      const scriptId = String(args.id ?? '');
      setAnimScripts((prev) => {
        const updated = prev.filter((s) => s.id !== scriptId);
        setTimeout(() => window.localStorage.setItem(animScriptsStorageKey, JSON.stringify(updated)), 0);
        return updated;
      });
      setSelectedAnimScriptId((prev) => prev === scriptId ? '' : prev);
    }

    if (command.tool === 'canvas_anim_play') {
      const scriptId = String(args.id ?? '');
      if (scriptId) setSelectedAnimScriptId(scriptId);
      setTimeout(() => runAnimationRef.current?.(), 50);
    }

    if (command.tool === 'canvas_anim_stop') {
      stopAnimationRef.current?.();
    }

    if (command.tool === 'canvas_anim_step_forward') {
      stepForwardRef.current?.();
    }

    if (command.tool === 'canvas_anim_step_backward') {
      stepBackwardRef.current?.();
    }

    if (command.tool === 'canvas_anim_reset') {
      resetAnimationRef.current?.();
    }

    nextNodes = recomputeAggregationNodes(nextNodes, nextEdges);
    nodesRef.current = nextNodes;
    edgesRef.current = nextEdges;
    setNodes(nextNodes);
    setEdges(nextEdges);
    postCanvasMcpState(nextNodes, nextEdges);
  }, [createCanvasEdge, postCanvasMcpState, setEdges, setNodes]);

  React.useEffect(() => {
    let stopped = false;
    let inFlight = false;

    const poll = async () => {
      if (stopped || inFlight) {
        return;
      }
      inFlight = true;
      try {
        const url = `${canvasMcpBaseUrl}/canvas/commands${mcpCursorRef.current ? `?since=${encodeURIComponent(mcpCursorRef.current)}` : ''}`;
        const response = await window.fetch(url);
        if (!response.ok) {
          console.warn('[poll] bad response', response.status, url);
          return;
        }
        const payload = await response.json() as { cursor?: string | null; commands?: Array<{ tool: string; arguments?: Record<string, unknown> }> };
        if (typeof payload.cursor === 'string') {
          mcpCursorRef.current = payload.cursor;
        }
        if (payload.commands?.length) {
          console.log('[poll] processing', payload.commands.length, 'commands', payload.commands.map(c=>c.tool));
          payload.commands.forEach(applyCanvasMcpCommand);
          const hasNonAnim = payload.commands.some((c) => !c.tool.startsWith('canvas_anim_'));
          if (hasNonAnim) {
            window.setTimeout(() => fitView({ padding: 0.18, duration: 250 }), 0);
          }
        }
      } catch (err) {
        console.warn('[poll] fetch error', err);
      } finally {
        inFlight = false;
      }
    };

    const timer = window.setInterval(poll, 900);
    void poll();
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [applyCanvasMcpCommand, canvasMcpBaseUrl, fitView]);

  const handleNodesChange = React.useCallback((changes: NodeChange<CanvasNode>[]) => {
    onNodesChange(changes);
  }, [onNodesChange]);

  React.useEffect(() => {
    toggleCanvasNodeSelection = (nodeId: string) => {
      setNodes((currentNodes) => currentNodes.map((currentNode) => (
        currentNode.id === nodeId
          ? { ...currentNode, selected: !currentNode.selected }
          : currentNode
      )));
    };
    return () => {
      toggleCanvasNodeSelection = null;
    };
  }, [setNodes]);

  const availableLines = React.useMemo(() => (
    aggregateBy(rows, (row) => `${row.canonicalArea}||${row.portfolio}`)
      .map((row) => {
        const [canonicalArea, portfolio] = row.name.split('||');
        return {
          id: `${canonicalArea}||${portfolio}`,
          canonicalArea,
          portfolio,
          series: seriesForBudgetLine(portfolio),
        };
      })
      .filter((line) => `${line.canonicalArea} ${line.portfolio}`.toLowerCase().includes(query.toLowerCase()))
      .filter((line) => !parentFilter || line.canonicalArea === parentFilter)
      .sort((a, b) => latestSeriesAmount(b.series) - latestSeriesAmount(a.series))
      .slice(0, 80)
  ), [parentFilter, query]);

  React.useEffect(() => {
    setNodes((currentNodes) => recomputeAggregationNodes(currentNodes, edges));
  }, [edges, setNodes]);

  React.useEffect(() => {
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.type !== 'ruleAggregation') return node;
      const data = node.data as RuleAggregationNodeData;
      const result = seriesForRule(data.conditions);
      return {
        ...node,
        data: {
          ...data,
          matchCount: result.matchCount,
          series: result.series,
        },
      };
    }));
  }, [setNodes]);

  React.useEffect(() => {
    window.localStorage.setItem(budgetCanvasStorageKey, JSON.stringify({ nodes, edges }));
  }, [edges, nodes]);

  React.useEffect(() => {
    postCanvasMcpState(nodes, edges);
  }, [edges, nodes, postCanvasMcpState]);

  const onConnect = React.useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) return;
    setEdges((currentEdges) => {
      if (hasCanvasPath(currentEdges, connection.target!, connection.source!)) {
        return currentEdges;
      }
      return addEdge({
        ...connection,
        style: { stroke: '#0065bd', strokeWidth: 2 },
      }, currentEdges);
    });
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

  function labelForAggregationSelection(selectedNodes: CanvasNode[], fallback: string) {
    if (selectedNodes.length === 0) return fallback;

    const budgetLineParents = selectedNodes
      .filter((node): node is BudgetLineNode => node.type === 'budgetLine')
      .map((node) => node.data.canonicalArea);
    const uniqueParents = Array.from(new Set(budgetLineParents));
    if (uniqueParents.length === 1 && selectedNodes.length > 1) {
      return uniqueParents[0];
    }

    const labels = selectedNodes.map((node) => node.data.label).filter(Boolean);
    const uniqueLabels = Array.from(new Set(labels));
    const visibleLabels = uniqueLabels.slice(0, 2).join(' + ');
    const remainingCount = uniqueLabels.length - 2;
    return remainingCount > 0 ? `${visibleLabels} + ${remainingCount} more` : visibleLabels || fallback;
  }

  function addAggregation() {
    const selectedNodes = nodes.filter((node) => node.selected);
    const selectedBounds = selectedNodes.reduce((bounds, node) => ({
      minX: Math.min(bounds.minX, node.position.x),
      maxX: Math.max(bounds.maxX, node.position.x),
      minY: Math.min(bounds.minY, node.position.y),
      maxY: Math.max(bounds.maxY, node.position.y),
    }), { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity });
    const id = `aggregation:${crypto.randomUUID()}`;
    const aggregationCount = nodes.filter((node) => node.type === 'aggregation').length;
    const fallbackLabel = `Aggregation ${aggregationCount + 1}`;
    const nextNode: AggregationNode = {
      id,
      type: 'aggregation',
      position: selectedNodes.length > 0
        ? { x: selectedBounds.maxX + 320, y: selectedBounds.minY }
        : { x: 520, y: 160 + aggregationCount * 90 },
      data: {
        label: labelForAggregationSelection(selectedNodes, fallbackLabel),
        inputCount: 0,
        series: sumSeries([]),
      },
    };
    setNodes((currentNodes) => [...currentNodes, nextNode]);
    if (selectedNodes.length > 0) {
      setEdges((currentEdges) => [
        ...currentEdges,
        ...selectedNodes
          .filter((node) => node.id !== id && !hasCanvasPath(currentEdges, id, node.id))
          .map((node) => ({
            id: `${node.id}->${id}`,
            source: node.id,
            target: id,
            animated: true,
            style: { stroke: '#d16b00', strokeWidth: 3 },
          })),
      ]);
    }
  }

  function addRuleAggregation() {
    const ruleCount = nodes.filter((node) => node.type === 'ruleAggregation').length;
    const conditions: RuleCondition[] = [{
      id: crypto.randomUUID(),
      field: 'portfolio',
      operator: 'contains',
      value: '',
    }];
    const result = seriesForRule(conditions);
    const id = `rule:${crypto.randomUUID()}`;
    const nextNode: RuleAggregationNode = {
      id,
      type: 'ruleAggregation',
      position: { x: 520, y: 160 + ruleCount * 100 },
      data: {
        label: `Rule ${ruleCount + 1}`,
        conditions,
        matchCount: result.matchCount,
        series: result.series,
      },
    };
    setNodes((currentNodes) => [...currentNodes, nextNode]);
    setEditingRuleNodeId(id);
  }

  function clearCanvas() {
    const shouldClear = window.confirm('Clear the saved canvas layout and aggregations?');
    if (!shouldClear) return;
    setNodes([]);
    setEdges([]);
    window.localStorage.removeItem(budgetCanvasStorageKey);
  }

  function saveCanvasFile() {
    const payload = {
      version: 1,
      savedAt: new Date().toISOString(),
      app: 'scottish-budget-tracker',
      nodes,
      edges,
      animScripts,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `scottish-budget-canvas-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function loadCanvasFile(file: File | undefined) {
    if (!file) return;
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as Partial<CanvasStorage> & { version?: number };
      if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) {
        throw new Error('Canvas file must contain nodes and edges arrays.');
      }
      const loadedNodes = refreshBudgetLineNodeData(parsed.nodes as CanvasNode[]);
      const loadedEdges = parsed.edges as Edge[];
      setNodes(recomputeAggregationNodes(loadedNodes, loadedEdges));
      setEdges(loadedEdges);
      const loadedScripts = (parsed as Record<string, unknown>).animScripts as AnimationScript[] | undefined;
      if (Array.isArray(loadedScripts) && loadedScripts.length > 0) {
        setAnimScripts(loadedScripts);
        setSelectedAnimScriptId(loadedScripts[0].id);
      }
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Unable to load canvas file.');
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function renameAggregation(value: string) {
    if (!renamingNodeId) return;
    const label = value.trim();
    if (!label) return;
    setNodes((currentNodes) => currentNodes.map((node) => {
      if (node.id !== renamingNodeId || node.type !== 'aggregation') return node;
      return {
        ...node,
        data: {
          ...(node.data as AggregationNodeData),
          label,
        },
      };
    }));
    setRenamingNodeId(null);
  }

  const renamingNode = nodes.find((node) => node.id === renamingNodeId && node.type === 'aggregation') as AggregationNode | undefined;
  const editingRuleNode = nodes.find((node) => node.id === editingRuleNodeId && node.type === 'ruleAggregation') as RuleAggregationNode | undefined;

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
        {parentFilter ? (
          <button className="parent-filter" onClick={() => setParentFilter(null)} type="button">
            <span>{parentFilter}</span>
            <X size={16} />
          </button>
        ) : null}
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
          <div className="canvas-toolbar-row">
            <button onClick={addAggregation} type="button">
              <Plus size={16} />
              Aggregation
            </button>
            <button onClick={addRuleAggregation} type="button">
              <Plus size={16} />
              Rule
            </button>
            <button className="secondary" onClick={clearCanvas} type="button">
              Clear
            </button>
            <button className="secondary" onClick={saveCanvasFile} type="button">
              Save
            </button>
            <button className="secondary" onClick={() => fileInputRef.current?.click()} type="button">
              Load
            </button>
            <input
              ref={fileInputRef}
              className="hidden-file-input"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void loadCanvasFile(event.target.files?.[0])}
            />
            <span>{nodes.length} nodes | {edges.length} links</span>
          </div>
          <div className="canvas-toolbar-row">
            <select
              className="anim-script-select"
              value={selectedAnimScriptId}
              onChange={(e) => setSelectedAnimScriptId(e.target.value)}
              disabled={isAnimating}
            >
              {animScripts.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <button className={isAnimating ? 'danger' : ''} onClick={isAnimating ? stopAnimation : runAnimation} type="button" title={isAnimating ? 'Stop' : 'Play'}>
              {isAnimating ? '⏹' : '▶'}
            </button>
            <button className="secondary" onClick={stepBackward} type="button" title="Previous step" disabled={animStepIndex < 0}>
              ◀
            </button>
            <button className="secondary" onClick={stepForward} type="button" title="Next step">
              ▶
            </button>
            <span className="step-counter">{animStepIndex + 1}/{animScripts.find((s) => s.id === selectedAnimScriptId)?.steps.filter((s) => s.nodeId || viewportActions.has(s.action)).length ?? 0}</span>
            <button className="secondary" onClick={resetAnimation} type="button" title="Reset animation">Reset</button>
            <button className="secondary" onClick={() => setShowAnimEditor(true)} type="button" title="Edit scripts" disabled={isAnimating}>
              Edit
            </button>
          </div>
        </div>
        <div className="flow-canvas" ref={flowCanvasRef} onDragOver={handleDragOver} onDrop={handleDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={canvasNodeTypes}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeDoubleClick={(_event, node) => {
              if (node.type === 'budgetLine') {
                setParentFilter((node.data as BudgetLineNodeData).canonicalArea);
                setQuery('');
              }
              if (node.type === 'aggregation') setRenamingNodeId(node.id);
              if (node.type === 'ruleAggregation') setEditingRuleNodeId(node.id);
            }}
            multiSelectionKeyCode={null}
            selectionKeyCode={['Shift']}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            minZoom={0.08}
            maxZoom={2.5}
            fitView
          >
            <Background color="#d8dee8" gap={18} />
            <MiniMap pannable zoomable />
            <Controls />
            {animOverlayText && (
              <div style={{
                position: 'absolute',
                top: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 100,
                background: 'rgba(0,0,0,0.75)',
                color: '#fff',
                padding: '8px 24px',
                borderRadius: 8,
                fontSize: 20,
                fontWeight: 600,
                pointerEvents: 'none',
                whiteSpace: 'nowrap',
              }}>
                {animOverlayText}
              </div>
            )}
          </ReactFlow>
        </div>
      </section>
      {renamingNode ? (
        <RenameAggregationDialog
          initialValue={(renamingNode.data as AggregationNodeData).label}
          onCancel={() => setRenamingNodeId(null)}
          onSave={renameAggregation}
        />
      ) : null}
      {editingRuleNode ? (
        <RuleAggregationDialog
          data={editingRuleNode.data as RuleAggregationNodeData}
          onCancel={() => setEditingRuleNodeId(null)}
          onSave={(nextData) => {
            setNodes((currentNodes) => currentNodes.map((node) => (
              node.id === editingRuleNode.id && node.type === 'ruleAggregation'
                ? { ...node, data: nextData }
                : node
            )));
            setEditingRuleNodeId(null);
          }}
        />
      ) : null}
      {showAnimEditor && (
        <AnimScriptEditor
          scripts={animScripts}
          selectedId={selectedAnimScriptId}
          onSave={(nextScripts, nextSelectedId) => {
            setAnimScripts(nextScripts);
            if (nextSelectedId) setSelectedAnimScriptId(nextSelectedId);
            setShowAnimEditor(false);
          }}
          onCancel={() => setShowAnimEditor(false)}
        />
      )}
    </section>
  );
}

function AnimScriptEditor({ scripts, selectedId, onSave, onCancel }: {
  scripts: AnimationScript[];
  selectedId: string;
  onSave: (scripts: AnimationScript[], selectedId: string | null) => void;
  onCancel: () => void;
}) {
  const current = scripts.find((s) => s.id === selectedId) ?? scripts[0];
  const [name, setName] = React.useState(current?.name ?? '');
  const [stepsJson, setStepsJson] = React.useState(current ? JSON.stringify(current.steps, null, 2) : '[]');
  const [error, setError] = React.useState('');

  const selectedScript = scripts.find((s) => s.id === selectedId) ?? scripts[0];

  const handleSave = () => {
    setError('');
    let steps: AnimationStep[];
    try {
      steps = JSON.parse(stepsJson);
      if (!Array.isArray(steps)) { setError('Steps must be an array.'); return; }
      const nodeOptional = new Set(['zoom', 'pan', 'text']);
      for (const step of steps) {
        if (typeof step.delay !== 'number') { setError(`Step missing "delay" number.`); return; }
        if (typeof step.action !== 'string') { setError(`Step missing "action" string.`); return; }
        if (!nodeOptional.has(step.action) && typeof step.nodeId !== 'string') { setError(`Step missing "nodeId" string.`); return; }
      }
    } catch {
      setError('Invalid JSON.');
      return;
    }
    if (!name.trim()) { setError('Name is required.'); return; }

    const id = selectedScript.id;
    const updated = scripts.map((s) => s.id === id ? { ...s, name: name.trim(), steps } : s);
    onSave(updated, id);
  };

  const handleAddNew = () => {
    const newScript: AnimationScript = {
      id: `script-${Date.now()}`,
      name: 'New script',
      steps: [],
    };
    const updated = [...scripts, newScript];
    setName(newScript.name);
    setStepsJson('[]');
    setError('');
    onSave(updated, newScript.id);
  };

  const handleDelete = () => {
    if (scripts.length <= 1) return;
    const updated = scripts.filter((s) => s.id !== selectedId);
    const nextSelected = updated[0]?.id ?? null;
    onSave(updated, nextSelected);
  };

  return (
    <div className="modal-backdrop" onClick={onCancel}>
      <div className="sankey-modal anim-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div className="sankey-modal-header">
          <span><strong>Animation Script Editor</strong></span>
          <button onClick={onCancel} type="button">✕</button>
        </div>
        <select value={selectedId} onChange={(e) => {
          const s = scripts.find((sc) => sc.id === e.target.value);
          if (s) { setName(s.name); setStepsJson(JSON.stringify(s.steps, null, 2)); setError(''); }
        }}>
          {scripts.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
        <div className="anim-editor-actions">
          <button onClick={handleAddNew} type="button">New</button>
          <button className="danger" onClick={handleDelete} type="button" disabled={scripts.length <= 1}>Delete</button>
          <label>Name: <input value={name} onChange={(e) => setName(e.target.value)} /></label>
        </div>
        <div>
          <label>Steps (JSON):</label>
          <textarea
            className="anim-editor-textarea"
            value={stepsJson}
            onChange={(e) => setStepsJson(e.target.value)}
            rows={14}
            spellCheck={false}
          />
        </div>
        {error && <p className="anim-editor-error">{error}</p>}
        <div className="anim-editor-footer">
          <button className="secondary" onClick={onCancel}>Cancel</button>
          <button onClick={handleSave}>Save script</button>
        </div>
      </div>
    </div>
  );
}

function BudgetLineCanvasNode({ id, data }: NodeProps<BudgetLineNode>) {
  return (
    <div className="canvas-node budget-node" onMouseDownCapture={(event) => handleCanvasNodeMouseDown(event, id)}>
      <strong>{data.label}</strong>
      <span>{data.canonicalArea}</span>
      <SeriesMiniTable series={data.series} highlightedYears={data.highlightedYears} />
      {data.annotation && <div className="node-annotation">{data.annotation}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function AggregationCanvasNode({ id, data }: NodeProps<AggregationNode>) {
  return (
    <div className="canvas-node aggregation-node" onMouseDownCapture={(event) => handleCanvasNodeMouseDown(event, id)}>
      <Handle type="target" position={Position.Left} />
      <strong>{data.label}</strong>
      <span>{data.inputCount} inputs</span>
      <SeriesMiniTable series={data.series} highlightedYears={data.highlightedYears} />
      {data.annotation && <div className="node-annotation">{data.annotation}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function RuleAggregationCanvasNode({ id, data }: NodeProps<RuleAggregationNode>) {
  return (
    <div className="canvas-node rule-node" onMouseDownCapture={(event) => handleCanvasNodeMouseDown(event, id)}>
      <strong>{data.label}</strong>
      <span>{data.matchCount} matched rows</span>
      <small>{data.conditions.map((condition) => `${condition.field} ${condition.operator} "${condition.value}"`).join(' AND ')}</small>
      <SeriesMiniTable series={data.series} highlightedYears={data.highlightedYears} />
      {data.annotation && <div className="node-annotation">{data.annotation}</div>}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

function handleCanvasNodeMouseDown(event: React.MouseEvent, nodeId: string) {
  if (!event.ctrlKey && !event.metaKey) return;
  event.preventDefault();
  event.stopPropagation();
  toggleCanvasNodeSelection?.(nodeId);
}

const ruleFields: RuleCondition['field'][] = ['portfolio', 'canonicalArea', 'area', 'budgetLine', 'year', 'total', 'flowStatus'];
const ruleOperators: RuleCondition['operator'][] = ['contains', 'equals', 'greater_than', 'less_than', 'matches_regex'];
const flowStatusOptions = Array.from(new Set(enrichedRows.flatMap((row) => row.flowStatuses))).sort();
const ruleValueOptions: Partial<Record<RuleCondition['field'], string[]>> = {
  portfolio: Array.from(new Set(rows.map((row) => row.portfolio))).sort(),
  canonicalArea: Array.from(new Set(rows.map((row) => row.canonicalArea))).sort(),
  area: Array.from(new Set(rows.map((row) => row.area))).sort(),
  year: years,
  flowStatus: flowStatusOptions,
};

function RuleAggregationDialog({
  data,
  onCancel,
  onSave,
}: {
  data: RuleAggregationNodeData;
  onCancel: () => void;
  onSave: (data: RuleAggregationNodeData) => void;
}) {
  const [label, setLabel] = React.useState(data.label);
  const [conditions, setConditions] = React.useState<RuleCondition[]>(data.conditions);
  const preview = React.useMemo(() => seriesForRule(conditions), [conditions]);

  function updateCondition(id: string, patch: Partial<RuleCondition>) {
    setConditions((current) => current.map((condition) => condition.id === id ? { ...condition, ...patch } : condition));
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="rule-dialog" onSubmit={(event) => {
        event.preventDefault();
        onSave({
          label: label.trim() || 'Rule',
          conditions,
          matchCount: preview.matchCount,
          series: preview.series,
        });
      }}>
        <h2>Rule aggregation</h2>
        <label>
          Name
          <input value={label} onChange={(event) => setLabel(event.target.value)} />
        </label>
        <div className="rule-conditions">
          {conditions.map((condition) => (
            <div className="rule-condition-row" key={condition.id}>
              <select value={condition.field} onChange={(event) => updateCondition(condition.id, { field: event.target.value as RuleCondition['field'] })}>
                {ruleFields.map((field) => <option key={field} value={field}>{field}</option>)}
              </select>
              <select value={condition.operator} onChange={(event) => updateCondition(condition.id, { operator: event.target.value as RuleCondition['operator'] })}>
                {ruleOperators.map((operator) => <option key={operator} value={operator}>{operator}</option>)}
              </select>
              {ruleValueOptions[condition.field] && condition.operator === 'equals' ? (
                <select value={condition.value} onChange={(event) => updateCondition(condition.id, { value: event.target.value, operator: condition.operator === 'contains' ? 'equals' : condition.operator })}>
                  <option value="">Any {condition.field}</option>
                  {ruleValueOptions[condition.field]?.map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              ) : condition.field === 'total' ? (
                <input type="number" value={condition.value} onChange={(event) => updateCondition(condition.id, { value: event.target.value })} />
              ) : (
                <input value={condition.value} onChange={(event) => updateCondition(condition.id, { value: event.target.value })} />
              )}
              <button type="button" onClick={() => setConditions((current) => current.filter((item) => item.id !== condition.id))}>Remove</button>
            </div>
          ))}
        </div>
        <button type="button" onClick={() => setConditions((current) => [...current, {
          id: crypto.randomUUID(),
          field: 'portfolio',
          operator: 'contains',
          value: '',
        }])}>Add condition</button>
        <p>{preview.matchCount} rows match this rule.</p>
        <div className="dialog-actions">
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

function SeriesMiniTable({ series, highlightedYears }: { series: Array<{ year: string; amount: number }>; highlightedYears?: string[] }) {
  return (
    <table>
      <tbody>
        {series.map((point) => (
          <tr key={point.year} className={highlightedYears?.includes(point.year) ? 'highlighted' : ''}>
            <td>{point.year}</td>
            <td>{compactMoney(point.amount)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RenameAggregationDialog({
  initialValue,
  onCancel,
  onSave,
}: {
  initialValue: string;
  onCancel: () => void;
  onSave: (value: string) => void;
}) {
  const [value, setValue] = React.useState(initialValue);

  return (
    <div className="modal-backdrop" role="presentation">
      <form className="rename-dialog" onSubmit={(event) => {
        event.preventDefault();
        onSave(value);
      }}>
        <h2>Rename aggregation</h2>
        <input autoFocus value={value} onChange={(event) => setValue(event.target.value)} />
        <div>
          <button type="button" onClick={onCancel}>Cancel</button>
          <button type="submit">Save</button>
        </div>
      </form>
    </div>
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
