import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';

type CanvasCommand = {
  id: string;
  tool: string;
  arguments?: Record<string, unknown>;
};

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

type BudgetLine = {
  canonicalArea: string;
  portfolio: string;
  areas: string[];
  sheets: string[];
  budgetLines: string[];
  latestYear: string;
  latestTotal: number;
  years: Array<{ year: string; amount: number }>;
};

const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 8787);
const commands: CanvasCommand[] = [];
let lastCanvasState: unknown = null;
let lastAnimScripts: unknown = null;
const sseSessions = new Map<string, ServerResponse>();
const budgetRows = JSON.parse(readFileSync(new URL('../data/budget-level-4.normalized.json', import.meta.url), 'utf8')) as BudgetRow[];
const budgetYears = Array.from(new Set(budgetRows.map((row) => row.year))).sort();
const latestBudgetYear = budgetYears.at(-1) ?? '';
const budgetLines = buildBudgetLines();

const tools = [
  {
    name: 'canvas_add_budget_line',
    description: 'Add or move an existing budget line node from the normalized budget data onto the canvas. Use query when you do not know the exact canonicalArea and portfolio.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search text, for example "NHS Pension Scheme".' },
        canonicalArea: { type: 'string' },
        portfolio: { type: 'string' },
        area: { type: 'string' },
        sheet: { type: 'string' },
        budgetLine: { type: 'string' },
        year: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
  },
  {
    name: 'canvas_search_budget_lines',
    description: 'Search existing normalized budget lines available in the canvas sidebar.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        field: {
          type: 'string',
          enum: ['all', 'year', 'sheet', 'area', 'canonicalArea', 'portfolio', 'budgetLine', 'resource', 'capital', 'total'],
        },
        limit: { type: 'number' },
      },
      required: ['query'],
    },
  },
  {
    name: 'canvas_add_aggregation',
    description: 'Add an aggregation node and optionally connect existing node ids into it.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        inputNodeIds: { type: 'array', items: { type: 'string' } },
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
  },
  {
    name: 'canvas_add_rule',
    description: 'Add a rule aggregation node.',
    inputSchema: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        conditions: { type: 'array' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
    },
  },
  {
    name: 'canvas_connect',
    description: 'Connect two canvas nodes.',
    inputSchema: {
      type: 'object',
      properties: {
        source: { type: 'string' },
        target: { type: 'string' },
      },
      required: ['source', 'target'],
    },
  },
  {
    name: 'canvas_rename_node',
    description: 'Rename an aggregation or rule node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        label: { type: 'string' },
      },
      required: ['nodeId', 'label'],
    },
  },
  {
    name: 'canvas_clear',
    description: 'Clear canvas nodes and edges.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'canvas_get_state',
    description: 'Return the latest canvas state reported by the browser app.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'canvas_move_node',
    description: 'Move an existing canvas node to a new position.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'canvas_highlight_years',
    description: 'Highlight specific year rows inside a canvas node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        years: { type: 'array', items: { type: 'string' }, description: 'Array of year strings to highlight, e.g. ["2024-25","2025-26"]. Empty array clears highlights.' },
      },
      required: ['nodeId'],
    },
  },
  {
    name: 'canvas_annotate_node',
    description: 'Add or update an annotation text on a canvas node.',
    inputSchema: {
      type: 'object',
      properties: {
        nodeId: { type: 'string' },
        annotation: { type: 'string', description: 'Annotation text to display on the node. Empty string clears the annotation.' },
      },
      required: ['nodeId', 'annotation'],
    },
  },
  {
    name: 'canvas_anim_save_script',
    description: 'Create or overwrite an animation script. Returns the script ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Script ID. Omit to auto-generate (not yet supported).' },
        name: { type: 'string', description: 'Display name for the script.' },
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              delay: { type: 'number', description: 'Delay in ms before this step executes.' },
              action: { type: 'string', enum: ['highlight', 'unhighlight', 'show', 'hide', 'annotate', 'unannotate', 'move'] },
              nodeId: { type: 'string' },
              value: { description: 'Value: string[] for highlight, string for annotate, {x,y} for move.' },
            },
          },
        },
      },
      required: ['id', 'name', 'steps'],
    },
  },
  {
    name: 'canvas_anim_delete_script',
    description: 'Delete an animation script by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'canvas_anim_list_scripts',
    description: 'List saved animation scripts.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'canvas_anim_play',
    description: 'Play an animation script by ID.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Script ID to play.' },
      },
      required: ['id'],
    },
  },
  {
    name: 'canvas_anim_stop',
    description: 'Stop the currently playing animation.',
    inputSchema: { type: 'object', properties: {} },
  },
];

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'content-type': 'application/json',
  });
  response.end(JSON.stringify(body));
}

