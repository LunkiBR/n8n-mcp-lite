# n8n-mcp-lite

Token-optimized Model Context Protocol for n8n.

Reduce AI token usage by up to **97–98%** in large workflows.

Build scalable, context-aware AI automations without exploding costs or losing reliability.

---

## 🚨 The Problem

Standard MCP implementations broadcast the entire workflow graph to the model.

As workflows grow:
- Context grows exponentially
- Tokens explode
- Latency increases
- Reliability drops
- Costs become unpredictable

AI automation stops scaling.

---

## 📊 Real Benchmark Results

Measured using identical workflows.

| Scenario | n8n-mcp (standard) | n8n-mcp-lite |
|-----------|--------------------|--------------|
| 5-node workflow | ~4,000 tokens | ~500 tokens |
| 78-node workflow | ~600,000+ tokens | ~16,500 tokens |
| Focus on 2 nodes (from 38) | ~135,000 tokens | ~2,600 tokens |

### 🔥 Reduction

- Small workflow → **~87% reduction**
- Large workflow → **~97% reduction**
- Focused execution → **~98% reduction**

n8n-mcp-lite scales.  
Naive MCP does not.

---

## 🟢 Quick Start (Beginner Path)

You don’t need to understand MCP internals.

1. Install
2. Connect your model (Claude, Gemini, etc.)
3. Import `/examples/beginner`
4. Run

You now have:
- Controlled context
- Predictable token usage
- Stable AI responses
- Scalable workflow behavior

---

## 🔵 Architecture (For Developers)

### Standard MCP

Workflow → Full Graph → Model → Token Explosion

### n8n-mcp-lite

Workflow → Context Filter → Focus Engine → Model → Stable Output

Instead of sending everything:

- Nodes are segmented
- Only relevant context is transmitted
- Structured minimal payloads are generated
- Execution semantics are preserved

---

## 🧠 Design Principles

- Focus over breadth
- Minimal context, maximal signal
- Deterministic structure
- Model-agnostic
- Production-first architecture

---

## 📁 Repository Structure
/core
mcp-lite-engine

/examples
beginner
production
enterprise-pattern

/docs
architecture.md
token-strategy.md
scaling.md
---

## 🧪 Why This Matters

At 600,000+ tokens per call, large workflows become:

- Expensive
- Slow
- Unreliable

At 16,500 tokens:

- Practical
- Predictable
- Production-viable

This is not an optimization tweak.  
It is an architectural correction.

---

## 🤝 Contributing

Contributions welcome.

- Benchmark improvements
- Additional model support
- Workflow patterns
- Testing scenarios

See `CONTRIBUTING.md`.

---

## 🌍 Vision

n8n-mcp-lite aims to become the standard way of building token-efficient AI workflows in n8n.

Start lightweight.  
Scale safely.  
Design intentionally.

---

## ⭐ If This Project Helps

Give it a star and help improve AI automation standards.
