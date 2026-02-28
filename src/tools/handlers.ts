// ============================================================
// n8n-mcp-lite: Tool handlers - implements all MCP tool logic
// ============================================================

import type { N8nApiClient } from "../api-client.js";
import type {
  N8nWorkflowRaw,
  N8nNodeRaw,
  N8nConnections,
  LiteWorkflow,
  LiteNode,
  LiteConnection,
} from "../types.js";
import {
  simplifyWorkflow,
  simplifyConnections,
  reconstructWorkflow,
  workflowToText,
  restoreNodeType,
} from "../transform/simplify.js";
import {
  buildWorkflowScan,
  buildFocusedView,
  discoverFocusArea,
  discoverRange,
  extractExecutionRunData,
} from "../transform/focus.js";
import type { ExecutionRunDataMap } from "../types.js";
import {
  buildAdjacency,
  bfsForward,
  bfsBackward,
} from "../transform/graph.js";
import { autoLayout } from "../transform/layout.js";
import { validateArgs } from "../validate.js";
import { TOOL_SCHEMAS } from "./definitions.js";
import { nodeDb } from "../knowledge/node-db.js";
import { NODE_FLAGS } from "../knowledge/types.js";
import { VersionStore } from "../versioning/version-store.js";
import { runPreflight, buildVirtualState } from "../security/preflight.js";
import type { PreflightResult } from "../security/types.js";
import { knowledgeDb } from "../knowledge/pattern-db.js";

type ToolResult = { content: Array<{ type: "text"; text: string }> };

function ok(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

function err(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
  };
}

export class ToolHandlers {
  private versionStore: VersionStore;

  constructor(private api: N8nApiClient, versionStore: VersionStore) {
    this.versionStore = versionStore;
  }

