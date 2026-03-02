// ============================================================
// n8n-mcp-lite: Error execution processor
// 5-phase error analysis for rich AI debugging
// Adapted from n8n-mcp's error-execution-processor.ts
// ============================================================

import type { N8nConnections, N8nConnectionTarget } from "../types.js";

// ---- Public types ----

export interface ErrorAnalysis {
  primaryError: {
    message: string;
    errorType: string;
    nodeName: string;
    nodeType: string;
    httpCode?: number;
    description?: string;
  };
  upstreamContext?: {
    nodeName: string;
    nodeType: string;
    itemCount: number;
    sampleKeys: string[];
  };
  executionPath: Array<{
    nodeName: string;
    status: "success" | "error" | "skipped";
    itemCount: number;
  }>;
  additionalErrors: Array<{ nodeName: string; message: string }>;
  suggestions: Array<{
    type: "fix" | "investigate" | "workaround";
    title: string;
    description: string;
    confidence: "high" | "medium";
  }>;
}

// ---- Main entry point ----

/**
 * Process a failed execution into a structured error analysis.
 * @param executionData - The raw execution `data` field from n8n API
 * @param workflowRaw  - Optional workflow JSON for connection tracing
 */
export function processErrorExecution(
  executionData: unknown,
  workflowRaw?: unknown
): ErrorAnalysis {
  const data = executionData as Record<string, unknown> | undefined;
  const resultData = data?.resultData as Record<string, unknown> | undefined;
  const runData = resultData?.runData as Record<string, unknown[]> | undefined;
  const topError = resultData?.error as Record<string, unknown> | undefined;

  const primary = extractPrimaryError(topError, runData);
  const upstream = extractUpstreamContext(primary.nodeName, runData, workflowRaw);
  const path = buildExecutionPath(runData);
  const additional = findAdditionalErrors(runData, primary.nodeName);
  const suggestions = generateSuggestions(primary, upstream);

  return {
    primaryError: primary,
    upstreamContext: upstream,
    executionPath: path,
    additionalErrors: additional,
    suggestions,
  };
}

// ---- Phase 1: Extract primary error ----

function extractPrimaryError(
  topError: Record<string, unknown> | undefined,
  runData: Record<string, unknown[]> | undefined
): ErrorAnalysis["primaryError"] {
  // Default fallback
  const result: ErrorAnalysis["primaryError"] = {
    message: "Unknown error",
    errorType: "Unknown",
    nodeName: "Unknown",
    nodeType: "Unknown",
  };

  if (!topError) return result;

  result.message = (topError.message as string) ?? "Unknown error";
  result.errorType = (topError.name as string) ?? "Unknown";

  // Extract node info from the error object
  const errorNode = topError.node as Record<string, unknown> | undefined;
  if (errorNode) {
    result.nodeName = (errorNode.name as string) ?? "Unknown";
    result.nodeType = (errorNode.type as string) ?? "Unknown";
  }

  // HTTP-specific error details
  if (topError.httpCode !== undefined) {
    result.httpCode = topError.httpCode as number;
  }
  if (topError.description) {
    result.description = String(topError.description).slice(0, 500);
  }

  // Enrich from node-level runData error (often has more detail)
  if (runData && result.nodeName !== "Unknown") {
    const nodeRuns = runData[result.nodeName];
    if (Array.isArray(nodeRuns) && nodeRuns.length > 0) {
      const lastRun = nodeRuns[nodeRuns.length - 1] as Record<string, unknown>;
      const nodeError = lastRun.error as Record<string, unknown> | undefined;
      if (nodeError) {
        if (!result.httpCode && nodeError.httpCode) {
          result.httpCode = nodeError.httpCode as number;
        }
        if (!result.description && nodeError.description) {
          result.description = String(nodeError.description).slice(0, 500);
        }
        // Prefer the node-level message if more detailed
        const nodeMsg = nodeError.message as string;
        if (nodeMsg && nodeMsg.length > result.message.length) {
          result.message = nodeMsg;
        }
      }
    }
  }

  return result;
}

// ---- Phase 2: Extract upstream context ----

