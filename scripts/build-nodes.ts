#!/usr/bin/env npx tsx
// ============================================================
// Build script: Extract node data from n8n-mcp's nodes.db
// into a compact JSON file for n8n-mcp-lite runtime use.
//
// Usage: npx tsx scripts/build-nodes.ts [path-to-nodes.db]
// Default: looks for ../n8n-mcp/data/nodes.db
// ============================================================

import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ---- Config ----

const dbPath =
  process.argv[2] ||
  resolve(__dirname, "..", "..", "n8n-mcp", "data", "nodes.db");
const outputPath = resolve(__dirname, "..", "src", "data", "nodes.json");

console.log(`Reading from: ${dbPath}`);
console.log(`Writing to:   ${outputPath}`);

// ---- Essential properties per node type ----
// Ported from n8n-mcp PropertyFilter.ESSENTIAL_PROPERTIES

const ESSENTIAL_PROPS: Record<string, { required: string[]; common: string[] }> = {
  "nodes-base.httpRequest": {
    required: ["url"],
    common: ["method", "authentication", "sendBody", "contentType", "sendHeaders", "sendQuery"],
  },
  "nodes-base.webhook": {
    required: [],
    common: ["httpMethod", "path", "responseMode", "responseData", "responseCode"],
  },
  "nodes-base.code": {
    required: [],
    common: ["jsCode", "pythonCode", "mode", "language"],
  },
  "nodes-base.if": {
    required: [],
    common: ["conditions"],
  },
  "nodes-base.switch": {
    required: [],
    common: ["rules", "mode"],
  },
  "nodes-base.set": {
    required: [],
    common: ["mode", "assignments", "includeOtherFields"],
  },
  "nodes-base.merge": {
    required: [],
    common: ["mode", "joinMode", "mergeByFields"],
  },
  "nodes-base.splitInBatches": {
    required: [],
    common: ["batchSize", "options"],
  },
  "nodes-base.noOp": { required: [], common: [] },
  "nodes-base.respondToWebhook": {
    required: [],
    common: ["respondWith", "responseBody", "responseCode", "responseHeaders"],
  },
  "nodes-base.executeWorkflow": {
    required: ["workflowId"],
    common: ["mode"],
  },
  "nodes-base.schedule": {
    required: [],
    common: ["rule"],
  },
  "nodes-base.gmail": {
    required: [],
    common: ["resource", "operation", "sendTo", "subject", "message"],
  },
  "nodes-base.slack": {
    required: [],
    common: ["resource", "operation", "channel", "text", "channelId"],
  },
  "nodes-base.postgres": {
    required: [],
    common: ["operation", "query", "table", "schema"],
  },
  "nodes-base.googleSheets": {
    required: [],
    common: ["resource", "operation", "documentId", "sheetName"],
  },
};

// Max props if no curated list
const MAX_FALLBACK_PROPS = 20;

// ---- Read database ----

const db = new Database(dbPath, { readonly: true });

interface NodeRow {
  node_type: string;
  display_name: string;
  description: string;
  category: string;
  package_name: string;
  properties_schema: string | null;
  operations: string | null;
  credentials_required: string | null;
  is_trigger: number;
  is_webhook: number;
  is_ai_tool: number;
  is_versioned: number;
  documentation: string | null;
}

const rows = db.prepare(`
  SELECT
    node_type, display_name, description, category, package_name,
    properties_schema, operations, credentials_required,
    is_trigger, is_webhook, is_ai_tool, is_versioned, documentation
  FROM nodes
  ORDER BY node_type
`).all() as NodeRow[];

console.log(`Found ${rows.length} nodes in database`);

// ---- Transform to compact format ----

interface CompactNode {
  t: string;
  d: string;
  desc: string;
  cat: string;
  pkg: string;
  f: number;
  v: string;
  ops?: Array<{ r: string; ops: string[] }>;
  props?: Array<Record<string, unknown>>;
  creds?: string[];
  _s: string;
}

const compactNodes: CompactNode[] = [];

