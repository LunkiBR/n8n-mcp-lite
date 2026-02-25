#!/usr/bin/env node
// ============================================================
// n8n-mcp-lite: Token-optimized MCP Server for n8n workflows
// ============================================================

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import { N8nApiClient } from "./api-client.js";
import { TOOLS } from "./tools/definitions.js";
import { ToolHandlers } from "./tools/handlers.js";

// ---- Configuration from environment ----

const N8N_HOST = process.env.N8N_HOST || process.env.N8N_API_URL || "";
const N8N_API_KEY = process.env.N8N_API_KEY || "";

if (!N8N_HOST || !N8N_API_KEY) {
  console.error(
    "Error: N8N_HOST and N8N_API_KEY environment variables are required.\n" +
      "Set them in your MCP client configuration:\n" +
      '  N8N_HOST: Your n8n instance URL (e.g., "https://your-n8n.example.com")\n' +
      "  N8N_API_KEY: Your n8n API key"
  );
  process.exit(1);
}

// ---- Initialize ----

const apiClient = new N8nApiClient({
  baseUrl: N8N_HOST,
  apiKey: N8N_API_KEY,
  timeout: parseInt(process.env.N8N_TIMEOUT ?? "30000", 10),
});

const handlers = new ToolHandlers(apiClient);

const server = new Server(
  {
    name: "n8n-mcp-lite",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// ---- Tool listing ----

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: TOOLS };
});

// ---- Tool execution ----

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

  const result = await handlers.handle(
    name,
    args as Record<string, unknown>
  );

  return result;
});

// ---- Error handling ----

server.onerror = (error) => {
  console.error("[n8n-mcp-lite error]", error);
};

process.on("SIGINT", async () => {
  await server.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await server.close();
  process.exit(0);
});

// ---- Start ----

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("n8n-mcp-lite server started (stdio transport)");
  console.error(`Connected to: ${N8N_HOST}`);
}

main().catch((error) => {
  console.error("Fatal error starting server:", error);
  process.exit(1);
});
