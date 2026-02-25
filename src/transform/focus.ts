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
    const code = (p.jsCode as string) ?? (p.functionCode as string) ?? "";
    const lang = (p.language as string) ?? "JavaScript";
    return `${lang} code (${code.length} chars)`;
  }

  // IF node
  if (type === "if" || type.includes("if")) {
    return "Conditional branch";
  }

  // Switch node
  if (type === "switch" || type.includes("switch")) {
    const rules = p.rules as Record<string, unknown> | undefined;
    const values = rules?.values as unknown[];
    const count = values?.length ?? 0;
    return count > 0 ? `Switch with ${count} rules` : "Switch";
  }

  // AI Agent
  if (type.includes("agent")) {
    const opts = p.options as Record<string, unknown> | undefined;
    const sysMsg = (opts?.systemMessage as string) ?? "";
    const msgLen = sysMsg.length;
    return msgLen > 0 ? `AI Agent (prompt: ${msgLen} chars)` : "AI Agent";
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
  focusedNodeNames: string[]
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
    .map(simplifyNode);

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
