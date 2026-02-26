// ============================================================
// n8n-mcp-lite: Local workflow version store
// Auto-snapshots workflows before mutations for rollback safety
// Storage: JSON files in .versioning/{workflowId}/
// ============================================================

import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  unlinkSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { N8nWorkflowRaw } from "../types.js";

// ---- Types ----

export interface WorkflowSnapshot {
  /** Unique snapshot ID */
  id: string;
  /** Workflow ID in n8n */
  workflowId: string;
  /** Workflow name at time of snapshot */
  workflowName: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** What triggered the snapshot */
  trigger:
    | "pre_update_nodes"
    | "pre_update_workflow"
    | "pre_create"
    | "pre_delete"
    | "manual";
  /** Human-readable description */
  description: string;
}

/** Full snapshot including the workflow data */
export interface WorkflowSnapshotWithData extends WorkflowSnapshot {
  /** Complete workflow JSON */
  data: N8nWorkflowRaw;
}

// ---- Index file per workflow ----

interface WorkflowIndex {
  workflowId: string;
  snapshots: WorkflowSnapshot[];
}

// ---- Version Store ----

const DEFAULT_MAX_SNAPSHOTS = 20;

export class VersionStore {
  private basePath: string;

  constructor(storagePath: string) {
    this.basePath = storagePath;
    mkdirSync(this.basePath, { recursive: true });
  }

  /** Save a snapshot before a mutation. Returns the snapshot ID. */
  saveSnapshot(
    workflowId: string,
    raw: N8nWorkflowRaw,
    trigger: WorkflowSnapshot["trigger"],
    description: string
  ): string {
    const workflowDir = this.ensureWorkflowDir(workflowId);
    const id = randomUUID();
    const timestamp = new Date().toISOString();

    const snapshot: WorkflowSnapshot = {
      id,
      workflowId,
      workflowName: raw.name || `Workflow ${workflowId}`,
      timestamp,
      trigger,
      description,
    };

    // Write full data file
    const dataPath = join(workflowDir, `${id}.json`);
    writeFileSync(dataPath, JSON.stringify(raw), "utf-8");

    // Update index
    const index = this.readIndex(workflowId);
    index.snapshots.unshift(snapshot); // newest first
    this.writeIndex(workflowId, index);

    // Auto-prune old snapshots
    this.pruneSnapshots(workflowId, DEFAULT_MAX_SNAPSHOTS);

    return id;
  }

  /** List snapshots for a workflow (metadata only, no data) */
  listSnapshots(
    workflowId: string,
    limit?: number
  ): WorkflowSnapshot[] {
    const index = this.readIndex(workflowId);
    const snapshots = index.snapshots;
    return limit ? snapshots.slice(0, limit) : snapshots;
  }

  /** Get a full snapshot including workflow data */
  getSnapshot(
    workflowId: string,
    snapshotId: string
  ): WorkflowSnapshotWithData | null {
    const index = this.readIndex(workflowId);
    const meta = index.snapshots.find((s) => s.id === snapshotId);
    if (!meta) return null;

    const dataPath = join(this.workflowDir(workflowId), `${snapshotId}.json`);
    if (!existsSync(dataPath)) return null;

    try {
      const raw = JSON.parse(readFileSync(dataPath, "utf-8")) as N8nWorkflowRaw;
      return { ...meta, data: raw };
    } catch {
      return null;
    }
  }

  /** Prune snapshots, keeping only the N most recent */
  pruneSnapshots(workflowId: string, keepCount: number = DEFAULT_MAX_SNAPSHOTS): number {
    const index = this.readIndex(workflowId);
    if (index.snapshots.length <= keepCount) return 0;

    const toRemove = index.snapshots.slice(keepCount);
    index.snapshots = index.snapshots.slice(0, keepCount);
    this.writeIndex(workflowId, index);

    let removed = 0;
    for (const snapshot of toRemove) {
      const dataPath = join(this.workflowDir(workflowId), `${snapshot.id}.json`);
      try {
        if (existsSync(dataPath)) {
          unlinkSync(dataPath);
          removed++;
        }
      } catch { /* ignore cleanup errors */ }
    }
    return removed;
  }

  /** Clear all snapshots for a workflow */
  clearSnapshots(workflowId: string): void {
    const dir = this.workflowDir(workflowId);
    if (!existsSync(dir)) return;

    try {
      const files = readdirSync(dir);
      for (const file of files) {
        unlinkSync(join(dir, file));
      }
    } catch { /* ignore */ }
  }

  // ---- Private helpers ----

  private workflowDir(workflowId: string): string {
    return join(this.basePath, workflowId);
  }

  private ensureWorkflowDir(workflowId: string): string {
    const dir = this.workflowDir(workflowId);
    mkdirSync(dir, { recursive: true });
    return dir;
  }

  private readIndex(workflowId: string): WorkflowIndex {
    const indexPath = join(this.workflowDir(workflowId), "_index.json");
    if (!existsSync(indexPath)) {
      return { workflowId, snapshots: [] };
    }
    try {
      return JSON.parse(readFileSync(indexPath, "utf-8"));
    } catch {
      return { workflowId, snapshots: [] };
    }
  }

  private writeIndex(workflowId: string, index: WorkflowIndex): void {
    const dir = this.ensureWorkflowDir(workflowId);
    const indexPath = join(dir, "_index.json");
    writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf-8");
  }
}
