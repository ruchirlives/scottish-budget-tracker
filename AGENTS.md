# AGENTS.md

## Project

This repo is a Node.js app for processing and visualising published Scottish budget data across multiple years.

This is an independent project. It is not affiliated with, endorsed by, or produced by the Scottish Government. Keep public-facing product names as "Scottish Budget Tracker" rather than "Scottish Government Budget Tracker".

The app currently uses:

- Vite
- React
- TypeScript
- Recharts
- `read-excel-file` for parsing downloaded `.xlsx` workbooks

## Environment

- Shell: PowerShell on Windows in VS Code
- Working directory: `e:\CODINGPROJECTS\NodeJS\ScottishGovernmentBudget`
- Use PowerShell-compatible commands. Do not use `&&`; run commands separately or use PowerShell syntax.

## Commands

```powershell
npm install
npm run fetch:data
npm run generate:flows
npm run generate:flow-candidates
npm run mcp
npm run dev
npm run build
npm audit --omit=dev
```

## Data Sources

Use official Scottish Government supporting documents pages as the source of truth.

Current source pages:

- https://www.gov.scot/publications/scottish-budget-2022-23/documents/
- https://www.gov.scot/publications/scottish-budget-2023-24/documents/
- https://www.gov.scot/publications/scottish-budget-2024-25/documents/
- https://www.gov.scot/publications/scottish-budget-2025-2026/documents/

The detailed budget data comes from the Level 4 Excel workbooks linked from those pages.

Level 4 ingestion currently covers 2022-23 onward. The 2021-22 supporting workbook available on gov.scot is an aggregate Annex C table, so do not add it to `scripts/sources.ts` without writing a separate parser and marking it as lower-granularity data.

Budget area labels are normalised through:

- `data/budget-area-crosswalk.json`

The crosswalk adds `canonicalArea` labels for year-on-year comparison. Preserve original `area` values for source traceability.

Budget line changes are modelled explicitly through:

- `data/budget-line-flows.json`

Use this for many-to-many line evolution such as continuation, rename, split, merge, new, retired, zeroed, or reclassified. Do not infer Level 4 continuity from labels alone unless the UI marks it as heuristic.

Broad actual expenditure data comes from Scottish Government provisional outturn reporting:

- https://www.gov.scot/publications/2024-25-provisional-outturn-briefing-note-24-june-2025/

The current outturn dataset is manually captured in `data/provisional-outturn-2024-25.json` from the official briefing note. It reports broad HM Treasury budget variances by portfolio, not Level 4 transaction data.

Run:

```powershell
npm run fetch:data
```

This downloads source workbooks into `data/` and writes:

- `data/budget-level-4.normalized.json`
- `data/provisional-outturn-2024-25.json`

When adding new years, update `scripts/sources.ts` and verify the parser still produces sensible normalized rows.

## Development Notes

- Keep data ingestion separate from frontend presentation.
- Prefer official spreadsheet data over numbers copied manually from PDFs or pages.
- If a workbook layout changes, tighten `scripts/fetch-budget-data.ts` rather than adding one-off frontend fixes.
- Keep the dashboard usable on desktop and mobile.
- Run `npm run build` before handing off changes.
- Run `npm audit --omit=dev` after dependency changes.
- Run `npm run mcp` to start the local remote-type MCP HTTP server for canvas automation. The endpoint is `http://127.0.0.1:8787/mcp`; Vite proxies `/mcp`, `/canvas`, and `/health` during development.

## Canvas Animation Scripts

When writing animation scripts for the canvas MCP app:

- **Keep annotations visible** — do not use `unannotate` or `unhighlight` steps. Once a node is highlighted/annotated it should stay that way through the rest of the animation so viewers can read at their own pace.
- **Pan to each node of interest** — always add a `panToNode` step before highlighting or annotating a node that isn't already in view. Use `setCenter` with `duration: 500` under the hood; zoom values should be tuned so the target node fills most of the viewport without cropping nearby nodes.
- **Use `panToNode` with sensible zoom** — start zoomed out (0.65–0.8) for column-level overviews, zoom in (0.9–1.0) for individual node details.
- **Use `panToNode` over `zoom` for viewport** — `zoom` action zooms toward viewport center; `panToNode` centers on a specific node. Prefer `panToNode` for narrative walkthroughs.
- **End with a summary text overlay** — final step should be a `text` action summarising the key takeaways.
- **Reset before replay** — call `canvas_anim_reset` before `canvas_anim_play` to clear previous state.

## Repo Hygiene

- This repo may not be initialized as a Git repository.
- Do not remove downloaded source data unless explicitly asked.
- Do not commit or depend on `dist/` unless the user asks for built assets to be versioned.

## External AI Work Note

If work later involves ComfyUI, the ComfyUI installation is at:

```text
I:\AI\ComfyUI-Github\ComfyUI
```

The `workflows`, `models`, and `custom_nodes` folders are outside the ComfyUI installation under `I:\AI`, which is also the root folder for AI-related repos. The machine has an RTX 3090 and 64 GB system RAM.
