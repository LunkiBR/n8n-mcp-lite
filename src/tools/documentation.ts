// ============================================================
// n8n-mcp-lite: Tool documentation & workflow guide
// Provides AI-friendly quick-start and per-tool docs
// ============================================================

const WORKFLOW_GUIDE = `# n8n-mcp-lite: AI Workflow Guide

## Recommended Flow (resolve in 1-2 iterations)

1. **DISCOVER**: search_nodes → find the right node type
2. **LEARN**: get_node(detail:"standard") → see properties, operations, credentials
3. **VALIDATE** (optional): validate_node → check config before creating
4. **CREATE**: create_workflow → simplified format, warnings attached but never blocked
5. **TEST**: trigger_webhook or test_node → execute and check results
6. **DEBUG**: executions(action:"get", mode:"error") → rich error analysis with suggestions
7. **FIX**: autofix_workflow or update_nodes → apply fixes

## Key Principles

- **n8n is the final validator.** The MCP never blocks workflow creation — it provides warnings.
- **Errors are rich.** When a workflow fails, use executions(mode:"error") to get: primary error, upstream context, execution path, and AI-friendly fix suggestions.
- **Node types can omit prefix.** "httpRequest" = "n8n-nodes-base.httpRequest".
- **Positions are auto-generated.** Just provide nodes and flow.
- **Always use get_node before configuring.** Prevents hallucinated parameters.

## AI Sub-Node Wiring (LangChain)

For AI nodes, use the type field in flow connections:
- LLM → AI Agent: {from: "OpenAI", to: "AI Agent", type: "ai_languageModel"}
- Memory → AI Agent: {from: "Memory", to: "AI Agent", type: "ai_memory"}
- Tool → AI Agent: {from: "Tool", to: "AI Agent", type: "ai_tool"}
- Embedding → VectorStore: {from: "Embed", to: "Store", type: "ai_embedding"}
- Document → VectorStore: {from: "Loader", to: "Store", type: "ai_document"}
`;

interface ToolDoc {
  summary: string;
  usage: string;
  tips?: string[];
}

