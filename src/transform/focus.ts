// ============================================================
// n8n-mcp-lite: Focus Mode construction logic
// ============================================================

import type {
  N8nWorkflowRaw,
  N8nNodeRaw,
  LiteConnection,
  WorkflowScan,
  ScanNode,
  FocusedWorkflow,
  DormantNode,
  NodeZone,
  ExecutionRunDataMap,
} from "../types.js";

import {
  simplifyNodeType,
  simplifyNode,
  simplifyConnections,
  topologicalSort,
} from "./simplify.js";

import {
  buildAdjacency,
  bfsForward,
  bfsBackward,
  classifyNodes,
  detectSegments,
  findBoundaries,
  followBranch,
  findNodesBetween,
} from "./graph.js";

// ============================================================
// Node Summary Generation
// ============================================================

/** Extract a short representation of an expression or literal value */
function exprShort(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") {
    if (value.startsWith("=")) {
      const match = value.match(/\{\{\s*(.+?)\s*\}\}/);
      if (match) {
        const inner = match[1];
        return inner.length > 30 ? inner.substring(0, 27) + "..." : inner;
      }
      return value.length > 30 ? value.substring(0, 27) + "..." : value;
    }
    return value.length > 30 ? value.substring(0, 27) + "..." : value;
  }
  return String(value);
}

/**
 * Generate a one-line summary for a node based on its type and key params.
 * Intentionally lossy — gives context without burning tokens.
 */
