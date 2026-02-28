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
    description:
      "Get details of a specific workflow execution. Use includeData to get the node-level output data (which fields each node produced).",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: "Execution ID",
        },
        includeData: {
          type: "boolean",
          description:
            "Include node output data from the execution (default: false). Returns a map of nodeName → { outputKeys, itemCount }.",
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
        executionId: {
          type: "string",
          description:
            "Optional execution ID. When provided, injects inputHint on focused nodes showing which $json.xxx fields are available from the last execution's upstream node data.",
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
  // ---- Version Control ----
  {
    name: "list_versions",
    description:
      "List local snapshots (backups) of a workflow. Snapshots are created automatically before every mutation (update_nodes, update_workflow, delete). Use rollback_workflow to restore a previous version.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflowId: {
          type: "string",
          description: "Workflow ID to list snapshots for",
        },
        limit: {
          type: "number",
          description: "Max snapshots to return (default: all)",
        },
      },
      required: ["workflowId"],
    },
  },

  {
    name: "rollback_workflow",
    description:
      "Restore a workflow to a previous snapshot. This overwrites the current workflow state with the backed-up version. Use list_versions first to find the snapshot ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflowId: {
          type: "string",
          description: "Workflow ID to rollback",
        },
        snapshotId: {
          type: "string",
          description: "Snapshot ID to restore (from list_versions)",
        },
      },
      required: ["workflowId", "snapshotId"],
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

  // ---- Knowledge: Search Patterns ----
  {
    name: "search_patterns",
    description:
      'Search ready-made workflow recipe templates by keyword. Returns matching patterns with id, name, description, tags, complexity, and requiredParams. Use BEFORE create_workflow to find existing templates. Query with keywords like "whatsapp", "ai agent", "webhook", "evolution", "meta".',
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: 'Search keywords (e.g. "whatsapp evolution ai", "webhook router", "menu bot")',
        },
        tags: {
          type: "array",
          items: { type: "string" },
          description: 'Filter by tags (e.g. ["whatsapp", "ai-agent"])',
        },
      },
      required: ["query"],
    },
  },

  // ---- Knowledge: Get Pattern ----
  {
    name: "get_pattern",
    description:
      'Get a complete workflow recipe template by ID. Returns full nodes[] and flow[] ready to use with create_workflow. Also returns requiredParams listing what to ask the user before creating. Use search_patterns first to find the pattern ID.',
    inputSchema: {
      type: "object" as const,
      properties: {
        id: {
          type: "string",
          description: 'Pattern ID from search_patterns (e.g. "whatsapp-evolution-ai-agent")',
        },
      },
      required: ["id"],
    },
  },

  // ---- Knowledge: Get Payload Schema ----
  {
    name: "get_payload_schema",
    description:
      'Get webhook payload schema + extraction expressions for a specific provider. Returns the incoming JSON structure, ready-to-use n8n expressions for each field, and send message formats. Use when building integrations with WhatsApp, Telegram, or other webhook-based services.',
    inputSchema: {
      type: "object" as const,
      properties: {
        provider: {
          type: "string",
          description: 'Provider ID. Use list_providers to see available options. Examples: "evolution-api", "whatsapp-meta-cloud", "z-api", "telegram"',
        },
        event: {
          type: "string",
          description: 'Optional: specific event name to focus on (e.g. "messages.upsert", "messages")',
        },
      },
      required: ["provider"],
    },
  },

  // ---- Knowledge: Get n8n Knowledge ----
  {
    name: "get_n8n_knowledge",
    description:
      'Look up gotchas, quirks, and best practices for n8n nodes and patterns. Returns documented issues with solutions and example code. Use when you\'re unsure about node behavior, connection types, or common pitfalls. Query by keyword or node type.',
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: 'What you want to know (e.g. "switch fallthrough", "ai agent output", "meta webhook verification", "session memory")',
        },
        nodeType: {
          type: "string",
          description: 'Optional: filter by node type (e.g. "switch", "ai-agent", "postgres", "httpRequest")',
        },
      },
    },
  },

  // ---- Knowledge: List Providers ----
  {
    name: "list_providers",
    description:
      'List all webhook/API providers that have documented payload schemas. Returns provider IDs to use with get_payload_schema.',
    inputSchema: {
      type: "object" as const,
      properties: {},
    },
  },

  // ---- Knowledge: Search Expressions ----
  {
    name: "search_expressions",
    description:
      'Search the n8n expression cookbook for ready-made expressions. Returns expressions for common use cases: cross-branch data access, WhatsApp field extraction, date formatting, null handling, etc.',
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: 'What you need (e.g. "extract whatsapp phone", "cross branch reference", "null default", "date format")',
        },
        category: {
          type: "string",
          description: 'Optional: filter by category ID (e.g. "cross-branch", "whatsapp-specific", "ai-agent-specific", "null-handling")',
        },
      },
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
