import React from 'react';
import ReactDOM from 'react-dom/client';
import { ArrowDownUp, ChevronRight, Database, Download, LineChart as LineChartIcon, Search, X } from 'lucide-react';
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

const maxBudgetAreaTotal = Math.max(...years.flatMap((year) => aggregateBy(rows.filter((row) => row.year === year), (row) => row.canonicalArea).map((row) => row.total)));
function BudgetTracker() {
  const [selectedYear, setSelectedYear] = React.useState(latestYear);
  const [query, setQuery] = React.useState('');
  const [selectedArea, setSelectedArea] = React.useState<string | null>(null);
  const [selectedLine, setSelectedLine] = React.useState<string | null>(null);
  const [budgetMode, setBudgetMode] = React.useState<'explore' | 'flows'>('explore');
  const [selectedFlowId, setSelectedFlowId] = React.useState(flows[0]?.id ?? '');
  const [flowQuery, setFlowQuery] = React.useState('');
  const [candidateQuery, setCandidateQuery] = React.useState('');

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
  const visibleCandidates = flowCandidates.filter((candidate) => {
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
                <h2>Candidate changes for review</h2>
              </div>
              <label className="search full">
                <Search size={18} />
                <input value={candidateQuery} onChange={(event) => setCandidateQuery(event.target.value)} placeholder="Filter candidates by type, area, or line" />
              </label>
              <div className="candidate-list">
                {visibleCandidates.map((candidate) => (
                  <article key={candidate.id}>
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

function App() {
  const [activeTab, setActiveTab] = React.useState<'budget' | 'outturn'>('budget');

  return (
    <main>
      <header className="app-header">
        <div>
          <p className="eyebrow">Scottish Budget Tracker</p>
          <h1>Compare planned budgets with broad outturn reporting</h1>
          <p className="disclaimer">Independent project using published Scottish Government data. Not affiliated with or endorsed by the Scottish Government.</p>
        </div>
        <a className="source-link" href={activeTab === 'budget' ? 'https://www.gov.scot/publications/scottish-budget-2025-2026/documents/' : outturnData.sourceUrl} target="_blank">
          <Database size={18} />
          {activeTab === 'budget' ? 'budget source' : 'outturn source'}
        </a>
      </header>

      <div className="tabs" role="tablist" aria-label="Data view">
        <button className={activeTab === 'budget' ? 'active' : ''} onClick={() => setActiveTab('budget')} type="button">Budget Tracker</button>
        <button className={activeTab === 'outturn' ? 'active' : ''} onClick={() => setActiveTab('outturn')} type="button">Outturn</button>
      </div>

      {activeTab === 'budget' ? <BudgetTracker /> : <OutturnTracker />}
    </main>
  );
}

ReactDOM.createRoot(document.getElementById('app')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
