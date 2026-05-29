import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import { budgetSources } from './sources';

type OutputRow = {
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

const outputDir = join(process.cwd(), 'data');
const crosswalkPath = join(outputDir, 'budget-area-crosswalk.json');
let areaCrosswalk: Record<string, string> = {};

function decodeHtml(value: string) {
  return value.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
}

function absoluteUrl(base: string, href: string) {
  return new URL(decodeHtml(href), base).toString();
}

async function findWorkbookUrl(pageUrl: string, textPattern: RegExp) {
  const response = await fetch(pageUrl);
  if (!response.ok) throw new Error(`Could not fetch ${pageUrl}: ${response.status}`);
  const html = await response.text();
  const linkPattern = /<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(linkPattern)) {
    const label = match[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (textPattern.test(label)) return absoluteUrl(pageUrl, match[1]);
  }
  throw new Error(`Could not find Level 4 workbook link on ${pageUrl}`);
}

function toNumber(value: unknown) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return 0;
  const cleaned = value.replace(/[£,\s]/g, '').replace(/[()]/g, '-');
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function firstTextValue(values: unknown[]) {
  const value = values.find((item): item is string => typeof item === 'string' && item.trim().length > 0);
  return value?.replace(/\s+/g, ' ').trim();
}

function isHelperSheet(sheetName: string) {
  return /^(contents|data sheet)$/i.test(sheetName.trim());
}

function areaFromSheet(sheetName: string, rows: unknown[][]) {
  const headerRow = rows.find((row) => (
    typeof row[0] === 'string'
    && row.some((value) => typeof value === 'string' && /Fiscal\s*Resource/i.test(value))
  ));
  return firstTextValue(headerRow ?? []) ?? sheetName;
}

function canonicalArea(area: string) {
  return areaCrosswalk[area] ?? area.replace(/\s+/g, ' ').trim();
}

function headerIndexForYear(headerRow: unknown[], year: string, labelPattern: RegExp) {
  const compactYear = year.replace('-', '');
  return headerRow.findIndex((value) => (
    typeof value === 'string'
    && value.replace(/\D/g, '').startsWith(compactYear)
    && labelPattern.test(value)
  ));
}

function headerRowForSheet(rows: unknown[][]) {
  return rows.find((row) => (
    typeof row[0] === 'string'
    && row.some((value) => typeof value === 'string' && /Fiscal\s*Resource/i.test(value))
  ));
}

async function rowsFromWorkbook(year: string, buffer: ArrayBuffer): Promise<OutputRow[]> {
  const workbookBuffer = Buffer.from(buffer);
  const sheets = await readXlsxFile(workbookBuffer);
  const outputRows: OutputRow[] = [];

  for (const sheet of sheets) {
    if (isHelperSheet(sheet.sheet)) continue;
    const area = areaFromSheet(sheet.sheet, sheet.data);
    const headerRow = headerRowForSheet(sheet.data);
    if (!headerRow) continue;
    const resourceIndex = headerIndexForYear(headerRow, year, /Fiscal\s*Resource/i);
    const capitalIndex = headerIndexForYear(headerRow, year, /Capital/i);
    const totalIndex = headerIndexForYear(headerRow, year, /Scottish\s*Budget/i);
    if (resourceIndex === -1 || capitalIndex === -1 || totalIndex === -1) continue;

    for (const values of sheet.data) {
      const textValues = values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0);
      if (textValues.length < 2) continue;
      const resource = toNumber(values[resourceIndex]);
      const capital = toNumber(values[capitalIndex]);
      const total = toNumber(values[totalIndex]);
      if (resource === 0 && capital === 0 && total === 0) continue;

      outputRows.push({
        year,
        sheet: sheet.sheet,
        area,
        canonicalArea: canonicalArea(area),
        portfolio: textValues[0],
        budgetLine: textValues[1],
        resource,
        capital,
        total,
      });
    }
  }

  return outputRows;
}

async function main() {
  await mkdir(outputDir, { recursive: true });
  areaCrosswalk = JSON.parse(await readFile(crosswalkPath, 'utf8')) as Record<string, string>;
  const allRows: OutputRow[] = [];

  for (const source of budgetSources) {
    const workbookUrl = await findWorkbookUrl(source.documentsPage, source.level4LinkText);
    const response = await fetch(workbookUrl);
    if (!response.ok) throw new Error(`Could not fetch ${workbookUrl}: ${response.status}`);
    const buffer = await response.arrayBuffer();
    const fileName = `scottish-budget-${source.year}-level-4.xlsx`;
    await writeFile(join(outputDir, fileName), Buffer.from(buffer));
    allRows.push(...await rowsFromWorkbook(source.year, buffer));
  }

  await writeFile(join(outputDir, 'budget-level-4.normalized.json'), JSON.stringify(allRows, null, 2));
  console.log(`Wrote ${allRows.length} normalized rows to data/budget-level-4.normalized.json`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