for (const row of rows) {
  // Parse JSON fields
  let properties: any[] = [];
  let operations: any[] = [];
  let credentials: any[] = [];

  try {
    if (row.properties_schema) properties = JSON.parse(row.properties_schema);
  } catch { /* skip */ }
  try {
    if (row.operations) operations = JSON.parse(row.operations);
  } catch { /* skip */ }
  try {
    if (row.credentials_required) credentials = JSON.parse(row.credentials_required);
  } catch { /* skip */ }

  // Build flags bitmask
  let flags = 0;
  if (row.is_trigger) flags |= 1;
  if (row.is_webhook) flags |= 2;
  if (row.is_ai_tool) flags |= 4;
  if (row.is_versioned) flags |= 8;

  // Package short name
  const pkg = row.package_name?.includes("langchain")
    ? "langchain"
    : row.package_name?.includes("community")
      ? "community"
      : "base";

  // Filter properties to essentials
  const essentialConfig = ESSENTIAL_PROPS[row.node_type];
  let filteredProps: any[] = [];

  if (essentialConfig && Array.isArray(properties)) {
    const wanted = new Set([...essentialConfig.required, ...essentialConfig.common]);
    filteredProps = properties
      .filter((p: any) => wanted.has(p.name))
      .map(simplifyProperty);
    // Mark required
    for (const p of filteredProps) {
      if (essentialConfig.required.includes(p.n)) p.req = true;
    }
  } else if (Array.isArray(properties)) {
    // Fallback: take required + first N visible properties
    const required = properties.filter((p: any) => p.required === true);
    const visible = properties.filter(
      (p: any) =>
        !p.required &&
        (!p.displayOptions || !p.displayOptions.hide) &&
        p.type !== "hidden"
    );
    filteredProps = [
      ...required.slice(0, 10).map((p: any) => ({ ...simplifyProperty(p), req: true as const })),
      ...visible.slice(0, MAX_FALLBACK_PROPS - required.length).map(simplifyProperty),
    ];
  }

  // Compact operations
  let compactOps: Array<{ r: string; ops: string[] }> | undefined;
  if (Array.isArray(operations) && operations.length > 0) {
    const opsMap = new Map<string, string[]>();
    for (const op of operations) {
      const resource = op.resource || op.name || "default";
      const opName = op.operation || op.value || op.name;
      if (!opsMap.has(resource)) opsMap.set(resource, []);
      if (opName && !opsMap.get(resource)!.includes(opName)) {
        opsMap.get(resource)!.push(opName);
      }
    }
    if (opsMap.size > 0) {
      compactOps = Array.from(opsMap.entries()).map(([r, ops]) => ({ r, ops }));
    }
  }

  // Credential names
  const credNames =
    Array.isArray(credentials) && credentials.length > 0
      ? credentials.map((c: any) => c.name || c.type || String(c)).filter(Boolean)
      : undefined;

  // Build search tokens
  const searchTokens = [
    row.node_type,
    row.display_name,
    row.description || "",
    row.category || "",
    ...(Array.isArray(operations) ? operations.map((o: any) => o.resource || o.name || "").filter(Boolean) : []),
  ]
    .join(" ")
    .toLowerCase();

  const entry: CompactNode = {
    t: row.node_type,
    d: row.display_name,
    desc: (row.description || "").slice(0, 200),
    cat: row.category || "uncategorized",
    pkg,
    f: flags,
    v: "1", // Default version
    _s: searchTokens,
  };

  if (compactOps) entry.ops = compactOps;
  if (filteredProps.length > 0) entry.props = filteredProps;
  if (credNames && credNames.length > 0) entry.creds = credNames;

  compactNodes.push(entry);
}

// ---- Write output ----

const json = JSON.stringify(compactNodes);
writeFileSync(outputPath, json, "utf-8");

const sizeKB = (Buffer.byteLength(json) / 1024).toFixed(1);
console.log(`\nGenerated ${compactNodes.length} nodes → ${sizeKB}KB`);
console.log(`Output: ${outputPath}`);

db.close();

// ---- Helpers ----

function simplifyProperty(prop: any): Record<string, unknown> {
  const result: Record<string, unknown> = {
    n: prop.name,
    dn: prop.displayName || prop.name,
    t: prop.type || "string",
  };

  if (prop.description) result.desc = prop.description.slice(0, 150);
  if (prop.default !== undefined && prop.default !== "" && prop.default !== null) {
    result.def = prop.default;
  }

  // Options (limit to 20)
  if (Array.isArray(prop.options) && prop.options.length > 0) {
    result.opts = prop.options.slice(0, 20).map((o: any) => ({
      v: String(o.value ?? o.name ?? o),
      l: String(o.name ?? o.value ?? o),
    }));
  }

  // Display conditions
  if (prop.displayOptions?.show) {
    result.show = prop.displayOptions.show;
  }

  return result;
}
