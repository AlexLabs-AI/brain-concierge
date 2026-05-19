# Brain Concierge

**Task-first knowledge retrieval for multi-agent AI systems.**

> An agent doesn't know what to ask for if it doesn't know what exists. Brain Concierge solves this — describe your task, get back exactly what you need to know.

---

## The Problem

Standard knowledge base retrieval requires knowing what to search for. In multi-agent systems, agents are purpose-built specialists that often lack awareness of what knowledge exists. Asking a design agent to "search for relevant patterns" before starting work produces poor results — the agent doesn't know the vocabulary, the categories, or what's even in the KB.

## The Pattern

Instead of search-first, Brain Concierge uses **task-first retrieval**:

```
brain_concierge(
  task="I am Atlas, about to design the curriculum ingestion pipeline. 
        My goal is idempotent PDF processing with extraction quality guarantees.",
  agent_role="agentic engineer"
)
```

The Concierge:
1. Generates multiple semantic search queries from your task description — bridging vocabulary gaps keywords miss
2. Runs them in parallel against the knowledge base vector index
3. Deduplicates and re-ranks results
4. Synthesizes a curated knowledge briefing tailored to what you're actually trying to do

You get back a synthesized briefing, not a list of pages.

---

## Why This Matters

This pattern was designed for operational AI agent fleets — systems where multiple purpose-built agents run autonomously and need to brief themselves before starting significant work.

The core insight: **describing a task is fundamentally different from searching for information.** Task descriptions carry intent, role context, and outcome goals. Keyword searches don't. Brain Concierge bridges that gap.

---

## Installation

### Prerequisites

- [GBrain](https://github.com/garrytan/gbrain) installed and running (`gbrain serve --http`)
- Node.js 18+
- An MCP-compatible AI agent (OpenClaw, Claude Desktop, Cursor, etc.)

### Setup

```bash
git clone https://github.com/AlexLabs-AI/brain-concierge.git
cd brain-concierge
npm install
cp .env.example .env
# Edit .env with your GBrain connection details
```

### Configuration

```bash
# Start the Concierge MCP server
node server.js
```

The server starts on port `7351` by default. Add it to your agent's MCP config:

```json
{
  "mcpServers": {
    "brain-concierge": {
      "url": "http://localhost:7351/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer your-token-here"
      }
    }
  }
}
```

See [INSTALL.md](INSTALL.md) for full setup instructions including token generation and GBrain integration.

---

## Usage

### Primary tool: `brain_concierge`

```
brain_concierge(task="<what you are about to do and why>")
```

**Parameters:**
- `task` (required) — Plain language description of what you're doing and what you're trying to achieve
- `agent_role` (optional) — Extra context about your perspective ("agentic engineer", "infrastructure lead", "marketing strategist")
- `depth` (optional) — How deep to go on retrieval (default: standard)
- `include_slug_prefixes` (optional) — Pull from a specific knowledge silo (e.g. `["rockport", "lifeforce"]`)

**Example:**
```
brain_concierge(
  task="I am about to design a new agent for customer onboarding. 
        My goal is to define the right escalation thresholds and tool set.",
  agent_role="agentic engineer"
)
```

**Returns:** A synthesized knowledge briefing — not a list of pages.

### Additional tools

- `brain_search` — Direct keyword search
- `brain_query` — Direct vector query
- `brain_get` — Retrieve a specific page by slug
- `brain_list` — List pages with filters
- `brain_stats` — Brain statistics

---

## Architecture

Brain Concierge sits between your agent and GBrain:

```
Agent
  └── brain_concierge(task="...")
        ├── Query expansion (multi-query generation from task)
        ├── Parallel vector search against GBrain
        ├── Deduplication + re-ranking
        └── LLM synthesis (Haiku — fast, cheap)
              └── Synthesized briefing → Agent
```

The synthesis step uses a small model (Haiku by default) to produce a briefing tailored to the task context. The retrieval mechanics are standard hybrid search — the differentiation is in the task framing and synthesis layer.

---

## Built by AlexLabs

Brain Concierge was developed as part of the AlexLabs AI agent fleet infrastructure. It runs in production across a fleet of operational AI agents.

Built on top of [GBrain](https://github.com/garrytan/gbrain) by Garry Tan.

**License:** MIT
