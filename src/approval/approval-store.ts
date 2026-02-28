// ============================================================
// n8n-mcp-lite: Optional approval gate + append-only audit log
// ============================================================
//
// When approval mode is enabled, mutating tools (create_workflow,
// update_workflow, update_nodes, delete_workflow) require an explicit
// approve token before executing:
//
//   1. Call the tool normally → get { pending: true, approve_token: "APPROVE_..." }
//   2. Call again with the same args + approve: "<token>" → execute
//
// The audit log (.versioning/audit.log) records every attempted mutation
// regardless of approval mode, so teams can audit what was done and when.
//
// Enable at startup via env var: N8N_REQUIRE_APPROVAL=true
// Toggle mid-session via: set_approval_mode({ enabled: true/false })
// ============================================================

import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface PendingOp {
  token: string;
  tool: string;
  summary: string;
  createdAt: number;
}

interface AuditEntry {
  timestamp: string;
  tool: string;
  workflowId: string | null;
  summary: string;
  approved: boolean;
  result: string | null;
}

const TOKEN_TTL_MS = 10 * 60 * 1000; // 10 minutes

export class ApprovalStore {
  private enabled: boolean;
  private pending = new Map<string, PendingOp>();
  private logPath: string;

  constructor(storeDir: string, initialEnabled = false) {
    this.enabled = initialEnabled;
    this.logPath = join(storeDir, "audit.log");
    try {
      mkdirSync(storeDir, { recursive: true });
    } catch {
      // Dir may already exist
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
  }

  /**
   * Create a pending approval token for a mutation.
   * Returns the opaque token string (format: "APPROVE_<ts36>_<rand>").
   */
  createPending(tool: string, summary: string): string {
    const token =
      `APPROVE_${Date.now().toString(36)}_${Math.random()
        .toString(36)
        .slice(2, 6)
        .toUpperCase()}`;

    // Purge expired tokens to avoid memory growth
    const now = Date.now();
    for (const [k, v] of this.pending) {
      if (now - v.createdAt > TOKEN_TTL_MS) this.pending.delete(k);
    }

    this.pending.set(token, { token, tool, summary, createdAt: Date.now() });
    return token;
  }

  /**
   * Consume (validate + delete) a pending token.
   * Returns the pending op if valid, null if missing or expired.
   */
  consumePending(token: string): PendingOp | null {
    const op = this.pending.get(token);
    if (!op) return null;

    if (Date.now() - op.createdAt > TOKEN_TTL_MS) {
      this.pending.delete(token);
      return null;
    }

    this.pending.delete(token);
    return op;
  }

  /**
   * Append one entry to the audit log.
   * Non-fatal: a log write failure must not break the tool execution.
   */
  appendAuditLog(
    tool: string,
    workflowId: string | null,
    summary: string,
    approved: boolean,
    result?: string
  ): void {
    const entry: AuditEntry = {
      timestamp: new Date().toISOString(),
      tool,
      workflowId,
      summary,
      approved,
      result: result ?? null,
    };
    try {
      appendFileSync(this.logPath, JSON.stringify(entry) + "\n", "utf-8");
    } catch {
      // Non-fatal: audit log failure must not propagate
    }
  }
}
