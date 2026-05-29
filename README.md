# Scottish Budget Tracker

Independent Node.js app for processing and visualising published Scottish budget data across multiple years.

This is an independent project. It is not affiliated with, endorsed by, or produced by the Scottish Government.

## Data sources

The ingestion script uses official Scottish Government supporting documents pages and resolves the detailed Level 4 Excel workbooks from those pages:

- Scottish Budget 2024 to 2025 supporting documents: https://www.gov.scot/publications/scottish-budget-2024-25/documents/
- Scottish Budget 2025 to 2026 supporting documents: https://www.gov.scot/publications/scottish-budget-2025-2026/documents/
- Scottish Budget 2022 to 2023 supporting documents: https://www.gov.scot/publications/scottish-budget-2022-23/documents/
- Scottish Budget 2023 to 2024 supporting documents: https://www.gov.scot/publications/scottish-budget-2023-24/documents/

Run the ingestion command to download the official Level 4 workbooks into `data/` and produce a normalized JSON extract. The parser also applies `data/budget-area-crosswalk.json` to add `canonicalArea` labels for cleaner year-on-year comparison while preserving original source area names.

Budget line evolution should be modelled in `data/budget-line-flows.json`. That file supports explicit many-to-many mappings for continuations, renames, splits, merges, new lines, retired lines, zeroed lines, and reclassifications.

Broad actual expenditure is represented through Scottish Government provisional outturn reporting:

- https://www.gov.scot/publications/2024-25-provisional-outturn-briefing-note-24-june-2025/

The current outturn dataset is manually captured in `data/provisional-outturn-2024-25.json` from Table 1 of the official briefing note. It reports HM Treasury budget variances by portfolio, not Level 4 transaction data.

## Commands

```powershell
npm install
npm run fetch:data
npm run generate:flows
npm run generate:flow-candidates
npm run dev
npm run build
```

## Notes

- Source data is Crown copyright and published under the Open Government Licence unless otherwise stated on gov.scot.
- This repository includes official `.xlsx` source workbooks and derived JSON files. See `DATA_NOTICE.md` for OGL v3.0 attribution and source links.
- App code is copyright Ruchir Shah and licensed under Creative Commons Attribution-NonCommercial 4.0 International in `LICENSE`. See `NOTICE.md`.
- The first parser is intentionally broad because workbook layouts vary by year. Tighten `scripts/fetch-budget-data.ts` as the visual model settles.
- Keep Budget Tracker and Outturn as separate views unless a reliable official budget-line outturn mapping becomes available.
- Level 4 budget ingestion currently covers 2022-23 onward. The 2021-22 supporting workbook available on gov.scot is an aggregate Annex C table rather than the same Level 4 workbook structure.
