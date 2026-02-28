# n8n-mcp-lite

Token-optimized MCP Server for n8n workflows. **80%+ token reduction** compared to the standard n8n MCP server, plus **Focus Mode**, **Security Preflight**, **Auto-Versioning**, a built-in **Node Knowledge DB** (1,236 nodes), **Ghost Payload hints**, and **Smart Summaries**.

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

**n8n-mcp-lite** solves all of this:

1. **Simplified Format** — Transforms n8n's complex JSON into a compact representation (80%+ savings)
2. **Focus Mode** — Work on specific areas of large workflows without loading everything
3. **Security Preflight** — Validates every mutation before it reaches the n8n API
4. **Auto-Versioning** — Automatic snapshots before every write operation, with rollback
5. **Node Knowledge DB** — 1,236 node schemas for inline validation and suggestions
6. **Smart Summaries** — `scan_workflow` shows meaningful previews: IF conditions, Switch labels, AI prompts, Code snippets, Set field names
7. **Ghost Payload** — `focus_workflow` with an `executionId` injects `inputHint` showing which `$json` fields are available at each focused node
8. **Node Dry-Run** — `test_node` runs a single node with mock data via a temporary workflow, without touching production

| Feature | n8n-mcp (standard) | n8n-mcp-lite |
|---------|---------------------|--------------|
| 5-node workflow | ~4,000 tokens | ~500 tokens |
| 78-node workflow | ~600,000+ tokens | ~16,500 tokens |
| 78-node scan (no params) | N/A | ~5,100 tokens |
| Focus on 2 nodes from 38 | ~135,000 tokens | ~2,600 tokens |
| Node creation | Full JSON with positions | `{name, type, params}` |
| Connections | Nested objects | `{from, to}` |
| Type names | `n8n-nodes-base.httpRequest` | `httpRequest` |
| Security validation | None | Pre-flight on every mutation |
| Rollback | None | Auto-snapshots + `rollback_workflow` |
| Node schema lookup | None | 1,236 nodes built-in |
| Input field hints | None | Ghost Payload via `executionId` |
| Node testing | None | `test_node` with mock data |

## Quick Start

### 1. Get your n8n API Key

Go to your n8n instance → **Settings** → **API** → **Create API Key**

### 2. Configure in your AI client

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

#### Google Antigravity

Edit `%USERPROFILE%\.gemini\antigravity\mcp_config.json` (Windows) or `~/.gemini/antigravity/mcp_config.json` (macOS/Linux):

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

You can also open the MCP store in Antigravity → **Manage MCP Servers** → **View raw config** to edit it via the IDE UI.

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

#### Cursor / Cline / Windsurf / Other MCP Clients

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

For best results, add the contents of [`SYSTEM_PROMPT.md`](./SYSTEM_PROMPT.md) to your AI client's system prompt or custom instructions. This teaches the AI how to use Focus Mode, Security Preflight, Ghost Payload, and all 26 tools effectively.

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `N8N_HOST` | Yes | n8n instance URL (e.g., `https://your-n8n.example.com`) |
| `N8N_API_KEY` | Yes | n8n API key |
| `N8N_TIMEOUT` | No | Request timeout in ms (default: 30000) |
| `N8N_VERSION_STORE_PATH` | No | Custom path for version snapshots (default: `<project>/.versioning`) |

> `N8N_API_URL` is also accepted as an alias for `N8N_HOST`.

## Tools (26 total)

### Reading

| Tool | Description |
|------|-------------|
| `list_workflows` | List all workflows (id, name, active, tags, node count) |
| `get_workflow` | Full simplified workflow (all nodes with params, 80%+ fewer tokens) |
| `get_workflow_raw` | Raw n8n JSON (debugging only) |
| `scan_workflow` | **Focus Mode** — Lightweight scan: names, types, smart 1-line summaries, segments, token estimate |
| `focus_workflow` | **Focus Mode** — Full detail for selected nodes only, dormant summaries for the rest. Accepts optional `executionId` for **Ghost Payload** hints |
| `expand_focus` | **Focus Mode** — Grow focus area by adding upstream/downstream/specific nodes |

### Writing (with Security Preflight + Auto-Snapshot)

All write operations automatically run **Security Preflight** before sending to n8n, and create an **auto-snapshot** you can roll back to.

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
| `get_execution` | Get execution details (use `includeData: true` to retrieve node output data) |
| `trigger_webhook` | Trigger via webhook (production or test) |
| `test_node` | **Dry-Run** — Test a single node with mock input data without touching your production workflow |