export function generateNodeSummary(
  type: string,
  params?: Record<string, unknown>
): string {
  const p = params ?? {};

  // HTTP Request
  if (type.includes("httpRequest") || type.includes("http")) {
    const method = (p.method as string) ?? (p.httpMethod as string) ?? "GET";
    const url = (p.url as string) ?? "";
    const truncUrl = url.length > 60 ? url.substring(0, 57) + "..." : url;
    return truncUrl ? `${method} ${truncUrl}` : `HTTP ${method}`;
  }

  // Code nodes
  if (type.includes("code") || type.includes("function")) {
    const code =
      (p.jsCode as string) ??
      (p.functionCode as string) ??
      (p.code as string) ??
      "";
    const lang = (p.language as string) ?? "JavaScript";
    const langShort = lang === "JavaScript" ? "JS" : lang;

    // Extract first meaningful line (skip comments, empty, imports)
    const lines = code.split("\n").map((l) => l.trim());
    const meaningful = lines.find(
      (l) =>
        l.length > 0 &&
        !l.startsWith("//") &&
        !l.startsWith("/*") &&
        !l.startsWith("*") &&
        !l.startsWith("import ") &&
        !l.startsWith("const {") &&
        !l.startsWith("require(")
    );
    if (meaningful) {
      const trunc =
        meaningful.length > 60
          ? meaningful.substring(0, 57) + "..."
          : meaningful;
      return `${langShort}: ${trunc}`;
    }
    return `${langShort} code (${code.length} chars)`;
  }

  // IF node
  if (type === "if" || type.includes("if")) {
    // IF v2: conditions.conditions[0]
    const conditions = p.conditions as Record<string, unknown> | undefined;
    const condArr = conditions?.conditions as
      | Array<Record<string, unknown>>
      | undefined;
    if (condArr && condArr.length > 0) {
      const c = condArr[0];
      const left = exprShort(c.leftValue);
      const opObj = c.operator as Record<string, unknown> | string | undefined;
      const op =
        typeof opObj === "string"
          ? opObj
          : (opObj as Record<string, unknown>)?.operation ?? "==";
      const right = exprShort(c.rightValue);
      const summary = right
        ? `If ${left} ${op} ${right}`
        : `If ${left} ${op}`;
      return summary.length > 70 ? summary.substring(0, 67) + "..." : summary;
    }
    // IF v1: value1, operation, value2
    const v1 = exprShort(p.value1);
    const op = p.operation as string | undefined;
    const v2 = exprShort(p.value2);
    if (v1 && op) {
      const summary = `If ${v1} ${op} ${v2 ?? ""}`.trim();
      return summary.length > 70 ? summary.substring(0, 67) + "..." : summary;
    }
    return "Conditional branch";
  }

  // Switch node
  if (type === "switch" || type.includes("switch")) {
    const rules = p.rules as Record<string, unknown> | undefined;
    const values = rules?.values as Array<Record<string, unknown>> | undefined;
    const count = values?.length ?? 0;
    if (values && values.length > 0) {
      const labels = values
        .slice(0, 3)
        .map((v) => {
          const label = v.outputKey ?? v.output ?? v.value;
          return typeof label === "string" ? label : String(label ?? "");
        })
        .filter(Boolean);
      const suffix = count > 3 ? `, +${count - 3} more` : "";
      if (labels.length > 0) {
        return `Switch: ${labels.join(", ")}${suffix}`;
      }
    }
    return count > 0 ? `Switch with ${count} rules` : "Switch";
  }

  // AI Agent
  if (type.includes("agent")) {
    const opts = p.options as Record<string, unknown> | undefined;
    const sysMsg =
      (opts?.systemMessage as string) ?? (p.systemMessage as string) ?? "";
    if (sysMsg.length > 0) {
      const preview = sysMsg.replace(/\n/g, " ").trim();
      const trunc =
        preview.length > 80 ? preview.substring(0, 77) + "..." : preview;
      return `AI Agent: "${trunc}"`;
    }
    return "AI Agent";
  }

  // LLM / Chat models
  if (type.includes("lmChat") || type.includes("ChatModel")) {
    const model = p.model as Record<string, unknown> | string | undefined;
    const modelName =
      typeof model === "string"
        ? model
        : (model as Record<string, unknown>)?.value ?? "unknown";
    return `LLM: ${modelName}`;
  }

  // Webhook
  if (type.includes("webhook")) {
    const method = (p.httpMethod as string) ?? "POST";
    const path = (p.path as string) ?? "";
    return path ? `Webhook: ${method} /${path}` : "Webhook trigger";
  }

  // Set node
  if (type === "set" || type.includes("set")) {
    // v3 Set: assignments.assignments[].name
    const assignments = p.assignments as
      | { assignments?: Array<{ name?: string }> }
      | undefined;
    if (assignments?.assignments) {
      const fields = assignments.assignments
        .map((a) => a.name)
        .filter(Boolean)
        .slice(0, 5);
      if (fields.length > 0) {
        const suffix =
          assignments.assignments.length > 5
            ? `, +${assignments.assignments.length - 5}`
            : "";
        return `Sets: ${fields.join(", ")}${suffix}`;
      }
    }
    return "Set values";
  }

  // Chat trigger
  if (type.includes("chatTrigger")) {
    return "Chat trigger";
  }

  // Execute workflow trigger
  if (type.includes("executeWorkflowTrigger")) {
    return "Sub-workflow trigger";
  }

  // Respond to webhook
  if (type.includes("respondToWebhook")) {
    return "Respond to webhook";
  }

  // Vector store
  if (type.includes("vectorStore")) {
    const mode = (p.mode as string) ?? "";
    return mode ? `Vector store (${mode})` : "Vector store";
  }

  // Memory nodes
  if (type.includes("memory")) {
    return "Memory buffer";
  }

  // Embeddings
  if (type.includes("embedding")) {
    return "Embeddings";
  }

  // Merge
  if (type === "merge" || type.includes("merge")) {
    return "Merge";
  }

  // Filter
  if (type === "filter" || type.includes("filter")) {
    return "Filter";
  }

  // Split in batches
  if (type.includes("splitInBatches")) {
    return "Split in batches";
  }

  // NoOp / noop
  if (type.includes("noOp")) {
    return "No operation";
  }

  // Fallback: humanize the type name
  return type
    .replace("langchain:", "")
    .replace(/([A-Z])/g, " $1")
    .trim();
}

/**
 * Estimate token cost for a node's content.
 */
export function estimateNodeTokens(node: N8nNodeRaw): number {
  const paramStr = node.parameters ? JSON.stringify(node.parameters) : "";
  return 20 + Math.ceil(paramStr.length / 4);
}

