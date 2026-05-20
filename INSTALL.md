# Installation Guide

## Prerequisites

1. **GBrain** running as an HTTP MCP server
   ```bash
   gbrain serve --http --port 7350
   ```
   See [GBrain docs](https://github.com/garrytan/gbrain) for full setup.

2. **Node.js** 18 or higher

3. A **GBrain bearer token** — create one via:
   ```bash
   gbrain auth create brain-concierge
   ```
   Save the token output.

4. An **Anthropic API key** — Brain Concierge uses Claude Sonnet for synthesis.

## Install

```bash
git clone https://github.com/AlexLabs-AI/brain-concierge.git
cd brain-concierge
npm install
```

## Configure

```bash
cp .env.example .env
```

Edit `.env`:
```env
# GBrain connection
GBRAIN_URL=http://localhost:7350
GBRAIN_TOKEN=your-gbrain-token-here

# Concierge server
PORT=7351
CONCIERGE_TOKEN=your-concierge-bearer-token

# LLM for synthesis — Sonnet by default for high-quality briefings
# Override with claude-haiku-4-5 for cost-sensitive or high-volume deployments
ANTHROPIC_API_KEY=your-anthropic-key
SYNTHESIS_MODEL=claude-sonnet-4-6
```

## Start

```bash
node server.js
```

The server starts on the configured port (default: 7351).

## Connect to your agent

Add to your agent's MCP configuration:

```json
{
  "mcpServers": {
    "brain-concierge": {
      "url": "http://localhost:7351/mcp",
      "transport": "streamable-http",
      "headers": {
        "Authorization": "Bearer your-concierge-token"
      }
    }
  }
}
```

## Verify

```bash
curl http://localhost:7351/health
# Returns: {"status":"ok","version":"1.1.0","tools":["brain_concierge"]}
```

## What the response looks like

Every `brain_concierge` call returns three layers:

```
# Knowledge Briefing
**Task:** ...
**Role:** ...

---

[Synthesized briefing — actionable knowledge for the task]

---

## Sources
- `slug/page-name` — Page Title
- `slug/another-page`

---

## KB Index
**Corpus:** 7,211 pages | 113,723 chunks
**Queries run:** 5 | **Unique sources found:** 12
**Prefixes in results:** default, rockport, garrytan

**Queries used:**
- query one
- query two
...
```

The sources section gives full provenance. Agents that need primary sources can retrieve the slugs directly via GBrain. The KB index shows what was searched and what corpus areas were hit.

## Model selection

`SYNTHESIS_MODEL` defaults to `claude-sonnet-4-6`. Options:

| Model | Use case |
|-------|----------|
| `claude-sonnet-4-6` | Default — best synthesis quality |
| `claude-haiku-4-5` | Cost-sensitive or high-frequency deployments |

Query expansion also uses `SYNTHESIS_MODEL`, so the same model generates both the search queries and the final briefing.