function extractUpstreamContext(
  errorNodeName: string,
  runData: Record<string, unknown[]> | undefined,
  workflowRaw: unknown
): ErrorAnalysis["upstreamContext"] | undefined {
  if (!runData || errorNodeName === "Unknown") return undefined;

  // Strategy 1: Use workflow connections to find upstream node
  const workflow = workflowRaw as Record<string, unknown> | undefined;
  if (workflow?.connections) {
    const connections = workflow.connections as N8nConnections;
    const nodes = workflow.nodes as Array<Record<string, unknown>> | undefined;
    const upstreamName = findUpstreamNode(errorNodeName, connections);

    if (upstreamName && runData[upstreamName]) {
      const upstreamRuns = runData[upstreamName] as Array<Record<string, unknown>>;
      const lastRun = upstreamRuns[upstreamRuns.length - 1];
      const outputData = lastRun?.data as Record<string, unknown> | undefined;
      const mainOutputs = outputData?.main as unknown[][] | undefined;

      if (mainOutputs && mainOutputs[0]) {
        const items = mainOutputs[0];
        const keys = extractOutputKeys(items);
        const nodeInfo = nodes?.find((n) => n.name === upstreamName);

        return {
          nodeName: upstreamName,
          nodeType: (nodeInfo?.type as string) ?? "Unknown",
          itemCount: items.length,
          sampleKeys: keys,
        };
      }
    }
  }

  // Strategy 2: Heuristic — find most recent successful node
  const successfulNodes: Array<{ name: string; startTime: number; run: Record<string, unknown> }> = [];
  for (const [nodeName, runs] of Object.entries(runData)) {
    if (nodeName === errorNodeName) continue;
    if (!Array.isArray(runs) || runs.length === 0) continue;
    const lastRun = runs[runs.length - 1] as Record<string, unknown>;
    if (lastRun.error) continue;
    const startTime = lastRun.startTime as number ?? 0;
    successfulNodes.push({ name: nodeName, startTime, run: lastRun });
  }

  if (successfulNodes.length === 0) return undefined;

  successfulNodes.sort((a, b) => b.startTime - a.startTime);
  const nearest = successfulNodes[0];
  const outputData = nearest.run.data as Record<string, unknown> | undefined;
  const mainOutputs = outputData?.main as unknown[][] | undefined;

  if (mainOutputs && mainOutputs[0]) {
    return {
      nodeName: nearest.name,
      nodeType: "Unknown",
      itemCount: mainOutputs[0].length,
      sampleKeys: extractOutputKeys(mainOutputs[0]),
    };
  }

  return undefined;
}

/** Walk connections backward to find the node that feeds into targetNode */
function findUpstreamNode(
  targetNode: string,
  connections: N8nConnections
): string | undefined {
  for (const [sourceName, outputs] of Object.entries(connections)) {
    for (const outputType of Object.values(outputs)) {
      for (const targets of outputType) {
        for (const target of targets) {
          if (target.node === targetNode) {
            return sourceName;
          }
        }
      }
    }
  }
  return undefined;
}

/** Extract output field keys from execution items (token-efficient: keys only, no values) */
function extractOutputKeys(items: unknown[]): string[] {
  const allKeys = new Set<string>();
  for (const item of items) {
    const json = (item as Record<string, unknown>)?.json as Record<string, unknown> | undefined;
    if (json) {
      for (const key of Object.keys(json)) {
        allKeys.add(key);
      }
    }
  }
  const keys = Array.from(allKeys);
  return keys.length > 20
    ? [...keys.slice(0, 20), `...+${keys.length - 20} more`]
    : keys;
}

// ---- Phase 3: Build execution path ----

function buildExecutionPath(
  runData: Record<string, unknown[]> | undefined
): ErrorAnalysis["executionPath"] {
  if (!runData) return [];

  const entries: Array<{ nodeName: string; startTime: number; status: "success" | "error"; itemCount: number }> = [];

  for (const [nodeName, runs] of Object.entries(runData)) {
    if (!Array.isArray(runs) || runs.length === 0) continue;
    const lastRun = runs[runs.length - 1] as Record<string, unknown>;
    const hasError = !!lastRun.error;
    const startTime = (lastRun.startTime as number) ?? 0;

    let itemCount = 0;
    if (!hasError) {
      const outputData = lastRun.data as Record<string, unknown> | undefined;
      const mainOutputs = outputData?.main as unknown[][] | undefined;
      if (mainOutputs && mainOutputs[0]) {
        itemCount = mainOutputs[0].length;
      }
    }

    entries.push({
      nodeName,
      startTime,
      status: hasError ? "error" : "success",
      itemCount,
    });
  }

  // Sort by execution time (trigger first, error last)
  entries.sort((a, b) => a.startTime - b.startTime);

  return entries.map(({ nodeName, status, itemCount }) => ({
    nodeName,
    status,
    itemCount,
  }));
}

// ---- Phase 4: Find additional errors ----

function findAdditionalErrors(
  runData: Record<string, unknown[]> | undefined,
  primaryNodeName: string
): ErrorAnalysis["additionalErrors"] {
  if (!runData) return [];

  const additional: ErrorAnalysis["additionalErrors"] = [];

  for (const [nodeName, runs] of Object.entries(runData)) {
    if (nodeName === primaryNodeName) continue;
    if (!Array.isArray(runs) || runs.length === 0) continue;
    const lastRun = runs[runs.length - 1] as Record<string, unknown>;
    if (!lastRun.error) continue;

    const errorObj = lastRun.error as Record<string, unknown> | string;
    const message = typeof errorObj === "string"
      ? errorObj
      : (errorObj?.message as string) ?? "error";

    additional.push({ nodeName, message });
  }

  return additional;
}

// ---- Phase 5: Generate suggestions ----

interface SuggestionPattern {
  keywords: RegExp;
  type: "fix" | "investigate" | "workaround";
  title: string;
  description: string;
  confidence: "high" | "medium";
}