/**
 * Extract a hint about what data a node outputs.
 * Used for dormant upstream nodes so the AI knows what data flows downstream.
 */
export function extractOutputHint(node: N8nNodeRaw): string | undefined {
  const params = node.parameters;
  if (!params) return undefined;
  const type = node.type.toLowerCase();

  // Set node: which fields it defines
  if (type.includes("set")) {
    const assignments = params.assignments as
      | { assignments?: Array<{ name?: string }> }
      | undefined;
    if (assignments?.assignments) {
      const fields = assignments.assignments
        .map((a) => a.name)
        .filter(Boolean)
        .slice(0, 5);
      if (fields.length > 0) return `Sets fields: ${fields.join(", ")}`;
    }
  }

  // Code node: hint from return statement
  if (type.includes("code") || type.includes("function")) {
    const code =
      (params.jsCode as string) ??
      (params.functionCode as string) ??
      (params.code as string) ??
      "";
    if (code) {
      const returnMatch = code.match(/return\s+[\[{]([^}\]]{0,80})/);
      if (returnMatch)
        return `Returns: ${returnMatch[0].substring(0, 80)}`;
    }
  }

  // HTTP Request: URL for context of which API
  if (type.includes("httprequest")) {
    const url = params.url as string | undefined;
    if (url && !url.startsWith("="))
      return `Fetches: ${url.substring(0, 80)}`;
  }

  // Database nodes: query summary
  if (
    type.includes("postgres") ||
    type.includes("mysql") ||
    type.includes("microsoftsql")
  ) {
    const query = params.query as string | undefined;
    if (query) {
      const match = query.match(/SELECT\s+(.{0,50})/i);
      if (match) return `Query: SELECT ${match[1]}`;
    }
  }

  // Spreadsheet/CSV nodes
  if (type.includes("spreadsheet") || type.includes("googlesheets")) {
    const sheetName = params.sheetName as string | undefined;
    const range = params.range as string | undefined;
    if (sheetName) return `Sheet: ${sheetName}${range ? ` (${range})` : ""}`;
  }

  // Execute workflow (sub-workflow)
  if (type.includes("executeworkflow")) {
    const wfId = params.workflowId as string | undefined;
    if (wfId) return `Sub-workflow: ${wfId}`;
  }

  return undefined;
}

// ============================================================
// Scan Mode (Table of Contents)
// ============================================================

/**
 * Generate a ScanNode from a raw n8n node — minimal, no params.
 */
export function scanNode(node: N8nNodeRaw): ScanNode {
  const simpleType = simplifyNodeType(node.type);
  const scan: ScanNode = {
    name: node.name,
    type: simpleType,
    _id: node.id,
  };

  if (node.disabled === true) {
    scan.disabled = true;
  }

  const summary = generateNodeSummary(simpleType, node.parameters);
  if (summary) {
    scan.summary = summary;
  }

  return scan;
}

/**
 * Build a WorkflowScan (table of contents) from a raw workflow.
 */
export function buildWorkflowScan(raw: N8nWorkflowRaw): WorkflowScan {
  const sortedNodes = topologicalSort(raw.nodes, raw.connections);
  const flow = simplifyConnections(raw.connections);

  // Detect output count per node from connections
  const maxOutputByNode = new Map<string, number>();
  for (const conn of flow) {
    const idx = conn.outputIndex ?? 0;
    const current = maxOutputByNode.get(conn.from) ?? 0;
    if (idx > current) maxOutputByNode.set(conn.from, idx);
  }

  const scanNodes = sortedNodes.map((node) => {
    const sn = scanNode(node);
    const maxOut = maxOutputByNode.get(node.name) ?? 0;
    if (maxOut > 0) {
      sn.outputs = maxOut + 1;
    }
    return sn;
  });

  // Detect segments
  const segmentInput = sortedNodes.map((n) => ({
    name: n.name,
    type: simplifyNodeType(n.type),
  }));
  const segments = detectSegments(segmentInput, flow);

  // Estimate total tokens
  const estimatedTokens = raw.nodes.reduce(
    (sum, node) => sum + estimateNodeTokens(node),
    0
  );

  const scan: WorkflowScan = {
    id: raw.id,
    name: raw.name,
    active: raw.active,
    nodeCount: raw.nodes.length,
    nodes: scanNodes,
    flow,
    estimatedTokens,
    focusRecommended: estimatedTokens > 8000 || raw.nodes.length > 30,
  };

  if (raw.tags && raw.tags.length > 0) {
    scan.tags = raw.tags.map((t) => t.name);
  }

  if (segments.length > 0) {
    scan.segments = segments;
  }

  if (raw.updatedAt) {
    scan.updatedAt = raw.updatedAt;
  }

  return scan;
}

