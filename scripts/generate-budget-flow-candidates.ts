import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type BudgetRow = {
  year: string;
  area: string;
  canonicalArea: string;
  portfolio: string;
  budgetLine: string;
  total: number;
};

type LineNode = {
  id: string;
  year: string;
  canonicalArea: string;
  portfolio: string;
  total: number;
};

type Evidence = {
  kind: string;
  detail: string;
  score?: number;
};

type Candidate = {
  id: string;
  type: 'rename' | 'split' | 'merge' | 'new' | 'retired' | 'zeroed' | 'moved' | 'extracted';
  confidence: 'high' | 'medium' | 'low';
  score: number;
  from: LineNode[];
  to: LineNode[];
  reason: string;
  evidence: Evidence[];
};

const dataDir = join(process.cwd(), 'data');
const genericLabels = new Set([
  'Capital',
  'Fund',
  'Level 3 Total',
  'Other',
  'Other Below £2m',
  'Pay',
  'Resource',
  'Salaries and Other Costs',
]);

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 100);
}

function clean(value: string) {
  return value.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
}

function tokens(value: string) {
  return new Set(clean(value).split(/\s+/).filter((token) => token.length > 2));
}

function similarity(left: string, right: string) {
  const a = tokens(left);
  const b = tokens(right);
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

function textEvidenceScore(from: BudgetRow, to: BudgetRow) {
  const toLabelTokens = tokens(to.portfolio);
  const fromTextTokens = tokens(`${from.portfolio} ${from.budgetLine}`);
  if (toLabelTokens.size === 0) return 0;
  const hits = [...toLabelTokens].filter((token) => fromTextTokens.has(token)).length;
  return hits / toLabelTokens.size;
}

function continuesNextYear(row: BudgetRow, allRows: BudgetRow[], years: string[]) {
  const yearIndex = years.indexOf(row.year);
  const nextYear = years[yearIndex + 1];
  if (!nextYear) return false;
  return allRows.some((candidate) => (
    candidate.year === nextYear
    && candidate.canonicalArea === row.canonicalArea
    && candidate.portfolio === row.portfolio
  ));
}

function amountRatio(left: number, right: number) {
  const max = Math.max(Math.abs(left), Math.abs(right));
  if (max === 0) return 1;
  return 1 - Math.min(Math.abs(left - right) / max, 1);
}

function confidence(score: number): Candidate['confidence'] {
  if (score >= 0.82) return 'high';
  if (score >= 0.62) return 'medium';
  return 'low';
}

function isUsefulLabel(label: string) {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (genericLabels.has(normalized)) return false;
  if (/^total\b/i.test(normalized)) return false;
  return normalized.length >= 4;
}

function makeNode(row: BudgetRow): LineNode {
  return {
    id: `${row.year}::${row.canonicalArea}::${row.portfolio}`,
    year: row.year,
    canonicalArea: row.canonicalArea,
    portfolio: row.portfolio,
    total: row.total,
  };
}

function addCandidate(candidates: Candidate[], candidate: Candidate) {
  if (candidate.score < 0.45 && !['new', 'retired', 'zeroed'].includes(candidate.type)) return;
  if (candidates.some((existing) => existing.id === candidate.id)) return;
  candidates.push(candidate);
}

async function main() {
  const rows = JSON.parse(await readFile(join(dataDir, 'budget-level-4.normalized.json'), 'utf8')) as BudgetRow[];
  const years = Array.from(new Set(rows.map((row) => row.year))).sort();
  const candidates: Candidate[] = [];

  const usefulRows = rows.filter((row) => isUsefulLabel(row.portfolio));

  for (let index = 0; index < years.length - 1; index += 1) {
    const fromYear = years[index];
    const toYear = years[index + 1];
    const fromRows = usefulRows.filter((row) => row.year === fromYear);
    const toRows = usefulRows.filter((row) => row.year === toYear);
    const fromKeys = new Set(fromRows.map((row) => `${row.canonicalArea}||${row.portfolio}`));
    const toKeys = new Set(toRows.map((row) => `${row.canonicalArea}||${row.portfolio}`));
    const vanished = fromRows.filter((row) => !toKeys.has(`${row.canonicalArea}||${row.portfolio}`));
    const appeared = toRows.filter((row) => !fromKeys.has(`${row.canonicalArea}||${row.portfolio}`));

    for (const from of vanished) {
      const best = appeared
        .map((to) => {
          const labelScore = similarity(from.portfolio, to.portfolio);
          const areaScore = from.canonicalArea === to.canonicalArea ? 1 : similarity(from.canonicalArea, to.canonicalArea);
          const valueScore = amountRatio(from.total, to.total);
          const score = (labelScore * 0.62) + (areaScore * 0.2) + (valueScore * 0.18);
          return { to, score, labelScore, areaScore, valueScore };
        })
        .sort((a, b) => b.score - a.score)[0];

      if (best && best.score >= 0.52) {
        const type = from.canonicalArea === best.to.canonicalArea ? 'rename' : 'moved';
        addCandidate(candidates, {
          id: `${type}-${slug(fromYear)}-${slug(from.portfolio)}-to-${slug(best.to.portfolio)}`,
          type,
          confidence: confidence(best.score),
          score: Number(best.score.toFixed(3)),
          from: [makeNode(from)],
          to: [makeNode(best.to)],
          reason: `Best ${fromYear} to ${toYear} unmatched-line match: label ${best.labelScore.toFixed(2)}, area ${best.areaScore.toFixed(2)}, amount ${best.valueScore.toFixed(2)}.`,
          evidence: [
            { kind: 'label_similarity', detail: `${from.portfolio} -> ${best.to.portfolio}`, score: Number(best.labelScore.toFixed(3)) },
            { kind: 'area_similarity', detail: `${from.canonicalArea} -> ${best.to.canonicalArea}`, score: Number(best.areaScore.toFixed(3)) },
            { kind: 'amount_similarity', detail: `${from.total.toFixed(1)}m -> ${best.to.total.toFixed(1)}m`, score: Number(best.valueScore.toFixed(3)) },
          ],
        });
      } else {
        addCandidate(candidates, {
          id: `retired-${slug(fromYear)}-${slug(from.canonicalArea)}-${slug(from.portfolio)}`,
          type: 'retired',
          confidence: 'medium',
          score: 1,
          from: [makeNode(from)],
          to: [],
          reason: `Line appears in ${fromYear} but not ${toYear}.`,
          evidence: [
            { kind: 'missing_next_year', detail: `${from.portfolio} does not appear as an exact line in ${toYear}.` },
          ],
        });
      }
    }

    for (const to of appeared) {
      const possibleParents = fromRows
        .map((from) => ({
          from,
          descriptionScore: textEvidenceScore(from, to),
          amountScore: amountRatio(from.total, to.total),
          areaScore: from.canonicalArea === to.canonicalArea ? 1 : similarity(from.canonicalArea, to.canonicalArea),
        }))
        .filter((item) => item.descriptionScore >= 0.5 && item.areaScore >= 0.35)
        .sort((a, b) => (b.descriptionScore + b.amountScore + b.areaScore) - (a.descriptionScore + a.amountScore + a.areaScore));
      const parent = possibleParents[0];
      const hasNextYearContinuation = continuesNextYear(to, usefulRows, years);
      if (parent) {
        const score = (parent.descriptionScore * 0.48) + (parent.amountScore * 0.2) + (parent.areaScore * 0.12) + (hasNextYearContinuation ? 0.2 : 0);
        addCandidate(candidates, {
          id: `extracted-${slug(toYear)}-${slug(parent.from.portfolio)}-to-${slug(to.portfolio)}`,
          type: 'extracted',
          confidence: confidence(score),
          score: Number(score.toFixed(3)),
          from: [makeNode(parent.from)],
          to: [makeNode(to)],
          reason: `${to.portfolio} appears as a new explicit line in ${toYear}, while the prior-year ${parent.from.portfolio} description contains matching terms.`,
          evidence: [
            { kind: 'description_match', detail: `${to.portfolio} terms appear in prior ${parent.from.portfolio} description.`, score: Number(parent.descriptionScore.toFixed(3)) },
            { kind: parent.from.canonicalArea === to.canonicalArea ? 'same_policy_area' : 'related_policy_area', detail: `${parent.from.canonicalArea} -> ${to.canonicalArea}`, score: Number(parent.areaScore.toFixed(3)) },
            { kind: 'amount_similarity', detail: `${parent.from.total.toFixed(1)}m -> ${to.total.toFixed(1)}m`, score: Number(parent.amountScore.toFixed(3)) },
            ...(hasNextYearContinuation ? [{ kind: 'continues_next_year', detail: `${to.portfolio} also appears in ${years[years.indexOf(toYear) + 1]}.`, score: 1 }] : []),
          ],
        });
      }

      const hasIncoming = candidates.some((candidate) => (
        candidate.to.some((node) => node.year === to.year && node.canonicalArea === to.canonicalArea && node.portfolio === to.portfolio)
      ));
      if (!hasIncoming) {
        addCandidate(candidates, {
          id: `new-${slug(toYear)}-${slug(to.canonicalArea)}-${slug(to.portfolio)}`,
          type: 'new',
          confidence: 'medium',
          score: 1,
          from: [],
          to: [makeNode(to)],
          reason: `Line appears in ${toYear} but not ${fromYear}.`,
          evidence: [
            { kind: 'new_exact_label', detail: `${to.portfolio} does not appear as an exact line in ${fromYear}.` },
            ...(continuesNextYear(to, usefulRows, years) ? [{ kind: 'continues_next_year', detail: `${to.portfolio} also appears in ${years[years.indexOf(toYear) + 1]}.`, score: 1 }] : []),
          ],
        });
      }
    }

    for (const from of vanished) {
      const possibleChildren = appeared
        .filter((to) => to.canonicalArea === from.canonicalArea)
        .map((to) => ({ to, score: similarity(from.portfolio, to.portfolio) }))
        .filter((item) => item.score >= 0.28)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      const childTotal = possibleChildren.reduce((sum, item) => sum + item.to.total, 0);
      if (possibleChildren.length >= 2 && amountRatio(from.total, childTotal) >= 0.45) {
        const score = (possibleChildren.reduce((sum, item) => sum + item.score, 0) / possibleChildren.length * 0.65) + (amountRatio(from.total, childTotal) * 0.35);
        addCandidate(candidates, {
          id: `split-${slug(fromYear)}-${slug(from.portfolio)}`,
          type: 'split',
          confidence: confidence(score),
          score: Number(score.toFixed(3)),
          from: [makeNode(from)],
          to: possibleChildren.map((item) => makeNode(item.to)),
          reason: `One vanished line has ${possibleChildren.length} possible same-area successors with combined value similarity ${amountRatio(from.total, childTotal).toFixed(2)}.`,
          evidence: [
            { kind: 'multiple_successors', detail: possibleChildren.map((item) => item.to.portfolio).join(', ') },
            { kind: 'combined_amount_similarity', detail: `${from.total.toFixed(1)}m -> ${childTotal.toFixed(1)}m`, score: Number(amountRatio(from.total, childTotal).toFixed(3)) },
          ],
        });
      }
    }

    for (const to of appeared) {
      const possibleParents = vanished
        .filter((from) => from.canonicalArea === to.canonicalArea)
        .map((from) => ({ from, score: similarity(from.portfolio, to.portfolio) }))
        .filter((item) => item.score >= 0.28)
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);
      const parentTotal = possibleParents.reduce((sum, item) => sum + item.from.total, 0);
      if (possibleParents.length >= 2 && amountRatio(parentTotal, to.total) >= 0.45) {
        const score = (possibleParents.reduce((sum, item) => sum + item.score, 0) / possibleParents.length * 0.65) + (amountRatio(parentTotal, to.total) * 0.35);
        addCandidate(candidates, {
          id: `merge-${slug(toYear)}-${slug(to.portfolio)}`,
          type: 'merge',
          confidence: confidence(score),
          score: Number(score.toFixed(3)),
          from: possibleParents.map((item) => makeNode(item.from)),
          to: [makeNode(to)],
          reason: `${possibleParents.length} vanished same-area lines have one possible successor with combined value similarity ${amountRatio(parentTotal, to.total).toFixed(2)}.`,
          evidence: [
            { kind: 'multiple_predecessors', detail: possibleParents.map((item) => item.from.portfolio).join(', ') },
            { kind: 'combined_amount_similarity', detail: `${parentTotal.toFixed(1)}m -> ${to.total.toFixed(1)}m`, score: Number(amountRatio(parentTotal, to.total).toFixed(3)) },
          ],
        });
      }
    }

    for (const row of toRows.filter((item) => item.total === 0)) {
      const existedBefore = fromRows.some((from) => from.canonicalArea === row.canonicalArea && from.portfolio === row.portfolio && from.total !== 0);
      if (existedBefore) {
        addCandidate(candidates, {
          id: `zeroed-${slug(toYear)}-${slug(row.canonicalArea)}-${slug(row.portfolio)}`,
          type: 'zeroed',
          confidence: 'high',
          score: 1,
          from: fromRows.filter((from) => from.canonicalArea === row.canonicalArea && from.portfolio === row.portfolio).map(makeNode),
          to: [makeNode(row)],
          reason: `Line continues into ${toYear} with zero total after non-zero prior-year value.`,
          evidence: [
            { kind: 'zero_total', detail: `${row.portfolio} has zero total in ${toYear}.`, score: 1 },
          ],
        });
      }
    }
  }

  candidates.sort((a, b) => (
    b.score - a.score
    || a.type.localeCompare(b.type)
    || (a.from[0]?.portfolio ?? a.to[0]?.portfolio ?? '').localeCompare(b.from[0]?.portfolio ?? b.to[0]?.portfolio ?? '')
  ));

  await writeFile(join(dataDir, 'budget-line-flow-candidates.json'), `${JSON.stringify({
    version: 1,
    description: 'Generated candidate budget-line changes for review. These are not accepted mappings until manually promoted into budget-line-flows.json.',
    generatedAt: new Date().toISOString(),
    candidates,
  }, null, 2)}\n`);

  console.log(`Wrote ${candidates.length} budget line flow candidates to data/budget-line-flow-candidates.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
