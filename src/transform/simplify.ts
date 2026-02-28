// ============================================================
// n8n-mcp-lite: Workflow JSON → Simplified transformation
// ============================================================

import type {
  N8nWorkflowRaw,
  N8nNodeRaw,
  N8nConnections,
  LiteWorkflow,
  LiteNode,
  LiteConnection,
} from "../types.js";
import { autoLayout } from "./layout.js";

const NODE_PREFIX = "n8n-nodes-base.";
const LANGCHAIN_PREFIX = "@n8n/n8n-nodes-langchain.";

/**
 * Minimum stable typeVersions for nodes that have multi-version formats.
 * Used as fallback when _v is not specified to avoid format/version mismatch
 * (e.g. Set node v3 params sent with typeVersion 1 → "not iterable" UI crash).
 * Always prefer _v from the node spec; this is only the last-resort default.
 */
const DEFAULT_TYPE_VERSIONS: Record<string, number> = {
  "n8n-nodes-base.set": 3,
  "n8n-nodes-base.if": 2,
  "n8n-nodes-base.switch": 3,
  "n8n-nodes-base.httpRequest": 4,
  "n8n-nodes-base.webhook": 2,
  "n8n-nodes-base.respondToWebhook": 1,
  "n8n-nodes-base.scheduleTrigger": 1,
  "n8n-nodes-base.merge": 3,
  "n8n-nodes-base.code": 2,
  "n8n-nodes-base.splitInBatches": 3,
  "n8n-nodes-base.postgres": 2,
  "n8n-nodes-base.mySql": 2,
  "@n8n/n8n-nodes-langchain.agent": 1,
  "@n8n/n8n-nodes-langchain.lmChatOpenAi": 1,
  "@n8n/n8n-nodes-langchain.memoryBufferWindow": 1,
  "@n8n/n8n-nodes-langchain.chainLlm": 1,
  "@n8n/n8n-nodes-langchain.toolCalculator": 1,
  "@n8n/n8n-nodes-langchain.vectorStoreInMemory": 1,
};

// Default values that can be stripped
const DEFAULT_EMPTY_VALUES = [null, undefined, "", "none", "off"];
const DEFAULT_PARAM_KEYS_TO_STRIP = ["options", "additionalFields"];

/**
 * Simplify a node type by stripping common prefixes
 */
export function simplifyNodeType(fullType: string): string {
  if (fullType.startsWith(NODE_PREFIX)) {
    return fullType.slice(NODE_PREFIX.length);
  }
  if (fullType.startsWith(LANGCHAIN_PREFIX)) {
    return "langchain:" + fullType.slice(LANGCHAIN_PREFIX.length);
  }
  return fullType;
}

/**
 * Restore a simplified node type to its full form
 */
export function restoreNodeType(simpleType: string): string {
  if (simpleType.startsWith("langchain:")) {
    return LANGCHAIN_PREFIX + simpleType.slice("langchain:".length);
  }
  if (simpleType.includes(".") || simpleType.startsWith("@")) {
    return simpleType; // Already fully qualified
  }
  return NODE_PREFIX + simpleType;
}

/**
 * Check if a value is empty/default and should be stripped
 */
function isEmptyOrDefault(value: unknown): boolean {
  if (DEFAULT_EMPTY_VALUES.includes(value as string | null | undefined))
    return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === "object" && value !== null && Object.keys(value).length === 0)
    return true;
  return false;
}

/**
 * Deep clean parameters: remove empty objects, empty arrays, null values,
 * and known default-only keys like "options: {}" and "additionalFields: {}"
 */