  async handle(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
      // Input validation (Pilar 0)
      const schema = TOOL_SCHEMAS[name];
      if (schema) {
        const validationError = validateArgs(args, schema as any, name);
        if (validationError) return err(validationError);
      }

      switch (name) {
        case "list_workflows":
          return await this.listWorkflows(args);
        case "get_workflow":
          return await this.getWorkflow(args);
        case "get_workflow_raw":
          return await this.getWorkflowRaw(args);
        case "create_workflow":
          return await this.createWorkflow(args);
        case "update_workflow":
          return await this.updateWorkflow(args);
        case "update_nodes":
          return await this.updateNodes(args);
        case "delete_workflow":
          return await this.deleteWorkflow(args);
        case "activate_workflow":
          return await this.activateWorkflow(args);
        case "deactivate_workflow":
          return await this.deactivateWorkflow(args);
        case "list_executions":
          return await this.listExecutions(args);
        case "get_execution":
          return await this.getExecution(args);
        case "trigger_webhook":
          return await this.triggerWebhook(args);
        case "scan_workflow":
          return await this.scanWorkflow(args);
        case "focus_workflow":
          return await this.focusWorkflow(args);
        case "expand_focus":
          return await this.expandFocus(args);
        case "search_nodes":
          return await this.searchNodes(args);
        case "get_node":
          return await this.getNodeInfo(args);
        case "list_versions":
          return await this.listVersions(args);
        case "rollback_workflow":
          return await this.rollbackWorkflow(args);
        // ---- Knowledge base ----
        case "search_patterns":
          return this.searchPatterns(args);
        case "get_pattern":
          return this.getPattern(args);
        case "get_payload_schema":
          return this.getPayloadSchema(args);
        case "get_n8n_knowledge":
          return this.getN8nKnowledge(args);
        case "list_providers":
          return this.listProviders();
        case "search_expressions":
          return this.searchExpressions(args);
        case "test_node":
          return await this.testNode(args);
        default:
          return err(`Unknown tool: ${name}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return err(msg);
    }
  }

  // ---- List workflows ----
  private async listWorkflows(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const limit = (args.limit as number) ?? 50;
    const cursor = args.cursor as string | undefined;

    const resp = await this.api.listWorkflows(cursor, limit);
    const workflows = resp.data;

    // Filter by active if specified
    let filtered = workflows;
    if (args.active !== undefined) {
      filtered = workflows.filter(
        (w) => w.active === (args.active as boolean)
      );
    }

    // Simplified list output
    const list = filtered.map((w) => ({
      id: w.id,
      name: w.name,
      active: w.active,
      nodes: w.nodeCount ?? 0,
      ...(w.tags && w.tags.length > 0
        ? { tags: w.tags.map((t) => t.name) }
        : {}),
      ...(w.isArchived ? { archived: true } : {}),
    }));

    return ok({
      workflows: list,
      count: list.length,
      ...(resp.nextCursor ? { nextCursor: resp.nextCursor } : {}),
    });
  }

  // ---- Get workflow (simplified) ----
  private async getWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const raw = await this.api.getWorkflow(id);
    const lite = simplifyWorkflow(raw);

    if (args.format === "text") {
      return ok(workflowToText(lite));
    }

    return ok(lite);
  }

  // ---- Get workflow (raw) ----
  private async getWorkflowRaw(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const raw = await this.api.getWorkflow(id);

    // Still strip the worst offenders even in raw mode
    const cleaned = { ...raw };
    delete cleaned.activeVersion;
    delete cleaned.shared;
    delete cleaned.staticData;
    delete cleaned.meta;
    delete cleaned.pinData;
    delete cleaned.versionId;
    delete cleaned.activeVersionId;
    delete cleaned.versionCounter;

    return ok(cleaned);
  }

  // ---- Create workflow ----
  private async createWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const name = args.name as string;
    if (!name) return err("Missing workflow name");

    const liteNodes = (args.nodes as LiteNode[]) ?? [];
    const liteFlow = (args.flow as LiteConnection[]) ?? [];

    if (liteNodes.length === 0) return err("At least one node is required");

    const lite: LiteWorkflow = {
      id: "",
      name,
      active: false,
      nodes: liteNodes.map((n, i) => ({
        ...n,
        _id: n._id || crypto.randomUUID(),
      })),
      flow: liteFlow,
      nodeCount: liteNodes.length,
      settings: args.settings as Record<string, unknown> | undefined,
    };

    if (args.tags) {
      lite.tags = args.tags as string[];
    }

    const reconstructed = reconstructWorkflow(lite);

    // Preflight validation on the virtual state
    const virtualState = buildVirtualState(
      reconstructed.nodes ?? [],
      (reconstructed.connections ?? {}) as Record<string, unknown>
    );
    const preflight = runPreflight(virtualState, "create_workflow");
    if (!preflight.pass) {
      return ok({
        blocked: true,
        message: preflight.summary,
        errors: preflight.errors,
        warnings: preflight.warnings,
        durationMs: preflight.durationMs,
      });
    }

    const created = await this.api.createWorkflow(reconstructed);

    return ok({
      id: created.id,
      name: created.name,
      active: created.active,
      nodeCount: created.nodes?.length ?? 0,
      message: "Workflow created successfully",
      ...(preflight.warnings.length > 0
        ? { preflight: { warnings: preflight.warnings } }
        : {}),
    });
  }

  // ---- Update workflow (full replacement from simplified format) ----
  private async updateWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    // Fetch original to preserve positions and credential IDs
    const original = await this.api.getWorkflow(id);

    // Auto-snapshot before mutation (Pilar 2)
    this.versionStore.saveSnapshot(
      id,
      original,
      "pre_update_workflow",
      `Before update_workflow`
    );

    const update: Partial<N8nWorkflowRaw> = {};

    if (args.name) {
      update.name = args.name as string;
    }

    if (args.nodes && args.flow) {
      const lite: LiteWorkflow = {
        id,
        name: (args.name as string) ?? original.name,
        active: original.active,
        nodes: args.nodes as LiteNode[],
        flow: args.flow as LiteConnection[],
        nodeCount: (args.nodes as LiteNode[]).length,
        settings: args.settings as Record<string, unknown> | undefined,
      };

      const reconstructed = reconstructWorkflow(lite, original);
      update.nodes = reconstructed.nodes;
      update.connections = reconstructed.connections;
      if (reconstructed.settings) update.settings = reconstructed.settings;

      // Preflight validation on the reconstructed state
      const virtualState = buildVirtualState(
        reconstructed.nodes ?? [],
        (reconstructed.connections ?? {}) as Record<string, unknown>
      );
      const preflight = runPreflight(virtualState, "update_workflow");
      if (!preflight.pass) {
        return ok({
          blocked: true,
          message: preflight.summary,
          errors: preflight.errors,
          warnings: preflight.warnings,
          durationMs: preflight.durationMs,
          snapshotSaved: true,
        });
      }
    } else if (args.settings) {
      update.settings = args.settings as Record<string, unknown>;
    }

    const updated = await this.api.updateWorkflow(id, update);

    return ok({
      id: updated.id,
      name: updated.name,
      active: updated.active,
      nodeCount: updated.nodes?.length ?? 0,
      message: "Workflow updated successfully",
    });
  }

  // ---- Surgical node operations ----
  private async updateNodes(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const operations = args.operations as Array<Record<string, unknown>>;
    if (!operations || operations.length === 0)
      return err("No operations provided");

    // Fetch current workflow
    const raw = await this.api.getWorkflow(id);

    // Auto-snapshot before mutation (Pilar 2)
    this.versionStore.saveSnapshot(
      id,
      raw,
      "pre_update_nodes",
      `Before update_nodes (${operations.length} operation(s))`
    );

    const nodes = [...raw.nodes];
    const connections = JSON.parse(
      JSON.stringify(raw.connections)
    ) as N8nConnections;

    const results: string[] = [];

    for (const op of operations) {
      const type = op.op as string;

      switch (type) {
        case "addNode": {
          const nodeSpec = op.node as Record<string, unknown>;
          if (!nodeSpec?.name || !nodeSpec?.type)
            throw new Error("addNode requires node.name and node.type");

          const existing = nodes.find(
            (n) => n.name === (nodeSpec.name as string)
          );
          if (existing)
            throw new Error(`Node "${nodeSpec.name}" already exists`);

          // Smart auto-position: recalculate layout with all nodes + new node
          let autoPos: [number, number] | undefined;
          if (!nodeSpec.position) {
            // Build lite representations to feed the layout engine
            const allLiteNodes: LiteNode[] = [
              ...nodes.map((n) => ({
                name: n.name,
                type: n.type,
                _id: n.id,
              })),
              {
                name: nodeSpec.name as string,
                type: restoreNodeType(nodeSpec.type as string),
                _id: (nodeSpec._id as string) || crypto.randomUUID(),
              },
            ];
            const allFlow = simplifyConnections(connections);
            const layoutMap = autoLayout(allLiteNodes, allFlow);
            autoPos = layoutMap.get(nodeSpec.name as string);
          }

          // Fallback: simple horizontal stacking
          const maxX = Math.max(...nodes.map((n) => n.position[0]), 50);

          const newNode: N8nNodeRaw = {
            id: (nodeSpec._id as string) || crypto.randomUUID(),
            name: nodeSpec.name as string,
            type: restoreNodeType(nodeSpec.type as string),
            typeVersion: (nodeSpec._v as number) ?? 1,
            position: (nodeSpec.position as [number, number]) ??
              autoPos ?? [maxX + 200, 300],
            parameters: (nodeSpec.params as Record<string, unknown>) ?? {},
          };

          if (nodeSpec.creds) {
            newNode.credentials = {};
            for (const [key, name] of Object.entries(
              nodeSpec.creds as Record<string, string>
            )) {
              newNode.credentials[key] = { id: "", name };
            }
          }

          if (nodeSpec.disabled) newNode.disabled = true;

          nodes.push(newNode);
          results.push(`Added node "${newNode.name}"`);
          break;
        }

        case "removeNode": {
          const name = op.name as string;
          const idx = nodes.findIndex((n) => n.name === name);
          if (idx === -1) throw new Error(`Node "${name}" not found`);

          nodes.splice(idx, 1);

          // Remove connections referencing this node
          delete connections[name];
          for (const [src, outputs] of Object.entries(connections)) {
            for (const [outputType, arrays] of Object.entries(outputs)) {
              for (let i = 0; i < arrays.length; i++) {
                connections[src][outputType][i] = arrays[i].filter(
                  (t) => t.node !== name
                );
              }
            }
          }

          results.push(`Removed node "${name}"`);
          break;
        }

        case "updateNode": {
          const name = op.name as string;
          const node = nodes.find((n) => n.name === name);
          if (!node) throw new Error(`Node "${name}" not found`);

          const updates = op.params as Record<string, unknown>;
          if (updates) {
            for (const [key, value] of Object.entries(updates)) {
              if (key.startsWith("parameters.") || key.startsWith("params.")) {
                const paramKey = key.replace(/^(parameters|params)\./, "");
                if (value === undefined) {
                  delete node.parameters[paramKey];
                } else {
                  node.parameters[paramKey] = value;
                }
              } else {
                // Direct parameter update
                node.parameters[key] = value;
              }
            }
          }

          // Allow updating node-level props
          if (op.nodeParams) {
            const np = op.nodeParams as Record<string, unknown>;
            if (np.onError !== undefined)
              node.onError = np.onError as string;
            if (np.notes !== undefined) node.notes = np.notes as string;
            if (np.typeVersion !== undefined)
              node.typeVersion = np.typeVersion as number;
          }

          results.push(`Updated node "${name}"`);
          break;
        }

        case "addConnection": {
          const from = op.from as string;
          const to = op.to as string;
          const outputType = (op.type as string) ?? "main";
          const outputIdx = (op.outputIndex as number) ?? 0;
          const inputIdx = (op.inputIndex as number) ?? 0;

          if (!connections[from]) connections[from] = {};
          if (!connections[from][outputType])
            connections[from][outputType] = [];

          while (connections[from][outputType].length <= outputIdx) {
            connections[from][outputType].push([]);
          }

          // Check for duplicate
          const existing = connections[from][outputType][outputIdx].find(
            (t) => t.node === to
          );
          if (!existing) {
            connections[from][outputType][outputIdx].push({
              node: to,
              type: outputType,
              index: inputIdx,
            });
          }

          results.push(`Connected "${from}" → "${to}"`);
          break;
        }

        case "removeConnection": {
          const from = op.from as string;
          const to = op.to as string;

          if (connections[from]) {
            for (const [outputType, arrays] of Object.entries(
              connections[from]
            )) {
              for (let i = 0; i < arrays.length; i++) {
                connections[from][outputType][i] = arrays[i].filter(
                  (t) => t.node !== to
                );
              }
            }
          }

          results.push(`Disconnected "${from}" → "${to}"`);
          break;
        }

        case "enable": {
          const name = op.name as string;
          const node = nodes.find((n) => n.name === name);
          if (!node) throw new Error(`Node "${name}" not found`);
          delete node.disabled;
          results.push(`Enabled "${name}"`);
          break;
        }

        case "disable": {
          const name = op.name as string;
          const node = nodes.find((n) => n.name === name);
          if (!node) throw new Error(`Node "${name}" not found`);
          node.disabled = true;
          results.push(`Disabled "${name}"`);
          break;
        }

        case "rename": {
          const name = op.name as string;
          const newName = op.newName as string;
          if (!newName) throw new Error("rename requires newName");

          const node = nodes.find((n) => n.name === name);
          if (!node) throw new Error(`Node "${name}" not found`);

          const duplicate = nodes.find((n) => n.name === newName);
          if (duplicate)
            throw new Error(`Node "${newName}" already exists`);

          // Update all connection references
          if (connections[name]) {
            connections[newName] = connections[name];
            delete connections[name];
          }

          for (const outputs of Object.values(connections)) {
            for (const arrays of Object.values(outputs)) {
              for (const targets of arrays) {
                for (const target of targets) {
                  if (target.node === name) {
                    target.node = newName;
                  }
                }
              }
            }
          }

          node.name = newName;
          results.push(`Renamed "${name}" → "${newName}"`);
          break;
        }

        default:
          results.push(`Unknown operation: ${type}`);
      }
    }

    // Preflight validation on the virtual post-mutation state
    const virtualState = buildVirtualState(
      nodes,
      connections as unknown as Record<string, unknown>
    );
    const preflight = runPreflight(virtualState, "update_nodes");
    if (!preflight.pass) {
      return ok({
        blocked: true,
        message: preflight.summary,
        errors: preflight.errors,
        warnings: preflight.warnings,
        operationsAttempted: results,
        durationMs: preflight.durationMs,
        snapshotSaved: true,
      });
    }

    // Apply changes (preflight passed) — include name + settings to avoid 405/400
    const payload: Partial<N8nWorkflowRaw> = {
      name: raw.name,
      nodes,
      connections,
    };
    if (raw.settings) payload.settings = raw.settings;

    const updated = await this.api.updateWorkflow(id, payload);

    return ok({
      id: updated.id,
      name: updated.name,
      nodeCount: updated.nodes?.length ?? 0,
      operations: results,
      message: "Operations applied successfully",
      ...(preflight.warnings.length > 0
        ? { preflight: { warnings: preflight.warnings } }
        : {}),
    });
  }

  // ---- Delete workflow ----
  private async deleteWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");
    if (args.confirm !== true) return err("Set confirm: true to delete");

    // Auto-snapshot before deletion (Pilar 2) - safety net for recovery
    try {
      const raw = await this.api.getWorkflow(id);
      this.versionStore.saveSnapshot(
        id,
        raw,
        "pre_delete",
        `Safety snapshot before deletion of "${raw.name}"`
      );
    } catch {
      // If we can't snapshot (e.g. already deleted), proceed
    }

    await this.api.deleteWorkflow(id);
    return ok({
      id,
      message: "Workflow deleted permanently. A snapshot was saved locally for recovery via rollback_workflow.",
    });
  }

  // ---- Activate/Deactivate ----
  private async activateWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const result = await this.api.activateWorkflow(id);
    return ok({
      id: result.id,
      name: result.name,
      active: result.active,
      message: "Workflow activated",
    });
  }

  private async deactivateWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const result = await this.api.deactivateWorkflow(id);
    return ok({
      id: result.id,
      name: result.name,
      active: result.active,
      message: "Workflow deactivated",
    });
  }

  // ---- Executions ----
  private async listExecutions(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const resp = await this.api.listExecutions({
      workflowId: args.workflowId as string | undefined,
      status: args.status as string | undefined,
      limit: (args.limit as number) ?? 20,
      cursor: args.cursor as string | undefined,
    });

    const executions = resp.data.map((e) => ({
      id: e.id,
      status: e.status,
      mode: e.mode,
      startedAt: e.startedAt,
      stoppedAt: e.stoppedAt,
      workflowId: e.workflowId,
    }));

    return ok({
      executions,
      count: executions.length,
      ...(resp.nextCursor ? { nextCursor: resp.nextCursor } : {}),
    });
  }

  private async getExecution(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing execution ID");

    const includeData = (args.includeData as boolean) ?? false;
    const exec = await this.api.getExecution(id, includeData);

    const result: Record<string, unknown> = {
      id: exec.id,
      finished: exec.finished,
      status: exec.status,
      mode: exec.mode,
      startedAt: exec.startedAt,
      stoppedAt: exec.stoppedAt,
      workflowId: exec.workflowId,
    };

    // If data requested, extract and return structured node outputs
    if (includeData && exec.data) {
      result.nodeData = extractExecutionRunData(exec.data);
    }

    return ok(result);
  }

  // ---- Webhook trigger ----
  private async triggerWebhook(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const path = args.path as string;
    if (!path) return err("Missing webhook path");

    const method = (args.method as string) ?? "POST";
    const data = args.data;
    const test = args.test as boolean;

    const result = test
      ? await this.api.triggerWebhookTest(path, method, data)
      : await this.api.triggerWebhook(path, method, data);

    return ok(result);
  }

  // ============================================================
  // Focus Mode handlers
  // ============================================================

  // ---- Scan workflow (table of contents) ----
  private async scanWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const raw = await this.api.getWorkflow(id);
    const scan = buildWorkflowScan(raw);

    return ok(scan);
  }

  // ---- Focus workflow (zoomed view) ----
  private async focusWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const raw = await this.api.getWorkflow(id);
    let focusedNodeNames: string[];

    if (args.nodes) {
      // Explicit node selection
      focusedNodeNames = args.nodes as string[];

      // Validate node names exist
      const allNames = new Set(raw.nodes.map((n) => n.name));
      const invalid = focusedNodeNames.filter((n) => !allNames.has(n));
      if (invalid.length > 0) {
        return err(`Nodes not found: ${invalid.join(", ")}`);
      }
    } else if (args.branch) {
      // Branch auto-discovery
      const branch = args.branch as {
        node: string;
        outputIndex: number;
        maxDepth?: number;
        includeUpstream?: number;
      };

      const nodeExists = raw.nodes.some((n) => n.name === branch.node);
      if (!nodeExists) {
        return err(`Branch node not found: "${branch.node}"`);
      }

      focusedNodeNames = discoverFocusArea(
        raw,
        branch.node,
        branch.outputIndex,
        {
          maxDepth: branch.maxDepth,
          includeUpstream: branch.includeUpstream,
        }
      );

      if (focusedNodeNames.length === 0) {
        return err(
          `No nodes found on output ${branch.outputIndex} of "${branch.node}"`
        );
      }
    } else if (args.range) {
      // Range discovery
      const range = args.range as { from: string; to: string };

      const fromExists = raw.nodes.some((n) => n.name === range.from);
      const toExists = raw.nodes.some((n) => n.name === range.to);
      if (!fromExists) return err(`Start node not found: "${range.from}"`);
      if (!toExists) return err(`End node not found: "${range.to}"`);

      focusedNodeNames = discoverRange(raw, range.from, range.to);

      if (focusedNodeNames.length === 0) {
        return err(
          `No path found from "${range.from}" to "${range.to}"`
        );
      }
    } else {
      return err(
        "Provide one of: nodes (explicit names), branch (auto-discover), or range (from/to)"
      );
    }

    // Optionally fetch execution data for inputHint injection
    let runDataMap: ExecutionRunDataMap | undefined;
    if (args.executionId) {
      try {
        const exec = await this.api.getExecution(
          args.executionId as string,
          true
        );
        if (exec.data) {
          runDataMap = extractExecutionRunData(exec.data);
        }
      } catch {
        // Graceful degradation: proceed without inputHint
      }
    }

    const focused = buildFocusedView(raw, focusedNodeNames, runDataMap);
    return ok(focused);
  }

  // ---- Expand focus (iterative refinement) ----
  private async expandFocus(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");

    const currentFocus = args.currentFocus as string[];
    if (!currentFocus || currentFocus.length === 0) {
      return err("Missing currentFocus: provide the current focused node names");
    }

    const raw = await this.api.getWorkflow(id);
    const flow = simplifyConnections(raw.connections);
    const { forward, reverse } = buildAdjacency(flow);

    const expanded = new Set(currentFocus);

    // Add explicit nodes
    if (args.addNodes) {
      const addNodes = args.addNodes as string[];
      const allNames = new Set(raw.nodes.map((n) => n.name));
      for (const name of addNodes) {
        if (!allNames.has(name)) {
          return err(`Node not found: "${name}"`);
        }
        expanded.add(name);
      }
    }

    // Expand upstream
    if (args.expandUpstream) {
      const depth = args.expandUpstream as number;
      const upstream = bfsBackward(Array.from(expanded), reverse, {
        maxDepth: depth,
        excludeNodes: expanded,
      });
      for (const name of upstream) expanded.add(name);
    }

    // Expand downstream
    if (args.expandDownstream) {
      const depth = args.expandDownstream as number;
      const downstream = bfsForward(Array.from(expanded), forward, {
        maxDepth: depth,
        excludeNodes: expanded,
      });
      for (const name of downstream) expanded.add(name);
    }

    const focused = buildFocusedView(raw, Array.from(expanded));
    return ok(focused);
  }

  // ---- Search nodes (Pilar 3: Anti-Hallucination) ----
  private async searchNodes(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const query = args.query as string;
    if (!query) return err("Missing search query");

    const results = nodeDb.searchNodes(query, {
      mode: (args.mode as "OR" | "AND" | "FUZZY") ?? "OR",
      limit: (args.limit as number) ?? 20,
      source: (args.source as "all" | "core" | "langchain") ?? "all",
    });

    return ok({
      results: results.map((r) => ({
        nodeType: r.nodeType,
        displayName: r.displayName,
        description: r.description,
        category: r.category,
        ...(r.isTrigger ? { trigger: true } : {}),
        ...(r.isWebhook ? { webhook: true } : {}),
        ...(r.isAITool ? { aiTool: true } : {}),
      })),
      count: results.length,
      totalNodes: nodeDb.size,
    });
  }

  // ---- Get node schema (Pilar 3: Anti-Hallucination) ----
  private async getNodeInfo(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const nodeType = args.nodeType as string;
    if (!nodeType) return err("Missing nodeType");

    const detail = (args.detail as string) ?? "standard";
    const node = nodeDb.getNode(nodeType);
    if (!node) return err(`Node not found: "${nodeType}". Use search_nodes to find available nodes.`);

    // Minimal: just identification
    if (detail === "minimal") {
      return ok({
        nodeType: node.t,
        displayName: node.d,
        description: node.desc,
        category: node.cat,
        isTrigger: !!(node.f & NODE_FLAGS.TRIGGER),
        isWebhook: !!(node.f & NODE_FLAGS.WEBHOOK),
        isAITool: !!(node.f & NODE_FLAGS.AI_TOOL),
      });
    }

    // Standard: essential properties + operations + credentials
    const result: Record<string, unknown> = {
      nodeType: node.t,
      displayName: node.d,
      description: node.desc,
      category: node.cat,
      version: node.v,
      isTrigger: !!(node.f & NODE_FLAGS.TRIGGER),
      isWebhook: !!(node.f & NODE_FLAGS.WEBHOOK),
      isAITool: !!(node.f & NODE_FLAGS.AI_TOOL),
    };

    if (node.ops && node.ops.length > 0) result.operations = node.ops;
    if (node.creds && node.creds.length > 0) result.credentials = node.creds;

    if (detail === "standard" && node.props) {
      // Return essential properties with readable format
      result.properties = node.props.map((p) => ({
        name: p.n,
        displayName: p.dn,
        type: p.t,
        ...(p.desc ? { description: p.desc } : {}),
        ...(p.def !== undefined ? { default: p.def } : {}),
        ...(p.req ? { required: true } : {}),
        ...(p.opts ? { options: p.opts.map((o) => `${o.v} (${o.l})`) } : {}),
        ...(p.show ? { showWhen: p.show } : {}),
      }));

      // Generate example config from required + default properties
      const example: Record<string, unknown> = {};
      for (const p of node.props) {
        if (p.req && !p.show) {
          // Required property without conditional visibility: always include
          example[p.n] = p.def ?? (p.opts?.[0]?.v ?? `<${p.t}>`);
        }
      }
      if (Object.keys(example).length > 0) {
        result.exampleConfig = example;
      }
    }

    if (detail === "full" && node.props) {
      // Return all properties with full detail
      result.properties = node.props;
    }

    return ok(result);
  }

  // ============================================================
  // Pilar 2: Version Control handlers
  // ============================================================

  // ---- List snapshots ----
  private async listVersions(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const workflowId = args.workflowId as string;
    if (!workflowId) return err("Missing workflowId");

    const limit = args.limit as number | undefined;
    const snapshots = this.versionStore.listSnapshots(workflowId, limit);

    return ok({
      workflowId,
      snapshots: snapshots.map((s) => ({
        id: s.id,
        workflowName: s.workflowName,
        timestamp: s.timestamp,
        trigger: s.trigger,
        description: s.description,
      })),
      count: snapshots.length,
      message: snapshots.length === 0
        ? "No snapshots found. Snapshots are created automatically before mutations."
        : undefined,
    });
  }

  // ---- Rollback to snapshot ----
  private async rollbackWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const workflowId = args.workflowId as string;
    if (!workflowId) return err("Missing workflowId");

    const snapshotId = args.snapshotId as string;
    if (!snapshotId) return err("Missing snapshotId");

    // Get the snapshot with full data
    const snapshot = this.versionStore.getSnapshot(workflowId, snapshotId);
    if (!snapshot) {
      return err(
        `Snapshot "${snapshotId}" not found for workflow "${workflowId}". Use list_versions to see available snapshots.`
      );
    }

    // Take a safety snapshot of the CURRENT state before rolling back
    try {
      const currentRaw = await this.api.getWorkflow(workflowId);
      this.versionStore.saveSnapshot(
        workflowId,
        currentRaw,
        "manual",
        `Safety snapshot before rollback to ${snapshotId}`
      );
    } catch {
      // If we can't fetch current state, proceed with rollback anyway
    }

    // Restore the workflow from the snapshot
    const { data } = snapshot;
    const updatePayload: Partial<N8nWorkflowRaw> = {
      name: data.name,
      nodes: data.nodes,
      connections: data.connections,
    };
    if (data.settings) updatePayload.settings = data.settings;

    const updated = await this.api.updateWorkflow(workflowId, updatePayload);

    return ok({
      id: updated.id,
      name: updated.name,
      active: updated.active,
      nodeCount: updated.nodes?.length ?? 0,
      restoredFrom: {
        snapshotId: snapshot.id,
        timestamp: snapshot.timestamp,
        description: snapshot.description,
      },
      message: "Workflow restored successfully. A safety snapshot of the previous state was created.",
    });
  }

  // ============================================================
  // Pilar 3: Knowledge Base handlers
  // ============================================================

  // ---- Search patterns ----
  private searchPatterns(args: Record<string, unknown>): ToolResult {
    const query = (args.query as string) ?? "";
    const tags = args.tags as string[] | undefined;

    const results = knowledgeDb.searchPatterns(query, tags);

    if (results.length === 0) {
      return ok({
        patterns: [],
        count: 0,
        message: `No patterns found for "${query}". Try broader terms like "whatsapp", "ai agent", "webhook", or use search_patterns with query="" to see all.`,
      });
    }

    // Return metadata only (no nodes/flow to save tokens)
    return ok({
      patterns: results.map(({ nodes, flow, ...meta }) => meta),
      count: results.length,
      tip: 'Use get_pattern with the pattern "id" to get the full nodes[] and flow[] ready for create_workflow.',
    });
  }

  // ---- Get pattern ----
  private getPattern(args: Record<string, unknown>): ToolResult {
    const id = args.id as string;
    if (!id) return err("Missing pattern id");

    const pattern = knowledgeDb.getPattern(id);
    if (!pattern) {
      return err(
        `Pattern "${id}" not found. Use search_patterns to find available patterns.`
      );
    }

    return ok({
      ...pattern,
      usage: {
        CRITICAL_WARNING: "NEVER reconstruct nodes from scratch. Copy the nodes[] array from this response exactly, only editing params values. The _v (typeVersion), _id, and type fields MUST be preserved — omitting _v causes UI crashes ('propertyValues[itemName] is not iterable').",
        step1: "Review requiredParams and ask the user for each value before building",
        step2: "Customize only nodes[].params values (system prompts, URLs, paths, etc.) — keep _v, _id, type untouched",
        step3: "Call create_workflow with name, this nodes[] and this flow[] (after param customization)",
        step4: "Set environment variables on n8n server for every requiredParam where envVar=true",
      },
    });
  }

  // ---- Get payload schema ----
  private getPayloadSchema(args: Record<string, unknown>): ToolResult {
    const provider = args.provider as string;
    if (!provider) return err("Missing provider. Use list_providers to see options.");

    const payload = knowledgeDb.getPayload(provider);
    if (!payload) {
      const available = knowledgeDb.listProviders().map((p) => p.id);
      return err(
        `Provider "${provider}" not found. Available: ${available.join(", ")}`
      );
    }

    const eventFilter = args.event as string | undefined;

    // Filter to specific event if requested
    let events = payload.events;
    if (eventFilter) {
      const filtered: typeof events = {};
      for (const [key, val] of Object.entries(events)) {
        if (key.toLowerCase().includes(eventFilter.toLowerCase())) {
          filtered[key] = val;
        }
      }
      events = Object.keys(filtered).length > 0 ? filtered : payload.events;
    }

    return ok({
      provider: provider,
      name: payload.name,
      description: payload.description,
      docsUrl: payload.docsUrl,
      webhookSetup: payload.webhookSetup,
      webhookVerification: payload.webhookVerification,
      events,
      sendMessage: payload.sendMessage,
      environmentVariables: payload.environmentVariables,
    });
  }

  // ---- Get n8n knowledge (gotchas) ----
  private getN8nKnowledge(args: Record<string, unknown>): ToolResult {
    const query = args.query as string | undefined;
    const nodeType = args.nodeType as string | undefined;

    if (!query && !nodeType) {
      // Return all gotchas summarized
      const all = knowledgeDb.getAllGotchas();
      return ok({
        gotchas: all.map((g) => ({
          id: g.id,
          title: g.title,
          tags: g.tags,
          nodeTypes: g.nodeTypes,
        })),
        count: all.length,
        tip: "Pass a query or nodeType to filter and get full details with solutions.",
      });
    }

    const results = knowledgeDb.searchGotchas(query, nodeType);

    if (results.length === 0) {
      return ok({
        gotchas: [],
        count: 0,
        message: `No gotchas found for query="${query ?? ""}" nodeType="${nodeType ?? ""}". Try broader terms.`,
      });
    }

    return ok({
      gotchas: results,
      count: results.length,
    });
  }

  // ---- List providers ----
  private listProviders(): ToolResult {
    const providers = knowledgeDb.listProviders();
    return ok({
      providers,
      count: providers.length,
      tip: 'Use get_payload_schema with a provider "id" to get the full payload schema and extraction expressions.',
    });
  }

  // ---- Search expressions ----
  private searchExpressions(args: Record<string, unknown>): ToolResult {
    const query = args.query as string | undefined;
    const category = args.category as string | undefined;

    if (!query && !category) {
      // Return category list only
      const all = knowledgeDb.getAllExpressions();
      return ok({
        categories: all.map((c) => ({
          id: c.id,
          title: c.title,
          description: c.description,
          entryCount: c.entries.length,
        })),
        tip: "Pass a query to search expressions, or a category ID to see all expressions in that category.",
      });
    }

    const results = knowledgeDb.searchExpressions(query, category);

    if (results.length === 0) {
      return ok({
        categories: [],
        count: 0,
        message: 'No expressions found. Try: "whatsapp phone", "cross branch", "ai agent output", "null default".',
      });
    }

    return ok({
      categories: results,
      totalExpressions: results.reduce((sum, c) => sum + c.entries.length, 0),
    });
  }

  // ============================================================
  // Dry-Run: Test Node
  // ============================================================

  private async testNode(args: Record<string, unknown>): Promise<ToolResult> {
    const nodeSpec = args.node as Record<string, unknown>;
    if (!nodeSpec?.name || !nodeSpec?.type) {
      return err("test_node requires node.name and node.type");
    }

    const mockInput = (args.mockInput as Record<string, unknown>) ?? {};
    const timeout = Math.min((args.timeout as number) ?? 15000, 60000);
    const startTime = Date.now();

    // Reject trigger nodes — they can't be tested this way
    const nodeType = (nodeSpec.type as string).toLowerCase();
    if (
      nodeType.includes("trigger") ||
      nodeType.includes("webhook") ||
      nodeType.includes("schedule") ||
      nodeType.includes("cron")
    ) {
      return err(
        "Cannot test trigger nodes. test_node is for data processing nodes (Code, Set, IF, HTTP Request, etc.)."
      );
    }

    // Build temporary workflow: Webhook → Target Node
    const ts = Date.now();
    const testWorkflowName = `__mcp_test_${ts}`;
    const webhookPath = `mcp-test-${ts}`;

    const webhookId = crypto.randomUUID();
    const targetId = crypto.randomUUID();
    const targetName = nodeSpec.name as string;

    const fullType = restoreNodeType(nodeSpec.type as string);

    // Build credentials object if provided
    let credentials: Record<string, { id: string; name: string }> | undefined;
    if (nodeSpec.creds && typeof nodeSpec.creds === "object") {
      credentials = {};
      for (const [k, v] of Object.entries(
        nodeSpec.creds as Record<string, string>
      )) {
        credentials[k] = { id: "", name: v };
      }
    }

    const tempWorkflow = {
      name: testWorkflowName,
      nodes: [
        {
          id: webhookId,
          name: "Test Webhook",
          type: "n8n-nodes-base.webhook",
          typeVersion: 2,
          position: [250, 300] as [number, number],
          parameters: {
            path: webhookPath,
            httpMethod: "POST",
            responseMode: "lastNode",
          },
        },
        {
          id: targetId,
          name: targetName,
          type: fullType,
          typeVersion: (nodeSpec._v as number) ?? 1,
          position: [500, 300] as [number, number],
          parameters:
            (nodeSpec.params as Record<string, unknown>) ?? {},
          ...(credentials ? { credentials } : {}),
        },
      ],
      connections: {
        "Test Webhook": {
          main: [
            [{ node: targetName, type: "main", index: 0 }],
          ],
        },
      },
      settings: { executionOrder: "v1" },
    };

    let createdId: string | undefined;

    try {
      // 1. Create temporary workflow
      const created = await this.api.createWorkflow(tempWorkflow);
      createdId = created.id;

      // 2. Activate it
      await this.api.activateWorkflow(createdId);

      // 3. Wait for activation to propagate, then trigger with retry
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // 4. Trigger webhook with mock data (retry once on 404 — activation race)
      let output: unknown;
      const triggerAttempt = async () =>
        this.api.triggerWebhook(webhookPath, "POST", mockInput);

      output = await triggerAttempt();

      // If we got a 404-style response, retry after extra wait
      if (
        output &&
        typeof output === "object" &&
        (output as Record<string, unknown>).status === 404
      ) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
        output = await triggerAttempt();
      }

      const durationMs = Date.now() - startTime;

      return ok({
        success: true,
        output,
        durationMs,
        note: "Temporary test workflow was created and deleted automatically.",
      });
    } catch (e) {
      const durationMs = Date.now() - startTime;
      const errorMsg = e instanceof Error ? e.message : String(e);

      return ok({
        success: false,
        error: errorMsg,
        durationMs,
      });
    } finally {
      // 5. Always clean up
      if (createdId) {
        try {
          await this.api.deactivateWorkflow(createdId);
        } catch {
          /* ignore */
        }
        try {
          await this.api.deleteWorkflow(createdId);
        } catch {
          /* ignore */
        }
      }
    }
  }
}