// ============================================================
// Execution Data Extraction (Ghost Payload)
// ============================================================

/**
 * Extract node output keys from raw execution data.
 * Navigates: data.resultData.runData[nodeName][runIndex].data.main[outputIndex][itemIndex].json
 */
export function extractExecutionRunData(
  executionData: unknown
): ExecutionRunDataMap {
  const result: ExecutionRunDataMap = {};

  if (!executionData || typeof executionData !== "object") return result;

  const data = executionData as Record<string, unknown>;
  const resultData = data.resultData as Record<string, unknown> | undefined;
  if (!resultData) return result;

  const runData = resultData.runData as
    | Record<string, unknown[]>
    | undefined;
  if (!runData) return result;

  for (const [nodeName, runs] of Object.entries(runData)) {
    if (!Array.isArray(runs) || runs.length === 0) continue;

    // Take the last run (most recent execution of this node)
    const lastRun = runs[runs.length - 1] as Record<string, unknown>;

    // Check for errors
    if (lastRun.error) {
      result[nodeName] = {
        outputKeys: [],
        itemCount: 0,
        error:
          typeof lastRun.error === "string"
            ? lastRun.error
            : ((lastRun.error as Record<string, unknown>)?.message as string) ??
              "error",
      };
      continue;
    }

    const outputData = lastRun.data as Record<string, unknown> | undefined;
    if (!outputData) continue;

    const mainOutputs = outputData.main as unknown[][] | undefined;
    if (!Array.isArray(mainOutputs) || mainOutputs.length === 0) continue;

    // Collect keys from all items on the first output
    const items = mainOutputs[0];
    if (!Array.isArray(items) || items.length === 0) continue;

    const allKeys = new Set<string>();
    for (const item of items) {
      const json = (item as Record<string, unknown>)?.json as
        | Record<string, unknown>
        | undefined;
      if (json) {
        for (const key of Object.keys(json)) {
          allKeys.add(key);
        }
      }
    }

    const keysArr = Array.from(allKeys);
    result[nodeName] = {
      outputKeys: keysArr.length > 20 ? keysArr.slice(0, 20) : keysArr,
      itemCount: items.length,
    };
  }

  return result;
}

/**
 * Find the input keys for a node by looking at upstream node outputs.
 */
export function getInputHintForNode(
  nodeName: string,
  flow: LiteConnection[],
  runDataMap: ExecutionRunDataMap
): string[] | undefined {
  const upstreamNames = flow
    .filter((c) => c.to === nodeName)
    .map((c) => c.from);

  if (upstreamNames.length === 0) return undefined;

  const allKeys = new Set<string>();
  for (const upstream of upstreamNames) {
    const rd = runDataMap[upstream];
    if (rd?.outputKeys) {
      for (const key of rd.outputKeys) {
        allKeys.add(key);
      }
    }
  }

  return allKeys.size > 0 ? Array.from(allKeys) : undefined;
}

// ============================================================
// Focus Mode
// ============================================================

/**
 * Build a DormantNode from a raw node + its zone classification.
 */
