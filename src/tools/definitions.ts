// ============================================================
// n8n-mcp-lite: Tool definitions for the MCP server
// ============================================================

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

export const TOOLS: Tool[] = [
  // ---- Workflow listing ----
  {
    name: "list_workflows",
    description:
      "List all n8n workflows with basic metadata. Returns: id, name, active status, tags, node count. Very token-efficient.",
    inputSchema: {
      type: "object" as const,
      properties: {
        active: {
          type: "boolean",
          description: "Filter by active status",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor from previous response",
        },
        limit: {
          type: "number",
          description: "Max workflows to return (default 50)",
        },
      },
    },
  },

  // ---- Workflow reading ----
  {
    name: "get_workflow",
    description:
      "Get a workflow in simplified format. 80%+ fewer tokens than raw n8n JSON. Strips positions, duplicated data, user profiles, empty defaults. Returns nodes with essential params, flow connections, settings. For large workflows (30+ nodes), prefer scan_workflow first, then focus_workflow for the area you need.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        format: {
          type: "string",
          enum: ["json", "text"],
          description:
            'Output format: "json" (structured, default) or "text" (human-readable summary, even fewer tokens)',
        },
      },
      required: ["id"],
    },
  },

  // ---- Workflow reading (raw) ----
  {
    name: "get_workflow_raw",
    description:
      "Get a workflow in raw n8n JSON format. Only use when you need the exact original structure (e.g., for debugging). Much more tokens than get_workflow.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
      },
      required: ["id"],
    },
  },

  // ---- Workflow creation ----
  {
    name: "create_workflow",
    description:
      'Create a new workflow from simplified format. Send nodes (name, type, params) and flow connections. Positions are auto-generated. Types can omit "n8n-nodes-base." prefix. Returns new workflow ID.',
    inputSchema: {
      type: "object" as const,
      properties: {
        name: {
          type: "string",
          description: "Workflow name",
        },
        nodes: {
          type: "array",
          description:
            'Array of nodes: {name, type (e.g. "httpRequest" or "n8n-nodes-base.httpRequest"), params?, creds?, disabled?, _v? (typeVersion)}',
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              type: { type: "string" },
              params: { type: "object" },
              creds: { type: "object" },
              disabled: { type: "boolean" },
              _v: { type: "number" },
            },
            required: ["name", "type"],
          },
        },
        flow: {
          type: "array",
          description:
            'Array of connections: {from, to, type? (default "main"), outputIndex?, inputIndex?}',
          items: {
            type: "object",
            properties: {
              from: { type: "string" },
              to: { type: "string" },
              type: { type: "string" },
              outputIndex: { type: "number" },
              inputIndex: { type: "number" },
            },
            required: ["from", "to"],
          },
        },
        settings: {
          type: "object",
          description: "Optional workflow settings",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "Optional tag names",
        },
      },
      required: ["name", "nodes", "flow"],
    },
  },

  // ---- Workflow update (simplified) ----
  {
    name: "update_workflow",
    description:
      "Update a workflow from simplified format. Send the complete simplified workflow (nodes + flow). Preserves original positions and credential IDs. For small changes, prefer update_nodes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        name: {
          type: "string",
          description: "New workflow name (optional)",
        },
        nodes: {
          type: "array",
          description: "Complete array of simplified nodes",
          items: { type: "object" },
        },
        flow: {
          type: "array",
          description: "Complete array of simplified connections",
          items: { type: "object" },
        },
        settings: {
          type: "object",
          description: "Updated settings (optional)",
        },
      },
      required: ["id"],
    },
  },

  // ---- Surgical node updates ----
  {
    name: "update_nodes",
    description:
      'Surgically update specific nodes or connections without sending the entire workflow. Operations: addNode, removeNode, updateNode, addConnection, removeConnection, enable, disable. Very token-efficient for small changes.',
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        operations: {
          type: "array",
          description:
            'Array of operations. Types: "addNode" (node: {name, type, params}), "removeNode" (name: string), "updateNode" (name: string, params: {}), "addConnection" (from, to, type?, outputIndex?), "removeConnection" (from, to), "enable" (name), "disable" (name), "rename" (name, newName)',
          items: {
            type: "object",
            properties: {
              op: {
                type: "string",
                enum: [
                  "addNode",
                  "removeNode",
                  "updateNode",
                  "addConnection",
                  "removeConnection",
                  "enable",
                  "disable",
                  "rename",
                ],
              },
            },
            required: ["op"],
          },
        },
      },
      required: ["id", "operations"],
    },
  },

  // ---- Workflow deletion ----
  {
    name: "delete_workflow",
    description:
      "Permanently delete a workflow. This cannot be undone. Requires confirmation.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        confirm: {
          type: "boolean",
          description: "Must be true to confirm deletion",
        },
      },
      required: ["id", "confirm"],
    },
  },

  // ---- Workflow activation ----
  {
    name: "activate_workflow",
    description: "Activate a workflow to enable automatic trigger execution.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
      },
      required: ["id"],
    },
  },

  {
    name: "deactivate_workflow",
    description: "Deactivate a workflow to stop automatic trigger execution.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
      },
      required: ["id"],
    },
  },

  // ---- Execution management ----
  {
    name: "list_executions",
    description:
      "List workflow executions with filtering by workflow, status, etc.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflowId: {
          type: "string",
          description: "Filter by workflow ID",
        },
        status: {
          type: "string",
          enum: ["success", "error", "waiting"],
          description: "Filter by status",
        },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
        cursor: {
          type: "string",
          description: "Pagination cursor",
        },
      },
    },
  },

  {
    name: "get_execution",
    description: "Get details of a specific workflow execution.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Execution ID",
        },
      },
      required: ["id"],
    },
  },

  // ---- Webhook trigger ----
  {
    name: "trigger_webhook",
    description:
      "Trigger a workflow via its webhook URL. Use for testing active workflows.",
    inputSchema: {
      type: "object" as const,
      properties: {
        path: {
          type: "string",
          description: "Webhook path (as configured in the Webhook node)",
        },
        method: {
          type: "string",
          enum: ["GET", "POST", "PUT", "DELETE"],
          description: "HTTP method (default: POST)",
        },
        data: {
          type: "object",
          description: "Request body/payload",
        },
        test: {
          type: "boolean",
          description:
            "Use test webhook URL instead of production (default: false)",
        },
      },
      required: ["path"],
    },
  },

  // ---- Focus Mode: Scan ----
  {
    name: "scan_workflow",
    description:
      "Use this FIRST on large workflows instead of get_workflow. Returns a lightweight table of contents: every node with name, type, and one-line summary, but NO params/code/credentials. Also detects branch segments (Switch/IF paths) and estimates total token cost. If focusRecommended is true, use focus_workflow next instead of get_workflow. ~90% fewer tokens than get_workflow.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
      },
      required: ["id"],
    },
  },

  // ---- Focus Mode: Focus ----
  {
    name: "focus_workflow",
    description:
      "Focus on a specific area of a workflow. Returns FULL detail (params, creds, code) ONLY for focused nodes; everything else becomes a minimal dormant summary with zone classification (upstream/downstream/parallel). Use after scan_workflow to zoom into the area you need. Three selection modes: explicit node names, branch auto-discovery, or range between two nodes. For modifications, use update_nodes on the focused nodes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        nodes: {
          type: "array",
          items: { type: "string" },
          description:
            "Explicit list of node names to focus on (any nodes in the workflow)",
        },
        branch: {
          type: "object",
          description:
            "Auto-discover a branch: follows all nodes from a specific output of a branching node (Switch, IF, etc.)",
          properties: {
            node: {
              type: "string",
              description: "Name of the branching node (e.g., Switch or IF node)",
            },
            outputIndex: {
              type: "number",
              description:
                "Which output branch to follow (0=first/true, 1=second/false, etc.)",
            },
            maxDepth: {
              type: "number",
              description: "Max traversal depth (default: unlimited)",
            },
            includeUpstream: {
              type: "number",
              description:
                "Include N levels of upstream nodes before the branch node (default: 0)",
            },
          },
          required: ["node", "outputIndex"],
        },
        range: {
          type: "object",
          description:
            "Focus on all nodes between two points in the workflow flow",
          properties: {
            from: {
              type: "string",
              description: "Start node name (included in focus)",
            },
            to: {
              type: "string",
              description: "End node name (included in focus)",
            },
          },
          required: ["from", "to"],
        },
      },
      required: ["id"],
    },
  },

  // ---- Focus Mode: Expand ----
  {
    name: "expand_focus",
    description:
      "Expand an existing focus area by adding adjacent nodes. Use after focus_workflow to iteratively include more context without pulling the entire workflow.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        currentFocus: {
          type: "array",
          items: { type: "string" },
          description:
            "Current focused node names (from previous focus_workflow result)",
        },
        addNodes: {
          type: "array",
          items: { type: "string" },
          description: "Specific node names to add to focus",
        },
        expandUpstream: {
          type: "number",
          description:
            "Add N levels of upstream nodes (parents/grandparents of current focus)",
        },
        expandDownstream: {
          type: "number",
          description:
            "Add N levels of downstream nodes (children/grandchildren of current focus)",
        },
      },
      required: ["id", "currentFocus"],
    },
  },
];