function sendSse(response: ServerResponse, event: string, data: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function sendSseText(response: ServerResponse, event: string, data: string) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${data}\n\n`);
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function buildBudgetLines() {
  const byLine = new Map<string, BudgetRow[]>();
  for (const row of budgetRows) {
    const key = `${row.canonicalArea}||${row.portfolio}`;
    byLine.set(key, [...(byLine.get(key) ?? []), row]);
  }

  return Array.from(byLine.entries()).map(([key, rowsForLine]) => {
    const [canonicalArea, portfolio] = key.split('||');
    const years = budgetYears.map((year) => ({
      year,
      amount: rowsForLine
        .filter((row) => row.year === year)
        .reduce((sum, row) => sum + row.total, 0),
    }));
    return {
      canonicalArea,
      portfolio,
      areas: Array.from(new Set(rowsForLine.map((row) => row.area))).sort(),
      sheets: Array.from(new Set(rowsForLine.map((row) => row.sheet))).sort(),
      budgetLines: Array.from(new Set(rowsForLine.map((row) => row.budgetLine))).sort(),
      latestYear: latestBudgetYear,
      latestTotal: years.find((year) => year.year === latestBudgetYear)?.amount ?? 0,
      years,
    };
  });
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function textForBudgetLineField(line: BudgetLine, field: string) {
  if (field === 'year') return line.years.map((year) => `${year.year} ${year.amount}`).join(' ');
  if (field === 'sheet') return line.sheets.join(' ');
  if (field === 'area') return line.areas.join(' ');
  if (field === 'canonicalArea') return line.canonicalArea;
  if (field === 'portfolio') return line.portfolio;
  if (field === 'budgetLine') return line.budgetLines.join(' ');
  if (field === 'resource' || field === 'capital' || field === 'total') {
    const matchingRows = budgetRows.filter((row) => row.canonicalArea === line.canonicalArea && row.portfolio === line.portfolio);
    return matchingRows.map((row) => String(row[field as 'resource' | 'capital' | 'total'])).join(' ');
  }
  return [
    line.portfolio,
    line.canonicalArea,
    line.areas.join(' '),
    line.sheets.join(' '),
    line.budgetLines.join(' '),
    line.years.map((year) => `${year.year} ${year.amount}`).join(' '),
  ].join(' ');
}

function scoreBudgetLine(line: BudgetLine, query: string, field = 'all') {
  const normalizedQuery = normalizeSearchText(query);
  const portfolio = normalizeSearchText(line.portfolio);
  const canonicalArea = normalizeSearchText(line.canonicalArea);
  const haystack = normalizeSearchText(textForBudgetLineField(line, field));
  if (!normalizedQuery) return 0;
  if (field === 'all' && portfolio === normalizedQuery) return 1000;
  if (field === 'all' && `${canonicalArea} ${portfolio}` === normalizedQuery) return 950;
  if (field === 'all' && portfolio.includes(normalizedQuery)) return 800 - portfolio.indexOf(normalizedQuery);
  if (haystack === normalizedQuery) return 760;
  if (haystack.includes(normalizedQuery)) return 600 - haystack.indexOf(normalizedQuery);
  const words = normalizedQuery.split(/\s+/).filter(Boolean);
  return words.reduce((score, word) => score + (haystack.includes(word) ? 25 : 0), 0);
}

function searchBudgetLines(query: string, limit = 10, field = 'all') {
  return budgetLines
    .map((line) => ({ line, score: scoreBudgetLine(line, query, field) }))
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score || b.line.latestTotal - a.line.latestTotal)
    .slice(0, Math.max(1, Math.min(limit, 50)))
    .map((result) => result.line);
}

function resolveBudgetLine(args: Record<string, unknown>) {
  const canonicalArea = typeof args.canonicalArea === 'string' ? args.canonicalArea : '';
  const portfolio = typeof args.portfolio === 'string' ? args.portfolio : '';
  const exact = budgetLines.find((line) => line.canonicalArea === canonicalArea && line.portfolio === portfolio);
  if (exact) return exact;

  const query = typeof args.query === 'string' && args.query.trim()
    ? args.query
    : [
      args.year,
      args.sheet,
      args.area,
      canonicalArea,
      portfolio,
      args.budgetLine,
    ].filter((value) => typeof value === 'string' && value.trim()).join(' ');
  return searchBudgetLines(query, 1, 'all')[0] ?? null;
}

function enqueue(name: string, args: Record<string, unknown> = {}) {
  const command = { id: randomUUID(), tool: name, arguments: args };
  commands.push(command);
  return command;
}

function handleMcpMessage(body: {
  id?: string | number;
  method?: string;
  params?: { name?: string; arguments?: Record<string, unknown> };
}) {
  if (body.method === 'initialize') {
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'scottish-budget-tracker-canvas', version: '0.1.0' },
      },
    };
  }

  if (body.method === 'tools/list') {
    return { jsonrpc: '2.0', id: body.id, result: { tools } };
  }

  if (body.method === 'tools/call') {
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (!name) {
      return { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Tool name is required.' } };
    }

    if (name === 'canvas_get_state') {
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify(lastCanvasState ?? { nodes: [], edges: [] }, null, 2) }] },
      };
    }

    if (name === 'canvas_search_budget_lines') {
      const query = String(args.query ?? '');
      const field = String(args.field ?? 'all');
      const limit = typeof args.limit === 'number' ? args.limit : 10;
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{
            type: 'text',
            text: JSON.stringify(searchBudgetLines(query, limit, field), null, 2),
          }],
        },
      };
    }

    if (name === 'canvas_add_budget_line') {
      const line = resolveBudgetLine(args);
      if (!line) {
        return {
          jsonrpc: '2.0',
          id: body.id,
          error: { code: -32602, message: 'No matching budget line found in the normalized budget data.' },
        };
      }

      const command = enqueue(name, {
        ...args,
        canonicalArea: line.canonicalArea,
        portfolio: line.portfolio,
        id: `line:${line.canonicalArea}:${line.portfolio}`,
      });
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{
            type: 'text',
            text: `Queued ${line.portfolio} under ${line.canonicalArea} (${command.id}). The browser canvas will refresh on its next poll.`,
          }],
        },
      };
    }

    if (name === 'canvas_anim_list_scripts') {
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(lastAnimScripts ?? [], null, 2) }],
        },
      };
    }

    if (name === 'canvas_anim_save_script') {
      enqueue(name, args);
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: `Queued save script "${args.name}" (${args.id}). The browser will apply it on its next poll.` }],
        },
      };
    }

    if (name === 'canvas_anim_delete_script') {
      enqueue(name, args);
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: `Queued delete script "${args.id}".` }],
        },
      };
    }

    if (name === 'canvas_anim_play') {
      enqueue(name, args);
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: `Queued play script "${args.id}".` }],
        },
      };
    }

    if (name === 'canvas_anim_stop') {
      enqueue(name, args);
      return {
        jsonrpc: '2.0',
        id: body.id,
        result: {
          content: [{ type: 'text', text: 'Queued stop animation.' }],
        },
      };
    }

    const command = enqueue(name, args);
    return {
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: `Queued ${command.tool} (${command.id}). The browser canvas will refresh on its next poll.` }] },
    };
  }

  if (body.id === undefined || body.id === null) {
    return null;
  }

  return { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Unsupported method.' } };
}

function openMcpEventStream(request: IncomingMessage, response: ServerResponse) {
  response.writeHead(200, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,accept,mcp-session-id',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
    'x-accel-buffering': 'no',
  });

  const sessionId = randomUUID();
  sseSessions.set(sessionId, response);
  sendSseText(response, 'endpoint', `/mcp/message?sessionId=${sessionId}`);
  sendSse(response, 'ready', {
    protocolVersion: '2024-11-05',
    capabilities: { tools: {} },
    serverInfo: { name: 'scottish-budget-tracker-canvas', version: '0.1.0' },
  });

  const heartbeat = setInterval(() => {
    response.write(': heartbeat\n\n');
  }, 15_000);

  request.on('close', () => {
    clearInterval(heartbeat);
    sseSessions.delete(sessionId);
  });
}

async function handleMcp(request: IncomingMessage, response: ServerResponse) {
  const body = JSON.parse(await readBody(request)) as {
    id?: string | number;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };

  const result = handleMcpMessage(body);
  if (result) {
    sendJson(response, 'error' in result ? 404 : 200, result);
    return;
  }

  sendJson(response, 202, {});
}

async function handleSseMcpMessage(request: IncomingMessage, response: ServerResponse, sessionId: string | null) {
  const stream = sessionId ? sseSessions.get(sessionId) : undefined;
  if (!stream) {
    sendJson(response, 404, { error: 'Unknown MCP SSE session.' });
    return;
  }

  const body = JSON.parse(await readBody(request)) as {
    id?: string | number;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };
  const result = handleMcpMessage(body);
  if (result) {
    sendSse(stream, 'message', result);
  }
  response.writeHead(202, {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type,accept,mcp-session-id',
  });
  response.end();
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === 'OPTIONS') {
      sendJson(response, 204, {});
      return;
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'GET' && url.pathname === '/mcp') {
      openMcpEventStream(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/mcp') {
      await handleMcp(request, response);
      return;
    }

    if (request.method === 'POST' && url.pathname === '/mcp/message') {
      await handleSseMcpMessage(request, response, url.searchParams.get('sessionId'));
      return;
    }

    if (request.method === 'GET' && url.pathname === '/canvas/commands') {
      const since = url.searchParams.get('since');
      const index = since ? commands.findIndex((command) => command.id === since) : -1;
      const nextCommands = commands.slice(index + 1);
      sendJson(response, 200, {
        cursor: commands.at(-1)?.id ?? since ?? null,
        commands: nextCommands,
      });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/canvas/state') {
      lastCanvasState = JSON.parse(await readBody(request));
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === 'POST' && url.pathname === '/canvas/scripts') {
      lastAnimScripts = JSON.parse(await readBody(request));
      sendJson(response, 200, { ok: true });
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

server.listen(port, () => {
  console.log(`Canvas MCP remote server listening on http://127.0.0.1:${port}/mcp`);
});
