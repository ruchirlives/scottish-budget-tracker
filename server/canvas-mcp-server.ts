import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

type CanvasCommand = {
  id: string;
  tool: string;
  arguments?: Record<string, unknown>;
};

const port = Number(process.env.PORT ?? process.env.MCP_PORT ?? 8787);
const commands: CanvasCommand[] = [];
let lastCanvasState: unknown = null;
const sseClients = new Set<ServerResponse>();

const tools = [
  {
    name: 'canvas_add_budget_line',
    description: 'Add or move a budget line node on the canvas.',
    inputSchema: {
      type: 'object',
      properties: {
        canonicalArea: { type: 'string' },
        portfolio: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
      },
      required: ['canonicalArea', 'portfolio'],
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

function enqueue(name: string, args: Record<string, unknown> = {}) {
  const command = { id: randomUUID(), tool: name, arguments: args };
  commands.push(command);
  return command;
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

  sseClients.add(response);
  sendSseText(response, 'endpoint', '/mcp');
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
    sseClients.delete(response);
  });
}

async function handleMcp(request: IncomingMessage, response: ServerResponse) {
  const body = JSON.parse(await readBody(request)) as {
    id?: string | number;
    method?: string;
    params?: { name?: string; arguments?: Record<string, unknown> };
  };

  if (body.method === 'initialize') {
    sendJson(response, 200, {
      jsonrpc: '2.0',
      id: body.id,
      result: {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'scottish-budget-tracker-canvas', version: '0.1.0' },
      },
    });
    return;
  }

  if (body.method === 'tools/list') {
    sendJson(response, 200, { jsonrpc: '2.0', id: body.id, result: { tools } });
    return;
  }

  if (body.method === 'tools/call') {
    const name = body.params?.name;
    const args = body.params?.arguments ?? {};
    if (!name) {
      sendJson(response, 400, { jsonrpc: '2.0', id: body.id, error: { code: -32602, message: 'Tool name is required.' } });
      return;
    }

    if (name === 'canvas_get_state') {
      sendJson(response, 200, {
        jsonrpc: '2.0',
        id: body.id,
        result: { content: [{ type: 'text', text: JSON.stringify(lastCanvasState ?? { nodes: [], edges: [] }, null, 2) }] },
      });
      return;
    }

    const command = enqueue(name, args);
    sendJson(response, 200, {
      jsonrpc: '2.0',
      id: body.id,
      result: { content: [{ type: 'text', text: `Queued ${command.tool} (${command.id}). The browser canvas will refresh on its next poll.` }] },
    });
    return;
  }

  sendJson(response, 404, { jsonrpc: '2.0', id: body.id, error: { code: -32601, message: 'Unsupported method.' } });
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

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : 'Unknown error' });
  }
});

server.listen(port, () => {
  console.log(`Canvas MCP remote server listening on http://127.0.0.1:${port}/mcp`);
});
