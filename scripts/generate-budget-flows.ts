import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

type BudgetRow = {
  year: string;
  area: string;
  canonicalArea: string;
  portfolio: string;
  total: number;
};

type Flow = {
  id: string;
  type: 'continuation';
  confidence: 'high' | 'medium';
  label: string;
  fromYear: string;
  toYear: string;
  links: Array<{
    year: string;
    canonicalArea: string;
    portfolio: string;
  }>;
  notes: string;
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
    .slice(0, 90);
}

function isUsefulLabel(label: string) {
  const normalized = label.replace(/\s+/g, ' ').trim();
  if (genericLabels.has(normalized)) return false;
  if (/^total\b/i.test(normalized)) return false;
  return normalized.length >= 4;
}

async function main() {
  const rows = JSON.parse(await readFile(join(dataDir, 'budget-level-4.normalized.json'), 'utf8')) as BudgetRow[];
  const byKey = new Map<string, BudgetRow[]>();

  for (const row of rows) {
    if (!isUsefulLabel(row.portfolio)) continue;
    const key = `${row.canonicalArea}||${row.portfolio}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row]);
  }

  const flows: Flow[] = [];
  for (const [key, items] of byKey) {
    const years = Array.from(new Set(items.map((row) => row.year))).sort();
    if (years.length < 3) continue;

    const [canonicalArea, portfolio] = key.split('||');
    flows.push({
      id: `${slug(canonicalArea)}-${slug(portfolio)}`,
      type: 'continuation',
      confidence: years.length >= 4 ? 'high' : 'medium',
      label: portfolio,
      fromYear: years[0],
      toYear: years.at(-1) ?? years[0],
      links: years.map((year) => ({
        year,
        canonicalArea,
        portfolio,
      })),
      notes: `Generated exact-label match within canonical area "${canonicalArea}". Review before treating as audited continuity.`,
    });
  }

  flows.sort((a, b) => (
    b.links.length - a.links.length
    || a.label.localeCompare(b.label)
  ));

  await writeFile(join(dataDir, 'budget-line-flows.json'), `${JSON.stringify({
    version: 1,
    description: 'Explicit and generated mappings for how source budget lines change across years. Amounts are GBP million. Generated exact-label matches should be reviewed before being treated as audited continuity.',
    generatedAt: new Date().toISOString(),
    flows,
  }, null, 2)}\n`);

  console.log(`Wrote ${flows.length} budget line flows to data/budget-line-flows.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