function cleanParams(
  params: Record<string, unknown>
): Record<string, unknown> | undefined {
  const cleaned: Record<string, unknown> = {};
  let hasContent = false;

  for (const [key, value] of Object.entries(params)) {
    // Strip known empty default keys
    if (DEFAULT_PARAM_KEYS_TO_STRIP.includes(key) && isEmptyOrDefault(value)) {
      continue;
    }

    // Skip null/undefined
    if (value === null || value === undefined) continue;

    // Recursively clean nested objects (but preserve non-empty ones)
    if (typeof value === "object" && !Array.isArray(value)) {
      const nestedCleaned = cleanParams(value as Record<string, unknown>);
      if (nestedCleaned) {
        cleaned[key] = nestedCleaned;
        hasContent = true;
      }
      continue;
    }

    // Keep everything else
    cleaned[key] = value;
    hasContent = true;
  }

  return hasContent ? cleaned : undefined;
}

/**
 * Simplify a single node
 */
export function simplifyNode(node: N8nNodeRaw): LiteNode {
  const lite: LiteNode = {
    name: node.name,
    type: simplifyNodeType(node.type),
    _id: node.id,
  };

  // Only include typeVersion if not 1
  if (node.typeVersion && node.typeVersion !== 1) {
    lite._v = node.typeVersion;
  }

  // Clean and include parameters
  const cleanedParams = node.parameters
    ? cleanParams(node.parameters)
    : undefined;
  if (cleanedParams) {
    lite.params = cleanedParams;
  }

  // Simplify credentials to just names
  if (node.credentials) {
    const creds: Record<string, string> = {};
    for (const [key, val] of Object.entries(node.credentials)) {
      creds[key] = val.name;
    }
    lite.creds = creds;
  }

  // Only include if actually disabled
  if (node.disabled === true) {
    lite.disabled = true;
  }

  // Error handling
  if (node.onError && node.onError !== "stopWorkflow") {
    lite.onError = node.onError;
  }

  // Notes
  if (node.notes) {
    lite.notes = node.notes;
  }

  return lite;
}

/**
 * Simplify connections from verbose n8n format to compact representation
 */
export function simplifyConnections(connections: N8nConnections): LiteConnection[] {
  const result: LiteConnection[] = [];

  for (const [sourceName, outputs] of Object.entries(connections)) {
    for (const [outputType, outputArrays] of Object.entries(outputs)) {
      for (let outputIdx = 0; outputIdx < outputArrays.length; outputIdx++) {
        const targets = outputArrays[outputIdx];
        if (!targets || targets.length === 0) continue;

        for (const target of targets) {
          const conn: LiteConnection = {
            from: sourceName,
            to: target.node,
          };

          // Only include type if not "main"
          if (outputType !== "main") {
            conn.type = outputType;
          }

          // Only include outputIndex if > 0
          if (outputIdx > 0) {
            conn.outputIndex = outputIdx;
          }

          // Only include inputIndex if > 0
          if (target.index > 0) {
            conn.inputIndex = target.index;
          }

          result.push(conn);
        }
      }
    }
  }

  return result;
}

/**
 * Clean workflow settings: remove defaults
 */
function cleanSettings(
  settings?: Record<string, unknown>
): Record<string, unknown> | undefined {
  if (!settings) return undefined;

  const cleaned: Record<string, unknown> = {};
  let hasContent = false;

  for (const [key, value] of Object.entries(settings)) {
    // Skip known defaults
    if (key === "executionOrder" && value === "v1") continue;
    if (key === "saveManualExecutions" && value === true) continue;
    if (key === "callerPolicy" && value === "workflowsFromSameOwner") continue;
    if (value === null || value === undefined || value === false) continue;

    cleaned[key] = value;
    hasContent = true;
  }

  return hasContent ? cleaned : undefined;
}

/**
 * Attempt to topologically sort nodes based on connections
 */
