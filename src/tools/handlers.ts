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
} from "../transform/focus.js";
import {
  buildAdjacency,
  bfsForward,
  bfsBackward,
} from "../transform/graph.js";

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
  constructor(private api: N8nApiClient) {}

  async handle(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    try {
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
    const created = await this.api.createWorkflow(reconstructed);

    return ok({
      id: created.id,
      name: created.name,
      active: created.active,
      nodeCount: created.nodes?.length ?? 0,
      message: "Workflow created successfully",
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

          // Auto-position: find max X and add 200
          const maxX = Math.max(...nodes.map((n) => n.position[0]), 50);

          const newNode: N8nNodeRaw = {
            id: (nodeSpec._id as string) || crypto.randomUUID(),
            name: nodeSpec.name as string,
            type: restoreNodeType(nodeSpec.type as string),
            typeVersion: (nodeSpec._v as number) ?? 1,
            position: (nodeSpec.position as [number, number]) ?? [
              maxX + 200,
              300,
            ],
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

    // Apply changes
    const updated = await this.api.updateWorkflow(id, {
      nodes,
      connections,
    });

    return ok({
      id: updated.id,
      name: updated.name,
      nodeCount: updated.nodes?.length ?? 0,
      operations: results,
      message: "Operations applied successfully",
    });
  }

  // ---- Delete workflow ----
  private async deleteWorkflow(
    args: Record<string, unknown>
  ): Promise<ToolResult> {
    const id = args.id as string;
    if (!id) return err("Missing workflow ID");
    if (args.confirm !== true) return err("Set confirm: true to delete");

    await this.api.deleteWorkflow(id);
    return ok({ id, message: "Workflow deleted permanently" });
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

    const exec = await this.api.getExecution(id);
    return ok({
      id: exec.id,
      finished: exec.finished,
      status: exec.status,
      mode: exec.mode,
      startedAt: exec.startedAt,
      stoppedAt: exec.stoppedAt,
      workflowId: exec.workflowId,
    });
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

    const focused = buildFocusedView(raw, focusedNodeNames);
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
}
