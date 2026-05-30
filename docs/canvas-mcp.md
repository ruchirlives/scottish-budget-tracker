# Canvas MCP Server

The canvas can be controlled by a local remote-type MCP HTTP server.

Run the server alongside Vite:

```powershell
npm run mcp
npm run dev
```

The Vite dev server proxies `/mcp`, `/canvas`, and `/health` to `http://127.0.0.1:8787`.

Remote MCP endpoint:

```text
http://127.0.0.1:8787/mcp
```

Canvas tools include:

- `canvas_add_budget_line`
- `canvas_add_aggregation`
- `canvas_add_rule`
- `canvas_connect`
- `canvas_rename_node`
- `canvas_clear`
- `canvas_get_state`

The React app polls `/canvas/commands`, applies queued canvas commands, posts the refreshed React Flow state to `/canvas/state`, and refits the viewport after command batches.