export function topologicalSort(
  nodes: N8nNodeRaw[],
  connections: N8nConnections
): N8nNodeRaw[] {
  const nameToNode = new Map(nodes.map((n) => [n.name, n]));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  // Initialize
  for (const node of nodes) {
    inDegree.set(node.name, 0);
    adjacency.set(node.name, []);
  }

  // Build graph
  for (const [source, outputs] of Object.entries(connections)) {
    for (const outputArrays of Object.values(outputs)) {
      for (const targets of outputArrays) {
        for (const target of targets) {
          adjacency.get(source)?.push(target.node);
          inDegree.set(
            target.node,
            (inDegree.get(target.node) ?? 0) + 1
          );
        }
      }
    }
  }

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: N8nNodeRaw[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    const node = nameToNode.get(name);
    if (node) sorted.push(node);

    for (const neighbor of adjacency.get(name) ?? []) {
      const newDegree = (inDegree.get(neighbor) ?? 1) - 1;
      inDegree.set(neighbor, newDegree);
      if (newDegree === 0) queue.push(neighbor);
    }
  }

  // Add any nodes not reachable (disconnected)
  for (const node of nodes) {
    if (!sorted.includes(node)) {
      sorted.push(node);
    }
  }

  return sorted;
}

// ============================================================
// PUBLIC API
// ============================================================

/**
 * Transform a raw n8n workflow JSON into a simplified representation.
 * This is the core optimization function.
 */
export function simplifyWorkflow(raw: N8nWorkflowRaw): LiteWorkflow {
  const sortedNodes = topologicalSort(raw.nodes, raw.connections);

  const lite: LiteWorkflow = {
    id: raw.id,
    name: raw.name,
    active: raw.active,
    nodes: sortedNodes.map(simplifyNode),
    flow: simplifyConnections(raw.connections),
    nodeCount: raw.nodes.length,
  };

  // Tags: simplify to just names
  if (raw.tags && raw.tags.length > 0) {
    lite.tags = raw.tags.map((t) => t.name);
  }

  // Settings: only non-defaults
  const cleanedSettings = cleanSettings(
    raw.settings as Record<string, unknown>
  );
  if (cleanedSettings) {
    lite.settings = cleanedSettings;
  }

  // Timestamp
  if (raw.updatedAt) {
    lite.updatedAt = raw.updatedAt;
  }

  return lite;
}

/**
 * Reconstruct a full n8n workflow JSON from a simplified representation.
 * Used when updating a workflow from AI-modified simplified format.
 */