const SUGGESTION_PATTERNS: SuggestionPattern[] = [
  {
    keywords: /required|must be provided|mandatory/i,
    type: "fix",
    title: "Missing required field",
    description: "A required field is missing. Check the node configuration and provide all mandatory parameters. Use get_node to see required fields.",
    confidence: "high",
  },
  {
    keywords: /auth|credentials?|401|403|unauthorized|forbidden/i,
    type: "fix",
    title: "Authentication error",
    description: "The request was rejected due to authentication issues. Verify the credentials are correctly configured in n8n (not in the workflow JSON).",
    confidence: "high",
  },
  {
    keywords: /429|rate.?limit|too many requests|throttl/i,
    type: "workaround",
    title: "Rate limiting",
    description: "The API is rate-limiting requests. Add a Wait node before this node, or reduce the batch size. Consider using the 'retry on fail' option.",
    confidence: "high",
  },
  {
    keywords: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EHOSTUNREACH|network|connect/i,
    type: "investigate",
    title: "Connection error",
    description: "Cannot reach the target server. Verify the URL/host is correct and accessible from the n8n instance. Check network/firewall settings.",
    confidence: "high",
  },
  {
    keywords: /json|parse error|unexpected token|syntax error/i,
    type: "fix",
    title: "Invalid JSON",
    description: "The response or request body contains invalid JSON. If sending data, verify the JSON structure. If receiving, the API may be returning non-JSON (HTML error page?).",
    confidence: "high",
  },
  {
    keywords: /not found|undefined|cannot read propert|null/i,
    type: "investigate",
    title: "Missing data field",
    description: "A referenced field doesn't exist in the input data. Check upstream node output — the field name may be different or missing. Use focus_workflow with executionId to see what data was available.",
    confidence: "medium",
  },
  {
    keywords: /type|expected.*but got|invalid.*value|cast/i,
    type: "fix",
    title: "Type mismatch",
    description: "A value has the wrong type (e.g. string instead of number). Check the parameter types expected by this node using get_node.",
    confidence: "medium",
  },
  {
    keywords: /timeout|timed?\s*out/i,
    type: "workaround",
    title: "Request timeout",
    description: "The operation timed out. Increase the timeout setting on the node, or check if the target service is responding slowly.",
    confidence: "high",
  },
  {
    keywords: /permission|access denied|not allowed|insufficient/i,
    type: "fix",
    title: "Permission denied",
    description: "The authenticated user/key doesn't have permission for this operation. Check the API key/token scopes and permissions.",
    confidence: "high",
  },
  {
    keywords: /duplicate|already exists|conflict|unique/i,
    type: "fix",
    title: "Duplicate/conflict",
    description: "The resource already exists or there's a conflict. Check if the item was already created, or use an upsert operation if available.",
    confidence: "medium",
  },
];

function generateSuggestions(
  primary: ErrorAnalysis["primaryError"],
  upstream: ErrorAnalysis["upstreamContext"] | undefined
): ErrorAnalysis["suggestions"] {
  const suggestions: ErrorAnalysis["suggestions"] = [];
  const errorText = `${primary.message} ${primary.description ?? ""} ${primary.errorType}`;

  // Pattern-based suggestions
  for (const pattern of SUGGESTION_PATTERNS) {
    if (pattern.keywords.test(errorText)) {
      suggestions.push({
        type: pattern.type,
        title: pattern.title,
        description: pattern.description,
        confidence: pattern.confidence,
      });
    }
  }

  // Empty upstream data suggestion
  if (upstream && upstream.itemCount === 0) {
    suggestions.push({
      type: "investigate",
      title: "Empty input data",
      description: `The upstream node "${upstream.nodeName}" produced 0 items. This node received no data to process. Check if the upstream node is filtering too aggressively or if its source is empty.`,
      confidence: "high",
    });
  }

  // HTTP code-specific suggestions
  if (primary.httpCode) {
    if (primary.httpCode === 400 && suggestions.length === 0) {
      suggestions.push({
        type: "fix",
        title: "Bad request (400)",
        description: "The API rejected the request. Check required parameters, data format, and field values. Use get_node to see the correct parameter structure.",
        confidence: "medium",
      });
    }
    if (primary.httpCode === 404) {
      suggestions.push({
        type: "fix",
        title: "Resource not found (404)",
        description: "The requested resource doesn't exist. Verify the ID/URL is correct and the resource hasn't been deleted.",
        confidence: "high",
      });
    }
    if (primary.httpCode >= 500) {
      suggestions.push({
        type: "workaround",
        title: "Server error (5xx)",
        description: "The target server returned an internal error. This is usually not a configuration issue — try again later or contact the service provider.",
        confidence: "high",
      });
    }
  }

  // Generic fallback if no patterns matched
  if (suggestions.length === 0) {
    suggestions.push({
      type: "investigate",
      title: "Node operation error",
      description: `Error in "${primary.nodeName}" (${primary.nodeType}): ${primary.message}. Check the node configuration and input data.`,
      confidence: "medium",
    });
  }

  return suggestions;
}