### Versioning

| Tool | Description |
|------|-------------|
| `list_versions` | List all snapshots for a workflow (auto-created before every mutation) |
| `rollback_workflow` | Restore a workflow to a previous snapshot |

### Node Knowledge Base

| Tool | Description |
|------|-------------|
| `search_nodes` | Search 1,236 built-in n8n node schemas by keyword |
| `get_node` | Get full schema for a node type (properties, operations, credentials) |
| `search_patterns` | Search ready-made workflow recipe templates |
| `get_pattern` | Get a complete workflow recipe (nodes + flow ready to use) |
| `get_payload_schema` | Get webhook payload schema + n8n expressions for WhatsApp, Telegram, etc. |
| `get_n8n_knowledge` | Look up gotchas, quirks, and best practices for specific nodes |
| `search_expressions` | Search cookbook of ready-made n8n expressions (cross-branch access, date formatting, etc.) |
| `list_providers` | List all webhook/API providers with documented payload schemas |

## Security Preflight

Every mutation (`create_workflow`, `update_workflow`, `update_nodes`) runs through a multi-layer security check **before** the request reaches your n8n instance:

### What It Catches

| Check | Examples |
|-------|---------|
| **Expression validation** | Missing `=` prefix, mismatched `{{ }}`, empty expressions, bare `$json`, legacy `$node[]` |
| **Hardcoded credentials** | OpenAI API keys, AWS keys, Slack tokens, DB connection strings |
| **SQL injection patterns** | `'; DROP TABLE`, `UNION SELECT`, `-- comment` in HTTP bodies |
| **Node config errors** | Unknown node types, invalid resource/operation combos, missing required fields |
| **Type mismatches** | String where number expected, boolean where string expected |
| **Property location hints** | Parameters placed at wrong nesting level (e.g., inside `options`) |
| **Broken connections** | References to non-existent nodes |
| **Orphan nodes** | Nodes with no connections in multi-node workflows |

### Response When Blocked

```json
{
  "blocked": true,
  "message": "2 error(s) found — mutation blocked",
  "errors": [
    {
      "type": "hardcoded_credential",
      "severity": "error",
      "node": "Call OpenAI",
      "message": "Possible hardcoded OpenAI API key in field 'apiKey'"
    }
  ],
  "warnings": [],
  "recommendation": "Fix the errors above before retrying"
}
```

## Auto-Versioning & Rollback

Every write operation automatically saves a snapshot of the workflow **before** the change is applied. Snapshots are stored locally in `.versioning/` (next to the project, never in `system32`).

```
# See all snapshots for a workflow
list_versions({ workflowId: "abc123" })

# Restore to a specific snapshot
rollback_workflow({ workflowId: "abc123", snapshotId: "snap_1234567890" })
```

- Maximum 20 snapshots per workflow (oldest are pruned automatically)
- Each snapshot includes: timestamp, trigger type, description, full workflow JSON

## Focus Mode

Focus Mode is designed for large workflows (30+ nodes) where loading everything at once wastes tokens.

```
scan_workflow     →  See the full structure (~2K-5K tokens, no params)
                     Smart summaries: IF conditions, Switch labels, AI prompts, Code snippets
                     Detects branches, estimates total token cost
                     ↓
focus_workflow    →  Zoom into specific area (full detail inside, dormant outside)
                     3 modes: explicit nodes, branch, or range
                     Optional: executionId → Ghost Payload hints on focused nodes
                     ↓
update_nodes      →  Edit within the focus boundary
                     ↓
expand_focus      →  Need more context? Grow the boundary iteratively
```

### Three Focus Modes

#### 1. Explicit Nodes

```json
focus_workflow({ "id": "workflow-id", "nodes": ["AI Agent", "Parse Response"] })
```

#### 2. Branch — Auto-discover a Switch/IF branch

```json
focus_workflow({ "id": "workflow-id", "branch": { "node": "Router", "outputIndex": 2 } })
```

#### 3. Range — Focus between two nodes

```json
focus_workflow({ "id": "workflow-id", "range": { "from": "Validate Input", "to": "Send Response" } })
```

### Ghost Payload — Know your `$json` fields

When you have an execution ID, pass it to `focus_workflow` and each focused node will receive an `inputHint` array listing the `$json` fields available from its upstream node's last run:

```json
focus_workflow({
  "id": "workflow-id",
  "nodes": ["AI Agent", "Format Response"],
  "executionId": "1234"
})
```

