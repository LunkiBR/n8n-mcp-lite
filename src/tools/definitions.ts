// ============================================================
// n8n-mcp-lite: Tool definitions for the MCP server
// ============================================================

import type { Tool } from "@modelcontextprotocol/sdk/types.js";

// Map of tool name → inputSchema for validation
export const TOOL_SCHEMAS: Record<string, Tool["inputSchema"]> = {};

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
      'Get a workflow in simplified format (80%+ fewer tokens) or raw n8n JSON. For large workflows (30+ nodes), prefer scan_workflow first, then focus_workflow. Use format="raw" only for debugging.',
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        format: {
          type: "string",
          enum: ["json", "text", "raw"],
          description:
            '"json" (default): simplified structured format. "text": human-readable summary (fewest tokens). "raw": original n8n JSON (most tokens, for debugging).',
        },
      },
      required: ["id"],
    },
  },

  // ---- Workflow creation ----
  {
    name: "create_workflow",
    description:
      'Create a new workflow from simplified format. Send nodes (name, type, params) and flow connections. Positions are auto-generated. Types can omit "n8n-nodes-base." prefix. Returns new workflow ID.\n\nBEST PRACTICE: Before creating complex workflows, use search_patterns to find ready-made templates. Use get_payload_schema for webhook integrations. Use get_n8n_knowledge for node-specific gotchas.\n\nAI SUB-NODE WIRING: For LangChain AI nodes, use the type field in flow connections:\n- LLM → AI Agent: {"from": "OpenAI", "to": "AI Agent", "type": "ai_languageModel"}\n- Memory → AI Agent: {"from": "Memory", "to": "AI Agent", "type": "ai_memory"}\n- Tool → AI Agent: {"from": "Tool", "to": "AI Agent", "type": "ai_tool"}\n- Embedding → VectorStore: {"from": "Embed", "to": "Store", "type": "ai_embedding"}\n- Document → VectorStore: {"from": "Loader", "to": "Store", "type": "ai_document"}\n\nREQUIREMENT GATHERING: Always ask the user for required configuration BEFORE creating (API URLs, credentials, system prompts, etc.).',
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
        approve: {
          type: "string",
          description:
            "Approval token (only required when approval mode is enabled). First call this tool without approve to get a token, then call again with the token to execute.",
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
        approve: {
          type: "string",
          description:
            "Approval token (only required when approval mode is enabled). First call this tool without approve to get a token, then call again with the token to execute.",
        },
      },
      required: ["id"],
    },
  },

  // ---- Surgical node updates ----
  {
    name: "update_nodes",
    description:
      'Surgically update specific nodes or connections without sending the entire workflow. Operations: addNode, removeNode, updateNode, addConnection, removeConnection, enable, disable. Very token-efficient for small changes.\n\nFor AI sub-node connections use type in addConnection: {"op":"addConnection","from":"OpenAI","to":"AI Agent","type":"ai_languageModel"}',
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
        continueOnError: {
          type: "boolean",
          description:
            "If true, apply valid operations even if some fail (best-effort mode). Returns applied and failed operation indices. Default: false (atomic)",
        },
        approve: {
          type: "string",
          description:
            "Approval token (only required when approval mode is enabled). First call this tool without approve to get a token, then call again with the token to execute.",
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
        approve: {
          type: "string",
          description:
            "Approval token (only required when approval mode is enabled). First call this tool without approve to get a token, then call again with the token to execute.",
        },
      },
      required: ["id", "confirm"],
    },
  },

  // ---- Workflow activation ----
  {
    name: "activate_workflow",
    description: "Activate or deactivate a workflow. Set active: true to enable, active: false to disable. Defaults to true (activate).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID",
        },
        active: {
          type: "boolean",
          description: "true (default) to activate, false to deactivate",
        },
      },
      required: ["id"],
    },
  },

  // ---- Execution management ----
  {
    name: "executions",
    description:
      'Manage workflow executions. action="list": list executions with filters. action="get": get details of a single execution. Use mode="error" for rich 5-phase debugging (primary error, upstream context, execution path, suggestions).',
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list", "get"],
          description: '"list" to list executions, "get" to get execution details',
        },
        id: {
          type: "string",
          description: "Execution ID (required for action=get)",
        },
        mode: {
          type: "string",
          enum: ["summary", "error"],
          description:
            'For action=get: "summary" (default) or "error" (rich 5-phase error analysis with suggestions)',
        },
        includeData: {
          type: "boolean",
          description:
            "For action=get, mode=summary: include node output data (default: false)",
        },
        workflowId: {
          type: "string",
          description: "For action=list: filter by workflow ID",
        },
        status: {
          type: "string",
          enum: ["success", "error", "waiting"],
          description: "For action=list: filter by status",
        },
        limit: {
          type: "number",
          description: "For action=list: max results (default 20)",
        },
        cursor: {
          type: "string",
          description: "For action=list: pagination cursor",
        },
      },
      required: ["action"],
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
      "Focus on a specific area of a workflow. Returns FULL detail (params, creds, code) ONLY for focused nodes; everything else is minimal. Four selection modes: explicit nodes, branch auto-discovery, range (from/to), or expand (add adjacent nodes to previous focus).",
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
            "Explicit list of node names to focus on",
        },
        branch: {
          type: "object",
          description:
            "Auto-discover a branch from a Switch/IF node",
          properties: {
            node: {
              type: "string",
              description: "Name of the branching node",
            },
            outputIndex: {
              type: "number",
              description:
                "Which output branch to follow (0=first/true, 1=second/false)",
            },
            maxDepth: {
              type: "number",
              description: "Max traversal depth (default: unlimited)",
            },
            includeUpstream: {
              type: "number",
              description:
                "Include N levels upstream of the branch node (default: 0)",
            },
          },
          required: ["node", "outputIndex"],
        },
        range: {
          type: "object",
          description:
            "Focus on all nodes between two points in the workflow",
          properties: {
            from: { type: "string", description: "Start node name" },
            to: { type: "string", description: "End node name" },
          },
          required: ["from", "to"],
        },
        // Expand mode (absorbs expand_focus)
        expandFrom: {
          type: "array",
          items: { type: "string" },
          description:
            "Expand mode: current focused node names to expand from (replaces expand_focus tool)",
        },
        addNodes: {
          type: "array",
          items: { type: "string" },
          description: "For expand mode: specific node names to add to focus",
        },
        expandUpstream: {
          type: "number",
          description: "For expand mode: add N levels of upstream nodes",
        },
        expandDownstream: {
          type: "number",
          description: "For expand mode: add N levels of downstream nodes",
        },
        executionId: {
          type: "string",
          description:
            "Optional execution ID for inputHint injection showing available $json fields.",
        },
      },
      required: ["id"],
    },
  },
  // ---- Version Control ----
  {
    name: "versions",
    description:
      'Manage workflow version snapshots. action="list": list snapshots for a workflow. action="rollback": restore workflow to a previous snapshot (safety snapshot auto-created).',
    inputSchema: {
      type: "object" as const,
      properties: {
        action: {
          type: "string",
          enum: ["list", "rollback"],
          description: '"list" to see snapshots, "rollback" to restore a snapshot',
        },
        workflowId: {
          type: "string",
          description: "Workflow ID",
        },
        snapshotId: {
          type: "string",
          description: "Snapshot ID to restore (required for action=rollback, get from action=list)",
        },
        limit: {
          type: "number",
          description: "For action=list: max snapshots to return (default: all)",
        },
      },
      required: ["action", "workflowId"],
    },
  },

  // ---- Node Knowledge: Search ----
  {
    name: "search_nodes",
    description:
      'Search n8n nodes by keyword. Returns matching nodes with type, description, category, and relevance score. Use mode="OR" for any-word match (default), "AND" for all-words, "FUZZY" for typo-tolerant. Use this BEFORE creating or updating nodes to find the correct node type.',
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: 'Search terms (e.g. "slack", "http request", "google sheets")',
        },
        mode: {
          type: "string",
          enum: ["OR", "AND", "FUZZY"],
          description: "Search mode: OR (any word, default), AND (all words), FUZZY (typo-tolerant)",
        },
        limit: {
          type: "number",
          description: "Max results (default 20)",
        },
        source: {
          type: "string",
          enum: ["all", "core", "langchain"],
          description: "Filter by package source",
        },
      },
      required: ["query"],
    },
  },

  // ---- Node Knowledge: Get Schema ----
  {
    name: "get_node",
    description:
      'Get official node schema: properties, operations, credentials. Use detail="minimal" (~200 tokens) for quick lookup, "standard" (default, ~1K tokens) for essential config info, "full" for everything. ALWAYS use this before configuring a node to avoid hallucinating parameters.',
    inputSchema: {
      type: "object" as const,
      properties: {
        nodeType: {
          type: "string",
          description:
            'Node type (e.g. "httpRequest", "nodes-base.slack", "slack"). Supports short names.',
        },
        detail: {
          type: "string",
          enum: ["minimal", "standard", "full"],
          description: 'Detail level: "minimal", "standard" (default), "full"',
        },
      },
      required: ["nodeType"],
    },
  },

  // ---- Knowledge base (unified) ----
  {
    name: "knowledge",
    description:
      'Unified knowledge base: patterns (workflow templates), gotchas (node quirks/best practices), payloads (webhook schemas), providers (list available), expressions (cookbook). Use topic + action to navigate.',
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          enum: ["patterns", "gotchas", "payloads", "providers", "expressions"],
          description: "Knowledge area to query",
        },
        action: {
          type: "string",
          enum: ["search", "get", "list"],
          description: '"search" (default): search by query. "get": get by ID. "list": list all entries.',
        },
        query: {
          type: "string",
          description: 'Search keywords (e.g. "whatsapp ai", "switch fallthrough", "cross branch")',
        },
        id: {
          type: "string",
          description: "For action=get: pattern ID or provider ID",
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: "For topic=patterns: filter by tags",
        },
        provider: {
          type: "string",
          description: "For topic=payloads: provider ID",
        },
        event: {
          type: "string",
          description: "For topic=payloads: specific event to focus on",
        },
        nodeType: {
          type: "string",
          description: "For topic=gotchas: filter by node type",
        },
        category: {
          type: "string",
          description: "For topic=expressions: filter by category ID",
        },
      },
      required: ["topic"],
    },
  },
  // ---- Dry-Run: Test Node ----
  {
    name: "test_node",
    description:
      'Test a single node with mock input data without running the full workflow. Creates a temporary Webhook\u2192Node workflow, triggers it, captures output, and cleans up automatically. LIMITATIONS: (1) Cannot test trigger nodes (webhook, schedule, cron). (2) Nodes requiring credentials must have valid credentials configured in n8n. (3) The node receives mock data via webhook, not from a real upstream node.',
    inputSchema: {
      type: "object" as const,
      properties: {
        node: {
          type: "object",
          description:
            "The node to test. Same format as create_workflow nodes: {name, type, params?, creds?, _v?}",
          properties: {
            name: { type: "string", description: "Node name" },
            type: { type: "string", description: "Node type (e.g. 'code', 'set', 'httpRequest')" },
            params: { type: "object", description: "Node parameters" },
            creds: { type: "object", description: "Credential names" },
            _v: { type: "number", description: "Type version" },
          },
          required: ["name", "type"],
        },
        mockInput: {
          type: "object",
          description:
            "Mock input data to feed into the node. Simulates the $json fields the node receives from upstream.",
        },
        timeout: {
          type: "number",
          description: "Timeout in milliseconds (default: 15000, max: 60000)",
        },
      },
      required: ["node", "mockInput"],
    },
  },

  // ---- Validate node config ----
  {
    name: "validate_node",
    description:
      "Validate a node configuration BEFORE creating a workflow. Returns warnings and suggestions without blocking anything. Use get_node first to see available properties, then validate_node to check your config.",
    inputSchema: {
      type: "object" as const,
      properties: {
        nodeType: {
          type: "string",
          description: 'Node type (e.g. "httpRequest", "slack", "telegram")',
        },
        config: {
          type: "object",
          description: "Node parameters to validate (the params object you would pass to create_workflow)",
        },
        mode: {
          type: "string",
          enum: ["full", "quick"],
          description: '"full" (default): check all properties, expressions, types. "quick": required fields only.',
        },
      },
      required: ["nodeType", "config"],
    },
  },

  // ---- Autofix workflow ----
  {
    name: "autofix_workflow",
    description:
      'Automatically fix common workflow issues. Preview fixes first (default) or apply them. Fix types: expression-format (missing = prefix), typeversion-correction (version too high), webhook-missing-path, error-output-config. A snapshot is saved before applying.',
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Workflow ID to fix",
        },
        applyFixes: {
          type: "boolean",
          description: "Apply fixes to workflow (default: false — preview mode)",
        },
        fixTypes: {
          type: "array",
          items: { type: "string" },
          description: 'Limit to specific fix types: "expression-format", "typeversion-correction", "webhook-missing-path", "error-output-config"',
        },
        confidenceThreshold: {
          type: "string",
          enum: ["high", "medium", "low"],
          description: "Minimum confidence for fixes (default: medium)",
        },
      },
      required: ["id"],
    },
  },

  // ---- Tool documentation ----
  {
    name: "tools_documentation",
    description:
      'Get tool docs and workflow guide. Call without args for the recommended AI workflow (discover → learn → create → test → debug → fix). Call with topic for specific tool docs.',
    inputSchema: {
      type: "object" as const,
      properties: {
        topic: {
          type: "string",
          description: 'Tool name (e.g. "create_workflow", "executions") or "overview" for the full guide',
        },
      },
    },
  },

  // ---- Approval mode toggle ----
  {
    name: "set_approval_mode",
    description:
      "Enable or disable approval mode for this session. When enabled, mutating tools (create_workflow, update_workflow, update_nodes, delete_workflow) require an explicit approve token before executing — preventing accidental changes. Can also be enabled at startup via the N8N_REQUIRE_APPROVAL=true environment variable. All mutations are logged to .versioning/audit.log regardless of this setting.",
    inputSchema: {
      type: "object" as const,
      properties: {
        enabled: {
          type: "boolean",
          description: "true to require approval on mutations, false to disable",
        },
      },
      required: ["enabled"],
    },
  },
];

// Build schema map for validation
for (const tool of TOOLS) {
  TOOL_SCHEMAS[tool.name] = tool.inputSchema;
}
