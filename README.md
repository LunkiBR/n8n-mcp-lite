# n8n-mcp-lite

**MCP redesigned for real-world workflow scale.**

> If your n8n workflow has more than ~40 nodes, standard MCP becomes structurally unusable.
> n8n-mcp-lite remains viable.

---

## Benchmark

Measured on identical workflows. Token counts via the OpenAI tokenizer.

| Scenario | Standard MCP | n8n-mcp-lite | Reduction |
|---|---|---|---|
| 5-node workflow | ~4,000 tokens | ~500 tokens | **87%** |
| 78-node workflow | ~600,000+ tokens | ~16,500 tokens | **97%** |
| Focus on 2 nodes (from 38) | ~135,000 tokens | ~2,600 tokens | **98%** |

Above ~50 nodes, standard MCP stops being context-viable. n8n-mcp-lite remains usable.

Standard MCP implementations serialize the full workflow graph on every context turn. In large workflows, this produces token counts that exceed practical context windows entirely — making reliable AI assistance structurally impossible above a certain workflow size.

n8n-mcp-lite addresses this at the architecture level, not through compression or summarization hacks.

---

## Who This Is For

**n8n users with growing workflows**
- Want AI to help manage, debug, and extend workflows safely
- Don't want to understand n8n JSON internals
- Need confidence that AI won't break production

**Developers building production automation**
- Care about deterministic serialization
- Need selective context for large workflows
- Want rollback and structural guarantees before any mutation
- Build workflows with 30, 50, 100+ nodes

---

## Quick Start

