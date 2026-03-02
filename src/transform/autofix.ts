// ============================================================
// n8n-mcp-lite: Workflow autofix engine
// Detects and applies common fixes to workflow issues
// ============================================================

import { nodeDb } from "../knowledge/node-db.js";

// ---- Public types ----

export interface AutoFix {
  type: string;
  nodeName: string;
  property?: string;
  before: unknown;
  after: unknown;
  confidence: "high" | "medium" | "low";
  description: string;
}

export interface AutoFixOptions {
  fixTypes?: string[];
  confidenceThreshold?: "high" | "medium" | "low";
}

// Confidence levels as numeric values for comparison
const CONFIDENCE_LEVEL: Record<string, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

// ---- Main API ----

/**
 * Detect fixable issues in a workflow.
 * Does NOT modify the workflow — returns a list of potential fixes.
 */
export function detectFixes(
  workflow: Record<string, unknown>,
  options?: AutoFixOptions
): AutoFix[] {
  const nodes = workflow.nodes as Array<Record<string, unknown>> | undefined;
  if (!nodes || !Array.isArray(nodes)) return [];

  const fixes: AutoFix[] = [];
  const allowedTypes = options?.fixTypes
    ? new Set(options.fixTypes)
    : null;
  const minConfidence = CONFIDENCE_LEVEL[options?.confidenceThreshold ?? "medium"] ?? 1;

  for (const node of nodes) {
    const name = node.name as string;
    const type = node.type as string;
    const params = (node.parameters ?? {}) as Record<string, unknown>;
    const typeVersion = node.typeVersion as number | undefined;

    // Fix 1: Expression format — {{ expr }} without leading =
    if (!allowedTypes || allowedTypes.has("expression-format")) {
      detectExpressionFixes(name, params, fixes, "");
    }

    // Fix 2: TypeVersion correction
    if (!allowedTypes || allowedTypes.has("typeversion-correction")) {
      if (type && typeVersion !== undefined) {
        detectTypeVersionFix(name, type, typeVersion, fixes);
      }
    }

    // Fix 3: Webhook missing path
    if (!allowedTypes || allowedTypes.has("webhook-missing-path")) {
      if (type && type.toLowerCase().includes("webhook")) {
        detectWebhookPathFix(name, params, fixes);
      }
    }

    // Fix 4: Error output config without connection
    if (!allowedTypes || allowedTypes.has("error-output-config")) {
      detectErrorOutputFix(name, node, workflow, fixes);
    }
  }

  // Filter by confidence threshold
  return fixes.filter(
    (f) => (CONFIDENCE_LEVEL[f.confidence] ?? 0) >= minConfidence
  );
}

/**
 * Apply fixes to a workflow (returns a new modified workflow object).
 * The original is NOT mutated.
 */
export function applyFixes(
  workflow: Record<string, unknown>,
  fixes: AutoFix[]
): Record<string, unknown> {
  // Deep clone to avoid mutation
  const patched = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;
  const nodes = patched.nodes as Array<Record<string, unknown>>;
  if (!nodes) return patched;

  // Index fixes by node name for quick lookup
  const fixesByNode = new Map<string, AutoFix[]>();
  for (const fix of fixes) {
    const arr = fixesByNode.get(fix.nodeName) ?? [];
    arr.push(fix);
    fixesByNode.set(fix.nodeName, arr);
  }

  for (const node of nodes) {
    const name = node.name as string;
    const nodeFixes = fixesByNode.get(name);
    if (!nodeFixes) continue;

    for (const fix of nodeFixes) {
      switch (fix.type) {
        case "expression-format": {
          if (fix.property) {
            setNestedValue(
              (node.parameters ?? {}) as Record<string, unknown>,
              fix.property,
              fix.after
            );
          }
          break;
        }
        case "typeversion-correction": {
          node.typeVersion = fix.after;
          break;
        }
        case "webhook-missing-path": {
          const params = (node.parameters ?? {}) as Record<string, unknown>;
          params.path = fix.after;
          node.parameters = params;
          break;
        }
        case "error-output-config": {
          // Remove onError from node if it's set without connections
          delete node.onError;
          break;
        }
      }
    }
  }

  return patched;
}

