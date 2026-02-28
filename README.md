# n8n-mcp-lite

Token-optimized Model Context Protocol for n8n.

Reduce AI token usage by up to **97–98%** in large workflows.

---

## 📊 Real Benchmark Results

Measured using identical workflows.

| Scenario | n8n-mcp (standard) | n8n-mcp-lite |
|-----------|--------------------|--------------|
| 5-node workflow | ~4,000 tokens | ~500 tokens |
| 78-node workflow | ~600,000+ tokens | ~16,500 tokens |
| Focus on 2 nodes (from 38) | ~135,000 tokens | ~2,600 tokens |

### Reduction

- Small workflow → ~87% reduction  
- Large workflow → ~97% reduction  
- Focused execution → ~98% reduction  

This is not a micro-optimization.  
It is an architectural correction.

---

# 🚀 Installation

Choose your environment:

---

## 🟢 Cursor

1. Open Cursor.
2. Go to Settings → MCP.
3. Add a new MCP server.
4. Point to this repository.
5. Restart Cursor.

You're ready to build token-efficient workflows.

---

## 🟢 Claude Desktop

1. Open Claude Desktop.
2. Configure MCP server path.
3. Add n8n-mcp-lite as your MCP provider.
4. Restart Claude.

Now Claude will operate with focused context instead of full-graph broadcasting.

---

## 🟢 Generic MCP-Compatible Clients

If your client supports custom MCP servers:

1. Clone this repository.
2. Run the MCP server locally.
3. Register it in your client config.
4. Start building.

---

# 🟢 Quick Start (Beginner Friendly)

1. Import `/examples/beginner`.
2. Run a scan.
3. Focus on selected nodes.
4. Observe token difference.

No deep MCP knowledge required.

---

# 🔵 Architecture Overview (For Developers)

## The Problem with Standard MCP

Traditional implementations:

Workflow → Full Graph → Model → Token Explosion

As workflows grow:
- Context scales linearly
- Tokens scale exponentially
- Reliability degrades

## n8n-mcp-lite Strategy

Workflow → Context Filter → Focus Engine → Model → Stable Output

Instead of broadcasting everything:

- Segment workflow intelligently
- Filter irrelevant nodes
- Send minimal structured payload
- Preserve execution semantics

---

# 🧠 Design Principles

- Focus over breadth
- Minimal context, maximal signal
- Deterministic structure
- Model-agnostic
- Production-ready behavior

---

# 📁 Repository Structure

/core  
/examples  
/docs  

---

# 🧪 When Should You Use This?

Use n8n-mcp-lite if:

- Workflows exceed 20+ nodes
- You hit context window limits
- Token costs are rising
- AI responses become unstable
- You care about scalable automation design

---

# 🤝 Contributing

Contributions welcome.

See CONTRIBUTING.md for:

- Setup instructions
- Benchmark methodology
- Testing strategy
- Good first issues

---

# 🌍 Vision

n8n-mcp-lite aims to become the standard approach for building context-aware AI workflows in n8n.

Start lightweight.  
Scale safely.  
Design intentionally.

---

# ⭐ Support

If this project improves your workflow reliability or reduces token usage, consider giving it a star.