1. Complete installation for your client ([Cursor](#cursor) / [Claude Desktop](#claude-desktop)).
2. Ask your AI assistant: *"List my n8n workflows."*
3. Ask: *"Scan workflow [name]."* — returns a lightweight overview without loading full JSON.
4. Ask: *"Focus on [node name]."* — loads only the nodes you need.
5. Make changes. Every mutation runs security checks and creates an auto-snapshot before touching n8n.

No n8n internals knowledge required. The server handles format translation, validation, and context management automatically.

---

## 5-Minute Validation Test

After installation:

1. Ask: *"List my workflows."*
2. Pick a workflow with 30+ nodes. Ask: *"Scan it."*
3. Note the token estimate in the response.
4. Compare it to the raw JSON size of that workflow.
5. Ask: *"Focus on [one node name]."* — see how much context drops further.

If you have a workflow above 50 nodes, the difference will be immediately visible.

---

## Real-World Scenarios

**Large workflows (50+ nodes)**

Standard MCP sends the entire workflow graph on every turn. At scale, this exceeds context windows entirely — responses degrade or fail. n8n-mcp-lite sends only what's needed, keeping interaction viable regardless of workflow size.

**Debugging broken expressions**

Ghost Payload attaches an `inputHint` to each focused node showing the exact `$json` field names arriving from upstream — pulled from real execution data. No more guessing what fields exist.

**Safe AI refactoring**

Every mutation runs a 7-layer security preflight before touching the n8n API. Hardcoded credentials, broken expressions, SQL injection patterns, and structural errors are caught and blocked. The API is never called on a failing check.

**Recovering from a bad change**

Every mutation auto-snapshots the workflow before executing. `rollback_workflow` restores any prior state exactly. Up to 20 snapshots per workflow, automatically pruned.

---

## What This Is

n8n-mcp-lite is an MCP server that connects AI clients (Claude, Cursor, or any MCP-compatible client) to an n8n instance. It exposes **26 tools** across six categories — reading, writing, activation, execution, versioning, and a node knowledge base — all operating on a compact serialization format purpose-built for AI interaction.

The server is designed to be:

- **Token-disciplined** — minimal context at every tool boundary
- **Architecturally safe** — every write operation runs security preflight and creates an auto-snapshot
- **Deterministic** — LiteNode format is stable and predictable across calls
- **Model-agnostic** — works with any MCP-compatible AI client

---

## Installation

### Prerequisites

- Node.js ≥ 18.0.0
- An n8n instance with API access enabled
- An n8n API key (`Settings → API → Create API Key`)

Clone the repository and build:

```bash
git clone https://github.com/LunkiBR/n8n-mcp-lite.git
cd n8n-mcp-lite
npm install
npm run build
```

---

### Cursor

Create or edit `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` (per-project):

```json
{
  "mcpServers": {
    "n8n-mcp-lite": {
      "command": "node",
      "args": ["/absolute/path/to/n8n-mcp-lite/dist/index.js"],
      "env": {
        "N8N_HOST": "https://your-n8n.example.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

Restart Cursor after saving. The MCP server will appear in the active tools panel.

---

### Claude Desktop

Edit the Claude Desktop configuration file:

- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "n8n-mcp-lite": {
      "command": "node",
      "args": ["/absolute/path/to/n8n-mcp-lite/dist/index.js"],
      "env": {
        "N8N_HOST": "https://your-n8n.example.com",
        "N8N_API_KEY": "your-api-key"
      }
    }
  }
}
```

Restart Claude Desktop. The server registers automatically on startup.

> **Note**: Do not use relative paths in `args`. Claude Desktop sets the working directory to the system root on some platforms. Always use absolute paths.

---

### Generic MCP Clients

Any client that supports the Model Context Protocol stdio transport:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/n8n-mcp-lite/dist/index.js"],
  "env": {
    "N8N_HOST": "https://your-n8n.example.com",
    "N8N_API_KEY": "your-api-key"
  }
}
```

The server communicates over `stdin`/`stdout` using the standard MCP protocol. No HTTP server is started.

---

## Architecture

### Why This Exists

AI-assisted automation breaks at scale because of context inflation. Standard MCP was not designed for workflows that grow past a few dozen nodes. n8n-mcp-lite is a serialization layer designed for AI reasoning — not a wrapper around the n8n API.

### The Core Problem

Standard MCP implementations pass the raw n8n workflow JSON to the model context on every call. A 78-node workflow produces over 600,000 tokens of raw JSON — well beyond any practical context window, and containing mostly positional metadata, default values, and structural noise irrelevant to the task at hand.

This is not a tokenizer efficiency problem. It is a serialization design problem.

### The n8n-mcp-lite Approach

```
n8n API (raw JSON)
       │
       ▼
┌─────────────────┐
│  Simplify Layer │  Strip defaults, normalize types, compress connections
└────────┬────────┘
         │  LiteNode format
         ▼
┌─────────────────┐
│  Graph Analysis │  Build adjacency graph, detect segments and branches
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  Focus Engine   │  Compute boundaries, classify upstream/downstream,
│                 │  reduce non-target nodes to one-line dormant summaries
└────────┬────────┘
         │  Focused context payload
         ▼
       Model
```

The result: the model receives exactly the nodes relevant to the current task, with full parameter detail for focused nodes and compact summaries for everything else.

### Subsystems

**Serialization Layer** (`src/transform/simplify.ts`)
Converts raw n8n JSON to LiteNode format. Strips all-default values, omits empty fields, normalizes node type prefixes (`n8n-nodes-base.httpRequest` → `httpRequest`), and compresses the connection graph. The format is stable across n8n versions.

**Graph Analysis** (`src/transform/graph.ts`)
Builds a directed adjacency graph from the serialized workflow. Detects independent branches, segments by router output index, identifies entry and exit points, and classifies node relationships for focus boundary computation.

**Focus Engine** (`src/transform/focus.ts`)
Given a set of target nodes, computes the boundary of the focus area, classifies every other node as upstream, downstream, or parallel, and reduces non-focused nodes to single-line dormant summaries. Supports node selection, branch selection, range selection, and iterative expansion via `expand_focus`.

**Ghost Payload** — when an `executionId` is provided to `focus_workflow`, the engine reads that execution's input data and attaches an `inputHint` to each focused node showing the exact `$json` field names arriving from upstream. Eliminates expression guessing in debugging workflows.

**Security Preflight** (`src/security/preflight.ts`)
Every mutating tool (`create_workflow`, `update_workflow`, `update_nodes`) runs a multi-layer validation pass before touching the n8n API:

| Layer | What It Catches |
|---|---|
| Expression syntax | Missing `=` prefix, mismatched brackets, bare `$json`, legacy `$node[]` |
| Hardcoded credentials | OpenAI keys, AWS keys, Slack tokens, DB connection strings |
| SQL injection | `DROP TABLE`, `UNION SELECT`, comment injections, `DELETE` without `WHERE` |
| Node configuration | Unknown node types, invalid resource/operation combinations |
| Structural integrity | References to non-existent nodes, orphaned nodes |
| Type validation | String where number expected, number where boolean expected (warnings) |
| Property location | Parameters placed at top level that belong inside `options` (warnings) |

If any error-level finding is detected, the mutation is blocked and the response contains a structured `errors` array with exact field locations and fix instructions. The n8n API is never called.

**Version Store** (`src/versioning/version-store.ts`)
Before every mutation, the current workflow state is serialized to a JSON snapshot in `.versioning/{workflowId}/`. Up to 20 snapshots are retained per workflow; oldest are pruned automatically. `rollback_workflow` restores any snapshot exactly.

**Approval Gate** (`src/approval/approval-store.ts`)
Optional team safety layer, enabled via `N8N_REQUIRE_APPROVAL=true`. When enabled, mutating tools return a `pending` response with an `approve_token` instead of executing immediately. The caller must re-submit with the token to proceed. All attempted mutations are recorded to an append-only audit log at `.versioning/audit.log`, regardless of approval mode status.

**Node Knowledge Base** (`src/knowledge/`)
Static embedded database of n8n node schemas, workflow pattern templates, webhook payload schemas, expression recipes, and documented node quirks. Queried via `get_node`, `search_patterns`, `get_payload_schema`, `search_expressions`, and `get_n8n_knowledge`.

---

## Feature Comparison

| Capability | Standard MCP | n8n-mcp-lite |
|---|:---:|:---:|
| Workflow read/write | Yes | Yes |
| Token-optimized serialization | No | Yes — LiteNode format |
| Focus mode (selective context) | No | Yes — node, branch, range, expand |
| Ghost payload (execution-aware hints) | No | Yes — `inputHint` per focused node |
| Security preflight (7 layers) | No | Yes — blocks before API call |
| Auto-versioning (pre-mutation snapshot) | No | Yes — up to 20 snapshots per workflow |
| Rollback | No | Yes — `rollback_workflow` |
| Surgical edits (`update_nodes`) | No | Yes — no full-workflow resend required |
| Node dry-run (`test_node`) | No | Yes — mock input, real output, no side effects |
| Node schema lookup (`get_node`) | No | Yes — properties, operations, credential types |
| Expression cookbook (`search_expressions`) | No | Yes — cross-branch, date, null handling |
| Pattern templates (`search_patterns`) | No | Yes — ready-to-create workflow recipes |
| Webhook payload schemas | No | Yes — field-level expressions per provider |
| Approval gate with audit log | No | Yes — `N8N_REQUIRE_APPROVAL=true` |
| Simplified type names | No | Yes — `httpRequest` vs `n8n-nodes-base.httpRequest` |
| Automatic node positioning | No | Yes — positions computed on create/update |

---

## Tool Reference

### Reading

| Tool | Purpose |
|---|---|
| `list_workflows` | List all workflows with id, name, active status, tags, node count |
| `scan_workflow` | Lightweight table of contents — node names, types, smart summaries, segments, token estimate |
| `focus_workflow` | Zoomed view — full detail for selected nodes, dormant summaries for rest; accepts `executionId` for Ghost Payload |
| `expand_focus` | Grow an existing focus area by adding adjacent upstream or downstream nodes |
| `get_workflow` | Full simplified workflow — all nodes with parameters |
| `get_workflow_raw` | Original n8n JSON, stripped of known bloat — debugging only |

### Writing

| Tool | Purpose |
|---|---|
| `create_workflow` | Create a new workflow from LiteNode format (preflight + auto-snapshot) |
| `update_nodes` | Surgical operations — add, remove, update nodes and connections without full-workflow resend (preflight + auto-snapshot) |
| `update_workflow` | Full workflow replacement from LiteNode format (preflight + auto-snapshot) |
| `delete_workflow` | Permanently delete — requires `confirm: true`, auto-snapshots first |

### Activation & Execution

| Tool | Purpose |
|---|---|
| `activate_workflow` | Enable automatic triggers |
| `deactivate_workflow` | Disable automatic triggers |
| `list_executions` | List executions, filterable by workflow ID and status |
| `get_execution` | Get execution details; `includeData: true` returns full node output data |
| `trigger_webhook` | Trigger workflow via webhook URL |
| `test_node` | Dry-run a single node with mock input — real execution, no side effects, auto-cleanup |

### Versioning

| Tool | Purpose |
|---|---|
| `list_versions` | List all snapshots for a workflow with timestamps and trigger labels |
| `rollback_workflow` | Restore workflow to a specific snapshot |

### Node Knowledge Base

| Tool | Purpose |
|---|---|
| `search_nodes` | Find node types by keyword — returns type, description, category |
| `get_node` | Full node schema: properties, operations, credential types, version differences |
| `search_patterns` | Find workflow templates by keyword or tag |
| `get_pattern` | Return complete template (nodes + flow) ready for `create_workflow` |
| `get_payload_schema` | Webhook payload structure and ready-to-use n8n expressions per provider |
| `get_n8n_knowledge` | Documented quirks, gotchas, and best practices for specific nodes |
| `search_expressions` | Expression cookbook — cross-branch access, date formatting, null handling |
| `list_providers` | List all providers with documented webhook schemas |

### Approval (Team Mode)

| Tool | Purpose |
|---|---|
| `set_approval_mode` | Enable or disable the approval gate at runtime |

---

## Configuration

All configuration is via environment variables passed through the MCP client config.

| Variable | Required | Description |
|---|:---:|---|
| `N8N_HOST` | Yes | Base URL of your n8n instance (e.g., `https://n8n.example.com`) |
| `N8N_API_KEY` | Yes | n8n API key with workflow read/write permissions |
| `N8N_TIMEOUT` | No | HTTP request timeout in milliseconds. Default: `30000` |
| `N8N_VERSION_STORE_PATH` | No | Directory for snapshots and audit log. Default: `.versioning/` inside the server install path |
| `N8N_REQUIRE_APPROVAL` | No | Set to `true` to require explicit approve tokens for all mutations. Default: `false` |

---

## Design Principles

**Context is a resource. Waste is architectural failure.**
The model should receive the minimum context necessary to complete the task correctly. Sending more is not safer — it is noisier.

**Determinism is not optional.**
LiteNode format is predictable. The same workflow produces the same serialized output on every call. The model can reason about structure without compensating for variance.

**Safety before execution — without exception.**
No mutation reaches the n8n API without passing preflight. No preflight-passing mutation executes without a prior snapshot. Rollback is always available.

**The model is a client, not a collaborator in protocol design.**
The server makes no assumptions about which model is on the other side of the MCP boundary. The protocol and the format work identically across all compliant clients.

**Minimal surface, maximum capability.**
26 tools cover the complete workflow lifecycle — create, read, update, delete, activate, debug, rollback, and learn — without redundancy.

---

## Feedback Wanted

This project is actively optimizing for real-world production cases, not toy examples.

If you're running workflows above 50 nodes, open an issue with:

- Node count
- Token estimate from `scan_workflow`
- Your use case (what you're trying to do with AI assistance)

Edge cases from real workflows directly shape what gets built next.

→ [Open an issue](https://github.com/LunkiBR/n8n-mcp-lite/issues)

---

## Contributing

Contributions are welcome. See `CONTRIBUTING.md` for:

- Development setup
- Benchmark methodology and tooling (`benchmark.mjs`)
- Testing strategy
- Good first issues

When adding or modifying tools, maintain the LiteNode format contract and ensure all mutating paths run through the preflight pipeline.

---

## License

MIT
