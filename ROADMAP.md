# Brain Concierge Roadmap

## v1.1.0 (current)
- **Sonnet default** — synthesis model upgraded from Haiku to Sonnet for higher-quality briefings
- **Always-on sources** — every response includes the source pages the briefing drew from
- **KB index bundled** — every response includes corpus shape (page count, prefixes found, queries used)
- **Eval suite** — `evals/` directory with Promptfoo config benchmarking concierge vs. raw GBrain baseline

## v1.2.0 (planned)
- **Eval results published** — run the baseline comparison on the AlexLabs corpus; make the empirical claim defensible
- **Ranked source scores** — surface relevance scores alongside source slugs when GBrain returns structured JSON
- **`depth: deep` + model auto-escalation** — deep mode triggers longer retrieval; optionally escalates synthesis model

## v2.0.0 (future)
- **Backend abstraction** — extract GBrain client into a provider interface (`search(queries, limit) → chunks`)
  - Enables Weaviate, Pinecone, pgvector, Qdrant adapters
  - Makes Brain Concierge a pattern any team can adopt, not a GBrain-only plugin
  - GBrain remains the reference implementation; other backends are community adapters
- **Downstream task quality eval** — the eval that actually maps to the core claim
  - Two agent fleets, same task corpus: one with Brain Concierge, one with raw GBrain
  - Score work product quality downstream, not retrieval precision
  - Measures "did the briefing surface what the agent needed to do the job well" rather than "did retrieval hit the right page"
  - Standard retrieval benchmarks cannot capture the value of task-first retrieval because any controlled test requires someone who already knows the corpus to write the test queries — removing the blind condition that makes the pattern valuable
- **`kb_index` standalone tool** — separate MCP tool that returns full corpus map (top tags, entity types, recent additions) without triggering a retrieval + synthesis cycle
- **Streaming responses** — stream the briefing as it synthesizes rather than waiting for the full response

## Design decisions log

**Why always return sources?** (v1.1.0)
Provenance is always valuable and cannot be reconstructed after synthesis. Summary-alone is strictly inferior to summary-with-sources. Agents can ignore sources they don't need; they cannot recover sources that were never returned. Simpler than a mode flag, stronger by default.

**Why bundle KB index into the response?** (v1.1.0)
Three-layer orientation in one call: briefing (what's relevant), sources (where it came from), KB index (what else exists). Agent arrives fully oriented — can validate the briefing against sources, or discover unexplored corpus silos from the index and re-query. Additive to the briefing, not a separate round-trip.

**Why Sonnet over Haiku?** (v1.1.0)
Synthesis quality matters more than synthesis speed for the use case. Agents that are blocked on a briefing can wait 2-3 extra seconds for a better one. Haiku remains available via `SYNTHESIS_MODEL` env var for cost-sensitive deployments or heartbeat agents where speed matters more.

**Why no mode flag?** (v1.1.0)
A mode flag (`briefing` / `sources` / `both`) adds interface complexity for marginal benefit. Always returning all three layers is the cleaner design — it makes the tool unconditionally useful for agents that need provenance (legal, factual, financial tasks) without requiring them to know to ask for it.
