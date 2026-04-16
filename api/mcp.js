/**
 * /api/mcp.js
 * MCP (Model Context Protocol) endpoint for the James Flight Proxy
 * Handles both GET (manifest discovery) and POST (tool invocation)
 */

const PROXY_BASE = "https://james-flight-proxy.vercel.app/api/search";

// MCP Tool manifest — describes the flight search tool to Claude
const MANIFEST = {
  schema_version: "v1",
  name_for_human: "Flight Search",
  name_for_model: "flight_search",
  description_for_human: "Search real-time flight prices via Google Flights",
  description_for_model:
    "Search for real-time flight prices and itineraries using Google Flights data. " +
    "Returns best and other flight options with prices, durations, stops, airlines, and layover details. " +
    "Use this whenever the user asks about flights, airfare, or travel options.",
  auth: { type: "none" },
  api: {
    type: "openapi",
    url: "https://james-flight-proxy.vercel.app/api/mcp",
  },
  tools: [
    {
      name: "search_flights",
      description:
        "Search for round-trip or one-way flights between two airports. " +
        "Returns structured flight data including prices, airlines, durations, stops, and layovers.",
      input_schema: {
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
            description:
              "Return date in YYYY-MM-DD format. Omit for one-way flights.",
          },
          type: {
            type: "integer",
            description: "Trip type: 1 = round trip, 2 = one way",
            default: 1,
          },
          travel_class: {
            type: "integer",
            description:
              "Cabin class: 1 = Economy, 2 = Premium Economy, 3 = Business, 4 = First",
            default: 1,
          },
          adults: {
            type: "integer",
            description: "Number of adult passengers",
            default: 1,
          },
          stops: {
            type: "integer",
            description:
              "Maximum stops filter: 0 = nonstop only, 1 = 1 stop max, 3 = any (default)",
            default: 3,
          },
          currency: {
            type: "string",
            description: "Currency code for prices",
            default: "USD",
          },
        },
        required: ["departure_id", "arrival_id", "outbound_date"],
      },
    },
  ],
};

export default async function handler(req, res) {
  // CORS headers — required for Claude.ai to call this endpoint
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");

  // Preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // GET — return manifest for Claude.ai discovery
  if (req.method === "GET") {
    return res.status(200).json(MANIFEST);
  }

  // POST — tool invocation from Claude
  if (req.method === "POST") {
    let body;
    try {
      body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }

    // MCP sends: { name: "search_flights", input: { ...params } }
    const toolName = body?.name;
    const input = body?.input || {};

    if (toolName !== "search_flights") {
      return res.status(404).json({ error: `Unknown tool: ${toolName}` });
    }

    // Build query string for the existing /api/search proxy
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

    try {
      const upstream = await fetch(`${PROXY_BASE}?${params.toString()}`);
      const data = await upstream.json();

      // Return MCP tool result format
      return res.status(200).json({
        type: "tool_result",
        content: [
          {
            type: "text",
            text: JSON.stringify(data),
          },
        ],
      });
    } catch (err) {
      return res.status(500).json({
        type: "tool_result",
        content: [{ type: "text", text: `Error fetching flights: ${err.message}` }],
        is_error: true,
      });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
