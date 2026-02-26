// ============================================================
// n8n-mcp-lite: Security analyzer
// Detects credential exposure, secrets, and dangerous patterns
// ============================================================

import type { ValidationWarning, VirtualNode } from "./types.js";

// Patterns that match common secrets/credentials in plain text
const SECRET_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /(?:api[_-]?key|apikey)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}/i, label: "API key" },
  { pattern: /(?:password|passwd|pwd)\s*[:=]\s*["']?[^\s"']{4,}/i, label: "Password" },
  { pattern: /(?:secret|token)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}/i, label: "Secret/Token" },
  { pattern: /(?:bearer|authorization)\s*[:=]\s*["']?[a-zA-Z0-9_\-]{16,}/i, label: "Authorization header" },
  { pattern: /sk-[a-zA-Z0-9]{20,}/, label: "OpenAI API key" },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, label: "GitHub personal access token" },
  { pattern: /gho_[a-zA-Z0-9]{36}/, label: "GitHub OAuth token" },
  { pattern: /xoxb-[0-9]+-[0-9]+-[a-zA-Z0-9]+/, label: "Slack bot token" },
  { pattern: /xoxp-[0-9]+-[0-9]+-[0-9]+-[a-f0-9]+/, label: "Slack user token" },
  { pattern: /AKIA[0-9A-Z]{16}/, label: "AWS access key" },
  { pattern: /-----BEGIN (?:RSA )?PRIVATE KEY-----/, label: "Private key" },
  { pattern: /(?:mysql|postgres|mongodb|redis):\/\/[^\s]+:[^\s]+@/, label: "Database connection string with credentials" },
];

/**
 * Scan a node's parameters for hardcoded secrets/credentials.
 */
export function detectCredentialExposure(
  node: VirtualNode
): ValidationWarning[] {
  const warnings: ValidationWarning[] = [];
  const seen = new WeakSet();

  function scan(obj: unknown, path: string, depth: number): void {
    if (depth > 30) return;

    if (typeof obj === "string" && obj.length > 8) {
      // Skip expression values (they reference variables, not literal secrets)
      if (obj.startsWith("=")) return;

      for (const { pattern, label } of SECRET_PATTERNS) {
        if (pattern.test(obj)) {
          warnings.push({
            type: "security",
            node: node.name,
            property: path,
            message: `Possible hardcoded ${label} detected in "${path}". Hardcoded credentials are a security risk.`,
            suggestion:
              "Use n8n's credential manager or environment variables ($env.VARIABLE) instead of hardcoding secrets.",
          });
          break; // One warning per value is enough
        }
      }
    }

    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) {
        scan(obj[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    if (obj && typeof obj === "object") {
      if (seen.has(obj as object)) return;
      seen.add(obj as object);
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        scan(value, path ? `${path}.${key}` : key, depth + 1);
      }
    }
  }

  scan(node.parameters, "", 0);
  return warnings;
}

/**
 * Check workflow connections for structural issues.
 */
export function validateConnections(
  nodes: VirtualNode[],
  connections: Record<string, unknown>
): { errors: Array<{ type: "invalid_connection"; node: string; message: string; fix?: string }>; warnings: ValidationWarning[] } {
  const errors: Array<{ type: "invalid_connection"; node: string; message: string; fix?: string }> = [];
  const warnings: ValidationWarning[] = [];

  const nodeNames = new Set(nodes.map((n) => n.name));

  // Walk connections to verify all referenced nodes exist
  for (const [sourceName, outputs] of Object.entries(connections)) {
    if (!nodeNames.has(sourceName)) {
      errors.push({
        type: "invalid_connection",
        node: sourceName,
        message: `Connection references source node "${sourceName}" which doesn't exist in the workflow.`,
        fix: `Remove the connection or add a node named "${sourceName}".`,
      });
      continue;
    }

    if (!outputs || typeof outputs !== "object") continue;

    for (const [_outputType, arrays] of Object.entries(outputs as Record<string, unknown[][]>)) {
      if (!Array.isArray(arrays)) continue;
      for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const target of arr) {
          if (target && typeof target === "object" && "node" in target) {
            const targetName = (target as { node: string }).node;
            if (!nodeNames.has(targetName)) {
              errors.push({
                type: "invalid_connection",
                node: sourceName,
                message: `Connection from "${sourceName}" targets non-existent node "${targetName}".`,
                fix: `Remove the connection or add a node named "${targetName}".`,
              });
            }
          }
        }
      }
    }
  }

  // Check for orphan nodes (no incoming or outgoing connections) - warning only
  const connectedNodes = new Set<string>();
  for (const [sourceName, outputs] of Object.entries(connections)) {
    connectedNodes.add(sourceName);
    if (!outputs || typeof outputs !== "object") continue;
    for (const arrays of Object.values(outputs as Record<string, unknown[][]>)) {
      if (!Array.isArray(arrays)) continue;
      for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const target of arr) {
          if (target && typeof target === "object" && "node" in target) {
            connectedNodes.add((target as { node: string }).node);
          }
        }
      }
    }
  }

  for (const node of nodes) {
    if (!connectedNodes.has(node.name) && !node.disabled) {
      // Trigger nodes are fine as orphans (they're entry points)
      const type = node.type.toLowerCase();
      const isTrigger =
        type.includes("trigger") ||
        type.includes("webhook") ||
        type.includes("schedule") ||
        type.includes("cron");
      if (!isTrigger && nodes.length > 1) {
        warnings.push({
          type: "best_practice",
          node: node.name,
          message: `Node "${node.name}" is disconnected (no connections to or from it).`,
          suggestion: "Connect this node to the workflow flow or remove it if unused.",
        });
      }
    }
  }

  return { errors, warnings };
}