export function reconstructWorkflow(
  lite: LiteWorkflow,
  originalRaw?: N8nWorkflowRaw
): Partial<N8nWorkflowRaw> {
  // Build position map from original if available
  const originalPositions = new Map<string, [number, number]>();
  const originalNodeMap = new Map<string, N8nNodeRaw>();
  if (originalRaw) {
    for (const node of originalRaw.nodes) {
      originalPositions.set(node.name, node.position);
      originalNodeMap.set(node.name, node);
    }
  }

  // Auto-layout for new workflows (when no original positions exist)
  const layoutPositions = originalRaw
    ? new Map<string, [number, number]>() // Update: prefer original positions
    : autoLayout(lite.nodes, lite.flow); // Create: smart auto-layout

  // Reconstruct nodes
  const nodes: N8nNodeRaw[] = lite.nodes.map((liteNode, index) => {
    const original = originalNodeMap.get(liteNode.name);
    const fullType = restoreNodeType(liteNode.type);

    const node: N8nNodeRaw = {
      id: liteNode._id || original?.id || crypto.randomUUID(),
      name: liteNode.name,
      type: fullType,
      typeVersion: liteNode._v ?? original?.typeVersion ?? DEFAULT_TYPE_VERSIONS[fullType] ?? 1,
      position: original?.position ??
        originalPositions.get(liteNode.name) ??
        layoutPositions.get(liteNode.name) ?? [
          250 + index * 200,
          300,
        ],
      parameters: liteNode.params ?? original?.parameters ?? {},
    };

    // Restore credentials with IDs from original
    if (liteNode.creds) {
      node.credentials = {};
      for (const [key, name] of Object.entries(liteNode.creds)) {
        const origCred = original?.credentials?.[key];
        node.credentials[key] = {
          id: origCred?.id ?? "",
          name: name,
        };
      }
    } else if (original?.credentials) {
      node.credentials = original.credentials;
    }

    if (liteNode.disabled) node.disabled = true;
    if (liteNode.onError) node.onError = liteNode.onError;
    if (liteNode.notes) node.notes = liteNode.notes;

    // Preserve any extra fields from original
    if (original?.webhookId) node.webhookId = original.webhookId;

    return node;
  });

  // Reconstruct connections
  const connections: N8nConnections = {};

  // Bug fix: auto-assign inputIndex for nodes with multiple upstream connections
  // (Merge, etc.). Without this, every connection defaults to index 0 and the
  // second branch of an IF→Merge pattern feeds the same input port, so Merge
  // never receives both data streams and waitForAll never fires.
  // Rule: if inputIndex is explicit → use it and reserve that slot.
  //       if implicit → use the next available input port for that target.
  const nextAutoInputIdx = new Map<string, number>();

  for (const conn of lite.flow) {
    const outputType = conn.type ?? "main";
    const outputIdx = conn.outputIndex ?? 0;

    if (!connections[conn.from]) {
      connections[conn.from] = {};
    }
    if (!connections[conn.from][outputType]) {
      connections[conn.from][outputType] = [];
    }

    // Ensure output array has enough slots
    while (connections[conn.from][outputType].length <= outputIdx) {
      connections[conn.from][outputType].push([]);
    }

    const trackerKey = `${conn.to}:${outputType}`;
    let inputIdx: number;

    if (conn.inputIndex !== undefined) {
      // Explicit: respect it and advance tracker past this slot
      inputIdx = conn.inputIndex;
      if ((nextAutoInputIdx.get(trackerKey) ?? 0) <= inputIdx) {
        nextAutoInputIdx.set(trackerKey, inputIdx + 1);
      }
    } else {
      // Implicit: auto-assign next available input port for this target
      inputIdx = nextAutoInputIdx.get(trackerKey) ?? 0;
      nextAutoInputIdx.set(trackerKey, inputIdx + 1);
    }

    connections[conn.from][outputType][outputIdx].push({
      node: conn.to,
      type: outputType,
      index: inputIdx,
    });
  }

  const result: Partial<N8nWorkflowRaw> = {
    name: lite.name,
    nodes,
    connections,
    settings: lite.settings ?? { executionOrder: "v1" },
  };

  return result;
}

/**
 * Generate a human-readable text summary of a workflow
 */
export function workflowToText(lite: LiteWorkflow): string {
  const lines: string[] = [];

  lines.push(`# ${lite.name}`);
  lines.push(`ID: ${lite.id} | Active: ${lite.active} | Nodes: ${lite.nodeCount}`);

  if (lite.tags && lite.tags.length > 0) {
    lines.push(`Tags: ${lite.tags.join(", ")}`);
  }

  lines.push("");
  lines.push("## Nodes");

  for (const node of lite.nodes) {
    let line = `- [${node.type}] "${node.name}"`;
    if (node.disabled) line += " (DISABLED)";
    if (node.creds) line += ` | creds: ${Object.values(node.creds).join(", ")}`;
    lines.push(line);

    if (node.params) {
      const keys = Object.keys(node.params);
      if (keys.length <= 5) {
        for (const key of keys) {
          const val = node.params[key];
          const valStr =
            typeof val === "string"
              ? val.length > 80
                ? val.substring(0, 77) + "..."
                : val
              : JSON.stringify(val);
          lines.push(`    ${key}: ${valStr}`);
        }
      } else {
        lines.push(`    (${keys.length} params: ${keys.join(", ")})`);
      }
    }
  }

  lines.push("");
  lines.push("## Flow");

  for (const conn of lite.flow) {
    let line = `  ${conn.from} → ${conn.to}`;
    if (conn.type) line += ` [${conn.type}]`;
    if (conn.outputIndex) line += ` (out:${conn.outputIndex})`;
    if (conn.inputIndex) line += ` (in:${conn.inputIndex})`;
    lines.push(line);
  }

  return lines.join("\n");
}
