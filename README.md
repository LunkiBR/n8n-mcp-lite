# n8n-mcp-lite

Token-optimized MCP Server for n8n workflows. **80%+ token reduction** compared to the standard n8n MCP server, plus **Focus Mode** for working on specific areas of large workflows.

## The Problem

The standard n8n MCP server returns massive JSON payloads:
- `activeVersion` duplicates ALL nodes and connections (2x the data)
- `shared` includes full user profiles with personalization data
- Positions (`[x, y]`) for every node
- Empty defaults (`options: {}`, `staticData: null`, etc.)
- Verbose connection format with redundant fields
- A **16-node workflow = 134,918 tokens** (!)

Even with the simplified format, large workflows with AI Agents (huge system prompts), Code nodes (long scripts), and multiple Switch branches still consume too many tokens to work efficiently.

## The Solution

**n8n-mcp-lite** solves both problems:

1. **Simplified Format** — Transforms n8n's complex JSON into a compact representation (80%+ savings)
2. **Focus Mode** — Work on specific areas of large workflows without loading everything

| Feature | n8n-mcp (standard) | n8n-mcp-lite |
|---------|---------------------|--------------|
| 5-node workflow | ~4,000 tokens | ~500 tokens |
| 78-node workflow | ~600,000+ tokens | ~16,500 tokens |
| 78-node scan (no params) | N/A | ~5,100 tokens |
| Focus on 2 nodes from 38 | ~135,000 tokens | ~2,600 tokens |
| Node creation | Full JSON with positions | `{name, type, params}` |
| Connections | Nested objects | `{from, to}` |
| Type names | `n8n-nodes-base.httpRequest` | `httpRequest` |

## Quick Start

### 1. Get your n8n API Key

Go to your n8n instance → **Settings** → **API** → **Create API Key**

### 2. Configure in your AI client

Choose your client below and add the configuration.

#### Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "n8n-lite": {
      "command": "npx",
      "args": ["-y", "n8n-mcp-lite"],
      "env": {
        "N8N_HOST": "https://your-n8n.example.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### Claude Code

Add to your project's `.claude/settings.json` or global `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "n8n-lite": {
      "command": "npx",
      "args": ["-y", "n8n-mcp-lite"],
      "env": {
        "N8N_HOST": "https://your-n8n.example.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### Cursor / Cline / Other MCP Clients

```json
{
  "mcpServers": {
    "n8n-lite": {
      "command": "npx",
      "args": ["-y", "n8n-mcp-lite"],
      "env": {
        "N8N_HOST": "https://your-n8n.example.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

#### Local Development (from source)

If running from a cloned repo instead of npm:

```json
{
  "mcpServers": {
    "n8n-lite": {
      "command": "node",
      "args": ["C:/path/to/n8n-mcp-lite/dist/index.js"],
      "env": {
        "N8N_HOST": "https://your-n8n.example.com",
        "N8N_API_KEY": "your-api-key-here"
      }
    }
  }
}
```

### 3. Add the System Prompt (recommended)

For best results, add the contents of [`SYSTEM_PROMPT.md`](./SYSTEM_PROMPT.md) to your AI client's system prompt or custom instructions. This teaches the AI how to use Focus Mode effectively and follow token-efficient patterns.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `N8N_HOST` | Yes | n8n instance URL (e.g., `https://your-n8n.example.com`) |
| `N8N_API_KEY` | Yes | n8n API key |
| `N8N_TIMEOUT` | No | Request timeout in ms (default: 30000) |

> `N8N_API_URL` is also accepted as an alias for `N8N_HOST`.

## Tools (15 total)

### Reading

| Tool | Description |
|------|-------------|
| `list_workflows` | List all workflows (id, name, active, tags, node count) |
| `get_workflow` | Full simplified workflow (all nodes with params, 80%+ fewer tokens) |
| `get_workflow_raw` | Raw n8n JSON (debugging only, still strips worst bloat) |
| `scan_workflow` | **Focus Mode** — Lightweight scan: names, types, 1-line summaries, segments, token estimate |
| `focus_workflow` | **Focus Mode** — Full detail for selected nodes only, dormant summaries for the rest |
| `expand_focus` | **Focus Mode** — Grow focus area by adding upstream/downstream/specific nodes |

### Writing

| Tool | Description |
|------|-------------|
| `create_workflow` | Create from simplified format (auto-generates positions) |
| `update_workflow` | Full replacement from simplified format (preserves positions/creds) |
| `update_nodes` | Surgical operations: addNode, removeNode, updateNode, addConnection, removeConnection, enable, disable, rename |
| `delete_workflow` | Permanent deletion (requires `confirm: true`) |

### Activation & Execution

| Tool | Description |
|------|-------------|
| `activate_workflow` | Enable automatic triggers |
| `deactivate_workflow` | Disable automatic triggers |
| `list_executions` | List executions (filter by workflow, status) |
| `get_execution` | Get execution details |
| `trigger_webhook` | Trigger via webhook (production or test) |

## Focus Mode

Focus Mode is designed for large workflows (30+ nodes) where loading everything at once wastes tokens. It's especially useful when workflows contain AI Agents with large system prompts, Code nodes with long scripts, or multiple Switch branches.

### How It Works

```
scan_workflow     →  See the full structure (~2K-5K tokens, no params)
                     Detects branches, estimates total token cost
                     ↓
focus_workflow    →  Zoom into specific area (full detail inside, dormant outside)
                     3 modes: explicit nodes, branch, or range
                     ↓
update_nodes      →  Edit within the focus boundary
                     ↓
expand_focus      →  Need more context? Grow the boundary iteratively
```

### Three Focus Modes

#### 1. Explicit Nodes — Focus on specific nodes anywhere

```json
focus_workflow({
  id: "workflow-id",
  nodes: ["AI Agent", "Parse Response", "Send Email"]
})
```

#### 2. Branch — Auto-discover a Switch/IF branch

```json
focus_workflow({
  id: "workflow-id",
  branch: {
    node: "Router",
    outputIndex: 2,
    includeUpstream: 1
  }
})
```

#### 3. Range — Focus on everything between two nodes

```json
focus_workflow({
  id: "workflow-id",
  range: {
    from: "Validate Input",
    to: "Send Response"
  }
})
```

### Focus Output Structure

```json
{
  "totalNodeCount": 75,
  "focused": [
    // Full LiteNode detail (params, creds, code) for selected nodes
  ],
  "focusedFlow": [
    // Connections between focused nodes only
  ],
  "dormant": [
    // Every other node: {name, type, zone, summary}
    {"name": "Webhook", "type": "webhook", "zone": "upstream", "summary": "Webhook: POST /incoming"},
    {"name": "Send Slack", "type": "slack", "zone": "downstream", "summary": "slack", "inputsFrom": ["AI Agent"]}
  ],
  "boundaries": [
    // Entry/exit points of the focus area
    {"from": "Validate", "to": "AI Agent", "direction": "entry"},
    {"from": "Parse Response", "to": "Send Slack", "direction": "exit"}
  ],
  "stats": {
    "focusedCount": 3,
    "upstreamCount": 5,
    "downstreamCount": 8,
    "parallelCount": 59
  }
}
```

### Real-World Results

| Workflow | Nodes | get_workflow | scan_workflow | focus (2 nodes) |
|----------|-------|-------------|---------------|-----------------|
| CRIS Phase 2+3 | 38 | ~13,600 tok | ~2,800 tok (80% less) | ~2,600 tok (81% less) |
| Limpex Atendimento | 78 | ~16,500 tok | ~5,100 tok (69% less) | ~3,100 tok (81% less) |

## Simplified Format

### Node Types

Prefixes are automatically stripped/restored:

| n8n Full Type | Simplified |
|---|---|
| `n8n-nodes-base.httpRequest` | `httpRequest` |
| `n8n-nodes-base.webhook` | `webhook` |
| `@n8n/n8n-nodes-langchain.agent` | `langchain:agent` |
| `@n8n/n8n-nodes-langchain.lmChatOpenAi` | `langchain:lmChatOpenAi` |

### LiteNode

```json
{
  "name": "Send Email",
  "type": "gmail",
  "_id": "uuid",
  "_v": 2,
  "params": { "sendTo": "user@example.com", "subject": "Hello" },
  "creds": { "gmailOAuth2Api": "My Gmail" },
  "disabled": true,
  "onError": "continueRegularOutput",
  "notes": "Sends notification"
}
```

- `_id` — Internal node ID (preserved for updates)
- `_v` — Type version (only if != 1)
- `params` — Only non-empty, non-default parameters
- `creds` — Credential names only (IDs restored from original on update)
- `disabled` — Only present if `true`
- `onError` — Only if non-default

### Connections

```json
{"from": "Webhook", "to": "Process"}
{"from": "IF", "to": "True Path", "outputIndex": 0}
{"from": "IF", "to": "False Path", "outputIndex": 1}
{"from": "Switch", "to": "Case 3", "outputIndex": 2}
{"from": "Model", "to": "Agent", "type": "ai_languageModel"}
{"from": "Data", "to": "Merge", "inputIndex": 1}
```

## update_nodes Operations

Surgical edits without sending the entire workflow:

```json
update_nodes({
  id: "workflow-id",
  operations: [
    // Update parameters
    {op: "updateNode", name: "HTTP Request", params: {url: "https://new-api.com"}},

    // Add a node
    {op: "addNode", node: {name: "Filter", type: "filter", params: {...}}},

    // Connect/disconnect
    {op: "addConnection", from: "HTTP Request", to: "Filter"},
    {op: "removeConnection", from: "Old Node", to: "Filter"},

    // Remove node (also cleans up connections)
    {op: "removeNode", name: "Old Node"},

    // Enable/disable
    {op: "disable", name: "Debug Node"},
    {op: "enable", name: "Production Node"},

    // Rename (updates all connection references)
    {op: "rename", name: "Node 1", newName: "Validate Input"}
  ]
})
```

## Building from Source

```bash
git clone https://github.com/LunkiBR/n8n-mcp-lite.git
cd n8n-mcp-lite
npm install
npm run build
```

Then use the "Local Development" config above, pointing to `dist/index.js`.

## Architecture

```
src/
  index.ts              # MCP server entry point (stdio transport)
  api-client.ts         # n8n REST API client
  types.ts              # All type definitions
  transform/
    simplify.ts         # Raw JSON → Simplified format (bidirectional)
    graph.ts            # BFS, adjacency, classification algorithms
    focus.ts            # Scan, Focus, Dormant builders
  tools/
    definitions.ts      # 15 MCP tool schemas
    handlers.ts         # Tool handler implementations
```

## License

MIT
