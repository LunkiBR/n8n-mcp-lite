// ============================================================
// n8n-mcp-lite: Preflight validation engine
// Intercepts mutations, validates virtually, blocks if unsafe
// ============================================================

import type {
  PreflightResult,
  ValidationError,
  ValidationWarning,
  VirtualWorkflowState,
  VirtualNode,
} from "./types.js";
import { validateNodeConfig } from "./config-validator.js";
import { validateAllExpressions } from "./expression-validator.js";
import { detectCredentialExposure, validateConnections } from "./security-analyzer.js";

/**
 * Run preflight validation on a virtual workflow state.
 * This is called AFTER applying the mutation virtually in memory,
 * but BEFORE sending it to the n8n API.
 *
 * @param state - The virtual (post-mutation) workflow state
 * @param mutationType - What kind of mutation triggered this
 * @returns PreflightResult with pass/fail and details
 */
export function runPreflight(
  state: VirtualWorkflowState,
  mutationType: string
): PreflightResult {
  const start = Date.now();
  const errors: ValidationError[] = [];
  const warnings: ValidationWarning[] = [];

  const { nodes, connections } = state;

  // ---- Phase 1: Validate each node ----
  for (const node of nodes) {
    // Skip disabled nodes
    if (node.disabled) continue;

    // 1a. Config validation against node knowledge DB
    const configResult = validateNodeConfig(node);
    errors.push(...configResult.errors);
    warnings.push(...configResult.warnings);

    // 1b. Expression validation on all parameters
    const exprResult = validateAllExpressions(
      node.parameters,
      node.name
    );
    errors.push(...exprResult.errors);
    warnings.push(...exprResult.warnings);

    // 1c. Security: credential exposure scan
    const credWarnings = detectCredentialExposure(node);
    warnings.push(...credWarnings);
  }

  // ---- Phase 2: Validate connections ----
  if (connections && typeof connections === "object") {
    const connResult = validateConnections(
      nodes,
      connections as Record<string, unknown>
    );
    errors.push(...connResult.errors);
    warnings.push(...connResult.warnings);
  }

  // ---- Phase 3: Workflow-level checks ----

  // Check for duplicate node names
  const nameCount = new Map<string, number>();
  for (const node of nodes) {
    nameCount.set(node.name, (nameCount.get(node.name) || 0) + 1);
  }
  for (const [name, count] of nameCount) {
    if (count > 1) {
      errors.push({
        type: "invalid_value",
        node: name,
        message: `Duplicate node name "${name}" (appears ${count} times). Node names must be unique.`,
        fix: `Rename one of the duplicate nodes to a unique name.`,
      });
    }
  }

  // ---- Build result ----
  const durationMs = Date.now() - start;
  const pass = errors.length === 0;

  let summary: string;
  if (pass && warnings.length === 0) {
    summary = `✓ Preflight passed (${mutationType}). No issues found.`;
  } else if (pass) {
    summary = `✓ Preflight passed with ${warnings.length} warning(s) (${mutationType}).`;
  } else {
    summary = `✗ Preflight BLOCKED (${mutationType}): ${errors.length} error(s), ${warnings.length} warning(s). Fix errors before proceeding.`;
  }

  return {
    pass,
    errors,
    warnings,
    summary,
    durationMs,
  };
}

/**
 * Build a virtual workflow state from raw n8n workflow data.
 * Used to create the "virtual" post-mutation state for validation.
 */
export function buildVirtualState(
  nodes: Array<{
    name: string;
    type: string;
    typeVersion: number;
    parameters: Record<string, unknown>;
    disabled?: boolean;
    credentials?: Record<string, unknown>;
  }>,
  connections: Record<string, unknown>
): VirtualWorkflowState {
  return {
    nodes: nodes.map((n) => ({
      name: n.name,
      type: n.type,
      typeVersion: n.typeVersion,
      parameters: n.parameters || {},
      disabled: n.disabled,
      credentials: n.credentials,
    })),
    connections,
  };
}