const TOOL_DOCS: Record<string, ToolDoc> = {
  list_workflows: {
    summary: "List all workflows with metadata (id, name, active, tags, node count).",
    usage: "list_workflows() or list_workflows({active: true})",
  },
  get_workflow: {
    summary: "Get workflow in simplified format (80% fewer tokens) or raw n8n JSON.",
    usage: 'get_workflow({id: "123"}) or get_workflow({id: "123", format: "raw"})',
    tips: ["For large workflows (30+ nodes), use scan_workflow first", 'format: "raw" returns original n8n JSON for debugging'],
  },
  create_workflow: {
    summary: "Create workflow from simplified nodes + flow. Never blocked by validation.",
    usage: 'create_workflow({name: "My Flow", nodes: [...], flow: [...]})',
    tips: ["Use search_patterns first to find templates", "Types can omit 'n8n-nodes-base.' prefix", "Always ask user for credentials/config before creating"],
  },
  update_workflow: {
    summary: "Full workflow update. Send complete nodes + flow arrays.",
    usage: 'update_workflow({id: "123", nodes: [...], flow: [...]})',
    tips: ["For small changes, prefer update_nodes instead"],
  },
  update_nodes: {
    summary: "Surgical node updates without sending entire workflow.",
    usage: 'update_nodes({id: "123", operations: [{op: "updateNode", name: "HTTP", params: {url: "..."}}]})',
    tips: ["Operations: addNode, removeNode, updateNode, addConnection, removeConnection, enable, disable, rename"],
  },
  delete_workflow: {
    summary: "Permanently delete a workflow. Snapshot saved automatically.",
    usage: 'delete_workflow({id: "123", confirm: true})',
  },
  activate_workflow: {
    summary: "Activate or deactivate a workflow.",
    usage: 'activate_workflow({id: "123", active: true}) or activate_workflow({id: "123", active: false})',
  },
  executions: {
    summary: "List executions or get execution details with rich error analysis.",
    usage: 'executions({action: "list", workflowId: "123"}) or executions({action: "get", id: "456", mode: "error"})',
    tips: ['mode: "error" returns 5-phase analysis: primary error, upstream context, execution path, additional errors, suggestions'],
  },
  trigger_webhook: {
    summary: "Trigger a workflow via webhook URL for testing.",
    usage: 'trigger_webhook({path: "my-path", data: {key: "value"}})',
    tips: ["Use test: true for test webhook URL (workflow doesn't need to be active)"],
  },
  scan_workflow: {
    summary: "Lightweight table of contents for large workflows. ~90% fewer tokens.",
    usage: 'scan_workflow({id: "123"})',
    tips: ["Use before get_workflow on large workflows", "Returns focusRecommended: true if workflow is large"],
  },
  focus_workflow: {
    summary: "Zoom into specific workflow area. Full detail for focused nodes, minimal for rest.",
    usage: 'focus_workflow({id: "123", nodes: ["HTTP Request"]}) or focus_workflow({id: "123", branch: {node: "IF", outputIndex: 0}})',
    tips: ["Three modes: explicit nodes, branch auto-discovery, or range (from/to)", "Add expandFrom/expandUpstream/expandDownstream to extend focus area"],
  },
  versions: {
    summary: "List snapshots or rollback to a previous version.",
    usage: 'versions({action: "list", workflowId: "123"}) or versions({action: "rollback", workflowId: "123", snapshotId: "abc"})',
    tips: ["Snapshots are auto-created before every mutation"],
  },
  search_nodes: {
    summary: "Search n8n nodes by keyword. Use BEFORE creating workflows.",
    usage: 'search_nodes({query: "telegram"})',
    tips: ["Modes: OR (default), AND, FUZZY (typo-tolerant)"],
  },
  get_node: {
    summary: "Get node schema: properties, operations, credentials.",
    usage: 'get_node({nodeType: "httpRequest", detail: "standard"})',
    tips: ["ALWAYS use before configuring a node", "Returns exampleConfig for required fields"],
  },
  validate_node: {
    summary: "Pre-validate node config. Advisory only — never blocks.",
    usage: 'validate_node({nodeType: "slack", config: {resource: "channel", operation: "create"}})',
    tips: ["Use after get_node, before create_workflow", "Returns warnings about missing/invalid fields"],
  },
  autofix_workflow: {
    summary: "Auto-detect and fix common workflow issues.",
    usage: 'autofix_workflow({id: "123"}) for preview, autofix_workflow({id: "123", applyFixes: true}) to apply',
    tips: ["Fixes: expression format, typeVersion, webhook paths, error output config", "Snapshot saved before applying"],
  },
  knowledge: {
    summary: "Unified knowledge base: patterns, gotchas, payloads, providers, expressions.",
    usage: 'knowledge({topic: "patterns", action: "search", query: "whatsapp"}) or knowledge({topic: "gotchas", query: "switch fallthrough"})',
    tips: ["Topics: patterns, gotchas, payloads, providers, expressions"],
  },
  test_node: {
    summary: "Test a single node with mock input data.",
    usage: 'test_node({node: {name: "Code", type: "code", params: {jsCode: "..."}}, mockInput: {name: "test"}})',
    tips: ["Cannot test trigger nodes", "Creates temporary workflow, triggers it, cleans up"],
  },
  set_approval_mode: {
    summary: "Toggle approval mode for mutation safety.",
    usage: "set_approval_mode({enabled: true})",
  },
  tools_documentation: {
    summary: "This tool. Get workflow guide and per-tool documentation.",
    usage: 'tools_documentation() for overview, tools_documentation({topic: "create_workflow"}) for specific tool',
  },
};

/**
 * Get documentation content based on the requested topic.
 */
export function getDocumentation(topic?: string): {
  content: string;
  topic: string;
} {
  if (!topic || topic === "overview" || topic === "essentials") {
    // Return the workflow guide + tool summary
    const toolList = Object.entries(TOOL_DOCS)
      .map(([name, doc]) => `- **${name}**: ${doc.summary}`)
      .join("\n");

    return {
      topic: "overview",
      content: `${WORKFLOW_GUIDE}\n## Available Tools\n\n${toolList}`,
    };
  }

  // Specific tool documentation
  const doc = TOOL_DOCS[topic];
  if (doc) {
    let content = `## ${topic}\n\n${doc.summary}\n\n**Usage:** \`${doc.usage}\``;
    if (doc.tips && doc.tips.length > 0) {
      content += `\n\n**Tips:**\n${doc.tips.map((t) => `- ${t}`).join("\n")}`;
    }
    return { topic, content };
  }

  // Not found — return overview with hint
  return {
    topic: "overview",
    content: `Tool "${topic}" not found. Available tools: ${Object.keys(TOOL_DOCS).join(", ")}\n\n${WORKFLOW_GUIDE}`,
  };
}
