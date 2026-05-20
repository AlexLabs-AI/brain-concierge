# Brain Concierge

**Task-first knowledge retrieval for multi-agent AI systems.**

> An agent can only retrieve what it knows to look for. Brain Concierge solves this — describe your task, get back a synthesized briefing, the source pages it drew from, and a map of the corpus.

---

## The Problem

Standard knowledge base retrieval requires knowing what to search for. In multi-agent systems, agents are purpose-built specialists that often lack awareness of what knowledge exists. An agent searching for "refund policy" never searches for "VIP exceptions," "escalation rules," or "January outage compensation" — not because it's broken, but because it doesn't know those concepts exist.

The query is only as good as the agent's awareness of what's in the KB.

## The Pattern

Instead of search-first, Brain Concierge uses **task-first retrieval**:

```
brain_concierge(
  task="I am preparing for a renewal call with an enterprise customer who 
        has raised pricing concerns. My goal is to retain the account 
        without discounting.",
  agent_role="account executive"
)
```

The Concierge:
1. Generates multiple semantic search queries from your task description — bridging vocabulary gaps keywords miss
2. Runs them in parallel against the knowledge base vector index
3. Deduplicates and re-ranks results
4. Synthesizes a knowledge briefing tailored to what you're actually trying to do

**Returns three layers in every response:**
- **Briefing** — synthesized, actionable knowledge for the task
- **Sources** — the exact pages retrieved, with slugs for provenance
- **KB Index** — corpus stats, slug prefixes in results, and the exact queries run

---

## Why This Matters

This pattern was designed for operational AI agent fleets — systems where multiple purpose-built agents run autonomously and need to brief themselves before starting significant work.

The core insight: **describing a task is fundamentally different from searching for information.** Task descriptions carry intent, role context, and outcome goals. When an agent describes its task, Brain Concierge can surface knowledge the agent didn't know to ask for — adjacent patterns, prior decisions, constraints documented in a different context. That's what makes it more than a retrieval wrapper.

---

## Installation

### Prerequisites

- [GBrain](https://github.com/garrytan/gbrain) installed and running (`gbrain serve --http`)
- Node.js 18+
- An MCP-compatible AI agent (OpenClaw, Claude Desktop, Cursor, etc.)
- An Anthropic API key (for synthesis)

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
- `agent_role` (optional) — Extra context about your perspective ("agentic engineer", "account executive", "market analyst")
- `depth` (optional) — `standard` (default) or `deep` for research-heavy tasks
- `include_slug_prefixes` (optional) — Pull from a specific knowledge silo (e.g. `["rockport", "lifeforce"]`)

**Examples:**

```
# Sales agent before a high-stakes renewal call
brain_concierge(
  task="I am preparing for a renewal call with an enterprise customer who 
        has raised pricing concerns. My goal is to handle the objection 
        and retain the account without discounting.",
  agent_role="account executive"
)
```

```
# Engineering agent before an architecture decision
brain_concierge(
  task="I am about to migrate our authentication system from session-based 
        to JWT tokens. My goal is to identify integration risks and ensure 
        nothing breaks for existing API consumers.",
  agent_role="backend engineer"
)
```

```
# Research agent starting a competitive analysis
brain_concierge(
  task="I am building a competitive positioning brief for a B2B SaaS product 
        entering the healthcare compliance market. My goal is to identify 
        gaps the incumbents are not addressing.",
  agent_role="market analyst"
)
```

**Returns:** A structured response with three sections — synthesized briefing, source page slugs, and KB index (corpus stats + queries run). Agents that need primary sources can drill into the slugs directly.

---

## Architecture

Brain Concierge sits between your agent and GBrain:

```
Agent
  └── brain_concierge(task="...")
        ├── Query expansion (multi-query generation from task — Sonnet)
        ├── Parallel vector search against GBrain
        │     └── Includes Accept: application/json, text/event-stream header
        ├── Deduplication + re-ranking
        └── LLM synthesis (Sonnet — higher quality briefings)
              └── Briefing + Sources + KB Index → Agent
```

The synthesis step uses `claude-sonnet-4-6` by default for higher quality briefings. Override via the `SYNTHESIS_MODEL` environment variable for cost-sensitive deployments.

---

## Evals

The `evals/` directory contains Promptfoo eval configs for benchmarking Brain Concierge against GBrain across a range of real-world task types.

| Config | Description |
|--------|-------------|
| `promptfooconfig.yaml` | 20-case eval, all task types |
| `promptfooconfig-fair.yaml` | Baseline: GBrain + Sonnet distillation + synthesis |
| `promptfooconfig-realworld.yaml` | Baseline: GBrain with natural short queries, raw chunks |

Note: benchmarking task-first retrieval against query-first retrieval has a structural limitation — any controlled eval requires someone who already knows the corpus to write the test queries, which removes the blind condition that Brain Concierge is designed for. The evals are provided as a starting point; results should be interpreted with that constraint in mind.

Run evals:
```bash
npx promptfoo eval --config evals/promptfooconfig-realworld.yaml --env-file .env.eval
```

See [evals/README.md](evals/README.md) for full setup.

---

## Roadmap

See [ROADMAP.md](ROADMAP.md) for planned features including backend abstraction (Weaviate, Pinecone, pgvector support) and a downstream task quality eval.

---

## Built by AlexLabs

Brain Concierge was developed as part of the AlexLabs AI agent fleet infrastructure. It runs in production across a fleet of operational AI agents.

Built on top of [GBrain](https://github.com/garrytan/gbrain) by Garry Tan.

**Version:** 1.1.0 | **License:** MIT