The focused nodes will include:
```json
{
  "name": "AI Agent",
  "inputHint": ["customerId", "message", "channel", "timestamp"]
}
```

No more guessing which fields are available — the execution data tells you exactly what arrives at each node.

### Real-World Results

| Workflow | Nodes | get_workflow | scan_workflow | focus (2 nodes) |
|----------|-------|-------------|---------------|-----------------|
| CRIS Phase 2+3 | 38 | ~13,600 tok | ~2,800 tok (80% less) | ~2,600 tok (81% less) |
| Limpex Atendimento | 78 | ~16,500 tok | ~5,100 tok (69% less) | ~3,100 tok (81% less) |

## Node Dry-Run (`test_node`)

Test a single node with mock input data without modifying or running your production workflow:

```json
test_node({
  "node": {
    "name": "Transform",
    "type": "code",
    "_v": 2,
    "params": {
      "jsCode": "return items.map(i => ({ json: { doubled: i.json.x * 2 } }))"
    }
  },
  "mockInput": { "x": 5 }
})
```

Returns the node's actual output: `{ "doubled": 10 }`

**How it works**: Creates a temporary 2-node workflow (`Webhook → YourNode`) with `responseMode: "lastNode"`, activates it, sends the mock data, captures the node's output from the webhook response, then permanently deletes the temporary workflow.

**Limitations**:
- Trigger nodes (webhook, schedule, chat) cannot be tested this way
- Nodes requiring credentials need those credentials configured in your n8n instance
- If the MCP server crashes mid-test, a `__mcp_test_*` workflow may remain — delete it manually

## Node Knowledge Base

The built-in Knowledge Base includes 8 tools for working with n8n nodes without leaving the chat:

```
# Find the right node type
search_nodes("send email")
→ gmail, emailSend, sendGrid, mailchimp...

# Get full schema before configuring
get_node("httpRequest")
→ Properties, operations, credential types, version info

# Find ready-made patterns
search_patterns("whatsapp ai agent")
→ Pattern: whatsapp-evolution-ai-agent (webhook + agent + memory)

# Get a complete template
get_pattern("whatsapp-evolution-ai-agent")
→ nodes[] + flow[] ready to pass to create_workflow

# Know what fields to extract from a webhook
get_payload_schema("evolution-api")
→ JSON structure + n8n expressions for each field

# Avoid common mistakes
get_n8n_knowledge("switch fallthrough")
→ Known issue: Switch node doesn't fall through; use separate connections

# Find expression recipes
search_expressions("cross branch reference")
→ $('NodeName').item.json.field — access data from non-linear upstream
```

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
  "notes": "Sends notification",
  "inputHint": ["email", "name", "orderId"]
}
```

## update_nodes Operations

```json
update_nodes({
  "id": "workflow-id",
  "operations": [
    {"op": "updateNode", "name": "HTTP Request", "params": {"url": "https://new-api.com"}},
    {"op": "addNode", "node": {"name": "Filter", "type": "filter", "params": {}}},
    {"op": "addConnection", "from": "HTTP Request", "to": "Filter"},
    {"op": "removeConnection", "from": "Old Node", "to": "Filter"},
    {"op": "removeNode", "name": "Old Node"},
    {"op": "disable", "name": "Debug Node"},
    {"op": "enable", "name": "Production Node"},
    {"op": "rename", "name": "Node 1", "newName": "Validate Input"}
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
    layout.ts           # Auto-position algorithm for new nodes
    graph.ts            # BFS, adjacency, classification algorithms
    focus.ts            # Scan, Focus, Dormant builders + Ghost Payload extraction
  tools/
    definitions.ts      # 26 MCP tool schemas
    handlers.ts         # Tool handler implementations
  security/
    preflight.ts        # Security orchestrator
    expression-validator.ts  # n8n expression syntax checks (incl. Rule 6: bare $json)
    config-validator.ts      # Node config vs knowledge DB (type + location validation)
    security-analyzer.ts     # Credential/SQL/orphan detection
  versioning/
    version-store.ts    # File-based snapshot storage
  knowledge/
    node-db.ts          # 1,236 node schema database
    pattern-db.ts       # Workflow patterns, payloads, gotchas, expressions
  data/
    nodes.json          # Compiled node knowledge (3.1MB)
    patterns.json       # Workflow recipe templates
    payloads.json       # Webhook payload schemas (WhatsApp, Telegram, etc.)
    gotchas.json        # Node quirks and best practices
    expressions.json    # n8n expression cookbook
```

## License

MIT
