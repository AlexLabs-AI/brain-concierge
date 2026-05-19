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
 *   ANTHROPIC_API_KEY — Anthropic API key for synthesis
 *   PORT              — Port to listen on (default: 7351)
 *   SYNTHESIS_MODEL   — Model for synthesis (default: claude-sonnet-4-6)
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
const SYNTHESIS_MODEL = process.env.SYNTHESIS_MODEL || "claude-sonnet-4-6";
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
          const jsonStr = data.replace(/^event:\s*\w+\s*\ndata:\s*/m, "").trim();
          const parsed = JSON.parse(jsonStr);
          if (parsed.error) {
            reject(new Error(`GBrain error: ${parsed.error.message || JSON.stringify(parsed.error)}`));
          } else if (parsed.result?.content?.[0]?.text) {
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

// ─── GBrain query with source extraction ──────────────────────────────────────

async function gbrainQuery(args) {
  // Returns { text: string, sources: [{slug, title, score}] }
  const rawText = await gbrainCall("query", args);

  // GBrain may return JSON-serialized results — try to parse for structured source data
  let sources = [];
  let text = rawText;

  try {
    const parsed = JSON.parse(rawText);
    if (Array.isArray(parsed)) {
      sources = parsed
        .filter(r => r.slug)
        .map(r => ({ slug: r.slug, title: r.title || r.slug, score: r.score || null }));
      text = parsed.map(r => r.chunk_text || r.text || "").filter(Boolean).join("\n\n");
      return { text, sources };
    }
  } catch {
    // Not JSON — attempt to extract slug patterns from formatted text
    const slugPattern = /\b([a-z][a-z0-9-]+(?:\/[a-z][a-z0-9-]+)+)\b/g;
    const matches = [...new Set((rawText.match(slugPattern) || []))];
    sources = matches.slice(0, 10).map(slug => ({ slug, title: null, score: null }));
  }

  return { text, sources };
}

// ─── GBrain corpus stats ──────────────────────────────────────────────────────

async function gbrainStats() {
  // Returns basic KB stats for the kb_index section
  try {
    const raw = await gbrainCall("get_stats", {});
    try {
      const parsed = JSON.parse(raw);
      return {
        page_count: parsed.page_count || parsed.pages || null,
        chunk_count: parsed.chunk_count || parsed.chunks || null
      };
    } catch {
      return { raw: raw.slice(0, 200) };
    }
  } catch {
    return null;
  }
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
    return [task];
  }
}

// ─── Brain Concierge core ─────────────────────────────────────────────────────

async function brainConcierge(task, agentRole, depth, includeSlugPrefixes) {
  // Run query generation and KB stats fetch in parallel
  const [queries, stats] = await Promise.all([
    generateQueries(task, agentRole),
    gbrainStats()
  ]);

  // Build query args
  const limit = depth === "deep" ? Math.ceil(MAX_RESULTS * 1.5) : MAX_RESULTS;
  const buildArgs = includeSlugPrefixes?.length
    ? (q) => ({ query: q, limit, include_slug_prefixes: includeSlugPrefixes })
    : (q) => ({ query: q, limit });

  // Run all queries in parallel with structured source extraction
  const results = await Promise.allSettled(
    queries.map(q => gbrainQuery(buildArgs(q)))
  );

  const allFailed = results.every(r => r.status === "rejected");
  if (allFailed) {
    const firstError = results[0].reason?.message || "Unknown error";
    return `Retrieval error: all GBrain queries failed. First error: ${firstError}\n\nCheck that the GBrain server is reachable and GBRAIN_TOKEN is valid.`;
  }

  // Deduplicate chunks and collect all sources
  const seenText = new Set();
  const seenSlugs = new Set();
  const chunks = [];
  const allSources = [];

  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      const { text, sources } = r.value;
      if (text) {
        const key = text.slice(0, 120);
        if (!seenText.has(key)) {
          seenText.add(key);
          chunks.push(text);
        }
      }
      for (const src of (sources || [])) {
        if (src.slug && !seenSlugs.has(src.slug)) {
          seenSlugs.add(src.slug);
          allSources.push(src);
        }
      }
    }
  }

  if (chunks.length === 0) {
    return "No relevant knowledge found for this task. The knowledge base may not have coverage in this area yet.";
  }

  // Synthesize briefing
  const combined = chunks.join("\n\n---\n\n").slice(0, 12000);
  const briefing = await synthesize(task, agentRole, combined);

  // Derive KB index: unique slug prefixes found across all results
  const prefixes = [...new Set(allSources.map(s => s.slug.split("/")[0]))].sort();

  // ─── Format output ────────────────────────────────────────────────────────

  const header = [
    `# Knowledge Briefing`,
    `**Task:** ${task}`,
    agentRole ? `**Role:** ${agentRole}` : null,
  ].filter(Boolean).join("\n");

  const sourcesSection = allSources.length > 0
    ? [
        `## Sources`,
        ...allSources.slice(0, 20).map(s =>
          s.title && s.title !== s.slug
            ? `- \`${s.slug}\` — ${s.title}`
            : `- \`${s.slug}\``
        )
      ].join("\n")
    : `## Sources\n*Source slugs not available in this GBrain response format.*`;

  const kbIndexLines = [
    `## KB Index`,
    stats?.page_count ? `**Corpus:** ${stats.page_count.toLocaleString()} pages | ${(stats.chunk_count || 0).toLocaleString()} chunks` : null,
    `**Queries run:** ${queries.length} | **Unique sources found:** ${allSources.length}`,
    prefixes.length > 0 ? `**Prefixes in results:** ${prefixes.join(", ")}` : null,
    ``,
    `**Queries used:**`,
    ...queries.map(q => `- ${q}`)
  ].filter(s => s !== null).join("\n");

  return [header, `---`, briefing, `---`, sourcesSection, `---`, kbIndexLines].join("\n\n");
}

// ─── MCP tool definitions ─────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "brain_concierge",
    description: "Task-first knowledge retrieval. Describe what you are about to do — get back a synthesized briefing, the source pages it drew from, and a map of the KB corpus. Use this before any significant task instead of manual search.",
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
    res.end(JSON.stringify({ status: "ok", version: "1.1.0", tools: TOOLS.map(t => t.name) }));
    return;
  }

  if (req.url === "/mcp" && req.method === "POST") {
    if (!validateBearer(req)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "unauthorized" }));
      return;
    }

    let body = "";
    let bodyBytes = 0;
    const MAX_BODY = 1024 * 512;
    req.on("data", c => {
      bodyBytes += c.length;
      if (bodyBytes > MAX_BODY) {
        req.destroy();
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "request_too_large" }));
        return;
      }
      body += c;
    });
    req.on("end", async () => {
      try {
        const rpc = JSON.parse(body);
        let result;

        if (rpc.method === "initialize") {
          result = {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "brain-concierge", version: "1.1.0" }
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