export function buildDormantNode(
  node: N8nNodeRaw,
  zone: NodeZone,
  flow: LiteConnection[],
  focusedNames: Set<string>
): DormantNode {
  const simpleType = simplifyNodeType(node.type);
  const dormant: DormantNode = {
    name: node.name,
    type: simpleType,
    zone,
    summary: generateNodeSummary(simpleType, node.parameters),
  };

  if (zone === "upstream") {
    // Show which focused nodes this upstream node feeds
    const targets = flow
      .filter((c) => c.from === node.name && focusedNames.has(c.to))
      .map((c) => c.to);
    if (targets.length > 0) {
      dormant.outputsTo = [...new Set(targets)];
    }
    // Add output data hint so the AI knows what data flows downstream
    const hint = extractOutputHint(node);
    if (hint) dormant.outputHint = hint;
  }

  if (zone === "downstream") {
    // Show which focused nodes feed this downstream node
    const sources = flow
      .filter((c) => c.to === node.name && focusedNames.has(c.from))
      .map((c) => c.from);
    if (sources.length > 0) {
      dormant.inputsFrom = [...new Set(sources)];
    }
  }

  return dormant;
}

/**
 * Build a FocusedWorkflow from a raw workflow and a set of focused node names.
 */
export function buildFocusedView(
  raw: N8nWorkflowRaw,
  focusedNodeNames: string[],
  runDataMap?: ExecutionRunDataMap
): FocusedWorkflow {
  const focusedSet = new Set(focusedNodeNames);
  const allNames = raw.nodes.map((n) => n.name);
  const flow = simplifyConnections(raw.connections);

  // Classify all nodes
  const classification = classifyNodes(allNames, focusedSet, flow);

  // Build focused nodes (full detail via simplifyNode)
  const sortedRawNodes = topologicalSort(raw.nodes, raw.connections);
  const focused = sortedRawNodes
    .filter((n) => focusedSet.has(n.name))
    .map((n) => {
      const lite = simplifyNode(n);
      // Inject inputHint from execution data if available
      if (runDataMap) {
        const hint = getInputHintForNode(n.name, flow, runDataMap);
        if (hint) lite.inputHint = hint;
      }
      return lite;
    });

  // Connections within focus area only
  const focusedFlow = flow.filter(
    (c) => focusedSet.has(c.from) && focusedSet.has(c.to)
  );

  // Build dormant nodes
  const dormant: DormantNode[] = [];
  const stats = {
    focusedCount: 0,
    upstreamCount: 0,
    downstreamCount: 0,
    parallelCount: 0,
  };

  for (const node of sortedRawNodes) {
    const zone = classification.get(node.name) ?? "parallel";
    if (zone === "focused") {
      stats.focusedCount++;
    } else {
      dormant.push(buildDormantNode(node, zone, flow, focusedSet));
      if (zone === "upstream") stats.upstreamCount++;
      else if (zone === "downstream") stats.downstreamCount++;
      else stats.parallelCount++;
    }
  }

  // Find boundaries
  const boundaries = findBoundaries(focusedSet, flow);

  return {
    id: raw.id,
    name: raw.name,
    totalNodeCount: raw.nodes.length,
    focused,
    focusedFlow,
    dormant,
    boundaries,
    stats,
  };
}

// ============================================================
// Focus Area Discovery
// ============================================================

/**
 * Auto-discover focused nodes by following a specific branch.
 */
export function discoverFocusArea(
  raw: N8nWorkflowRaw,
  startNode: string,
  outputIndex: number,
  options?: {
    maxDepth?: number;
    includeUpstream?: number;
  }
): string[] {
  const flow = simplifyConnections(raw.connections);
  const branchNodes = followBranch(startNode, outputIndex, flow, {
    maxDepth: options?.maxDepth,
  });

  // Optionally include upstream nodes
  if (options?.includeUpstream && options.includeUpstream > 0) {
    const { reverse } = buildAdjacency(flow);
    const upstream = bfsBackward(Array.from(branchNodes), reverse, {
      maxDepth: options.includeUpstream,
      excludeNodes: branchNodes,
    });
    for (const name of upstream) branchNodes.add(name);
  }

  return Array.from(branchNodes);
}

/**
 * Discover nodes between two points in the workflow (range mode).
 */
export function discoverRange(
  raw: N8nWorkflowRaw,
  fromNode: string,
  toNode: string
): string[] {
  const flow = simplifyConnections(raw.connections);
  const between = findNodesBetween(fromNode, toNode, flow);
  return Array.from(between);
}
