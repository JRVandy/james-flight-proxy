/**
 * /api/mcp.js
 * MCP endpoint using JSON-RPC 2.0 over SSE — compatible with Claude.ai custom connectors
 */

const PROXY_BASE = "https://james-flight-proxy.vercel.app/api/search";

const TOOLS = [
  {
    name: "search_flights",
    description:
      "Search for real-time flight prices and itineraries using Google Flights data. " +
      "Returns best and other flight options with prices, durations, stops, airlines, and layover details. " +
      "Use this whenever the user asks about flights, airfare, or travel options.",
    inputSchema: {
      type: "object",
      properties: {
        departure_id: {
          type: "string",
          description: "Origin airport IATA code (e.g. HSV, BHM, ATL)",
        },
        arrival_id: {
          type: "string",
          description: "Destination airport IATA code (e.g. CUN, PLS, JFK)",
        },
        outbound_date: {
          type: "string",
          description: "Departure date in YYYY-MM-DD format",
        },
        return_date: {
          type: "string",
          description: "Return date in YYYY-MM-DD format. Omit for one-way.",
        },
        type: {
          type: "integer",
          description: "Trip type: 1 = round trip, 2 = one way",
          default: 1,
        },
        travel_class: {
          type: "integer",
          description: "Cabin: 1=Economy, 2=Premium Economy, 3=Business, 4=First",
          default: 1,
        },
        adults: {
          type: "integer",
          description: "Number of adult passengers",
          default: 1,
        },
        stops: {
          type: "integer",
          description: "Max stops: 0=nonstop only, 1=1 stop max, 3=any",
          default: 3,
        },
        currency: {
          type: "string",
          description: "Currency code",
          default: "USD",
        },
      },
      required: ["departure_id", "arrival_id", "outbound_date"],
    },
  },
];

async function searchFlights(input) {
  const params = new URLSearchParams({
    departure_id: input.departure_id,
    arrival_id: input.arrival_id,
    outbound_date: input.outbound_date,
    currency: input.currency || "USD",
    type: String(input.type ?? 1),
    travel_class: String(input.travel_class ?? 1),
    adults: String(input.adults ?? 1),
  });
  if (input.return_date) params.set("return_date", input.return_date);
  if (input.stops !== undefined) params.set("stops", String(input.stops));

  const upstream = await fetch(`${PROXY_BASE}?${params.toString()}`);
  if (!upstream.ok) throw new Error(`Upstream error: ${upstream.status}`);
  return await upstream.json();
}

function sendSSE(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function jsonRpcResult(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function jsonRpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Accept");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // SSE stream — Claude.ai connects here to establish the MCP session
  if (req.method === "GET") {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    // Send endpoint event so Claude knows where to POST messages
    const host = `https://${req.headers.host}`;
    sendSSE(res, "endpoint", `${host}/api/mcp`);

    // Keep alive
    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);

    req.on("close", () => {
      clearInterval(keepAlive);
    });

    return; // keep connection open
  }

  // POST — handle JSON-RPC messages from Claude
  if (req.method === "POST") {
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json(jsonRpcError(null, -32700, "Parse error"));
    }

    const { id, method, params } = body;

    if (method === "initialize") {
      return res.status(200).json(
        jsonRpcResult(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "flight-search", version: "1.0.0" },
        })
      );
    }

    if (method === "notifications/initialized") {
      return res.status(200).end();
    }

    if (method === "tools/list") {
      return res.status(200).json(jsonRpcResult(id, { tools: TOOLS }));
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolInput = params?.arguments || {};

      if (toolName !== "search_flights") {
        return res.status(200).json(
          jsonRpcResult(id, {
            content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
            isError: true,
          })
        );
      }

      try {
        const data = await searchFlights(toolInput);
        return res.status(200).json(
          jsonRpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(data) }],
          })
        );
      } catch (err) {
        return res.status(200).json(
          jsonRpcResult(id, {
            content: [{ type: "text", text: `Error: ${err.message}` }],
            isError: true,
          })
        );
      }
    }

    return res.status(200).json(jsonRpcError(id, -32601, `Method not found: ${method}`));
  }

  return res.status(405).json({ error: "Method not allowed" });
}
