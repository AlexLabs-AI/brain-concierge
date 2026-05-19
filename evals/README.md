# Brain Concierge Eval Suite

Benchmarks `brain_concierge` (task-first retrieval + synthesis) against a raw GBrain `query` call using the same task string as input. This answers the core empirical question: does the task-framing + synthesis layer produce measurably better output than piping the same text directly into GBrain?

## Setup

```bash
# Install promptfoo
npm install -g promptfoo

# Copy and fill in your credentials
cp .env.example .env
# Set: GBRAIN_URL, GBRAIN_TOKEN, CONCIERGE_URL, CONCIERGE_TOKEN, ANTHROPIC_API_KEY
```

## Run

```bash
# From the repo root
npx promptfoo eval --config evals/promptfooconfig.yaml

# View results in browser
npx promptfoo view
```

## What it tests

8 test cases across 4 domains:

| Domain | Cases |
|--------|-------|
| Agentic engineering | Agent architecture, context window economics |
| Infrastructure / ops | GBrain setup, OpenClaw deployment |
| Business / brand context | Lifeforce Financial, Rockport Studios |
| Edge cases | No KB coverage, vague task |

Each test runs both providers on the same input and scores with LLM-as-judge (relevance, completeness, actionability). Results show whether `brain_concierge` meaningfully outperforms raw GBrain query.

## Interpreting results

- **brain_concierge wins consistently** → task framing + synthesis adds real value; the interface contract is doing work
- **gbrain-baseline ties or wins** → synthesis overhead not justified; consider making brain_concierge a thin pass-through for those task types
- **Both fail on edge cases** → expected; documents KB coverage gaps

## Adding test cases

Add entries to `promptfooconfig.yaml` under `tests:`. Follow the pattern: real task a fleet agent would perform, LLM-rubric assertion that describes what a good response looks like.
