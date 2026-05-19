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

# LLM for synthesis (Anthropic Haiku recommended)
ANTHROPIC_API_KEY=your-anthropic-key
SYNTHESIS_MODEL=claude-haiku-4-5
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
# Should return: {"status":"ok","tools":"brain_concierge,..."}
```
