/**
 * Fair GBrain baseline provider for Promptfoo
 *
 * Mirrors Brain Concierge's pipeline but with a single Sonnet distillation
 * step (1-2 focused queries) instead of Brain Concierge's 5-query expansion.
 *
 * Pipeline:
 *   task → Sonnet distills to 2 concise queries
 *       → GBrain retrieval (parallel)
 *       → Sonnet synthesis → briefing
 *
 * This isolates whether Brain Concierge's multi-query expansion (5 queries)
 * adds value over a single well-formed distillation (2 queries), holding
 * synthesis model and KB constant.
 */

const https = require("https");
const http = require("http");

const GBRAIN_URL = process.env.GBRAIN_URL || "http://localhost:7350";
const GBRAIN_TOKEN = process.env.GBRAIN_TOKEN || "";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = process.env.SYNTHESIS_MODEL || "claude-sonnet-4-6";

// ─── Anthropic call ───────────────────────────────────────────────────────────

function anthropicCall(messages, maxTokens = 512) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      messages
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
          if (res.statusCode !== 200) {
            reject(new Error(`Anthropic ${res.statusCode}: ${parsed.error?.message}`));
          } else {
            resolve(parsed.content?.[0]?.text || "");
          }
        } catch (e) { reject(e); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("Anthropic timeout")); });
    req.write(body);
    req.end();
  });
}

// ─── GBrain query ─────────────────────────────────────────────────────────────

function gbrainQuery(query, limit = 8) {
  return new Promise((resolve, reject) => {
    const url = new URL("/mcp", GBRAIN_URL);
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: { name: "query", arguments: { query, limit } }
    });
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.request(url.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "Authorization": `Bearer ${GBRAIN_TOKEN}`,
        "Content-Length": Buffer.byteLength(body)
      },
      timeout: 20000
    }, (res) => {
      let data = "";
      res.on("data", c => data += c);
      res.on("end", () => {
        try {
          const line = data.split("\n").find(l => l.startsWith("data:"));
          if (!line) { resolve([]); return; }
          const parsed = JSON.parse(line.replace(/^data:\s*/, "").trim());
          const text = parsed?.result?.content?.[0]?.text || "[]";
          resolve(JSON.parse(text));
        } catch { resolve([]); }
      });
    });
    req.on("error", reject);
    req.on("timeout", () => { req.destroy(); reject(new Error("GBrain timeout")); });
    req.write(body);
    req.end();
  });
}

// ─── Main provider ────────────────────────────────────────────────────────────

class GbrainFairProvider {
  constructor(options) {
    this.id = () => "gbrain-fair-baseline";
  }

  async callApi(prompt, context) {
    const task = context?.vars?.task || prompt;
    const agentRole = context?.vars?.agent_role || "";

    // Step 1: Distill task to 2 focused search queries
    const distillText = await anthropicCall([{
      role: "user",
      content: `Convert this task description into exactly 2 concise semantic search queries (5-10 words each) that would retrieve the most relevant knowledge from a knowledge base.\n\nTask: ${task}${agentRole ? `\nRole: ${agentRole}` : ""}\n\nReturn exactly 2 queries, one per line. No numbering, no explanation.`
    }], 128);

    const queries = distillText.split("\n").map(q => q.trim()).filter(q => q.length > 0).slice(0, 2);
    if (queries.length === 0) queries.push(task.slice(0, 100));

    // Step 2: Run queries against GBrain in parallel
    const results = await Promise.allSettled(queries.map(q => gbrainQuery(q, 8)));

    const seenSlugs = new Set();
    const chunks = [];
    for (const r of results) {
      if (r.status === "fulfilled" && Array.isArray(r.value)) {
        for (const chunk of r.value) {
          if (chunk.slug && !seenSlugs.has(chunk.slug)) {
            seenSlugs.add(chunk.slug);
            chunks.push(chunk);
          }
        }
      }
    }

    if (chunks.length === 0) {
      return { output: "No relevant knowledge found for this task.", metadata: { queries, chunks: 0 } };
    }

    // Step 3: Synthesize with Sonnet (same as Brain Concierge)
    const combined = chunks.map(c => c.chunk_text || "").join("\n\n---\n\n").slice(0, 12000);
    const briefing = await anthropicCall([{
      role: "user",
      content: `Task: ${task}${agentRole ? `\nAgent role: ${agentRole}` : ""}\n\nKnowledge base excerpts:\n${combined}\n\nSynthesize a concise knowledge briefing for this agent. Extract only what is directly relevant. Be terse — max 600 words.`
    }], 1024);

    // Format to match Brain Concierge output structure
    const sources = chunks.slice(0, 20).map(c => `- \`${c.slug}\``).join("\n");
    const output = [
      `# Knowledge Briefing (GBrain Baseline)`,
      `**Task:** ${task}`,
      agentRole ? `**Role:** ${agentRole}` : null,
      `---`,
      briefing,
      `---`,
      `## Sources`,
      sources,
      `---`,
      `## KB Index`,
      `**Queries used (${queries.length}):**`,
      ...queries.map(q => `- ${q}`),
      `**Sources found:** ${chunks.length}`
    ].filter(Boolean).join("\n\n");

    return {
      output,
      metadata: { queries, chunks: chunks.length, model: MODEL }
    };
  }
}

module.exports = GbrainFairProvider;
