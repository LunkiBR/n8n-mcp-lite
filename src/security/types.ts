// ============================================================
// n8n-mcp-lite: Security & validation types
// ============================================================

/** Validation error - blocks the mutation */
export interface ValidationError {
  type:
    | "missing_required"
    | "invalid_type"
    | "invalid_value"
    | "unknown_node"
    | "invalid_expression"
    | "security"
    | "invalid_connection"
    | "syntax_error";
  property?: string;
  node?: string;
  message: string;
  fix?: string;
}

/** Validation warning - does not block, but surfaces concerns */
export interface ValidationWarning {
  type:
    | "deprecated"
    | "security"
    | "best_practice"
    | "missing_common"
    | "expression_hint";
  property?: string;
  node?: string;
  message: string;
  suggestion?: string;
}

/** Full preflight result */
export interface PreflightResult {
  /** Whether the mutation should proceed */
  pass: boolean;
  /** Blocking errors (pass=false if any) */
  errors: ValidationError[];
  /** Non-blocking warnings */
  warnings: ValidationWarning[];
  /** Quick summary for the AI */
  summary: string;
  /** How long validation took (ms) */
  durationMs: number;
}

/** A virtual workflow state representing the mutation result */
export interface VirtualWorkflowState {
  nodes: VirtualNode[];
  connections: Record<string, unknown>;
}

export interface VirtualNode {
  name: string;
  type: string;
  typeVersion: number;
  parameters: Record<string, unknown>;
  disabled?: boolean;
  credentials?: Record<string, unknown>;
}
