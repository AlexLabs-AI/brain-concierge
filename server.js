#!/usr/bin/env node
/**
 * Brain Concierge MCP Server
 * Task-first knowledge retrieval for multi-agent AI systems.
 *
 * https://github.com/AlexLabs-AI/brain-concierge
 *
 * Required env vars (see .env.example):
 *   GBRAIN_URL        — GBrain HTTP MCP server URL (e.g. http://localhost:7350)
 *   GBRAIN_TOKEN      — Bearer token for GBrain HTTP server
 *   CONCIERGE_TOKEN   — Bearer token agents use to authenticate with this server
 *   ANTHROPIC_API_KEY — Anthropic API key for synthesis (Haiku)
 *   PORT              — Port to listen on (default: 7351)
 *   SYNTHESIS_MODEL   — Model for synthesis (default: claude-haiku-4-5)
 */

require("dotenv").config();

const http = require("http");
const https = require("https");
const crypto = require("crypto");

// ─── Config ───────────────────────────────────────────────────────────────────

const GBRAIN_URL = process.env.GBRAIN_URL || "http://localhost:7350";
const GBRAIN_TOKEN = process.env.GBRAIN_TOKEN || "";
const CONCIERGE_TOKEN = process.env.CONCIERGE_TOKEN || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const PORT = parseInt(process.env.PORT || "7351", 10);
const SYNTHESIS_MODEL = process.env.SYNTHESIS_MODEL || "claude-haiku-4-5";
const MAX_RESULTS = parseInt(process.env.MAX_RESULTS || "8", 10);
const QUERY_LIMIT = parseInt(process.env.QUERY_LIMIT || "5", 10);

if (!GBRAIN_TOKEN) { console.error("GBRAIN_TOKEN is required"); process.exit(1); }
if (!CONCIERGE_TOKEN) { console.error("CONCIERGE_TOKEN is required"); process.exit(1); }
if (!ANTHROPIC_API_KEY) { console.error("ANTHROPIC_API_KEY is required"); process.exit(1); }

// ─── GBrain HTTP client ────────────────────────────────────────────────────────

async function gbrainCall(toolName, args) {
  const url = new URL("/mcp", GBRAIN_URL);
  const body = JSON.stringify({
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name: toolName, arguments: args }
  });

  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${GBRAIN_TOKEN}`,
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 20000
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          // GBrain HTTP MCP server returns SSE format: "event: message\ndata: {...}"
          // Strip the SSE envelope before parsing JSON
          const jsonStr = data.replace(/^event:\s*\w+\s*\ndata:\s*/m, "").trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed.result?.content?.[0]?.text) {
            resolve(parsed.result.content[0].text);
          } else {
            resolve("");
          }
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("GBrain request timed out")); });
    req.write(body);
    req.end();
  });
}

// ─── Anthropic synthesis ──────────────────────────────────────────────────────

async function synthesize(task, agentRole, chunks) {
  const systemPrompt = `You are a knowledge briefing engine. Given a task description and raw knowledge base excerpts, synthesize a concise, relevant knowledge package.

Rules:
- Extract only what is directly relevant to the task
- Organize by relevance, not source order
- Include concrete facts, patterns, decisions, and prior work
- Flag any contradictions or gaps
- Be terse — the agent is about to start work, not write a report
- Max 600 words`;

  const userPrompt = `Task: ${task}${agentRole ? `\nAgent role: ${agentRole}` : ""}

Knowledge base excerpts:
${chunks}

Synthesize a knowledge briefing for this agent.`;

  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: SYNTHESIS_MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }]
    });

    const req = https.request("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 30000
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          resolve(parsed.content?.[0]?.text || "Synthesis failed.");
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Anthropic request timed out")); });
    req.write(body);
    req.end();
  });
}

// ─── Generate search queries from task ────────────────────────────────────────

async function generateQueries(task, agentRole) {
  const prompt = `Generate ${QUERY_LIMIT} distinct semantic search queries to retrieve knowledge relevant to this task.

Task: ${task}${agentRole ? `\nAgent role: ${agentRole}` : ""}