// ---- Fix detectors ----

/**
 * Recursively detect expression format issues: {{ expr }} without = prefix
 */
function detectExpressionFixes(
  nodeName: string,
  obj: Record<string, unknown>,
  fixes: AutoFix[],
  pathPrefix: string
): void {
  for (const [key, value] of Object.entries(obj)) {
    const fullPath = pathPrefix ? `${pathPrefix}.${key}` : key;

    if (typeof value === "string") {
      // Pattern: starts with {{ but not with ={{ — needs = prefix
      if (/^\{\{.*\}\}$/.test(value.trim()) && !value.trim().startsWith("=")) {
        fixes.push({
          type: "expression-format",
          nodeName,
          property: fullPath,
          before: value,
          after: `=${value.trim()}`,
          confidence: "high",
          description: `Expression "${value}" missing "=" prefix. n8n requires "={{ expr }}" format.`,
        });
      }
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      detectExpressionFixes(
        nodeName,
        value as Record<string, unknown>,
        fixes,
        fullPath
      );
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        if (value[i] && typeof value[i] === "object") {
          detectExpressionFixes(
            nodeName,
            value[i] as Record<string, unknown>,
            fixes,
            `${fullPath}[${i}]`
          );
        }
      }
    }
  }
}

/**
 * Detect if typeVersion exceeds the known maximum for a node type.
 */
function detectTypeVersionFix(
  nodeName: string,
  nodeType: string,
  currentVersion: number,
  fixes: AutoFix[]
): void {
  const schema = nodeDb.getNode(nodeType);
  if (!schema?.v) return;

  const maxVersion = parseFloat(schema.v);
  if (isNaN(maxVersion) || currentVersion <= maxVersion) return;

  fixes.push({
    type: "typeversion-correction",
    nodeName,
    before: currentVersion,
    after: maxVersion,
    confidence: "high",
    description: `typeVersion ${currentVersion} exceeds known max (${maxVersion}) for ${nodeType}. Downgrading to avoid runtime errors.`,
  });
}

/**
 * Detect webhook nodes without a path configured.
 */
function detectWebhookPathFix(
  nodeName: string,
  params: Record<string, unknown>,
  fixes: AutoFix[]
): void {
  if (params.path) return; // Path already set

  const uuid = crypto.randomUUID().slice(0, 8);
  fixes.push({
    type: "webhook-missing-path",
    nodeName,
    property: "path",
    before: undefined,
    after: uuid,
    confidence: "high",
    description: `Webhook node "${nodeName}" has no path. Generated a unique path.`,
  });
}

/**
 * Detect onError output config without corresponding error output connections.
 */
function detectErrorOutputFix(
  nodeName: string,
  node: Record<string, unknown>,
  workflow: Record<string, unknown>,
  fixes: AutoFix[]
): void {
  const onError = node.onError as string | undefined;
  if (onError !== "continueErrorOutput") return;

  // Check if there are connections from this node's error output (index 1)
  const connections = workflow.connections as Record<string, Record<string, unknown[][]>> | undefined;
  if (!connections) return;

  const nodeConnections = connections[nodeName];
  if (!nodeConnections?.main) return;

  const mainOutputs = nodeConnections.main as unknown[][];
  // Error output is at index 1
  const hasErrorConnection = mainOutputs.length > 1 && mainOutputs[1] && mainOutputs[1].length > 0;

  if (!hasErrorConnection) {
    fixes.push({
      type: "error-output-config",
      nodeName,
      before: "continueErrorOutput",
      after: undefined,
      confidence: "medium",
      description: `Node "${nodeName}" has onError="continueErrorOutput" but no error output connection. Removing to avoid silent failures.`,
    });
  }
}

// ---- Utility ----

/**
 * Set a nested value in an object using dot-notation path.
 * Supports paths like "options.field" and "items[0].value"
 */
function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown
): void {
  const parts = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: Record<string, unknown> = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const key = parts[i];
    if (current[key] === undefined || current[key] === null) return;
    if (typeof current[key] === "object") {
      current = current[key] as Record<string, unknown>;
    } else {
      return; // Can't traverse further
    }
  }

  current[parts[parts.length - 1]] = value;
}