Return one query per line. No numbering, no explanation. Focus on different angles: concepts, prior decisions, patterns, domain knowledge, constraints.`;

  const body = JSON.stringify({
    model: SYNTHESIS_MODEL,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }]
  });

  try {
    const result = await new Promise((resolve, reject) => {
      const req = https.request("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: 15000
      }, (res) => {
        let data = "";
        res.on("data", c => data += c);
        res.on("end", () => {
          try { resolve(JSON.parse(data).content?.[0]?.text || ""); }
          catch (e) { reject(e); }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => { req.destroy(); reject(new Error("timeout")); });
      req.write(body);
      req.end();
    });
    return result.split("\n").map(q => q.trim()).filter(q => q.length > 0).slice(0, QUERY_LIMIT);
  } catch {
    // Fallback: use task description directly
    return [task];
  }
}

// ─── Brain Concierge core ─────────────────────────────────────────────────────

async function brainConcierge(task, agentRole, depth, includeSlugPrefixes) {
  // 1. Generate parallel search queries
  const queries = await generateQueries(task, agentRole);

  // 2. Run queries in parallel against GBrain
  const limit = depth === "deep" ? Math.ceil(MAX_RESULTS * 1.5) : MAX_RESULTS;
  const args = includeSlugPrefixes?.length
    ? (q) => ({ query: q, limit, include_slug_prefixes: includeSlugPrefixes })
    : (q) => ({ query: q, limit });

  const results = await Promise.allSettled(
    queries.map(q => gbrainCall("query", args(q)).catch(() => ""))
  );

  // 3. Deduplicate and collect chunks
  const seen = new Set();
  const chunks = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      // Simple dedup: skip if we've seen >80% of this content before
      const key = r.value.slice(0, 120);
      if (!seen.has(key)) {
        seen.add(key);
        chunks.push(r.value);
      }
    }
  }

  if (chunks.length === 0) {
    return "No relevant knowledge found for this task. The knowledge base may not have coverage in this area yet.";
  }

  // 4. Synthesize
  const combined = chunks.join("\n\n---\n\n").slice(0, 12000); // cap context
  const briefing = await synthesize(task, agentRole, combined);

  return `# Knowledge Briefing\n**Task:** ${task}${agentRole ? `\n**Role:** ${agentRole}` : ""}\n\n---\n\n${briefing}\n\n---\n*Queries run: ${queries.length} | Sources: ${chunks.length}*`;
}

// ─── MCP tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "brain_concierge",
    description: "Task-first knowledge retrieval. Describe what you are about to do — get back a synthesized knowledge briefing. Use this before any significant task instead of manual search.",
    inputSchema: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "Describe your task in plain language. Include your role, goal, and constraints. Example: 'I am about to respond to a churn risk alert for a high-value account. The customer cited slow onboarding and missing integrations. My goal is to build a retention plan that addresses both.'"
        },
        agent_role: {
          type: "string",
          description: "Your role or name (e.g. 'agentic engineer', 'Atlas — CAE'). Helps tailor the knowledge package."
        },
        depth: {
          type: "string",
          enum: ["standard", "deep"],
          description: "standard (default): concise package. deep: more content for research-heavy tasks."
        },
        include_slug_prefixes: {
          type: "array",
          items: { type: "string" },
          description: "Opt into specific knowledge silos (e.g. ['rockport']). Omit for default cross-fleet search."
        }
      },
      required: ["task"]
    }
  }
];

// ─── Auth ─────────────────────────────────────────────────────────────────────

function validateBearer(req) {
  const auth = req.headers["authorization"] || "";
  const m = auth.match(/^Bearer\s+(\S+)$/i);
  if (!m) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(m[1]), Buffer.from(CONCIERGE_TOKEN));
  } catch { return false; }
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // Health check (no auth required)
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", version: "1.0.0", tools: TOOLS.map(t => t.name) }));
    return;
  }

  if (req.url === "/mcp" && req.method === "POST") {
    if (!validateBearer(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    let body = "";
    req.on("data", c => body += c);
    req.on("end", async () => {
      try {
        const rpc = JSON.parse(body);
        let result;

        if (rpc.method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "brain-concierge", version: "1.0.0" }
          };
        } else if (rpc.method === "tools/list" || rpc.method === "notifications/initialized") {
          result = { tools: TOOLS };
        } else if (rpc.method === "tools/call") {
          const { name, arguments: args } = rpc.params;
          if (name === "brain_concierge") {
            if (!args?.task) {
              result = { content: [{ type: "text", text: "Error: task is required." }] };
            } else {
              const briefing = await brainConcierge(
                args.task,
                args.agent_role,
                args.depth,
                args.include_slug_prefixes
              );
              result = { content: [{ type: "text", text: briefing }] };
            }
          } else {
            result = { content: [{ type: "text", text: `Unknown tool: ${name}` }] };
          }
        } else {
          result = { error: `Unknown method: ${rpc.method}` };
        }

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id ?? null, result }));
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: e.message } }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end();
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`Brain Concierge MCP server running on :${PORT}`);
  console.log(`GBrain: ${GBRAIN_URL}`);
  console.log(`Synthesis model: ${SYNTHESIS_MODEL}`);
  console.log(`Health: http://localhost:${PORT}/health`);
});
